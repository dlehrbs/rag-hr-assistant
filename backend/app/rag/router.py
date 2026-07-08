"""[rag/router] 🧭 Intent Router — 질문 유형 분류(인사/메타/일반) + 후속질문 쿼리 재작성 + 인사·메타 즉답.
LLM 의도분류로 인사·메타를 떼어내고, 후속질문은 직전 대화 맥락으로 완결 질문으로 재작성.
config·rag.manager에만 의존. main·generator가 import해 사용.
※ 리팩토링으로 main.py에서 이동 — 코드 내용 byte-동일."""
import os
import asyncio
import logging

from config import DOCS_PATH, extract_doc_name, COMPANY_NAME
from rag.manager import RAGManager

logger = logging.getLogger("main")

# ── 🧭 Intent Router (Phase 1: 인사·메타 분기) ─────────────────────────────────
# 모든 질문을 보수적 RAG 파이프에 강제 통과시키던 구조를 개선. 입력 진입 시 LLM이
# 유형(인사/메타/일반)을 라벨 1단어로 분류 → 인사·메타만 떼어내고 나머지는 기존 RAG 그대로.
# 안전 원칙: 애매하면 '일반'(RAG) 폴백 → 규정질문을 잡담으로 오답하는 위험 차단.
_INTENT_PROMPT = """다음 질문의 유형을 아래 셋 중 하나로만 답하라. 다른 말은 절대 쓰지 마라.
- 인사: 인사/감사/작별/잡담, 너(챗봇)의 정체성, 날씨·기분·일상 등 사내 규정과 무관한 가벼운 대화 (직전 대화가 있어도 인사·감사·잡담은 인사다)
- 메타: 챗봇이 무엇을 할 수 있는지, 어떤 문서·규정을 보유했는지, 무엇을/어떤 질문을 물어볼 수 있는지 묻는 질문
- 일반: 특정 규정 내용·금액·계산 등 실제 업무 질문 (직전 대화에 이어지는 후속 질문도 일반이다)
판단이 애매하면 반드시 '일반'이라고 답하라.
★중요: 질문에 사내 규정·제도·문서 주제(예: 근무·휴가·급여·복지·출장·경비·인사 등 회사 정책 관련 용어)가 하나라도 들어 있으면, 말투가 "뭐야/뭐 하는 거야/알려줄 수 있어" 처럼 들려도 그것은 '메타'나 '인사'가 아니라 무조건 '일반'이다.

예시)
"안녕" => 인사
"고마워" => 인사
[직전: 연차 17일] "고마워!" => 인사
"넌 누구야" => 인사
"오늘 날씨 어때?" => 인사
"아 심심해" => 인사
"무슨 문서 갖고 있어?" => 메타
"넌 뭐 할 수 있어?" => 메타
"어떤 질문들을 내가 할 수 있지?" => 메타
"안녕하세요, 연차 며칠인가요?" => 일반
"내부 감사 규정 알려줘" => 일반
"출장비는 어떻게 정산해?" => 일반
"복지 제도가 뭐 있어?" => 일반
"통신비 지원은 뭐야?" => 일반
"휴가 규정 알려줄 수 있어?" => 일반
[직전: 경조금 10만원] "그럼 형은?" => 일반
[직전: 연차 15일] "그럼 3년차면?" => 일반

{ctx}질문: "{q}"
유형:"""

# ── 🔄 Intent Router (Phase 2): 후속 질문 맥락 해소(쿼리 재작성) ──────────────
# 2번째+ 입력만 작동. "그럼 1800이면?" 처럼 혼자선 뜻이 통하지 않는 질문을
# 직전 대화의 주제·수치로 채워 완결된 질문으로 재작성 → 검색·분류·계산핸들러가 정상 동작.
# 안전: 첫 입력은 호출 안 함, 실패 시 원문 사용, 재작성 결과는 사용자에게 투명 표시.
_REWRITE_PROMPT = """너의 임무는 사용자의 '새 질문'을 혼자서도 뜻이 통하는 완전한 질문으로 만드는 것뿐이다.

규칙:
1. 인사·감사·작별·잡담 등 질문이 아닌 표현(예: "안녕", "고마워", "수고했어")은 토씨 하나 바꾸지 말고 그대로 출력하라.
2. 새 질문에 이미 구체적인 주제가 들어있으면(예: 일본 출장, 연차, 경조금, 통신비 등) 그것은 독립 질문이다 → 그대로 출력하라.
3. 새 질문이 "그럼", "그건", "그것보다", "더", "얼마야" 처럼 직전 대화 없이는 무슨 말인지 모르는 경우에만 → 직전 대화의 주제·수치를 채워 완전한 질문으로 다시 써라.
4. 주제가 바뀌면 이전 주제를 절대 끌어오지 마라.
5. 직전 대화에 쓰인 핵심 용어(예: 운전보조금, 자가운전, 경조금, 국내여비)는 동의어로 바꾸지 말고 그대로 사용하라.
6. 오직 한 문장만 출력하라. 괄호 설명, 부연, 따옴표, "재구성" 같은 군더더기를 절대 붙이지 마라.
7. ★너는 질문에 절대 답하지 않는다. 출력은 반드시 '질문' 형태여야 한다. "~합니다", "~됩니다" 같은 평서문(답변)을 만들면 안 된다.

예시)
[직전: 5년 근속 연차 17일] 새 질문: "고마워!"
→ 고마워!

[직전: 공통 업무 나열] 새 질문: "회식비 결재누구한테 해야해?"
→ 회식비 결재누구한테 해야해?

[직전: 1500km 운전보조금 15만원] 새 질문: "그럼 1800이면?"
→ 한달에 1800km 자가운전하면 운전보조금 얼마야?

[직전: 1500km 운전보조금 15만원] 새 질문: "일본 출장 가면 여비 얼마야?"
→ 일본 출장 가면 여비 얼마야?

[직전: 아들 결혼 경조금 10만원] 새 질문: "그럼 형은?"
→ 형이 결혼하면 경조금 얼마야?

[직전 대화]
{history}
[새 질문]
{q}

다시 쓴 질문(한 문장만):"""

def _fmt_history_for_rewrite(history: list, max_msgs: int = 4) -> str:
    """재작성용 직전 대화 요약 (최근 몇 개 메시지, AI답변은 축약)."""
    recent = history[-max_msgs:] if history else []
    lines = []
    for m in recent:
        content = (m.get("content") or "")
        if m.get("role") != "user" and len(content) > 200:
            content = content[:200] + "…"
        who = "사용자" if m.get("role") == "user" else "챗봇"
        lines.append(f"{who}: {content}")
    return "\n".join(lines)

async def rewrite_followup(query: str, history: list) -> str:
    """후속 질문을 완결된 질문으로 재작성. 독립 질문이면 원문 그대로. 실패 시 원문."""
    try:
        hist = _fmt_history_for_rewrite(history)
        if not hist.strip():
            return query
        prompt = _REWRITE_PROMPT.format(history=hist, q=query[:300])
        raw = await asyncio.to_thread(RAGManager.chain._llm.invoke, prompt)
        text = (raw.content if hasattr(raw, "content") else str(raw)).strip()
        # 모델이 따옴표·접두어를 붙이는 경우 정리
        text = text.strip().strip('"').strip("'").strip()
        for pre in ("다시 쓴 질문:", "완성된 질문:", "질문:", "답변:", "→"):
            if text.startswith(pre):
                text = text[len(pre):].strip()
        # 비정상(빈 문자열, 과도하게 길어짐) 방어 → 원문 사용
        if not text or len(text) > len(query) + 200:
            return query
        # ★[가드] 7.8B가 '재작성' 대신 '답변'을 해버리는 오작동 차단.
        #   예1: "회식비 결재누구한테 해야해?" → "...해야 합니다."(평서문)
        #   예2: "...담당합니다. 정확한 전결권자는 ...확인해 주세요."(여러 문장 설명형 답변)
        #   재작성된 후속질문은 '짧은 단문 질문'이어야 한다. 아래 답변-징후가 있으면 폐기·원문 사용.
        #   (오염된 문장에 든 일반 단어가 검색·재채점을 망침)
        _t = text.rstrip()
        _decl_ends = ("합니다.", "합니다", "됩니다.", "됩니다", "입니다.", "입니다",
                      "습니다.", "습니다", "세요.", "세요", "주세요.", "주세요",
                      "바랍니다.", "바랍니다", "드립니다.", "드립니다", "십시오.", "십시오",
                      "한다.", "이다.", "해요.", "예요.", "것입니다.", "겁니다.")
        _answer_like = (not _t.endswith("?")) and (
            any(_t.endswith(e) for e in _decl_ends)                # 평서문·요청문 종결
            or (_t.count("다.") + _t.count("요.")) >= 2            # 여러 문장 = 설명형 답변
            or "일반적으로" in _t or "에 따라 다르" in _t or "확인해" in _t  # 답변 상투어
        )
        if _answer_like:
            logger.info(f"  ↳ 🔄 [재작성 폐기] 답변-징후 감지 → 원문 사용: '{text[:50]}'")
            return query
        return text
    except Exception as e:
        logger.warning(f"쿼리 재작성 실패(원문 사용): {e}")
        return query

async def classify_intent(query: str, history: list = None) -> str:
    """질문을 인사/메타/일반 중 하나로 분류. 직전 대화로 후속질문 오분류 방지. 실패·애매 시 '일반' 폴백."""
    try:
        ctx = ""
        if history:
            last = history[-1]
            c = (last.get("content") or "")[:120]
            if c:
                ctx = f"[직전 대화 — {'사용자' if last.get('role')=='user' else 'AI'}: {c}]\n"
        prompt = _INTENT_PROMPT.format(ctx=ctx, q=query.replace('"', "'")[:300])
        raw = await asyncio.to_thread(RAGManager.chain._llm.invoke, prompt)
        text = (raw.content if hasattr(raw, "content") else str(raw)).strip()
        if "메타" in text:
            return "메타"
        if "인사" in text:
            return "인사"
        return "일반"
    except Exception as e:
        logger.warning(f"의도 분류 실패(→일반 폴백): {e}")
        return "일반"

def _list_doc_names() -> list:
    """DOCS_PATH의 PDF 문서 핵심 이름 목록."""
    try:
        files = sorted(f for f in os.listdir(DOCS_PATH) if f.lower().endswith(".pdf"))
        return [extract_doc_name(f) for f in files]
    except Exception as e:
        logger.warning(f"문서 목록 조회 실패: {e}")
        return []

def respond_greeting_text(query: str) -> str:
    """인사/정체성 질문에 대한 고정 응답 (LLM 스트리밍 실패 시 폴백)."""
    return (f"안녕하세요! 저는 {COMPANY_NAME} 사내 문서 안내 챗봇입니다. 😊\n"
            "등록된 사내 규정·정책 문서에 대해 무엇이든 물어봐 주세요.\n"
            "예) \"연차는 며칠까지 쓸 수 있어?\", \"출장 여비는 어떻게 정산해?\"")

# 인사/잡담에 LLM이 사람처럼 자연스럽게 응답하기 위한 프롬프트 (가벼운 가드만).
# {q}는 .format(q=...)로 채워지므로 리터럴 유지 — 회사명 부분만 f-string으로 주입.
_GREETING_GEN_PROMPT = (
    f"너는 {COMPANY_NAME} 사내 문서 안내 챗봇이다. 사용자가 인사를 하거나 가벼운 잡담·너에 대한 질문을 했다.\n"
    "사람처럼 자연스럽고 친근하게 한국어로 짧게(1~3문장) 대답하라.\n"
    "- 인사·감사·잡담에는 딱딱한 안내문 대신 진짜 사람처럼 자연스럽게 받아쳐라. 매번 똑같은 멘트나 기능 나열은 피하고 대화에 맞게 다양하게 답하라.\n"
    "- 기분·안부 같은 가벼운 잡담은 편하게 응해도 된다.\n"
    "- 단, 날씨·뉴스·시사·일반상식·코딩 등 사내 문서 밖의 '사실'을 묻는 질문에는 모른다고 솔직히 말하고 사내 문서 쪽으로 부드럽게 권유하라.\n"
    f"- 회사 규정 내용을 지어내지 마라. 네 이름은 '{COMPANY_NAME} 사내 문서 챗봇'이며 '[챗봇 이름]' 같은 placeholder나 '마스터' 같은 과장은 쓰지 마라.\n"
    "- 실제로 할 수 없는 일(카페 추천, 음악 재생, 외부 검색 등)을 해주겠다고 약속하지 마라.\n\n"
    '사용자: "{q}"\n'
    "답변:"
)

def respond_meta_text() -> str:
    """메타 질문(보유 문서 목록)에 대한 직접 응답 (검색 미사용)."""
    names = _list_doc_names()
    if not names:
        return "현재 학습된 문서 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
    listed = "\n".join(f"{i}. {n}" for i, n in enumerate(names, 1))
    return (f"현재 {len(names)}종의 사내 문서를 학습하고 있습니다:\n\n{listed}\n\n"
            f"이 중 무엇이든 질문해 주세요. 예) \"연차는 며칠까지 쓸 수 있어?\"")
