import { useChatStore } from '@/store/useChatStore';
import { fetchSSE } from '@/utils/sseClient';
import { API_BASE } from '@/utils/config';
import { useErrorStore } from '@/store/useErrorStore';
import { classifyError } from '@/utils/errorMessage';

/**
 * 채팅 스트리밍 전송 공유 헬퍼 — 메인 채팅(`/`)과 프로젝트 채팅(`/projects/[id]/[convId]`)이 공유.
 *
 * 어시스턴트 메시지 생성 → SSE 스트리밍(THOUGHT/TITLE/본문 파싱) → 완료/에러 시 서버 저장까지
 * 일괄 처리한다. 호출자는 사용자 메시지 추가·저장과 AbortController 관리만 담당.
 *
 * project_id가 있으면 백엔드 chat_generator 분기 C(업로드 파일만 검색)로 라우팅된다.
 */
export async function streamChatResponse(opts: {
  targetId: string;
  query: string;
  history: { role: string; content: string }[];
  fileId?: string | null;
  projectId?: string | null;
  userProfile?: string;
  signal?: AbortSignal;
  onSessionExpired?: () => void;
}): Promise<string> {
  const store = useChatStore.getState();
  const assistantId = (Date.now() + 1).toString();

  store.addMessage(opts.targetId, {
    id: assistantId,
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isStreaming: true,
  });
  store.setGenerating(true);

  await fetchSSE(`${API_BASE}/api/chat/stream`, {
    method: 'POST',
    credentials: 'include',
    signal: opts.signal,
    body: JSON.stringify({
      query: opts.query,
      file_id: opts.fileId ?? null,
      project_id: opts.projectId ?? null,
      history: opts.history,
      user_profile: opts.userProfile ?? '',
      web_search: false,
      // 답변 모드(sticky, 스토어). 프로젝트/파일 채팅은 백엔드가 무시 → 항상 regulation처럼 동작.
      answer_mode: opts.projectId ? 'regulation' : useChatStore.getState().answerMode,
    }),
    onMessage: (chunk) => {
      if (chunk.includes('파일 분석 세션이 만료')) {
        opts.onSessionExpired?.();
      }
      if (chunk.startsWith('[THOUGHT]')) {
        useChatStore.getState().appendThought(opts.targetId, assistantId, chunk.replace('[THOUGHT]', '').trim());
        return;
      }
      if (chunk.startsWith('[TITLE]')) {
        useChatStore.getState().updateTitle(opts.targetId, chunk.replace('[TITLE]', '').trim());
        return;
      }
      if (chunk.startsWith('[SUGGEST]')) {
        const sugg = chunk.replace('[SUGGEST]', '').trim().split('|||').map((s) => s.trim()).filter(Boolean);
        if (sugg.length) useChatStore.getState().setSuggestions(opts.targetId, assistantId, sugg);
        return;
      }
      if (chunk.startsWith('[SRC]')) {
        const tier = chunk.replace('[SRC]', '').trim();
        if (tier === 'regulation' || tier === 'web' || tier === 'general') {
          useChatStore.getState().setSourceTier(opts.targetId, assistantId, tier);
        }
        return;
      }
      useChatStore.getState().appendChunk(opts.targetId, assistantId, chunk);
    },
    onFinished: () => {
      const s = useChatStore.getState();
      s.setGenerating(false);
      s.finishStreaming(opts.targetId, assistantId);
      const completed = s.conversations.find((c) => c.id === opts.targetId)?.messages.find((m) => m.id === assistantId);
      if (completed) s.saveAssistantMessage(opts.targetId, completed);
    },
    onError: (err: any) => {
      const s = useChatStore.getState();
      const e = classifyError(err);
      s.setGenerating(false);
      // 사용자가 '중지'한 경우 — 에러 아님, 조용히 종료
      if (e.kind === 'aborted') return;
      // 메시지 버블엔 짧은 안내, 상세 원인·대응은 전역 팝업으로 노출
      s.appendChunk(opts.targetId, assistantId, `⚠️ ${e.title} — 답변을 생성하지 못했습니다.`);
      s.finishStreaming(opts.targetId, assistantId);
      const errMsg = s.conversations.find((c) => c.id === opts.targetId)?.messages.find((m) => m.id === assistantId);
      if (errMsg?.content) s.saveAssistantMessage(opts.targetId, errMsg);
      useErrorStore.getState().show(e);
    },
  });

  return assistantId;
}
