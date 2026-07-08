"""[routes/documents] 문서/업로드 API — 헬스·문서목록·관리자문서 CRUD·임시파일 업로드/상태·인덱싱. APIRouter.
config·core·rag.manager·state·handlers.files·deps 의존. 파서 라이브러리는 함수내 지연import.
※ 리팩토링 이동 — 본문 byte-동일(@app→@router). process_file_indexing은 백그라운드 헬퍼."""
import os
import uuid
import time
import asyncio
import tempfile
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, BackgroundTasks

from config import DATA_ROOT, DOCS_PATH, MAX_INDEXING_TASKS
from core.auth import get_current_user, get_current_user_info
from core.retriever import HybridRetriever
from core.vector_store import ChromaVectorStore
from langchain_text_splitters import RecursiveCharacterTextSplitter
from rag.manager import RAGManager
from state import indexing_tasks, indexing_semaphore
from handlers.files import _parse_upload_to_documents
from deps import limiter, _require_admin

logger = logging.getLogger("main")

router = APIRouter()


@router.get("/api/health")
async def health_check():
    """Docker healthcheck 전용 엔드포인트. 엔진이 준비된 경우만 200 반환."""
    if not RAGManager._is_ready:
        raise HTTPException(status_code=503, detail="엔진 로딩 중...")
    return {"status": "ok", "engine": "ready"}

@router.get("/api/documents")
async def get_documents(user: str = Depends(get_current_user)): # 보안 적용
    return {"documents": RAGManager.get_document_list()}

@router.post("/api/admin/upload")
@limiter.limit("3/minute")
async def admin_upload_document(request: Request, file: UploadFile = File(...), user_info: dict = Depends(_require_admin)):
    """사내 핵심 DB(DOCS_PATH)에 문서를 영구 추가"""
    filename = file.filename
    # 허용 확장자 검사 (파싱 가능한 전체 형식)
    allowed_ext = {".pdf", ".txt", ".md", ".html", ".htm", ".docx", ".xlsx", ".xls", ".pptx"}
    ext = os.path.splitext(filename)[1].lower()
    if ext not in allowed_ext:
        raise HTTPException(status_code=400, detail=f"허용되지 않는 파일 형식입니다: {ext}")

    dest = os.path.join(DOCS_PATH, filename)
    if os.path.exists(dest):
        raise HTTPException(status_code=409, detail=f"동일한 이름의 파일이 이미 존재합니다: {filename}")

    try:
        with open(dest, "wb") as f:
            content = await file.read()
            f.write(content)
        logger.info(f"📥 [Admin] 사내 DB 파일 추가: {filename} ({len(content)/1024:.1f} KB)")
        return {"success": True, "filename": filename, "size": len(content)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 저장 실패: {e}")

@router.delete("/api/admin/documents/{filename:path}")
async def admin_delete_document(filename: str, user_info: dict = Depends(_require_admin)):
    """사내 핵심 DB(DOCS_PATH)에서 문서를 영구 삭제"""
    # 경로 탈출 방지
    safe_name = os.path.basename(filename)
    target = os.path.join(DOCS_PATH, safe_name)
    if not os.path.exists(target):
        raise HTTPException(status_code=404, detail=f"파일을 찾을 수 없습니다: {safe_name}")
    try:
        os.remove(target)
        logger.info(f"🗑️ [Admin] 사내 DB 파일 삭제: {safe_name}")
        return {"success": True, "deleted": safe_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 삭제 실패: {e}")

@router.get("/api/tasks")
async def get_tasks(user_info: dict = Depends(get_current_user_info)):
    # retriever 객체는 JSON 직렬화가 안 되므로 제외하고 반환
    # [SSO 검수] 본인 업로드 태스크만 노출 (admin은 전체 — 파일명 프라이버시 보호)
    is_admin = user_info.get("role") == "admin"
    username = user_info.get("username")
    return sorted(
        [
            {k: v for k, v in dict(id=tid, **tinfo).items() if k != "retriever"}
            for tid, tinfo in indexing_tasks.items()
            if "filename" in tinfo and (is_admin or tinfo.get("username") == username)
        ],
        key=lambda x: x.get("timestamp", 0),
        reverse=True
    )

@router.post("/api/upload_temp")
async def upload_temp_document(file: UploadFile = File(...), mode: str = "fast", background_tasks: BackgroundTasks = None, user: str = Depends(get_current_user)): # 보안 적용
    # [C-01] 서버 메모리 고갈 방지를 위한 최대 태스크 수 제한
    if len(indexing_tasks) >= MAX_INDEXING_TASKS:
        raise HTTPException(
            status_code=429,
            detail=f"서버가 처리 중인 최대 태스크({MAX_INDEXING_TASKS}건)에 도달했습니다. 잠시 후 다시 시도해주세요."
        )
    try:
        content = await file.read()
        task_id = str(uuid.uuid4())
        indexing_tasks[task_id] = {
            "status": "indexing",
            "filename": file.filename,
            "timestamp": time.time(),
            "retriever": None,
            "username": user  # [SSO 검수] 업로드 파일명이 타 사용자에게 노출되지 않도록 소유자 기록
        }
        background_tasks.add_task(process_file_indexing, task_id, file.filename, content, mode)
        return {"status": "task_started", "task_id": task_id}
    except Exception as e:
        logger.error(f"📄 업로드 에러: {e}")
        return {"error": str(e)}

@router.get("/api/upload/status/{task_id}")
async def get_parsing_status(task_id: str, user: str = Depends(get_current_user)):
    task = indexing_tasks.get(task_id)
    if not task: return {"error": "존재하지 않는 작업입니다."}
    return {k: v for k, v in task.items() if k != "retriever"}

async def process_file_indexing(task_id: str, filename: str, content: bytes, mode: str):
    """인덱싱 + 자동 요약 생성

    [C-04] ChromaDB 동시 쓰기 안전성:
    - 각 태스크는 고유 디렉터리(temp_db/{task_id}) 사용 → 별도 SQLite 파일
    - indexing_semaphore(2)로 동시 작업 수 제한
    - 임베딩 모델(CPU)은 thread-safe하지 않을 수 있으므로
      동시성 문제 발생 시 Semaphore(1)로 낮추는 것을 권장
    """
    async with indexing_semaphore:
        start_task = time.time()
        
        try:
            documents = []
            if mode == "quality":
                # -------------------------------------------------------------
                # Mode B: [💎 정밀 분석] 스토리보드
                # -------------------------------------------------------------
                logger.info(f"💎 [정밀 분석] 파일 수신: \"{filename}\" ({len(content)/(1024*1024):.1f}MB)")
                logger.info(f"  ↳ ☁️ [통신] LlamaParse 클라우드 게이트웨이 접속... [인증 성공]")
                
                api_key = os.getenv("LLAMA_CLOUD_API_KEY")
                if not api_key:
                    indexing_tasks[task_id].update({"status": "error", "error": "LlamaParse API Key 미설정"})
                    return
                from llama_parse import LlamaParse
                parser = LlamaParse(result_type="markdown", language="ko", verbose=False) # Verbose 끔
                
                logger.info(f"  ↳ ⚙️ [파싱] 문서 레이아웃 및 테이블 구조 분석 요청 중...")
                p_start = time.time()
                with tempfile.NamedTemporaryFile(suffix=f"_{filename}", delete=True) as tmp:
                    tmp.write(content)
                    tmp.flush()
                    llama_docs = await parser.aload_data(tmp.name)
                
                logger.info(f"  ↳ 📥 [수신] 마크다운 변환 데이터 수집 완료 ({time.time()-p_start:.2f}초)")
                
                from langchain_core.documents import Document
                for i, d in enumerate(llama_docs):
                    documents.append(Document(page_content=d.text, metadata={"page_no": i+1, "source": filename}))
            else:
                # -------------------------------------------------------------
                # Mode A: [⚡ 고속 분석] 스토리보드
                # -------------------------------------------------------------
                logger.info(f"⚡ [고속 분석] 파일 수신: \"{filename}\" ({len(content)/(1024*1024):.1f}MB)")
                logger.info(f"  ↳ 📄 [파서] PyMuPDF 가동... 로컬 고속 추출 시작")
                
                e_start = time.time()
                try:
                    # 통합 파서로 전체 형식 처리(pdf/txt/md/html/docx/xlsx/pptx)
                    documents = await _parse_upload_to_documents(content, filename, "fast")
                except ValueError as e:
                    indexing_tasks[task_id].update({"status": "error", "error": str(e)})
                    return
                logger.info(f"  ↳ 📄 [파서] {len(documents)}페이지 텍스트 추출 완료 ({time.time()-e_start:.2f}초)")

            if not documents:
                indexing_tasks[task_id].update({"status": "error", "error": "텍스트 추출 불가"})
                return

            # [분할 단계]
            splitter = RecursiveCharacterTextSplitter(chunk_size=600, chunk_overlap=100)
            chunks = await asyncio.to_thread(splitter.split_documents, documents)
            logger.info(f"  ↳ 🧩 [분할] 의미론적 청킹 완료... {len(chunks)}개 조각 생성")

            # [임베딩 단계]
            logger.info(f"  ↳ 🖥️ [임베딩] GPU 1 활용 벡터화 및 인덱싱 시작...")
            temp_db_dir = os.path.join(DATA_ROOT, f"databases/temp_db/{task_id}")
            temp_vs = ChromaVectorStore(
                persist_directory=temp_db_dir,
                collection_name=f"temp_{task_id[:8]}",
                embeddings=RAGManager.embedder.get_embeddings()
            )
            await asyncio.to_thread(temp_vs.create_from_documents, chunks, True)

            temp_retriever = HybridRetriever(
                parent_map={str(i): d for i, d in enumerate(documents)},
                child_vector_store=temp_vs,
                parent_docs=documents,
                top_k=5
            )

            # 자동 요약 생성
            try:
                summary_context = "\n".join([d.page_content for d in documents[:10]])[:3000]
                summary_prompt = f"다음 문서의 핵심 내용을 3~5줄로 전문적이고 명확하게 요약해주세요.\n\n[문서 내용]\n{summary_context}\n\n요약:"
                summary_response = await asyncio.to_thread(RAGManager.chain._llm.invoke, summary_prompt)
                auto_summary = summary_response if isinstance(summary_response, str) else getattr(summary_response, 'content', str(summary_response))
            except Exception as e:
                logger.warning(f"⚠️ 요약 실패: {e}")
                auto_summary = "요약을 생성할 수 없습니다."

            indexing_tasks[task_id].update({
                "status": "ready",
                "retriever": temp_retriever,
                "chunks_count": len(chunks),
                "auto_summary": auto_summary.strip()
            })
            
            elapsed = time.time() - start_task
            logger.info(f"✅ [완료] 인덱싱 성공! \"{filename}\" 분석 완료 ({elapsed:.1f}초)")
            logger.info("-" * 80)
            
        except Exception as e:
            logger.error(f"❌ [오류] 분석 실패: {e}")
            indexing_tasks[task_id].update({"status": "error", "error": str(e)})
