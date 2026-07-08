"""
하이브리드 검색기 모듈
Test 07에서 확정된 Parent-Child Vector + Kiwi BM25 하이브리드 검색 전략을 구현합니다.

검색 흐름:
  1. [Vector 검색] Child 청크에서 유사도 검색 → 매칭된 Parent 반환
  2. [BM25 검색]   Kiwi 형태소 분석 기반 키워드 검색 → Parent 반환
  3. [병합]         두 결과를 중복 제거 후 합산

[비판 3 수정] BM25 인덱스를 디스크에 직렬화하여 서버 재시작 시 재인덱싱(30~60초) 없이
             3초 이내 즉시 로드되도록 save_to_disk / load_from_disk 지원 추가.

[Cache Invalidation 추가] 문서 내용 MD5 해시를 인덱스와 함께 저장.
             서버 재시작 시 현재 문서 해시 vs 저장된 해시를 비교하여
             불일치 시 자동으로 pkl을 파기하고 재인덱싱 수행.
             → 새 문서 추가 후 수동으로 pkl 삭제할 필요 없음.
"""
import hashlib
import logging
import os
import pickle
from typing import Dict, List, Optional

from kiwipiepy import Kiwi
from langchain_core.documents import Document
from rank_bm25 import BM25Okapi
from tqdm import tqdm

from .vector_store import ChromaVectorStore

logger = logging.getLogger(__name__)


class KiwiBM25Retriever:
    """Kiwi 형태소 분석기 + BM25 한국어 키워드 검색기

    [비판 3 수정]
    - save_to_disk(): BM25 인덱스 + corpus_hash를 함께 pkl로 직렬화
    - load_from_disk(): current_docs와 저장된 해시를 비교하여
                        문서 변경 감지 시 None 반환 → 자동 재인덱싱 트리거
    - 문서 변경이 없으면 서버 재시작 시 인덱싱 비용 0원
    - 새 문서 추가 시 pkl 수동 삭제 불필요 (Cache Invalidation 자동)
    """

    # 추출할 품사 태그 (명사, 동사, 형용사, 어근, 외국어, 숫자)
    TARGET_TAGS = {"NNG", "NNP", "NNB", "NR", "NP", "VV", "VA", "XR", "SL", "SN"}

    def __init__(self, documents: List[Document], k: int = 20):
        self.k = k
        self.docs = documents
        self.kiwi = Kiwi()

        tokenized = [self._tokenize(d.page_content) for d in tqdm(documents, desc="🥝 Kiwi BM25 인덱싱")]
        self.bm25 = BM25Okapi(tokenized)

    # ──────────────────────────────────────────
    # Cache Invalidation 핵심: 해시 계산기
    # ──────────────────────────────────────────
    @staticmethod
    def _compute_corpus_hash(documents: List[Document]) -> str:
        """문서 전체 내용을 하나의 MD5 해시로 압축.

        동작 방식:
          1. 각 문서의 page_content를 정렬된 순서로 이어붙임
             (순서가 달라져도 동일 문서 집합이면 동일 해시 보장)
          2. 전체 문자열을 MD5로 해싱 → 32자 hex 문자열 반환

        왜 MD5인가:
          - 보안 목적이 아닌 '변경 감지' 목적이므로 MD5로 충분
          - SHA256 대비 연산 속도가 빠름 (수천 개 문서도 < 1초)
        """
        corpus = "|".join(sorted(doc.page_content for doc in documents))
        return hashlib.md5(corpus.encode("utf-8")).hexdigest()

    def save_to_disk(self, path: str) -> None:
        """BM25 인덱스 + 문서 목록 + corpus_hash를 디스크에 저장.

        corpus_hash: 현재 문서 집합의 지문(Fingerprint).
                     다음 load_from_disk() 호출 시 비교 기준으로 사용됨.
        """
        corpus_hash = self._compute_corpus_hash(self.docs)
        data = {
            "bm25": self.bm25,
            "docs": self.docs,
            "k": self.k,
            "corpus_hash": corpus_hash,   # ← 핵심: 문서 지문 함께 저장
        }
        with open(path, "wb") as f:
            pickle.dump(data, f)
        logger.info(f"BM25 인덱스 저장 완료: {path} (corpus_hash={corpus_hash[:8]}...)")

    @classmethod
    def load_from_disk(
        cls,
        path: str,
        current_docs: Optional[List[Document]] = None,
    ) -> Optional["KiwiBM25Retriever"]:
        """디스크에서 BM25 인덱스를 로드. 문서 변경 시 자동 캐시 무효화.

        Args:
            path: pkl 파일 경로
            current_docs: 현재 메모리에 올라온 부모 문서 리스트.
                          None이면 해시 검증 생략 (하위 호환).

        Returns:
            KiwiBM25Retriever 인스턴스  → 캐시 유효, 즉시 사용 가능
            None                        → 캐시 무효 또는 미존재, 재인덱싱 필요

        Cache Invalidation 로직:
          저장된 corpus_hash ≠ 현재 문서 해시  →  None 반환 → 호출자가 재인덱싱
          저장된 corpus_hash == 현재 문서 해시  →  인스턴스 반환 → 즉시 재사용
        """
        if not os.path.exists(path):
            return None

        with open(path, "rb") as f:
            data = pickle.load(f)

        # ── 구 포맷 감지: dict가 아니면 캐시 무효화 ────────────
        # 이전 버전의 pkl은 list나 다른 타입으로 저장될 수 있음.
        # corpus_hash 키가 없는 구 포맷은 하위 호환 불가 → 재인덱싱 수행.
        if not isinstance(data, dict):
            logger.warning(f"BM25 캐시 구 포맷 감지 (type={type(data).__name__}): 재인덱싱을 수행합니다.")
            return None

        # ── 해시 비교: 문서 변경 감지 ──────────────────────────
        if current_docs is not None:
            saved_hash = data.get("corpus_hash", "")
            current_hash = cls._compute_corpus_hash(current_docs)

            if saved_hash != current_hash:
                logger.info(
                    f"BM25 캐시 무효화: 문서 변경 감지 — "
                    f"저장된 해시 {saved_hash[:8]}... → 현재 해시 {current_hash[:8]}... (재인덱싱 시작)"
                )
                return None

            logger.info(f"BM25 캐시 유효: 문서 변경 없음 (hash={current_hash[:8]}...)")
        # ────────────────────────────────────────────────────────

        instance = cls.__new__(cls)
        instance.bm25 = data["bm25"]
        instance.docs = data["docs"]
        instance.k    = data["k"]
        instance.kiwi = Kiwi()
        logger.info(f"BM25 인덱스 디스크 로드 완료: {path} ({len(instance.docs)}개 문서)")
        return instance

    # 문서에서 실제로 쓰는 표기로 통일 (대소문자 불일치 방지)
    _TERM_NORMALIZE = {
        "iot": "IoT", "IOT": "IoT",
        "si1": "SI 1", "SI1": "SI 1",
        "si2": "SI 2", "SI2": "SI 2",
        "sm사업부": "SM사업부", "Sm사업부": "SM사업부",
    }

    @staticmethod
    def _normalize_query(query: str) -> str:
        import re
        result = query
        for wrong, right in KiwiBM25Retriever._TERM_NORMALIZE.items():
            result = re.sub(re.escape(wrong), right, result, flags=re.IGNORECASE)
        return result

    def _tokenize(self, text: str) -> List[str]:
        """Kiwi 형태소 분석 후 핵심 품사만 추출"""
        tokens: List[str] = []
        try:
            for token in self.kiwi.tokenize(text):
                if token.tag in self.TARGET_TAGS:
                    tokens.append(token.form)
        except Exception:
            pass
        return tokens

    def search(self, query: str, k: Optional[int] = None) -> List[Document]:
        """BM25 점수 상위 k개 문서 반환. k를 지정하면 self.k 대신 사용."""
        query = self._normalize_query(query)
        query_tokens = self._tokenize(query)
        if not query_tokens:
            logger.warning(f"BM25 토크나이저 결과 없음: '{query[:50]}'")
            return []

        actual_k = k if k is not None else self.k
        scores = self.bm25.get_scores(query_tokens)
        top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:actual_k]
        results = [self.docs[i] for i in top_indices]
        logger.info(f"BM25 검색 완료: {len(results)}건 반환 (query='{query[:40]}')")
        return results


class HybridRetriever:
    """
    Parent-Child Vector + Kiwi BM25 하이브리드 검색기

    Args:
        parent_map: {doc_id: parent_document} 매핑
        child_vector_store: 자식 청크가 인덱싱된 ChromaVectorStore
        parent_docs: BM25 인덱싱용 부모 문서 리스트
        top_k: 1차 검색에서 가져올 문서 수
        bm25_instance: [비판 3 수정] 외부에서 디스크 로드한 BM25 인스턴스 주입 가능 (없으면 새로 생성)
    """

    def __init__(
        self,
        parent_map: Dict[str, Document],
        child_vector_store: ChromaVectorStore,
        parent_docs: List[Document],
        top_k: int = 20,
        bm25_instance: Optional[KiwiBM25Retriever] = None,
    ):
        self.parent_map = parent_map
        self.child_vs = child_vector_store
        self.top_k = top_k
        # 외부 주입 인스턴스가 있으면 재사용, 없으면 새로 인덱싱
        if bm25_instance is not None:
            self.bm25 = bm25_instance
        elif parent_docs:
            self.bm25 = KiwiBM25Retriever(parent_docs, k=top_k)
        else:
            self.bm25 = None  # 빈 인덱스 — reindex 후 정상화

    def search(
        self,
        query: str,
        vector_k: Optional[int] = None,
        bm25_k: Optional[int] = None,
        mode: str = "hybrid",
    ) -> List[Document]:
        query = KiwiBM25Retriever._normalize_query(query)
        """
        하이브리드 검색 수행
        1) Child Vector Search → Parent 소환 (vector_k 개)
        2) Kiwi BM25 → Parent 반환 (bm25_k 개)
        3) 중복 제거 후 합산

        mode: "hybrid" | "vector" | "bm25"
        vector_k / bm25_k 미지정 시 self.top_k 사용 (하위 호환)
        """
        vk = vector_k if vector_k is not None else self.top_k
        bk = bm25_k if bm25_k is not None else self.top_k

        # ── BM25 단독 모드 ────────────────────────────────────
        if mode == "bm25":
            if self.bm25 is None:
                return []
            return self.bm25.search(query, k=bk)

        # ── Vector 경로: 자식 검색 → 부모 소환 ──────────────
        child_results = self.child_vs.similarity_search(query, k=vk)
        vector_parents: List[Document] = []
        seen_ids = set()
        for child in child_results:
            pid = child.metadata.get("parent_id")
            if pid and pid in self.parent_map and pid not in seen_ids:
                # Child 매칭 시 Parent(넓은 컨텍스트)를 소환 — "좁게 찾고 넓게 읽힌다"
                vector_parents.append(self.parent_map[pid])
                seen_ids.add(pid)

        # ── Vector 단독 모드 ──────────────────────────────────
        if mode == "vector":
            return vector_parents

        # ── Hybrid: BM25 추가 후 중복 제거 병합 ─────────────
        if self.bm25 is None:
            return vector_parents
        bm25_results = self.bm25.search(query, k=bk)
        merged: List[Document] = list(vector_parents)
        seen_contents = {d.page_content[:200] for d in merged}
        for doc in bm25_results:
            key = doc.page_content[:200]
            if key not in seen_contents:
                merged.append(doc)
                seen_contents.add(key)

        return merged
