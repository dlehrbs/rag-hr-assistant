import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  files?: string[];
  isStreaming?: boolean;
  thoughtSteps?: string[];
  isAborted?: boolean;
  feedback?: number;
  suggestions?: string[];   // [후속질문] 백엔드 게이트를 통과한 추천 질문(마지막 AI 답변에만 노출)
  sourceTier?: 'regulation' | 'web' | 'general';   // [출처 등급 배지] 답변 근거 등급
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  isPinned?: boolean;
  projectId?: string | null;   // 프로젝트 공간 대화면 프로젝트 id, 일반 대화면 null
  activeFileId: string | null;
  attachedFiles: { id: string; name: string; uploadedAt?: number }[];
}

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  isGenerating: boolean;
  isSidebarOpen: boolean;
  activeFileId: string | null;
  attachedFiles: { id: string; name: string; uploadedAt?: number }[];
  userProfile: string;
  isPersonaActive: boolean;
  isConvsLoaded: boolean;  // 서버에서 대화 로드 완료 여부
  answerMode: 'regulation' | 'general';  // 답변 모드(sticky): 사내규정(기본) | 일반대화

  // 기존 액션 (시그니처 유지)
  createNewChat: (projectId?: string | null) => string;
  startNewChat: () => string;   // 빈 새 채팅이 이미 있으면 재사용(중복 방지)
  setActiveChat: (id: string) => void;
  setFileToChat: (fileId: string | null, files: { id: string; name: string }[]) => void;
  setUserProfile: (profile: string) => void;
  addMessage: (convId: string, msg: Message) => void;
  appendChunk: (convId: string, msgId: string, chunk: string) => void;
  appendThought: (convId: string, msgId: string, thought: string) => void;
  setSuggestions: (convId: string, msgId: string, suggestions: string[]) => void;
  setSourceTier: (convId: string, msgId: string, tier: 'regulation' | 'web' | 'general') => void;
  setAnswerMode: (mode: 'regulation' | 'general') => void;
  updateTitle: (convId: string, title: string) => void;
  togglePin: (convId: string) => void;
  moveConversation: (convId: string, projectId: string | null) => void;
  deleteChat: (id: string) => void;
  setGenerating: (status: boolean) => void;
  toggleSidebar: () => void;
  clearAll: () => void;
  finishStreaming: (convId: string, msgId: string) => void;
  markAborted: (convId: string, msgId: string) => void;
  editMessage: (convId: string, msgId: string, newContent: string) => void;
  clearFileSession: () => void;
  setFeedback: (convId: string, msgId: string, score: number) => void;

  // 서버 동기화 액션
  loadConversations: () => Promise<void>;
  saveUserMessage: (convId: string, msg: Message) => void;
  saveAssistantMessage: (convId: string, msg: Message) => void;
}

// 대화 로드 동시 호출 합치기용 (진행 중 Promise 공유 — 중복 요청 방지)
let _convsLoadingPromise: Promise<void> | null = null;

// ── Fire-and-forget API 헬퍼 ──────────────────────────────────────────────────
const _sync = (url: string, options: RequestInit = {}) => {
  fetch(url, { credentials: 'include', ...options }).catch(() => {});
};

// ── 서버 응답 → 스토어 포맷 변환 ────────────────────────────────────────────
const _mapServerConvs = (data: any[]): Conversation[] =>
  [...data].sort((a, b) => {
    // isPinned 우선, 그 다음 updated_at 내림차순
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  }).map(conv => ({
    id: conv.id,
    title: conv.title,
    isPinned: !!conv.is_pinned,
    projectId: conv.project_id ?? null,
    updatedAt: new Date(conv.updated_at).getTime(),
    messages: (conv.messages ?? []).map((m: any) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: m.msg_timestamp,
      files: m.files_json ? JSON.parse(m.files_json) : undefined,
      thoughtSteps: m.thought_steps_json ? JSON.parse(m.thought_steps_json) : undefined,
      isAborted: !!m.is_aborted,
      feedback: m.feedback ?? undefined,
      isStreaming: false,
    })),
    activeFileId: null,
    attachedFiles: [],
  }));

// ── localStorage 마이그레이션 (최초 1회) ────────────────────────────────────
const _migrateLocalStorage = async () => {
  try {
    const raw = localStorage.getItem('gemini-rag-storage');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const oldConvs: any[] = parsed?.state?.conversations ?? [];
    if (!oldConvs.length) return;

    for (const conv of oldConvs) {
      await fetch('/api/conversations', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: conv.id,
          title: conv.title || '새로운 채팅',
          is_pinned: conv.isPinned ?? false,
          updated_at: conv.updatedAt ? new Date(conv.updatedAt).toISOString() : new Date().toISOString(),
        }),
      }).catch(() => {});

      for (const msg of (conv.messages ?? [])) {
        if (msg.isStreaming) continue;
        await fetch(`/api/conversations/${conv.id}/messages`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: msg.id, role: msg.role, content: msg.content,
            timestamp: msg.timestamp,
            files: msg.files ?? null,
            thought_steps: msg.thoughtSteps ?? null,
            is_aborted: msg.isAborted ?? false,
            feedback: msg.feedback ?? null,
          }),
        }).catch(() => {});
      }
    }

    // 마이그레이션 완료 — conversations는 localStorage에서 제거, 설정값만 남김
    const newStorage = {
      state: {
        isSidebarOpen: parsed.state?.isSidebarOpen ?? true,
        userProfile: parsed.state?.userProfile ?? '',
      },
      version: 0,
    };
    localStorage.setItem('gemini-rag-storage', JSON.stringify(newStorage));
  } catch {
    // 마이그레이션 실패해도 UI는 정상 동작
  }
};

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,
      isGenerating: false,
      isSidebarOpen: true,
      activeFileId: null,
      attachedFiles: [],
      userProfile: '',
      isPersonaActive: false,
      isConvsLoaded: false,
      answerMode: 'regulation',
      setAnswerMode: (mode) => set({ answerMode: mode }),

      // ── 서버에서 대화 로드 ────────────────────────────────────────────────
      loadConversations: async () => {
        // 동시 호출 합치기: 여러 컴포넌트(페이지+사이드바)가 동시에 마운트되며
        // 호출해도 실제 요청은 1건만 나가도록 진행 중 Promise를 공유한다.
        if (_convsLoadingPromise) return _convsLoadingPromise;
        _convsLoadingPromise = (async () => {
        try {
          const res = await fetch('/api/conversations', { credentials: 'include' });
          if (!res.ok) { set({ isConvsLoaded: true }); return; }
          const data: any[] = await res.json();

          // 서버에 데이터 없고 localStorage에 구 버전 데이터 있으면 마이그레이션
          if (data.length === 0) {
            const raw = localStorage.getItem('gemini-rag-storage');
            const old = raw ? JSON.parse(raw)?.state?.conversations ?? [] : [];
            if (old.length > 0) {
              await _migrateLocalStorage();
              const res2 = await fetch('/api/conversations', { credentials: 'include' });
              if (res2.ok) {
                const data2 = await res2.json();
                const convs = _mapServerConvs(data2);
                set({ conversations: convs, isConvsLoaded: true, activeId: convs[0]?.id ?? null });
                return;
              }
            }
            set({ isConvsLoaded: true });
            return;
          }

          const convs = _mapServerConvs(data);
          const curActive = get().activeId;
          const validActive = convs.find(c => c.id === curActive)?.id ?? convs[0]?.id ?? null;
          set({ conversations: convs, isConvsLoaded: true, activeId: validActive });
        } catch {
          set({ isConvsLoaded: true }); // 실패해도 UI는 동작
        } finally {
          _convsLoadingPromise = null;   // 다음 호출(로그아웃 후 재로그인 등) 허용
        }
        })();
        return _convsLoadingPromise;
      },

      // ── 사용자 메시지 서버 저장 ──────────────────────────────────────────
      saveUserMessage: (convId, msg) => {
        _sync(`/api/conversations/${convId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: msg.id, role: msg.role, content: msg.content,
            timestamp: msg.timestamp,
            files: msg.files ?? null,
            thought_steps: null,
            is_aborted: false, feedback: null,
          }),
        });
      },

      // ── AI 메시지 서버 저장 (스트리밍 완료 또는 중단 후 호출) ────────────
      saveAssistantMessage: (convId, msg) => {
        if (!msg.content && !msg.isAborted) return; // 빈 미완성 메시지는 저장 안 함
        _sync(`/api/conversations/${convId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: msg.id, role: msg.role, content: msg.content,
            timestamp: msg.timestamp,
            files: null,
            thought_steps: msg.thoughtSteps ?? null,
            is_aborted: msg.isAborted ?? false,
            feedback: msg.feedback ?? null,
          }),
        });
      },

      // ── 새 채팅 생성 ─────────────────────────────────────────────────────
      createNewChat: (projectId = null) => {
        const newId = Date.now().toString();
        const newConv: Conversation = {
          id: newId, title: '새로운 채팅', messages: [],
          updatedAt: Date.now(), activeFileId: null, attachedFiles: [],
          projectId: projectId ?? null,
        };
        set((state) => ({
          conversations: [newConv, ...state.conversations],
          activeId: newId, activeFileId: null, attachedFiles: [],
        }));
        _sync('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: newId, title: '새로운 채팅',
            is_pinned: false,
            updated_at: new Date().toISOString(),
            project_id: projectId ?? null,
          }),
        });
        return newId;
      },

      // 빈 새 채팅(메시지 0개, 일반 대화) 이 이미 있으면 그걸 활성화해 재사용 — 빈 탭 중복 생성 방지
      startNewChat: () => {
        const st = get();
        const empty = st.conversations.find((c) => !c.projectId && c.messages.length === 0);
        if (empty) {
          set({ activeId: empty.id, activeFileId: null, attachedFiles: [] });
          return empty.id;
        }
        return get().createNewChat();
      },

      setActiveChat: (id) => {
        const conv = get().conversations.find(c => c.id === id);
        set({ activeId: id, activeFileId: conv?.activeFileId || null, attachedFiles: conv?.attachedFiles || [] });
      },

      setFileToChat: (fileId, files) =>
        set((state) => {
          const filesWithTime = files.map(f => ({ ...f, uploadedAt: Date.now() }));
          return {
            activeFileId: fileId,
            attachedFiles: filesWithTime,
            conversations: state.conversations.map((c) =>
              c.id === state.activeId ? { ...c, activeFileId: fileId, attachedFiles: filesWithTime } : c
            ),
          };
        }),

      setUserProfile: (profile) => set({
        userProfile: profile,
        isPersonaActive: profile.trim().length > 0,
      }),

      addMessage: (convId, msg) =>
        set((state) => {
          const conversations = state.conversations.map((c) => {
            if (c.id === convId) {
              const updatedMessages = [...c.messages, msg];
              let newTitle = c.title;
              if (c.messages.length === 0 && msg.role === 'user') {
                newTitle = msg.content.slice(0, 20) + (msg.content.length > 20 ? '...' : '');
              }
              return { ...c, messages: updatedMessages, title: newTitle, updatedAt: Date.now() };
            }
            return c;
          });
          return { conversations };
        }),

      appendChunk: (convId, msgId, chunk) =>
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === msgId ? { ...m, content: m.content + chunk } : m
              ),
            } : c
          ),
        })),

      appendThought: (convId, msgId, thought) =>
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === msgId ? { ...m, thoughtSteps: [...(m.thoughtSteps || []), thought] } : m
              ),
            } : c
          ),
        })),

      setSuggestions: (convId, msgId, suggestions) =>
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === msgId ? { ...m, suggestions } : m
              ),
            } : c
          ),
        })),

      setSourceTier: (convId, msgId, tier) =>
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === msgId ? { ...m, sourceTier: tier } : m
              ),
            } : c
          ),
        })),

      finishStreaming: (convId, msgId) =>
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === msgId ? { ...m, isStreaming: false } : m
              ),
            } : c
          ),
        })),

      markAborted: (convId, msgId) =>
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === msgId ? { ...m, isStreaming: false, isAborted: true } : m
              ),
            } : c
          ),
        })),

      // ── 제목 업데이트 + 서버 동기화 ─────────────────────────────────────
      updateTitle: (convId, title) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId ? { ...c, title, updatedAt: Date.now() } : c
          ),
        }));
        _sync(`/api/conversations/${convId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, updated_at: new Date().toISOString() }),
        });
      },

      // ── 핀 고정/해제 + 서버 동기화 ──────────────────────────────────────
      togglePin: (convId) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId ? { ...c, isPinned: !c.isPinned } : c
          ),
        }));
        const conv = get().conversations.find(c => c.id === convId);
        if (conv) {
          _sync(`/api/conversations/${convId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_pinned: conv.isPinned }),
          });
        }
      },

      // ── 대화의 프로젝트 이동/제거 (projectId=null 이면 프로젝트에서 제거) ──
      moveConversation: (convId, projectId) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId ? { ...c, projectId } : c
          ),
        }));
        _sync(`/api/conversations/${convId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ set_project_id: true, project_id: projectId }),
        });
      },

      // ── 대화 삭제 + 서버 동기화 ─────────────────────────────────────────
      deleteChat: (id) => {
        set((state) => {
          const filtered = state.conversations.filter((c) => c.id !== id);
          const nextActive = state.activeId === id ? (filtered[0]?.id || null) : state.activeId;
          return { conversations: filtered, activeId: nextActive };
        });
        _sync(`/api/conversations/${id}`, { method: 'DELETE' });
      },

      setGenerating: (status) => set({ isGenerating: status }),
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

      // ── 전체 대화 삭제 + 서버 동기화 ────────────────────────────────────
      clearAll: () => {
        set({ conversations: [], activeId: null });
        _sync('/api/conversations/all', { method: 'DELETE' });
      },

      // ── 피드백 저장 + 서버 동기화 ────────────────────────────────────────
      setFeedback: (convId, msgId, score) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === convId ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === msgId ? { ...m, feedback: score } : m
              ),
            } : c
          ),
        }));
        _sync(`/api/conversations/${convId}/messages/${msgId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback: score }),
        });
      },

      // ── 메시지 수정 (이후 메시지 삭제 + 서버 동기화) ─────────────────────
      editMessage: (convId, msgId, newContent) =>
        set((state) => ({
          conversations: state.conversations.map((c) => {
            if (c.id === convId) {
              const msgIndex = c.messages.findIndex((m) => m.id === msgId);
              if (msgIndex !== -1) {
                const updatedMessages = c.messages.slice(0, msgIndex + 1);
                updatedMessages[msgIndex] = {
                  ...updatedMessages[msgIndex],
                  content: newContent,
                  timestamp: Date.now(),
                };
                return { ...c, messages: updatedMessages, updatedAt: Date.now() };
              }
            }
            return c;
          }),
        })),

      clearFileSession: () =>
        set((state) => ({
          activeFileId: null,
          attachedFiles: [],
          conversations: state.conversations.map((c) =>
            c.id === state.activeId ? { ...c, activeFileId: null, attachedFiles: [] } : c
          ),
        })),
    }),
    {
      name: 'gemini-rag-storage',
      // conversations는 서버에서 관리 — localStorage에는 설정값만 저장
      partialize: (state) => ({
        isSidebarOpen: state.isSidebarOpen,
        userProfile: state.userProfile,
      }),
      onRehydrateStorage: () => (state) => {
        // userProfile이 복원된 후 isPersonaActive 동기화
        if (state && state.userProfile) {
          state.isPersonaActive = state.userProfile.trim().length > 0;
        }
      },
    }
  )
);
