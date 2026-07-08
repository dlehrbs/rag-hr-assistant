"""[projects_logic] 프로젝트 공간 로직 — 디스크 영속 인덱스 + 런타임 retriever LRU 캐시,
프로젝트별 락(동시 업로드 lost-update 방지), 파일 인덱싱/삭제, 멤버 권한(role/access).
config·state·handlers.files·core·rag.manager·langchain에 의존. routes/projects·main(generator 재노출) 사용.
※ 리팩토링으로 main.py에서 이동 — 함수 본문 byte-동일."""
import os
import time
import asyncio
import sqlite3
import pickle
import logging
from collections import OrderedDict
from typing import Dict

from fastapi import HTTPException
from langchain_text_splitters import RecursiveCharacterTextSplitter

from config import FEEDBACK_DB, PROJECT_DB_ROOT, PROJECT_RETRIEVER_CACHE_MAX
from core.retriever import HybridRetriever
from core.vector_store import ChromaVectorStore
from rag.manager import RAGManager
from state import indexing_semaphore
from handlers.files import _parse_upload_to_documents

logger = logging.getLogger("main")

# --- 프로젝트 공간: 디스크 영속 인덱스 + 런타임 retriever 캐시 ---
# project_retrievers 는 lazy-load LRU 캐시(evict돼도 디스크 유지 → 다음 검색 때 자동 재로드).
project_retrievers: "OrderedDict[str, HybridRetriever]" = OrderedDict()
# ★ 프로젝트별 락 — 같은 프로젝트의 인덱싱/삭제를 직렬화(lost-update 방지). 다른 프로젝트는 병렬.
project_locks: Dict[str, asyncio.Lock] = {}


def _get_project_lock(project_id: str) -> asyncio.Lock:
    lock = project_locks.get(project_id)
    if lock is None:
        lock = asyncio.Lock()
        project_locks[project_id] = lock
    return lock

def _set_project_file_status(file_id: str, **fields):
    """project_files 행 상태 갱신 (스레드/백그라운드에서 호출 가능)."""
    try:
        conn = sqlite3.connect(FEEDBACK_DB)
        sets = ", ".join(f"{k}=?" for k in fields)
        conn.execute(f"UPDATE project_files SET {sets} WHERE id=?", (*fields.values(), file_id))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"❌ [프로젝트] 파일 상태 갱신 실패: {e}")

def _build_project_retriever(project_id: str):
    """디스크의 프로젝트 인덱스(Chroma + parent_map.pkl)로 HybridRetriever 복원.
    flat 청크 인덱싱(청크=parent=child) — vector·BM25 경로 모두 동작."""
    proj_dir = os.path.join(PROJECT_DB_ROOT, project_id)
    pmap_path = os.path.join(proj_dir, "parent_map.pkl")
    if not os.path.exists(pmap_path):
        return None
    with open(pmap_path, "rb") as f:
        parent_map = pickle.load(f)
    parent_docs = list(parent_map.values())
    if not parent_docs:
        return None
    vs = ChromaVectorStore(
        persist_directory=proj_dir,
        collection_name=f"proj_{project_id[:8]}",
        embeddings=RAGManager.embedder.get_embeddings(),
    )
    vs.load_existing()
    return HybridRetriever(
        parent_map=parent_map,
        child_vector_store=vs,
        parent_docs=parent_docs,
        top_k=7,
    )

def load_project_retriever(project_id: str):
    """런타임 LRU 캐시 우선, 없으면 디스크에서 lazy-load. 한도 초과 시 가장 오래된 것 evict."""
    cached = project_retrievers.get(project_id)
    if cached is not None:
        project_retrievers.move_to_end(project_id)   # 최근 사용 표시
        return cached
    retriever = _build_project_retriever(project_id)
    if retriever is not None:
        project_retrievers[project_id] = retriever
        project_retrievers.move_to_end(project_id)
        while len(project_retrievers) > PROJECT_RETRIEVER_CACHE_MAX:
            evicted_id, _ = project_retrievers.popitem(last=False)   # 가장 오래된 것 제거
            logger.info(f"  ↳ ♻️ [프로젝트캐시] LRU evict: {evicted_id[:8]} (보관 {PROJECT_RETRIEVER_CACHE_MAX}개 초과)")
    return retriever

async def index_file_into_project(project_id: str, file_id: str, filename: str, content: bytes, mode: str):
    """업로드 파일을 프로젝트 인덱스에 누적(append). parent_map.pkl 갱신 후 retriever 캐시 재구축."""
    async with indexing_semaphore:
        start = time.time()
        logger.info(f"📥 [프로젝트:{project_id[:8]}] 파일 인덱싱 시작: '{filename}' ({len(content)/1024:.0f}KB, 모드:{mode})")
        try:
            # [진행률] 단계별 stage/progress 갱신 → 프론트가 폴링해 진행바 표시
            _set_project_file_status(file_id, stage=("정밀 분석 중" if mode == "quality" else "문서 분석 중"), progress=10)
            documents = await _parse_upload_to_documents(content, filename, mode)
            if not documents:
                logger.warning(f"⚠️ [프로젝트:{project_id[:8]}] '{filename}' 텍스트 추출 실패")
                _set_project_file_status(file_id, status="error", error="텍스트 추출 불가", stage="실패", progress=0)
                return

            _set_project_file_status(file_id, stage="청킹 중", progress=25)
            splitter = RecursiveCharacterTextSplitter(chunk_size=600, chunk_overlap=100)
            base_chunks = await asyncio.to_thread(splitter.split_documents, documents)
            # flat 인덱싱: 각 청크에 전역 고유 parent_id 부여 (파일 간 키 충돌 방지)
            from langchain_core.documents import Document
            chunks = []
            for idx, c in enumerate(base_chunks):
                pid = f"{file_id}_{idx}"
                meta = dict(c.metadata or {})
                meta["parent_id"] = pid
                meta["file_id"] = file_id   # 파일 단위 삭제용 태그
                meta["source"] = meta.get("source", filename)
                chunks.append(Document(page_content=c.page_content, metadata=meta))

            proj_dir = os.path.join(PROJECT_DB_ROOT, project_id)
            os.makedirs(proj_dir, exist_ok=True)

            # ★ 동일 프로젝트의 인덱싱/삭제를 직렬화 (동시 업로드 시 parent_map.pkl lost-update 방지).
            #   파싱·청킹(위, 느림·무공유)은 락 밖에서, 디스크/캐시 쓰기만 락 안에서 수행.
            async with _get_project_lock(project_id):
                # 1) Chroma append — 임베딩 단계는 배치로 쪼개 실제 진행률(25→90%) 제공
                vs = ChromaVectorStore(
                    persist_directory=proj_dir,
                    collection_name=f"proj_{project_id[:8]}",
                    embeddings=RAGManager.embedder.get_embeddings(),
                )
                _BATCH = 16
                total = len(chunks)
                for i in range(0, total, _BATCH):
                    batch = chunks[i:i + _BATCH]
                    await asyncio.to_thread(vs.create_from_documents, batch, False)
                    done = min(i + _BATCH, total)
                    pct = 25 + int(65 * done / total) if total else 90   # 25~90% 구간
                    _set_project_file_status(file_id, stage=f"인덱싱 중 ({done}/{total})", progress=pct)

                # 2) parent_map.pkl 누적 갱신 (락 보호 하의 읽기-수정-쓰기)
                pmap_path = os.path.join(proj_dir, "parent_map.pkl")
                parent_map = {}
                if os.path.exists(pmap_path):
                    with open(pmap_path, "rb") as f:
                        parent_map = pickle.load(f)
                for c in chunks:
                    parent_map[c.metadata["parent_id"]] = c
                with open(pmap_path, "wb") as f:
                    pickle.dump(parent_map, f)

                # 3) 캐시 지연 무효화 — 업로드마다 BM25 전체 재구축 대신 캐시만 비움.
                #    다음 검색에서 1회 재구축(연속 업로드 시 합쳐져 업로드 경로가 빨라짐).
                project_retrievers.pop(project_id, None)

            _set_project_file_status(file_id, status="ready", chunks_count=len(chunks), error=None, stage="완료", progress=100)
            logger.info(f"✅ [프로젝트:{project_id[:8]}] '{filename}' 인덱싱 완료 ({len(chunks)}청크, {time.time()-start:.1f}초)")
        except Exception as e:
            logger.error(f"❌ [프로젝트:{project_id[:8]}] 인덱싱 실패: {e}")
            _set_project_file_status(file_id, status="error", error=str(e))

def remove_file_from_project(project_id: str, file_id: str):
    """프로젝트 인덱스에서 특정 파일의 청크만 제거 (원본 바이트 미보관 → file_id 태그 기준 정리).
    Chroma는 where 필터로 삭제, parent_map은 file_id prefix 키 제거 후 retriever 캐시 재구축."""
    proj_dir = os.path.join(PROJECT_DB_ROOT, project_id)
    pmap_path = os.path.join(proj_dir, "parent_map.pkl")
    if not os.path.exists(proj_dir):
        return
    logger.info(f"🗑️ [프로젝트:{project_id[:8]}] 파일 인덱스 제거 시작 (file_id={file_id[:8]})")
    # 1) Chroma에서 해당 파일 청크 삭제
    try:
        vs = ChromaVectorStore(
            persist_directory=proj_dir,
            collection_name=f"proj_{project_id[:8]}",
            embeddings=RAGManager.embedder.get_embeddings(),
        )
        vs.load_existing()
        if vs._vectorstore is not None:
            # langchain_chroma의 delete()는 ids만 받으므로 하부 chromadb 컬렉션에서 where 삭제
            vs._vectorstore._collection.delete(where={"file_id": file_id})
    except Exception as e:
        logger.error(f"❌ [프로젝트:{project_id[:8]}] Chroma 파일 삭제 실패: {e}")
    # 2) parent_map 정리
    parent_map = {}
    if os.path.exists(pmap_path):
        with open(pmap_path, "rb") as f:
            parent_map = pickle.load(f)
    parent_map = {k: v for k, v in parent_map.items() if v.metadata.get("file_id") != file_id}
    with open(pmap_path, "wb") as f:
        pickle.dump(parent_map, f)
    # 3) 캐시 무효화만 — 재구축은 다음 검색에서 1회(load_project_retriever).
    #    (remove는 to_thread로 실행되므로 스레드 내에서 캐시 재구축/LRU 변형을 하지 않음)
    project_retrievers.pop(project_id, None)

def _get_project_role(conn, project_id: str, username: str):
    """사용자의 프로젝트 역할 반환: 'owner' | 'editor' | 'viewer' | None(접근불가)."""
    row = conn.execute("SELECT username FROM projects WHERE id=?", (project_id,)).fetchone()
    if not row:
        return None
    if row[0] == username:
        return "owner"
    m = conn.execute("SELECT role FROM project_members WHERE project_id=? AND username=?",
                     (project_id, username)).fetchone()
    return m[0] if m else None

def _require_project_access(conn, project_id: str, username: str, need: str = "view"):
    """역할 기반 접근검사. need: 'view'(멤버 누구나) | 'edit'(편집자+소유자) | 'owner'(소유자만).
    반환: 현재 사용자의 역할 문자열."""
    role = _get_project_role(conn, project_id, username)
    if role is None:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    if need == "edit" and role == "viewer":
        raise HTTPException(status_code=403, detail="이 프로젝트에 파일을 추가·삭제할 권한이 없습니다. (뷰어)")
    if need == "owner" and role != "owner":
        raise HTTPException(status_code=403, detail="프로젝트 소유자만 가능한 작업입니다.")
    return role

def _project_members_list(conn, project_id: str):
    """프로젝트 소유자 + 초대 멤버 목록(이름·부서 포함) 반환."""
    out = []
    owner = conn.execute("SELECT username FROM projects WHERE id=?", (project_id,)).fetchone()
    if owner:
        nm = conn.execute("SELECT display_name, dept FROM users WHERE username=?", (owner[0],)).fetchone()
        out.append({"username": owner[0], "name": (nm[0] if nm and nm[0] else owner[0]),
                    "dept": (nm[1] if nm else None), "role": "owner"})
    for u, role in conn.execute("SELECT username, role FROM project_members WHERE project_id=? ORDER BY created_at ASC", (project_id,)).fetchall():
        nm = conn.execute("SELECT display_name, dept FROM users WHERE username=?", (u,)).fetchone()
        out.append({"username": u, "name": (nm[0] if nm and nm[0] else u),
                    "dept": (nm[1] if nm else None), "role": role})
    return out
