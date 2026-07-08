"""
RAG 체인 모듈
Test 12에서 확정된 'LLM 단일 처리' 방식과
Test 14에서 확정된 '모드 2 (유연한 비서)' 프롬프트를 적용합니다.

아키텍처:
  라우터 없음 → 항상 검색 수행 → 프롬프트에서 [일상대화] 자동 판별
  vLLM (OpenAI 호환 API) — Chat Template 자동 처리
"""
import logging
import os
from typing import Any, Dict, List

from langchain_core.documents import Document
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════
# 모드 2: 유연한 비서 프롬프트 (Test 14 확정)
# ═══════════════════════════════════════════════════════════
SYSTEM_PROMPT = """당신은 사내 취업규칙·인사규정 안내 전문 AI 어시스턴트입니다.
반드시 아래의 지시사항을 무조건 준수하세요.

1. 사용자의 질문에 대한 답이 [문서]에 포함되어 있다면, [문서]만을 기반으로 사실적이고 정확하게 답변하세요.
2. 답변 시 반드시 출처 규정명과 조항(예: 취업규칙 제35조, 인사규정 제12조)을 명시하세요.
3. 만약 [문서]에 질문에 대한 답변이 포함되어 있지 않다면, 절대 내용을 지어내지 말고 "해당 내용은 현재 규정에 명시되어 있지 않습니다."라고 명확히 답변하세요.
4. [SOURCE: INTERNAL] 태그를 사용하여 문서 기반 답변임을 명시하세요.
5. 각 [문서] 항목의 첫 줄에는 [문서: XXX] 형태로 문서명이 표시됩니다. 질문의 주제와 관련 없는 문서(예: 연차 관련 질문인데 주차·차량·통신비·경조사 등 다른 도메인 문서)의 내용은 무시하고 답변하세요.
"""


class RAGChain:
    """
    통합 RAG 체인
    - 라우터 없이 LLM 단일 처리 (Test 12 F1=0.922)
    - 모드 2 유연한 비서 프롬프트 (Test 14)
    - vLLM OpenAI 호환 API (Chat Template 자동 처리)
    """

    def __init__(
        self,
        retriever,
        reranker,
        model_name: str = "LGAI-EXAONE/EXAONE-3.5-7.8B-Instruct",
        temperature: float = 0,
        top_k_final: int = 5,
        **kwargs,  # num_ctx 등 Ollama 전용 파라미터 무시
    ):
        self.retriever = retriever
        self.reranker = reranker
        self.model_name = model_name
        self.top_k_final = top_k_final

        vllm_host = os.getenv("VLLM_HOST", "http://host.docker.internal:8000")
        self._llm = ChatOpenAI(
            model=model_name,
            base_url=f"{vllm_host}/v1",
            api_key="none",
            temperature=temperature,
            max_tokens=2048,
            extra_body={"max_tokens": 2048},
            disabled_params={"max_completion_tokens": None},
        )
        self._last_contexts: List[Document] = []
        logger.info(f"LLM 연결 완료: {model_name} | vLLM (host={vllm_host})")

    def invoke(self, question: str) -> str:
        """질문에 대한 답변 생성"""
        candidates = self.retriever.search(question)

        if not candidates:
            logger.warning(f"[Zero-hit] 검색 결과 없음: '{question[:60]}'")

        if candidates:
            reranked = self.reranker.rerank(question, candidates, top_k=self.top_k_final)
            final_docs = [doc for doc, _ in reranked]
        else:
            final_docs = []

        self._last_contexts = final_docs

        context = "\n\n".join(
            [f"[문서 {i+1}] {doc.page_content}" for i, doc in enumerate(final_docs)]
        )
        messages = [
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=f"[문서]\n{context}\n\n[질문]\n{question}"),
        ]
        try:
            result = self._llm.invoke(messages)
            return result.content.strip()
        except Exception as e:
            logger.error(f"LLM 호출 실패: {e}")
            raise

    def invoke_with_context(self, question: str) -> Dict[str, Any]:
        """답변과 컨텍스트를 함께 반환"""
        answer = self.invoke(question)
        return {
            "question": question,
            "answer": answer,
            "contexts": self._last_contexts,
            "num_docs": len(self._last_contexts),
        }

    def get_last_contexts(self) -> List[Document]:
        """마지막 검색에 사용된 컨텍스트 반환"""
        return self._last_contexts

    def stream(self, question: str):
        """vLLM 스트리밍 — AIMessageChunk 반환"""
        candidates = self.retriever.search(question)

        if not candidates:
            logger.warning(f"[Zero-hit] 검색 결과 없음 (stream): '{question[:60]}'")

        if candidates:
            reranked = self.reranker.rerank(question, candidates, top_k=self.top_k_final)
            final_docs = [doc for doc, _ in reranked]
        else:
            final_docs = []
        self._last_contexts = final_docs

        context = "\n\n".join(
            [f"[문서 {i+1}] {doc.page_content}" for i, doc in enumerate(final_docs)]
        )
        messages = [
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=f"[문서]\n{context}\n\n[질문]\n{question}"),
        ]
        try:
            return self._llm.stream(messages)
        except Exception as e:
            logger.error(f"LLM 스트리밍 실패: {e}")
            raise
