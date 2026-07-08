"""
리랭커 모듈
Test 14에서 확정된 BGE-reranker-v2-m3를 사용합니다.
Top-K=20 검색 결과 → 리랭킹 → Top-K=5 최종 선별
"""
import logging
from typing import List, Tuple

from langchain_core.documents import Document

logger = logging.getLogger(__name__)


class BGEReranker:
    """BAAI/bge-reranker-v2-m3 기반 Cross-Encoder 리랭커"""

    def __init__(
        self,
        model_name: str = "BAAI/bge-reranker-v2-m3",
        device: str = "cuda:0",
    ):
        self.model_name = model_name
        self.device = device
        self._model = None
        self._load_model()

    def _load_model(self):
        """Cross-Encoder 모델 로드"""
        try:
            from sentence_transformers import CrossEncoder
            self._model = CrossEncoder(self.model_name, device=self.device)
            logger.info(f"리랭커 로드 완료: {self.model_name} (device={self.device})")
        except Exception as e:
            logger.error(f"리랭커 로드 실패: {e}")
            self._model = None

    def rerank(
        self,
        query: str,
        documents: List[Document],
        top_k: int = 5,
    ) -> List[Tuple[Document, float]]:
        """
        검색된 문서를 리랭킹하여 상위 top_k개 반환

        Returns:
            [(document, score), ...] 형태의 정렬된 리스트
        """
        if not documents:
            return []

        if self._model is None:
            logger.warning("리랭커 미사용 — 원래 검색 순서로 반환")
            return [(doc, 1.0 - i * 0.01) for i, doc in enumerate(documents[:top_k])]

        pairs = [(query, doc.page_content) for doc in documents]
        scores = self._model.predict(pairs)

        scored = sorted(zip(documents, scores), key=lambda x: x[1], reverse=True)
        return scored[:top_k]
