"""
벡터 저장소 모듈
ChromaDB를 사용한 벡터 저장 및 검색
"""
import logging
import os
from typing import List, Optional

from langchain_chroma import Chroma
from langchain_core.documents import Document
from tqdm import tqdm

logger = logging.getLogger(__name__)


class ChromaVectorStore:
    """ChromaDB 기반 벡터 저장소"""

    def __init__(
        self,
        persist_directory: str = "./databases/chroma_db",
        collection_name: str = "rag_documents",
        embeddings=None,
    ):
        self.persist_directory = persist_directory
        self.collection_name = collection_name
        self.embeddings = embeddings
        self._vectorstore: Optional[Chroma] = None

    def create_from_documents(self, documents: List[Document], wipe_existing: bool = True) -> Chroma:
        """문서로부터 벡터 저장소 생성 (진행률 확인 가능)"""
        os.makedirs(self.persist_directory, exist_ok=True)

        if wipe_existing:
            try:
                _tmp = Chroma(
                    persist_directory=self.persist_directory,
                    embedding_function=self.embeddings,
                    collection_name=self.collection_name,
                )
                _tmp.delete_collection()
                del _tmp
            except Exception:
                pass

        self._vectorstore = Chroma(
            persist_directory=self.persist_directory,
            embedding_function=self.embeddings,
            collection_name=self.collection_name,
        )

        batch_size = 100
        logger.info(f"벡터 DB 구축 시작 (총 {len(documents)}개 청크, {batch_size}개씩 배치 처리)")

        for i in tqdm(range(0, len(documents), batch_size), desc="Embedding Docs"):
            batch = documents[i : i + batch_size]
            try:
                self._vectorstore.add_documents(batch)
            except Exception as e:
                logger.error(f"벡터 DB 배치 추가 실패 (batch {i}~{i+batch_size}): {e}")
                raise

        logger.info(f"벡터 저장소 생성 완료: {len(documents)}개 청크 저장됨")
        return self._vectorstore

    def load_existing(self) -> Optional[Chroma]:
        """기존 벡터 저장소 로드"""
        if not os.path.exists(self.persist_directory):
            logger.warning(f"기존 벡터 저장소가 없습니다: {self.persist_directory}")
            return None

        self._vectorstore = Chroma(
            persist_directory=self.persist_directory,
            embedding_function=self.embeddings,
            collection_name=self.collection_name,
        )
        logger.info(f"기존 벡터 저장소 로드 완료: {self.persist_directory}")
        return self._vectorstore

    def similarity_search(self, query: str, k: int = 20) -> List[Document]:
        """유사도 검색"""
        if self._vectorstore is None:
            raise ValueError("벡터 저장소가 초기화되지 않았습니다.")
        return self._vectorstore.similarity_search(query, k=k)
