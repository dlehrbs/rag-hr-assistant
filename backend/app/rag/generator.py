"""[rag/generator] 핵심 응답 생성기 — chat_generator(SSE 스트리밍) + 웹검색 + 범용대화/웹폴백 프롬프트.
분기 A(파일)/B(문서RAG)/C(프로젝트) 라우팅, 이중질의 리랭킹, 거절기반 웹폴백,
후속질문·출처배지까지 전 파이프라인.
config·state·rag.manager·rag.retrieval_utils·rag.router에 의존.
main은 chat_generator를 import해 SSE 래퍼(chat_stream/widget)에서 호출.
※ 리팩토링으로 main.py에서 이동 — chat_generator 본문 byte-동일(단, load_project_retriever만
   프로젝트 로직 결합으로 순환 방지 위해 함수 내부 지연 import 1줄 추가)."""
import os
import re
import time
import asyncio
import sqlite3
import traceback
import logging
from datetime import datetime
from typing import Optional, List
import httpx
import torch

from config import FEEDBACK_DB, RERANK_THRESHOLD, SEARXNG_URL, SEARXNG_ENGINES, COMPANY_NAME
from state import live_queries, indexing_tasks, tps_history
from rag.manager import RAGManager, check_vllm_health
from rag.retrieval_utils import _max_rerank, _reconstruct_context, _generate_followups
from rag.router import (
    classify_intent, rewrite_followup, respond_greeting_text,
    respond_meta_text, _GREETING_GEN_PROMPT,
)

logger = logging.getLogger("main")


async def search_web(query: str, num_results: int = 5) -> list:
    """사내 SearXNG를 통한 웹 검색 — On-Premise, API 키 불필요"""
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.get(SEARXNG_URL, params={
                "q": query,
                "format": "json",
                "engines": SEARXNG_ENGINES,
            })
            if r.status_code != 200:
                logger.warning(f"SearXNG 응답 오류: {r.status_code}")
                return []
            results = r.json().get("results", [])
            return results[:num_results]
    except Exception as e:
        logger.warning(f"웹 검색 실패: {e}")
        return []

# 웹 자동 폴백 시: 사내 문서에 답이 없을 때 웹 검색 결과로 답하는 시스템 프롬프트
# (사내 우선/충돌 비교 멘트 없음 — 어차피 관련 사내 문서가 없는 상황이므로)
_WEB_FALLBACK_SYSTEM = (f"당신은 {COMPANY_NAME} AI 어시스턴트입니다.\n"
    "아래 [웹 검색 결과]를 바탕으로 사용자 질문에 친절하고 정확하게 답하세요.\n"
    "이 정보는 사내 공식 규정이 아니라 외부 웹에서 찾은 일반 정보임을 유의하세요.\n"
    "웹 검색 결과에도 답이 없으면 '관련 정보를 찾지 못했습니다.'라고만 답하세요.\n"
    "(추정), (가능성) 같은 표현은 쓰지 마세요.")

# ── [범용 대화 모드] 사용자가 '일반대화'를 명시적으로 선택했을 때만 사용 ────────────
# 사내 규정(분기 B RAG)과 완전히 별개 경로. 모델이 자기 지식으로 자유롭게 답한다.
# ★ 가드: 회사 내부 제도의 '구체적 수치·규정'은 지어내지 말고 규정 모드로 안내(정책 날조 방지).
_GENERAL_SYSTEM = (f"당신은 {COMPANY_NAME} 직원을 돕는 친절하고 유능한 범용 AI 비서입니다.\n"
    "상식·설명·해석·번역·요약·글쓰기·코딩·일반 계산 등 무엇이든 자연스럽고 정확하게 한국어로 도와주세요.\n"
    "다만 회사의 사내 규정·급여·인사·경조·여비 등 '내부 제도의 구체적 수치나 규정'은 임의로 지어내지 말고, "
    "'해당 내용은 사내규정 모드(📘)에서 정확히 확인하실 수 있습니다.'라고 안내하세요.\n"
    "모르면 모른다고 솔직히 말하고, 억지로 답을 만들지 마세요.")

# ── [후속 질문 추천] ─────────────────────────────────────────────────────────
# 챗봇이 직접 추천하는 질문이므로 "답할 수 있는 질문만" 노출해야 신뢰가 유지된다.
# 방식: ① 방금 답변에 인용된 final_docs를 근거로 LLM이 후속질문 후보 생성(1회)
#       ② 각 후보를 재검색(GPU1, 유휴)해 '같은 근거 문서'를 끌어오는지 확인 → 답변가능성 게이트
#       ③ 게이트 통과분만 반환. 통과 0개면 빈 리스트(억지로 채우지 않음 = 양보다 신뢰).
_FOLLOWUP_ENABLED = os.getenv("FOLLOWUP_SUGGESTIONS", "1") == "1"
_SUGGEST_SEP = "|||"  # SSE 한 줄에 여러 질문을 담기 위한 구분자(본문엔 안 나오는 제어문자)

async def chat_generator(query: str, file_id: Optional[str] = None, history: List[dict] = [], user_profile: str = "", web_search: bool = False, project_id: Optional[str] = None, username: str = "", answer_mode: str = "regulation"):
    """제미나이 스타일 완벽 격리형 및 UI 동기화 제너레이터 (Activity/Personalization 지원)"""
    start_time_all = time.time()
    footer_text = ""
    collected_chunks = []
    _suggest_docs = []   # [후속질문] 사내 문서로 답한 경우의 근거 문서(게이트용). 미설정 시 추천 생략
    _src_tier = None     # [출처 등급 배지] regulation | web | general (사내 B 경로에서만 설정)
    total_tokens = 0
    # [웹 토글 통합] 사용자 수동 웹검색 버튼 제거 — 항상 사내문서 우선, 관련도 낮으면 자동 웹 폴백.
    # 프론트가 보내는 web_search 값은 무시하고 docs 모드로 시작한다.
    web_search = False
    # 채팅 종류 구분: 일반(사내 DB) / 프로젝트(업로드 파일) / 파일(임시 첨부)
    if project_id:
        _chat_kind = f"📁 [프로젝트 채팅] (프로젝트 {project_id[:8]})"
    elif file_id:
        _chat_kind = "📎 [파일 분석]"
    else:
        _chat_kind = "💬 [일반 채팅]"
    logger.info(f"{_chat_kind} 질문: \"{query[:50]}{'...' if len(query)>50 else ''}\"")

    # [Dashboard] 질의 기록 — 답변 완료가 아니라 '질문 받는 즉시' 남긴다.
    # (끝에서 기록하면 답변 도중 이탈·SSE 끊김·특수분기 return 시 누락됨 — 실제로 표/엑셀 등
    #  오래 걸리는 질문이 기록되지 않던 문제. 진입 시점 기록으로 누락 0.)
    live_queries.append({"query": query, "time": datetime.now().strftime("%m/%d %H:%M")})
    if len(live_queries) > 20:
        live_queries.pop(0)
    # DB 질의 로그 기록은 호출측 래퍼(_qlog_start/_qlog_finish)에서 처리 —
    # 진입 즉시 기록(누락 0) + 스트림 종료 시 응답시간·상태 갱신(관제)을 한곳에서.

    if not RAGManager._is_ready:
        logger.warning("⚠️  [시스템] AI 엔진 예열 중 접근 시도")
        yield "data: ⏳ AI 엔진이 예열 중입니다. (10초만 더 기다려 주세요.)\\n\n\n"
        yield "data: [DONE]\n\n"
        return

    # [C-1] vLLM 사전 점검 — 엔진(GPU)이 죽어 있으면 raw 에러 대신 안내 메시지.
    # 진짜 SPOF(GPU/vLLM 단일)에 대한 유일한 현실적 완충. /health GET은 로컬 <50ms.
    if not await check_vllm_health():
        logger.critical("❌ [C-1] vLLM 응답 없음 — 사용자에게 점검 안내 후 종료")
        yield ("data: ⚠️ AI 엔진이 일시적으로 응답하지 않습니다. 잠시 후(약 1분) 다시 시도해 주세요. "
               "문제가 지속되면 관리자에게 문의 바랍니다.\n\n")
        yield "data: [DONE]\n\n"
        return

    # ── 💬 범용 대화 모드 (사용자가 명시적으로 '일반대화' 선택) ─────────────────────
    # 사내규정(RAG)과 완전 별개 경로: 검색·계산·출처·후속질문·라우터 전부 없이 모델이 자유 답변.
    # 파일/프로젝트 채팅에는 적용하지 않음(그쪽은 각자 문서 근거). 히스토리는 그대로 주입해 맥락 유지.
    if answer_mode == "general" and file_id is None and project_id is None:
        logger.info("  ↳ 💬 [범용 대화] 모드 — 모델 자체 지식으로 자유 답변")
        history_str = ""
        if history:
            _tail = history[-6:]   # 최근 3턴 정도만 맥락으로
            history_str = "\n".join(
                f"{'사용자' if h.get('role')=='user' else 'AI'}: {(h.get('content') or '')[:600]}"
                for h in _tail
            )
            history_str = f"[이전 대화]\n{history_str}\n"
        gen_prompt = f"{_GENERAL_SYSTEM}\n{history_str}[사용자 질문]\n{query}\n답변:"
        try:
            _tok = 0
            for _chunk in RAGManager.chain._llm.stream(gen_prompt):
                _t = _chunk if isinstance(_chunk, str) else getattr(_chunk, "content", "")
                if _t:
                    _tok += len(_t)
                    yield f"data: {_t.replace(chr(10), chr(92)+'n')}\n\n"
            # 첫 대화면 제목 생성(규정 모드와 동일 UX)
            if len(history) == 0:
                try:
                    _tp = f"다음 대화의 주제를 2~3단어 명사형으로만 요약해줘. 다른 말 금지.\n질문: {query}\n제목:"
                    _gt = RAGManager.chain._llm.invoke(_tp)
                    _tt = (_gt if isinstance(_gt, str) else getattr(_gt, 'content', '')).strip().replace('"', '')
                    if _tt:
                        yield f"data: [TITLE] {_tt}\n\n"
                except Exception:
                    pass
        except Exception as e:
            logger.error(f"❌ [범용 대화] 생성 실패: {e}")
            yield "data: 죄송합니다. 답변 생성 중 문제가 발생했습니다.\\n\n"
        yield "data: [SRC] general\n\n"
        yield "data: [DONE]\n\n"
        return

    # ── 🧭 Intent Router: ① 맥락인지 분류(원문+직전대화) → 인사·메타 즉답 ──
    #                      ② '일반'으로 판정된 것만 후속 재작성 → 인사·감사는 재작성 미경유.
    # 분류기에 직전 대화를 함께 줘서 "고마워"(직전 연차)=인사, "그럼 형은?"(직전 경조금)=일반 정확 분리.
    # 파일 첨부(file_id)·웹검색 시에는 라우팅 건너뜀(기존 동작 보존).
    _q_orig = query   # [이중질의] 원문 질문 보존 — 재작성이 덮어써도 검색·리랭킹은 원문+재작성 둘 다 사용
    if file_id is None and project_id is None and not web_search:
        try:
            yield "data: [THOUGHT] 🧭 질문 유형 분석 중...\n\n"
            _intent = await classify_intent(query, history)
            logger.info(f"  ↳ 🧭 [라우터] intent='{_intent}' q='{query[:40]}'")
            if _intent == "일반" and history:
                # 일반(규정·계산)으로 판정된 후속 질문만 맥락 해소(재작성)
                _rewritten = await rewrite_followup(query, history)
                if _rewritten and _rewritten.strip() and _rewritten.strip() != query.strip():
                    yield f"data: [THOUGHT] 🔄 이어진 질문으로 이해: \"{_rewritten}\"\n\n"
                    logger.info(f"  ↳ 🔄 [재작성] '{query}' → '{_rewritten}'")
                    query = _rewritten  # 이후 검색·계산핸들러 전부 재작성된 질문 사용
            if _intent == "인사":
                # 인사는 LLM이 자연스럽게 응답 (스코프 가드 프롬프트), 실패 시 고정문구 폴백
                _streamed = False
                try:
                    _gp = _GREETING_GEN_PROMPT.format(q=query.replace('"', "'")[:300])
                    # temperature 상향 → 매번 다른 자연스러운 답변 (기본 chain은 temp=0)
                    _greet_llm = RAGManager.chain._llm.bind(temperature=0.85)
                    for _chunk in _greet_llm.stream(_gp):
                        _t = _chunk if isinstance(_chunk, str) else getattr(_chunk, "content", "")
                        if _t:
                            _streamed = True
                            yield f"data: {_t.replace(chr(10), chr(92)+'n')}\n\n"
                except Exception as e:
                    logger.warning(f"인사 LLM 생성 실패(→고정문구 폴백): {e}")
                if not _streamed:
                    yield f"data: {respond_greeting_text(query).replace(chr(10), chr(92)+'n')}\n\n"
                yield "data: [DONE]\n\n"
                return
            if _intent == "메타":
                _msg = respond_meta_text().replace("\n", "\\n")
                yield f"data: {_msg}\n\n"
                yield "data: [DONE]\n\n"
                return
        except Exception as e:
            logger.warning(f"라우터 처리 오류(→기존 RAG 진행): {e}")

    try:
        # [Premium Log] 현재 자원 상태 스캔
        rag_device = "CPU (기본)"
        free_vram = 0
        if torch.cuda.is_available():
            dev_idx = 1 if torch.cuda.device_count() > 1 else 0
            free_mem, _ = torch.cuda.mem_get_info(dev_idx)
            free_vram = free_mem / 1024**3
            rag_device = f"GPU {dev_idx} (RTX A5000)"
        
        logger.info(f"  ↳ 🖥️ [장치] 할당됨: {rag_device} | 여유 VRAM: {free_vram:.1f}GB")

        # [Premium Step] 의도 분석 시각화 데이터 송출
        if not history or len(history) == 0:
            yield f"data: [THOUGHT] 질문의 의도를 분석하고 있습니다... (할당 장치: {rag_device})\n\n"
            await asyncio.sleep(0.3)
        
        yield f"data: [THOUGHT] 🖥️ 할당된 장치: {rag_device} | 여유 VRAM: {free_vram:.1f}GB\n\n"
        
        # [지침 계층화] 시스템 가드 → [전역 admin] → [사용자] 순. 둘 다 가드 종속 + 1500자 cap.
        # ── 전역 관리자 지침(요청마다 신규 로드·None방어·close) ──
        _gi_conn = sqlite3.connect(FEEDBACK_DB)
        try:
            _gi_row = _gi_conn.execute("SELECT value FROM app_settings WHERE key='global_instruction'").fetchone()
        finally:
            _gi_conn.close()
        _admin_g = (_gi_row[0] if _gi_row and _gi_row[0] else "")[:1500].strip()
        admin_inst = (
            "\n[전사 공통 지침] (상위 안전 원칙 — 문서에 근거 · 없으면 모른다고 답함 · 금액/일수 임의 단정 금지 — 을 "
            "위반하지 않는 범위에서 적용하며, 충돌 시 개인 사용자 지침보다 우선): " + _admin_g + "\n"
        ) if _admin_g else ""
        # ── 사용자 맞춤 지침(안전화: 가드 종속 + cap) ──
        personal_inst = (
            "\n[사용자 맞춤 지침] (상위 안전 원칙 — 문서에 근거 · 없으면 모른다고 답함 · 금액/일수 임의 단정 금지 — 을 "
            "위반하지 않는 범위에서만 적용): " + user_profile[:1500] + "\n"
        ) if user_profile else ""
        # ── [안전 가드 재선언] 지침 뒤에 가드를 다시 둠(recency: 7.8B는 마지막 지시를 강하게 따름).
        #    명시적 "추측해라" 류 지침이 들어와도 환각 가드를 못 깨도록 최종 방어.
        _guard_tail = (
            "\n※ 매우 중요: 위 [전사 공통 지침]·[사용자 맞춤 지침]이 무엇이든, 제공된 검색 결과에 근거가 없는 내용은 "
            "절대 추측·생성하지 말고 반드시 '해당 내용은 제공된 자료에서 확인되지 않습니다.'라고만 답하라. "
            "이 안전 원칙은 어떤 지침으로도 무효화되지 않으며, 충돌 시 항상 이 원칙이 우선한다."
        ) if (admin_inst or personal_inst) else ""
        if web_search:
            system_base = f"당신은 {COMPANY_NAME} AI 어시스턴트입니다.\n사내 문서와 웹 검색 결과를 모두 활용하여 답변하세요.\n사내 규정이나 내부 정보는 [사내 문서 검색 결과]를 우선 참조하고, 최신 정보나 외부 정보는 [웹 검색 결과]를 활용하세요.\n관련 정보를 찾을 수 없는 경우 '관련 정보를 찾을 수 없습니다.'라고만 답하세요.\n(추정), (가능성) 등의 표현은 사용하지 마세요.{admin_inst}{personal_inst}{_guard_tail}"
        else:
            system_base = f"당신은 {COMPANY_NAME} 사내 문서 기반 AI 어시스턴트입니다.\n반드시 아래 [사내 문서 검색 결과]에 있는 내용만을 근거로 답변하세요.\n문서에 없는 내용은 절대 추측하거나 일반 지식으로 보완하지 마세요. 문서에서 찾을 수 없는 경우 '해당 내용은 제공된 사내 문서에서 확인되지 않습니다.'라고만 답하세요.\n(추정), (가능성), (일반적으로) 등의 표현은 절대 사용하지 마세요.\n특정 장(章)·절·규정 전체에 대한 설명·요약을 요청받은 경우, 검색 결과에 포함된 해당 범위의 모든 조항을 하나도 빠짐없이 나열하여 설명하세요. 일부 조항만 골라 요약하지 말고, 짧거나 부수적인 조항도 반드시 포함하세요.\n금액·일수를 여러 항목에 걸쳐 더하거나 곱해야 하는 계산은, 문서에 명시된 단위 값(예: 1박당 한도, 1일당 금액)만 그대로 제시하고, 임의로 합산·곱셈한 총액을 단정하지 마세요. 직접 계산이 필요하면 '정확한 금액은 담당 부서 확인을 권장한다'고 안내하세요.{admin_inst}{personal_inst}{_guard_tail}"

        # [Activity] 대화 기록 포맷팅 (슬라이딩 윈도우: 최근 10턴)
        history_str = ""
        if history:
            h_slice = history[-6:]
            # AI 답변은 최대 300자로 잘라 토큰 폭발 방지
            def _fmt(m):
                content = m['content']
                if m['role'] != 'user' and len(content) > 300:
                    content = content[:300] + "…"
                return f"{'사용자' if m['role']=='user' else 'AI'}: {content}"
            history_str = "\n".join([_fmt(m) for m in h_slice])
            # 표 답변 등이 누적돼 history가 비대해지는 경우 상한 (토큰 오버플로우 방지)
            if len(history_str) > 2400:
                history_str = history_str[-2400:]
            history_str = f"\n[최근 대화 기록]\n{history_str}\n"

        is_file_session = bool(file_id)
        is_project_session = bool(project_id)
        task = indexing_tasks.get(file_id) if file_id else None
        prompt = ""
        footer_text = ""
        _hybrid_tbl_str = ""
        # 웹 폴백 버퍼링 제어 플래그. 분기 B에서 재계산되지만,
        # 분기 A(파일)·C(프로젝트)는 사내 DB·웹과 무관하므로 버퍼링 없이 바로 흘린다.
        _special = True

        # [버그 방어] '유령 파일' 세션 차단 (만료된 세션 처리)
        if is_file_session and not task:
            yield "data: ⚠️ 파일 분석 세션이 만료되었습니다. 파일을 다시 업로드해주세요.\\n\n\n"
            yield "data: [DONE]\n\n"
            return

        # ---------------------------------------------------------
        # 분기 A: [업로드된 파일이 있는 세션] -> 사내 DB 완전 무시
        # ---------------------------------------------------------
        if is_file_session:
            logger.info("  ↳ 🧠 [의도] 분석: 개별 문서 분석 (업로드 파일 기반)")
            if task["status"] != "ready":
                yield "data: ⏳ 파일 분석이 아직 진행 중입니다. 잠시 후 다시 질문해주세요.\\n\n\n"
                yield "data: [DONE]\n\n"
                return

            yield f"data: [THOUGHT] '{task.get('filename')}' 문서 내에서 관련 정보를 찾는 중...\n\n"
            temp_docs = task["retriever"].search(query)
            
            # [고도화 Fallback] 검색 결과 부족 시 '사전 요약본' 및 상단 4개 컨텍스트 주입
            context_data = ""
            if not temp_docs:
                auto_sum = task.get("auto_summary", "문서 내용 요약 정보가 없습니다.")
                top_chunks = task["retriever"].parent_docs[:4] if hasattr(task["retriever"], "parent_docs") else []
                top_context = "\n".join([d.page_content for d in top_chunks])
                context_data = f"[전체 문서 사전 요약]\n{auto_sum}\n\n[문서 도입부]\n{top_context}"
            else:
                context_data = "\n\n".join([f"[참조 {i+1}] {d.page_content}" for i, d in enumerate(temp_docs)])

            prompt = f"""{system_base}
{history_str}
[문서 내용 ({task.get('filename')})]
{context_data}

[사용자 질문]
{query}

답변:"""
            footer_text = "\n\n---\n**[참조된 문서 목록]**\n"
            if temp_docs:
                for i, d in enumerate(temp_docs):
                    page = d.metadata.get('page_no')
                    p_out = f" (p.{page})" if page and str(page).isdigit() else ""
                    footer_text += f"{i+1}. 📄 {task.get('filename')} (단독 분석){p_out}\n"
            else:
                footer_text += f"1. 📄 {task.get('filename')} (전체 문서 참고 분석)\n"

        # ---------------------------------------------------------
        # 분기 C: [프로젝트 공간 세션] -> 업로드 파일만 검색 (사내 DB 무시)
        # ---------------------------------------------------------
        elif is_project_session:
            logger.info(f"  ↳ 🧠 [의도] 분석: 프로젝트 문서 분석 (project={project_id[:8]})")
            from projects_logic import load_project_retriever  # 지연 import: 프로젝트 로직 결합 → 순환 방지
            proj_retriever = load_project_retriever(project_id)
            if proj_retriever is None:
                yield "data: 이 프로젝트에는 아직 분석할 문서가 없습니다. 먼저 파일을 업로드해주세요.\\n\n\n"
                yield "data: [DONE]\n\n"
                return

            yield "data: [THOUGHT] 📁 프로젝트 문서에서 관련 정보를 찾는 중...\n\n"
            async with RAGManager.get_gpu_lock():
                sp = RAGManager.search_params
                proj_docs = proj_retriever.search(
                    query, vector_k=sp["vector_k"], bm25_k=sp["bm25_k"], mode=sp["mode"]
                )
                scored = RAGManager.chain.reranker.rerank(query, proj_docs, top_k=sp["final_top_k"]) if proj_docs else []
            top_docs = [d for d, _s in scored] if scored else proj_docs[:sp["final_top_k"]]

            if not top_docs:
                context_data = "(프로젝트 문서에서 관련 내용을 찾지 못했습니다.)"
            else:
                context_data = "\n\n".join([f"[참조 {i+1}] {d.page_content}" for i, d in enumerate(top_docs)])

            # 프로젝트 전용 시스템 지침 (사내 규정이 아니라 업로드 문서 기반)
            project_system = (
                "당신은 사용자가 업로드한 문서를 분석하는 AI 어시스턴트입니다.\n"
                "반드시 아래 [프로젝트 문서 내용]에 있는 내용만을 근거로 답변하세요.\n"
                "문서에 없는 내용은 추측하거나 일반 지식으로 보완하지 말고, "
                "'업로드된 문서에서 해당 내용을 찾을 수 없습니다.'라고 답하세요." + personal_inst
            )
            # [프로젝트 지침] 요청마다 신규 로드(캐시 금지) · None 방어 · 주입 cap 1500 · 가드 후순위 종속 주입
            _pi_conn = sqlite3.connect(FEEDBACK_DB)
            try:
                _pi_row = _pi_conn.execute("SELECT instruction FROM projects WHERE id=?", (project_id,)).fetchone()
            finally:
                _pi_conn.close()
            _proj_instr = (_pi_row[0] if _pi_row and _pi_row[0] else "")[:1500].strip()
            if _proj_instr:
                project_system += (
                    "\n[프로젝트 지침] (단, 위 원칙 — 업로드 문서만 근거 · 없으면 '업로드된 문서에서 해당 내용을 "
                    "찾을 수 없습니다.' — 을 위반하지 않는 범위에서만 적용): " + _proj_instr
                )
            # ── [토큰 오버플로우 방지] 분기 C 입력 예산 (vLLM max-model-len 16384) ──
            #   분기 C는 청크가 작아(600×7) 대체로 안전하나, 긴 질문(문서 붙여넣기 등)이 들어오면
            #   고정부+질문이 한도를 넘겨 vLLM 400 에러로 답변이 깨질 수 있어 방어한다.
            #   재현: 다양한 텍스트 ~22000자 → vLLM 400(16384 초과). 안전선 ~18000자 → 예산 14000자.
            _PROJ_INPUT_BUDGET = 14000
            q_use = query if len(query) <= 8000 else query[:8000] + "\n…(질문이 너무 길어 일부 생략됨)"
            _fixed = len(project_system) + len(history_str) + len(q_use) + 60
            _avail = max(_PROJ_INPUT_BUDGET - _fixed, 500)
            if len(context_data) > _avail:
                logger.warning(f"⚠️ [토큰보호:분기C] 문서 컨텍스트 {len(context_data)}자 → {_avail}자 절단 (오버플로우 방지)")
                context_data = context_data[:_avail] + "\n…(문서 컨텍스트 길이 제한으로 일부 생략됨)"
            prompt = f"""{project_system}
{history_str}
[프로젝트 문서 내용]
{context_data}

[사용자 질문]
{q_use}

답변:"""
            footer_text = "\n\n---\n**[참조된 문서 목록]**\n"
            for i, d in enumerate(top_docs):
                src = d.metadata.get('source', '프로젝트 문서')
                page = d.metadata.get('page_no')
                p_out = f" (p.{page})" if page and str(page).isdigit() else ""
                # [출처 강화] 답변 근거가 된 실제 발췌문을 ⟪⟫로 함께 전달 (프론트가 팝업·모달로 표시).
                # 줄바꿈·구분자 충돌 제거 후 280자로 절단.
                snippet = re.sub(r"\s+", " ", (d.page_content or "")).replace("⟪", "").replace("⟫", "").strip()[:280]
                footer_text += f"{i+1}. 📄 {src}{p_out} ⟪{snippet}⟫\n"

        # ---------------------------------------------------------
        # 분기 B: [일반 질문 세션] -> 사내 지식 DB 단독 검색
        # ---------------------------------------------------------
        else:
            logger.info("  ↳ 🧠 [의도] 분석: 전문 지식 검색 (사내 DB 활용)")

            async with RAGManager.get_gpu_lock():
                start_rerank = time.time()
                yield "data: [THOUGHT] 📂 사내 지식 베이스(Vector DB) 탐색 중...\n\n"
                sp = RAGManager.search_params
                db_docs = RAGManager.chain.retriever.search(
                    _q_orig,
                    vector_k=sp["vector_k"],
                    bm25_k=sp["bm25_k"],
                    mode=sp["mode"],
                )
                # [이중질의] 재작성이 원문과 다르면 재작성으로도 검색해 후보 합집합(recall 확보).
                #   원문 완결이면 원문이, 지시어 질문이면 재작성이 정답 문서를 끌어온다.
                if query.strip() != _q_orig.strip():
                    _extra = RAGManager.chain.retriever.search(
                        query, vector_k=sp["vector_k"], bm25_k=sp["bm25_k"], mode=sp["mode"],
                    )
                    _seen = {d.page_content for d in db_docs}
                    db_docs = db_docs + [d for d in _extra if d.page_content not in _seen]
                logger.info(f"  ↳ 🔍 [검색] 1차 후보 {len(db_docs)}건 확보 (모드: {sp['mode']}, 벡터 {sp['vector_k']}/BM25 {sp['bm25_k']})")
                yield f"data: [THOUGHT] 🔍 탐색 완료: 관련 문서 {len(db_docs)}개 발견!\n\n"

                yield "data: [THOUGHT] ⚖️ 검색된 정보들 간의 연관성 및 가중치 분석 중...\n\n"
                # [이중질의] 원문·재작성 두 질문으로 채점해 문서별 max 점수로 판정
                scored = _max_rerank(_q_orig, query, db_docs, sp["final_top_k"])
                elapsed_rerank = time.time() - start_rerank
                logger.info(f"  ↳ ⚖️ [리랭킹] 상위 {len(scored)}건 선별 ({elapsed_rerank:.2f}초)")
                yield f"data: [THOUGHT] ✅ 정밀 재채점 완료 ({elapsed_rerank:.2f}초 소요)\n\n"
                
                top_score = scored[0][1] if scored else 0
                # [점수기록] 차단 여부와 무관하게 항상 최고 연관도 기록 (임계값 스윕 분석용)
                _best_src = os.path.basename(str(scored[0][0].metadata.get('source_file', 'Unknown'))) if scored else 'None'
                logger.info(f"  ↳ 📊 [점수기록] q='{query}' top_score={top_score*100:.2f}% src='{_best_src}'")
                _threshold = sp.get("rerank_threshold", RERANK_THRESHOLD)
                _special = False   # (린 코어) 계산·환율 특수 모드 없음 — 항상 일반 버퍼링
                # [웹 폴백 트리거 = 오직 LLM의 거절] 관련도 점수로 웹을 켜지 않는다.
                # 관련도가 낮든 높든 항상 사내 문서로 먼저 답을 시도하고,
                # LLM이 "확인되지 않습니다"라고 답할 때만 아래 생성 단계에서 웹으로 재검색한다.
                _auto_web = False
                if top_score < _threshold:
                    logger.info(f"  ↳ 📉 [관련도] {top_score*100:.1f}% < {_threshold*100:.0f}% — 사내 답변 시도 후 거절 시 웹 폴백")
                final_docs = [doc for doc, _ in scored]
                _suggest_docs = final_docs   # [후속질문] 근거 문서 보관(답변 완료 후 게이트에 사용)
                _src_tier = "regulation"     # [출처배지] 사내 B 경로 진입 = 기본 규정 근거(웹폴백 시 아래서 web으로 교체)

                # [doc_access_logs] 실제 사용된 문서 기록 (위젯 TOP 4 추천용)
                if final_docs:
                    try:
                        _used = list({os.path.basename(str(d.metadata.get('source_file', '')))
                                      for d in final_docs if d.metadata.get('source_file')})
                        _dc = sqlite3.connect(FEEDBACK_DB)
                        _dc.executemany("INSERT INTO doc_access_logs (source_file) VALUES (?)", [(_f,) for _f in _used])
                        _dc.commit()
                        _dc.close()
                    except Exception:
                        pass

                # [컨텍스트 재구성] 흩어진 동일 그룹(사업부+전결권자) 청크를 묶고 번호순 정렬+개수 헤더 부착
                db_link_content = _reconstruct_context(final_docs)

                # [Premium Log] 한국어 검색 결과 요약
                logger.info(f"  ↳ 📂 [검색] DB 탐색 중... 관련 문서 {len(db_docs)}개 발견")
                logger.info(f"  ↳ ⚖️  [분석] 정밀 재채점 완료 ({elapsed_rerank:.2f}초)")
                
                if final_docs:
                    best_doc = os.path.basename(str(final_docs[0].metadata.get('source_file', 'Unknown')))
                    yield f"data: [THOUGHT] 📄 최적 근거 문서 선정: \"{best_doc}\" (연관도: {top_score*100:.1f}%)\n\n"
                    logger.info(f"  ↳ 📄 [근거] 최적 문서: \"{best_doc}\" (연관도: {top_score*100:.1f}%)")
                else:
                    # [Dashboard] Zero-Hit 기록
                    try:
                        conn = sqlite3.connect(FEEDBACK_DB)
                        c = conn.cursor()
                        c.execute("INSERT INTO zero_hits (query) VALUES (?)", (query,))
                        conn.commit()
                        conn.close()
                    except Exception as e:
                        logger.error(f"Zero-Hit 저장 오류: {e}")

                # ── 웹 검색 (web_search=True일 때) ──────────────────────────────
                web_docs = []
                web_context = ""
                if web_search:
                    yield "data: [THOUGHT] 🌐 인터넷 검색 중...\n\n"
                    web_docs = await search_web(query, num_results=5)
                    if web_docs:
                        web_context = "\n\n".join(
                            [f"[웹 {i+1}] {r.get('title','')}\n{r.get('content','')}" for i, r in enumerate(web_docs)]
                        )
                        yield f"data: [THOUGHT] 🌐 웹 검색 완료: {len(web_docs)}건 발견\n\n"

                # ── 프롬프트 조립 ────────────────────────────────────────────────
                extra_ctx = ""
                if web_search and web_docs:
                    extra_ctx += f"\n[웹 검색 결과]\n{web_context}\n"

                web_instruction = (
                    "\n[웹 검색 모드 활성] 위 [웹 검색 결과]를 반드시 참조하여 답변하세요."
                    " 사내 문서에 없는 내용이라도 웹 검색 결과에 있으면 답변할 수 있습니다."
                    " 사내 규정과 웹 정보가 충돌하면 사내 문서를 우선합니다."
                ) if web_search and web_docs else ""

                # ── [동적 컨텍스트 길이 제한] 토큰 오버플로우(16384) 방지 ──────────────
                # vLLM max-model-len 16384, output max_tokens 2048 → input 한도 ≈14336토큰.
                # 한글 1자≈1토큰 근사, 안전마진 포함해 입력 문자 예산 11000자.
                # 고정부(시스템·대화기록·질문·웹)를 먼저 확보하고 남는 예산만큼만 검색 컨텍스트 사용.
                # ⚠️ 이 값은 vLLM --max-model-len 과 반드시 동기화할 것 (작게 잡아야 안전).
                # 웹 폴백 모드: 관련도 낮은 사내 문서는 컨텍스트에서 제외(웹 결과만으로 답)
                if _auto_web:
                    ctx_for_prompt = "(관련된 사내 문서 없음 — 웹 검색 결과를 참고하여 답변)"
                else:
                    ctx_for_prompt = db_link_content if final_docs else "관련된 사내 문서를 찾을 수 없습니다."
                _INPUT_CHAR_BUDGET = 11000
                _fixed_len = len(system_base) + len(history_str) + len(extra_ctx) + len(query) + len(web_instruction) + 80
                _avail = _INPUT_CHAR_BUDGET - _fixed_len
                if _avail < 800:
                    # 대화기록이 비대 → history를 최근 2턴만 남겨 컨텍스트 공간 확보
                    _avail = max(_avail, 800)
                if len(ctx_for_prompt) > _avail:
                    ctx_for_prompt = ctx_for_prompt[:_avail] + "\n…(컨텍스트 길이 제한으로 일부 생략됨)"
                    logger.warning(f"⚠️ [토큰보호] 검색 컨텍스트 {len(db_link_content)}자 → {_avail}자 절단 (오버플로우 방지)")

                prompt = f"""{system_base}
{history_str}
[사내 문서 검색 결과]
{ctx_for_prompt}
{extra_ctx}
[사용자 질문]
{query}
{web_instruction}
답변:"""
                # ── 사내 문서 출처 조립 (웹 폴백 모드면 관련도 낮은 사내 문서는 출처에서 제외) ──
                if final_docs and not _auto_web:
                    footer_text = "\n\n---\n**[참조된 문서 목록]**\n"
                    idx = 1
                    for d in final_docs:
                        fname = os.path.basename(str(d.metadata.get('source_file','?')))
                        if not fname or fname == '?':
                            continue
                        page = d.metadata.get('page_no')
                        p_out = f" (p.{page})" if page and str(page).isdigit() else ""
                        # [출처 강화] 답변 근거가 된 발췌문을 ⟪⟫로 함께 전달(호버 미리보기용).
                        # 사내 문서는 프론트에서 클릭 시 실제 PDF 페이지를 여는 동작은 그대로 유지된다.
                        # ※ 파싱/인덱스는 무관 — 이미 검색된 d.page_content를 표시용으로 덧붙일 뿐.
                        snippet = re.sub(r"\s+", " ", (d.page_content or "")).replace("⟪", "").replace("⟫", "").strip()[:280]
                        footer_text += f"{idx}. 📄 {fname}{p_out} ⟪{snippet}⟫\n"
                        idx += 1

                # ── 웹 출처 조립 ─────────────────────────────────────────────────
                if web_docs:
                    footer_text += "\n\n---\n**[참조된 웹 페이지]**\n"
                    for i, r in enumerate(web_docs, 1):
                        title = r.get('title', '웹 페이지')
                        url = r.get('url', '#')
                        footer_text += f"{i}. 🌐 [{title}]({url})\n"

                _hybrid_tbl_str = ""   # (린 코어) 특수 근거표 로직 제거(린 코어)

        # 스트리밍 출력
        logger.info(f"🤖 [생성] AI 답변 생성 중 (GPU 0 - {RAGManager.config['llm_model']}) ...")
        start_gen = time.time()
        total_tokens = 0
        
        # 스트리밍 출력 관찰 및 수집
        collected_chunks = []
        yield f"data: [THOUGHT] 🤖 AI 답변 생성 중 ({rag_device} - {RAGManager.config['llm_model']})\n\n"

        # [웹 폴백 = 거절 트리거] 사내 문서로 답을 시도하되 답을 잠깐 버퍼링하며
        # 거절을 조기 감지. 거절이면 스트리밍을 폐기하고 웹으로 재검색한다.
        # ★ 7.8B는 "확인되지 않습니다"로만 답하지 않고 "명시되어 있지 않습니다/포함되어 있지 않"
        #   같은 변형 + 서론을 붙여 거절한다. 정확문자열 1개+40자 창으로는 이 반쪽 거절을 놓쳐
        #   → 규정 배지·후속질문이 잘못 붙던 문제. 감지어를 넓히고 버퍼 창을 키운다.
        _REFUSAL_PHRASES = ("확인되지 않습니다", "명시되어 있지 않", "포함되어 있지 않",
                            "찾을 수 없습니다", "명확하게 명시되어 있지", "규정이 없습니다",
                            "관련 내용이 없습니다", "정보가 부족합니다", "확인되지 않았습니다")
        _PEEK_LIMIT = 140            # 서론 뒤에 나오는 거절까지 포착(기존 40 → 140)
        _peek = []
        _flushed = _special                  # 계산·환율 모드는 버퍼링 없이 바로 흘림
        _refused = False
        for chunk in RAGManager.chain._llm.stream(prompt):
            if not chunk:
                continue
            text = chunk if isinstance(chunk, str) else getattr(chunk, 'content', '')
            if not text:
                continue
            total_tokens += len(text)
            if _flushed:
                collected_chunks.append(text)
                yield f"data: {text.replace(chr(10), chr(92)+'n')}\n\n"
                continue
            _peek.append(text)
            _joined = "".join(_peek)
            if any(_p in _joined for _p in _REFUSAL_PHRASES):
                _refused = True
                break
            if len(_joined) >= _PEEK_LIMIT:   # 거절 아님 확정 → 버퍼 flush 후 정상 스트리밍
                _flushed = True
                for _t in _peek:
                    collected_chunks.append(_t)
                    yield f"data: {_t.replace(chr(10), chr(92)+'n')}\n\n"
                _peek = []
        if not _refused and _peek:       # 짧은 정상 답변 잔여 flush
            for _t in _peek:
                collected_chunks.append(_t)
                yield f"data: {_t.replace(chr(10), chr(92)+'n')}\n\n"

        # ── 거절 감지 시 웹 자동 재검색 ──────────────────────────────────────
        if _refused:
            collected_chunks.clear()     # 거절 답변 폐기
            yield "data: [THOUGHT] 🌐 사내 문서에 답이 없어 웹에서 다시 검색합니다...\n\n"
            try:
                _conn = sqlite3.connect(FEEDBACK_DB)
                _conn.execute("INSERT INTO zero_hits (query) VALUES (?)", (query,))
                _conn.commit(); _conn.close()
            except Exception:
                pass
            _wdocs = await search_web(query, num_results=5)
            if _wdocs:
                _wctx = "\n\n".join([f"[웹 {i+1}] {r.get('title','')}\n{r.get('content','')}"
                                     for i, r in enumerate(_wdocs)])
                _wprompt = f"{_WEB_FALLBACK_SYSTEM}\n\n[웹 검색 결과]\n{_wctx}\n\n[사용자 질문]\n{query}\n\n답변:"
                yield "data: ℹ️ *사내 규정 문서에는 관련 내용이 없어, 웹에서 검색한 정보를 안내드립니다.*\\n\\n\n\n"
                for chunk in RAGManager.chain._llm.stream(_wprompt):
                    if not chunk:
                        continue
                    text = chunk if isinstance(chunk, str) else getattr(chunk, 'content', '')
                    if text:
                        total_tokens += len(text)
                        collected_chunks.append(text)
                        yield f"data: {text.replace(chr(10), chr(92)+'n')}\n\n"
                footer_text = "\n\n---\n**[참조된 웹 페이지]**\n"   # 출처를 웹으로 교체
                for i, r in enumerate(_wdocs, 1):
                    footer_text += f"{i}. 🌐 [{r.get('title','웹 페이지')}]({r.get('url','#')})\n"
                _src_tier = "web"   # [출처배지] 웹 폴백으로 답함
            else:
                _nf = "관련 정보를 사내 문서와 웹에서 모두 찾지 못했습니다."
                collected_chunks.append(_nf)
                yield f"data: {_nf}\n\n"
                # [모드 전환 넛지] 규정모드에서 답 못 찾음 → 일반 상식/계산/번역류일 수 있으니
                # 💬일반대화 모드를 안내. 데이터 근거: zero-hit의 약 절반이 일반지식 질문(규정모드 오사용).
                # 자동 라우팅(위험)이 아니라 '제안'이라 오탐이어도 무해.
                yield ("data: \\n\\n💡 혹시 사내 규정이 아닌 **일반 상식·계산·번역·요약** 같은 질문이라면, "
                       "입력창의 **💬 일반대화 모드**로 바꿔서 다시 물어봐 주세요.\n\n")
                footer_text = ""
                _src_tier = None   # [출처배지] 아무것도 못 찾음 → 배지 없음

        # LLM 스트리밍 완료 직후 — 연결이 살아있는 이 시점에 하이브리드 표 yield
        if _hybrid_tbl_str:
            yield f"data: {_hybrid_tbl_str.replace(chr(10), chr(92)+'n')}\n\n"

        elapsed_all = time.time() - start_time_all
        full_response = "".join(collected_chunks)
        
        # [Dashboard] TPS 기록
        tps = total_tokens / elapsed_all if elapsed_all > 0 else 0
        tps_history.append(tps)
        if len(tps_history) > 50:
            tps_history.pop(0)

        # [Dashboard] 질의 기록은 chat_generator 진입 시점으로 이동함(누락 방지). 여기선 기록하지 않음.

        yield f"data: [THOUGHT] ✅ 답변 생성 완료. (소요 시간: {elapsed_all:.1f}초 | 토큰: {total_tokens} | TPS: {tps:.1f})\n\n"
        
        # [Auto-Titling] 첫 대화일 경우 제목 생성 요청
        if len(history) == 0:
            logger.info("📝 [제목] 새로운 대화 제목 생성 중...")
            title_prompt = f"다음은 사용자의 질문과 AI의 답변입니다. 이 대화의 주제를 2~3단어로 요약해줘. 질문의 핵심만 뽑아서 명사형으로 말해줘. 다른 말은 하지 마.\n질문: {query}\n답변: {full_response[:50]}...\n제목:"
            try:
                gen_title = RAGManager.chain._llm.invoke(title_prompt)
                title_text = (gen_title if isinstance(gen_title, str) else getattr(gen_title, 'content', '')).strip().replace('"', '')
                if title_text:
                    yield f"data: [TITLE] {title_text}\n\n"
                    logger.info(f"📝 [제목] 확정: {title_text}")
            except Exception as e:
                logger.error(f"제목 생성 실패: {e}")

        logger.info(f"✅ [완료] 답변 생성 완료. (총 소요 시간: {elapsed_all:.1f}초 | 토큰: {total_tokens})")
        logger.info("-" * 80)

        if footer_text:
            safe_footer = footer_text.replace('\n', '\\n')
            yield f"data: {safe_footer}\n\n"

        # ── [후속 질문 추천] 사내 문서로 답한 경우에만, 답변가능성 게이트 통과분만 노출 ──
        # (_suggest_docs가 채워졌다는 건 사내 분기를 탔다는 뜻 → _refused도 정의돼 있음)
        if _FOLLOWUP_ENABLED and _suggest_docs and not _refused:
            try:
                _fups = await asyncio.to_thread(_generate_followups, query, _suggest_docs)
                if _fups:
                    yield f"data: [SUGGEST] {_SUGGEST_SEP.join(_fups)}\n\n"
                    logger.info(f"  ↳ 💡 [후속질문] {len(_fups)}개 제안: {_fups}")
            except Exception as _fe:
                logger.warning(f"후속질문 생성 실패: {_fe}")

        # ── [출처 등급 배지] regulation(규정) / web(웹폴백) — 사내 B 경로에서만 설정됨 ──
        # (파일/프로젝트/못찾음은 _src_tier=None → 배지 없음. general은 자체 브랜치서 emit)
        if _src_tier:
            yield f"data: [SRC] {_src_tier}\n\n"

        yield "data: [DONE]\n\n"

    except Exception as e:
        logger.error(f"❌ 에러: {traceback.format_exc()}")
        yield f"data: ❌ 시스템 에러가 발생했습니다: {str(e)}\\n\n"
        yield "data: [DONE]\n\n"
