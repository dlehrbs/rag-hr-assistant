"""
임베딩 모듈
Test 02에서 확정된 intfloat/multilingual-e5-large를 기본 모델로 사용합니다.

[2026-06-16] e5 prefix 적용
  intfloat/multilingual-e5-large는 학습 시 모든 입력에 접두어를 강제하는 모델입니다.
    - 문서(passage): "passage: {text}"
    - 질문(query):   "query: {text}"
  접두어를 생략하면 질문 벡터와 문서 벡터가 동일 공간에 정렬되지 않아 검색 recall이
  5~15% 손실됩니다. E5HuggingFaceEmbeddings가 인덱싱/검색 양쪽에서 자동으로 접두어를 부착합니다.
  ⚠️ 문서 쪽 접두어는 인덱싱 시점에 벡터로 굳으므로, 이 클래스로 교체 후 반드시 전체 재인덱싱이 필요합니다.
"""
import logging
from typing import List

from langchain_huggingface import HuggingFaceEmbeddings

logger = logging.getLogger(__name__)


class E5HuggingFaceEmbeddings(HuggingFaceEmbeddings):
    """multilingual-e5 계열 전용 — 인덱싱은 'passage: ', 검색은 'query: ' 접두어 자동 부착"""

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return super().embed_documents([f"passage: {t}" for t in texts])

    def embed_query(self, text: str) -> List[float]:
        return super().embed_query(f"query: {text}")

    async def aembed_documents(self, texts: List[str]) -> List[List[float]]:
        return await super().aembed_documents([f"passage: {t}" for t in texts])

    async def aembed_query(self, text: str) -> List[float]:
        return await super().aembed_query(f"query: {text}")


class Embedder:
    """HuggingFace 임베딩 래퍼"""

    def __init__(
        self,
        model_name: str = "intfloat/multilingual-e5-large",
        device: str = "cpu",
    ):
        self.model_name = model_name
        # e5 계열은 prefix 전용 클래스 사용, 그 외 모델은 표준 클래스 사용
        emb_cls = E5HuggingFaceEmbeddings if "e5" in model_name.lower() else HuggingFaceEmbeddings
        try:
            self._embeddings = emb_cls(
                model_name=model_name,
                model_kwargs={"device": device},
                encode_kwargs={"normalize_embeddings": True},
            )
            prefix_note = " (query:/passage: prefix 적용)" if emb_cls is E5HuggingFaceEmbeddings else ""
            logger.info(f"임베딩 모델 로드 완료: {model_name} (device={device}){prefix_note}")
        except Exception as e:
            logger.error(f"임베딩 모델 로드 실패: {model_name} — {e}")
            raise

    def get_embeddings(self):
        """LangChain 호환 임베딩 객체 반환"""
        return self._embeddings
