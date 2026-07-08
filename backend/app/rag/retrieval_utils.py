"""[rag/retrieval_utils] 검색 후처리 유틸 — 이중질의 리랭킹 · 컨텍스트 재구성 · 후속질문 생성.
문서 도메인에 독립적인 범용 헬퍼(회사 고유 로직 없음)."""
import os
import re
import logging
from rag.manager import RAGManager

logger = logging.getLogger("main")


def _max_rerank(q_orig: str, q_rw: str, docs: list, top_k: int):
    """[이중질의] 원문·재작성 두 질문으로 각 문서를 채점해 문서별 max 점수로 정렬·반환.
    - 원문이 완결이면 원문 점수가, 지시어 질문이면 재작성 점수가 각 문서를 살린다.
    - 엉터리 재작성이 끌어온 무관 문서는 두 점수 모두 낮아 자동 탈락.
    질문 유형을 분류하지 않고 '관련성 점수'로만 판정. 반환: [(doc, score)] 내림차순 상위 top_k."""
    if not docs:
        return []
    rk = RAGManager.chain.reranker
    r1 = rk.rerank(q_orig, docs, top_k=len(docs))
    r2 = rk.rerank(q_rw, docs, top_k=len(docs)) if (q_rw and q_rw.strip() != q_orig.strip()) else []
    best = {}
    for doc, sc in list(r1) + list(r2):
        k = id(doc)            # 동일 docs 리스트를 두 번 채점 → 객체 id 안정적
        if k not in best or sc > best[k][1]:
            best[k] = (doc, sc)
    return sorted(best.values(), key=lambda x: x[1], reverse=True)[:top_k]


def _reconstruct_context(final_docs: list) -> str:
    """리랭킹된 청크를 LLM에 주기 전 정리 — 리랭커 순위를 보존해 번호를 붙인다.
    최상위 연관도 문서가 항상 컨텍스트 앞쪽에 오도록 한다."""
    parts = []
    for i, doc in enumerate(final_docs):
        parts.append(f"[참조 {i+1}] {doc.page_content}")
    return "\n\n".join(parts)


def _generate_followups(query: str, final_docs: list, max_n: int = 3) -> list:
    """근거 문서로 답할 수 있는 자연스러운 후속 질문을 LLM으로 생성한 뒤,
    각 후보를 재검색+리랭크해 '같은 근거 문서 + 충분한 점수'일 때만 통과시키는 게이트 적용."""
    src_set = {os.path.basename(str(d.metadata.get('source_file', '')))
               for d in final_docs if d.metadata.get('source_file')}
    src_set.discard('')
    if not src_set:
        return []
    titles = ", ".join(sorted(src_set))
    snippet = re.sub(r"\s+", " ", " ".join((d.page_content or "")[:220] for d in final_docs[:3]))[:650]
    prompt = (
        "너는 문서 안내 챗봇이다. 아래 [근거 문서] 내용만으로 답할 수 있는, "
        "사용자가 이어서 물어볼 만한 자연스러운 후속 질문 3개를 만들어라.\n"
        "규칙: 각 질문은 한 줄, 번호·기호 없이, 10~35자, 물음표로 끝낼 것. "
        "근거 문서로 답할 수 없는 질문은 절대 만들지 마라.\n"
        f"[근거 문서: {titles}]\n{snippet}\n\n[방금 사용자 질문] {query}\n\n후속 질문:"
    )
    try:
        raw = RAGManager.chain._llm.invoke(prompt)
        text = raw if isinstance(raw, str) else getattr(raw, 'content', '')
    except Exception:
        return []
    cands, seen = [], set()
    qn = query.replace(" ", "")
    for line in (text or "").splitlines():
        s = re.sub(r"^[\s\-\d\.\)\*•·]+", "", line).strip().strip('"').strip()
        if not (8 <= len(s) <= 40) or "?" not in s:
            continue
        k = s.replace(" ", "")
        if k in seen or k == qn:
            continue
        seen.add(k); cands.append(s)
    # 답변가능성 게이트: 후보를 재검색+리랭크해 '같은 근거 문서 + 리랭크 점수 충분'일 때만 통과.
    sp = RAGManager.search_params
    _GATE_MIN = float(os.getenv("FOLLOWUP_GATE_MIN_SCORE", "0.20"))
    out = []
    for c in cands:
        try:
            hits = RAGManager.chain.retriever.search(c, vector_k=8, bm25_k=8, mode=sp["mode"])
            if not hits:
                continue
            scored = RAGManager.chain.reranker.rerank(c, hits, top_k=3)
            if not scored:
                continue
            top_doc, top_score = scored[0]
            top_src = os.path.basename(str(top_doc.metadata.get('source_file', '')))
            if top_src in src_set and top_score >= _GATE_MIN:
                out.append(c)
        except Exception:
            continue
        if len(out) >= max_n:
            break
    return out
