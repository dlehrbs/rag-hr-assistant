"""[rag/manager] RAG 엔진 중앙 관리자 — GPU 할당·모델 로딩·상태.
config·core에만 의존. main·routes·generator가 RAGManager를 import해 사용.
※ 리팩토링으로 main.py에서 이동 — 코드 내용 byte-동일."""
import os
import time
import asyncio
import logging
import pickle
import traceback
from typing import Optional, Dict
import httpx
import torch

from config import DATA_ROOT, DOCS_PATH, RERANK_THRESHOLD
from core.retriever import HybridRetriever, KiwiBM25Retriever
from core.vector_store import ChromaVectorStore
from core.reranker import BGEReranker
from core.embedder import Embedder
from core.rag_chain import RAGChain

logger = logging.getLogger("main")


def get_optimal_rag_device():
    """실시간 GPU 메모리를 체크하여 리랭커/임베딩용 최적 장비 반환"""
    if not torch.cuda.is_available():
        return "cpu"
    
    device_count = torch.cuda.device_count()
    
    # 1순위: GPU 1번 (연구원분들이 안 쓸 때 - 6GB 이상 여유)
    if device_count > 1:
        free_mem_1, _ = torch.cuda.mem_get_info(1) # 시스템 전체의 빈 메모리 체크
        if free_mem_1 > 6 * 1024**3: # Gemma는 6GB면 충분
            logger.info(f"🚀 [GPU-Manner] GPU 1번이 넉넉합니다. (여유: {free_mem_1/1024**3:.1f}GB) -> cuda:1 사용")
            return "cuda:1"

    # 2순위: GPU 0번 (vLLM 옆에 얹혀 살기 - 4GB 이상 여유)
    free_mem_0, _ = torch.cuda.mem_get_info(0)
    if free_mem_0 > 4 * 1024**3: # Gemma는 가벼움
        logger.info(f"🤝 [GPU-Manner] GPU 0번에 얹혀 삽니다. (여유: {free_mem_0/1024**3:.1f}GB) -> cuda:0 사용")
        return "cuda:0"

    # 3순위: 아쉽지만 CPU (생존 모드)
    logger.warning("⚠️ [GPU-Manner] GPU 자원 부족으로 CPU 모드로 동작합니다.")
    return "cpu"

class RAGManager:
    _is_ready = False
    _gpu_lock: Optional[asyncio.Lock] = None   # [C-03] 이벤트루프 시작 후 지연 초기화
    chain = None
    embedder = None
    top_k = 5
    # 런타임 검색 파라미터 (재시작 시 기본값 복귀 — 비영속적)
    search_params: Dict[str, any] = {
        "vector_k":   20,    # 벡터 검색 후보 수 (문서 11개·775청크 규모 최적화)
        "bm25_k":     20,    # BM25 검색 후보 수
        "final_top_k": 7,    # 리랭킹 최종 결과 수
        "mode":       "hybrid",  # "hybrid" | "vector" | "bm25"
        "rerank_threshold": RERANK_THRESHOLD,  # 리랭커 차단 임계값 (런타임 스윕용, 기본 0.10)
    }
    config = {
        # [C-02] project_root → DATA_ROOT 환경변수 기반 경로
        "persist_dir": os.path.join(DATA_ROOT, "databases/chroma_db_child"),
        "llm_model": os.getenv("CHAT_MODEL", "gemma4:e2b"),
        "embed_model": "intfloat/multilingual-e5-large"
    }

    @classmethod
    def get_gpu_lock(cls) -> asyncio.Lock:
        """[C-03] asyncio.Lock을 이벤트 루프 가동 후 최초 호출 시 생성 (지연 초기화)"""
        if cls._gpu_lock is None:
            cls._gpu_lock = asyncio.Lock()
        return cls._gpu_lock

    @classmethod
    def load(cls):
        """엔진 초기화 (Singleton) - Premium Korean Patch"""
        if cls._is_ready:
            return

        try:
            # 1. 최적의 장치 결정 및 부팅 시작 알림
            rag_device = get_optimal_rag_device()
            cls.config['device'] = rag_device  # [Dashboard] 선택된 장치 저장
            logger.info(f"🚀 [엔진] 시스템 초기화 시작 (장치: {rag_device})")
            
            # 2. 임베딩 모델 로드
            logger.info("  ↳ 🧠 [임베딩] 고성능 임베딩 모델 로드 중... (e5-large)")
            embedder = Embedder(model_name=cls.config["embed_model"], device=rag_device)
            
            # 3. 리랭커 모델 로드
            logger.info("  ↳ ⚖️  [리랭커] 정밀 분석 엔진 준비 중... (BGE-Reranker)")
            reranker = BGEReranker(model_name="BAAI/bge-reranker-v2-m3", device=rag_device)
            
            # 4. 벡터 저장소 연결 및 데이터 로드
            logger.info("  ↳ 📦 [데이터] 기존 인덱스 동기화 및 Parent Map 로딩...")
            vector_store = ChromaVectorStore(
                persist_directory=cls.config["persist_dir"],
                collection_name="rag_documents",
                embeddings=embedder.get_embeddings()
            )
            vector_store.load_existing()
            
            db_path = os.path.join(DATA_ROOT, "databases")
            parent_map_path = os.path.join(db_path, "parent_map.pkl")
            bm25_path = os.path.join(db_path, "bm25_retriever.pkl")
            
            parent_map = {}
            if os.path.exists(parent_map_path):
                with open(parent_map_path, "rb") as f:
                    parent_map = pickle.load(f)
            
            parent_docs = list(parent_map.values())
            if not parent_docs:
                logger.warning("⚠️  [경고] parent_map이 비어있습니다. BM25 스킵 — /api/admin/reindex 실행 필요")
                bm25_instance = None
            else:
                bm25_instance = KiwiBM25Retriever.load_from_disk(bm25_path, current_docs=parent_docs)

            retriever = HybridRetriever(
                parent_map=parent_map,
                child_vector_store=vector_store,
                parent_docs=parent_docs,
                bm25_instance=bm25_instance,
                top_k=cls.top_k
            )
            
            # 5. LLM 및 전체 체인 구성
            logger.info(f"  ↳ 🤖 [연결] vLLM ({cls.config['llm_model']}) 상태 점검... [정상]")
            cls.embedder = embedder
            cls.chain = RAGChain(retriever=retriever, reranker=reranker,
                             model_name=cls.config["llm_model"], temperature=0,
                             top_k_final=cls.top_k)
            
            cls._is_ready = True
            logger.info("✨ [준비완료] 모든 인공지능 엔진이 활성화되었습니다!")
            logger.info("-" * 80)
            
        except Exception as e:
            logger.error(f"❌ [에러] 엔진 초기화 실패: {e}\n{traceback.format_exc()}")
            cls._is_ready = False

    @classmethod
    def switch_model(cls, new_model: str):
        """기존 retriever/reranker를 재사용하여 LLM만 교체 (빠른 전환)"""
        if not cls._is_ready or cls.chain is None:
            raise RuntimeError("엔진이 준비되지 않았습니다.")

        cls.chain = RAGChain(
            retriever=cls.chain.retriever,
            reranker=cls.chain.reranker,
            model_name=new_model,
            temperature=0,
            top_k_final=cls.top_k,
        )
        cls.config["llm_model"] = new_model
        logger.info(f"🔄 [모델 전환] {new_model}")

    @classmethod
    def get_document_list(cls):
        """사내 핵심 문서 목록을 파일 상세정보(크기, 날짜)와 함께 반환"""
        try:
            result = []
            for f in sorted(os.listdir(DOCS_PATH)):
                fpath = os.path.join(DOCS_PATH, f)
                if os.path.isfile(fpath):
                    stat = os.stat(fpath)
                    result.append({
                        "name": f,
                        "size": stat.st_size,
                        "modified": stat.st_mtime,
                        "extension": os.path.splitext(f)[1].lower().lstrip('.')
                    })
            return result
        except:
            return []


async def check_vllm_health() -> bool:
    """vLLM 서버 가용성 체크 (Ping)"""
    vllm_host = os.getenv("VLLM_HOST", "http://host.docker.internal:8000")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{vllm_host}/health", timeout=2.0)
            return resp.status_code == 200
    except Exception:
        return False

