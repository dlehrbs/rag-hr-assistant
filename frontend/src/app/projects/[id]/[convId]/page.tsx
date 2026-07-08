'use client';

import { useEffect, useRef, useState, use as usePromise } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Square, Home, Loader2 } from 'lucide-react';
import { useChatStore } from '@/store/useChatStore';
import { useProjectStore } from '@/store/useProjectStore';
import { streamChatResponse } from '@/utils/chatSend';
import MessageBubble from '@/components/chat/MessageBubble';
import ProjectFilePanel from '@/components/projects/ProjectFilePanel';

export default function ProjectChatPage({ params }: { params: Promise<{ id: string; convId: string }> }) {
  const { id: projectId, convId } = usePromise(params);
  const router = useRouter();
  const {
    conversations, isConvsLoaded, loadConversations, setActiveChat,
    isGenerating, setGenerating, addMessage, saveUserMessage, saveAssistantMessage,
    editMessage, markAborted, userProfile,
  } = useChatStore();
  const { isLoaded, loadProjects, getProject } = useProjectStore();
  const project = getProject(projectId);

  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoSentRef = useRef(false);

  useEffect(() => { if (!isLoaded) loadProjects(); }, [isLoaded, loadProjects]);
  useEffect(() => { if (!isConvsLoaded) loadConversations(); }, [isConvsLoaded, loadConversations]);
  useEffect(() => { if (isConvsLoaded) setActiveChat(convId); }, [convId, isConvsLoaded, setActiveChat]);

  const conv = conversations.find((c) => c.id === convId);
  const messages = conv?.messages || [];

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'auto' }); }, [messages]);

  const sendText = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    const userMsg = { id: `${Date.now()}-u`, role: 'user' as const, content: t, timestamp: Date.now() };
    addMessage(convId, userMsg);
    saveUserMessage(convId, userMsg);
    abortRef.current = new AbortController();
    const history = (useChatStore.getState().conversations.find((c) => c.id === convId)?.messages || [])
      .slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
    await streamChatResponse({ targetId: convId, query: t, history, projectId, userProfile, signal: abortRef.current.signal });
  };

  const send = () => {
    if (isGenerating || !input.trim()) return;
    const t = input.trim();
    setInput('');
    sendText(t);
  };

  // 개요에서 넘어온 첫 메시지: 대화 로드 완료 후 1회 전송 (레이스 제거)
  useEffect(() => {
    if (!isConvsLoaded || autoSentRef.current) return;
    let pending: string | null = null;
    try { pending = sessionStorage.getItem(`proj_pending_${convId}`); } catch { /* ignore */ }
    if (pending) {
      autoSentRef.current = true;
      try { sessionStorage.removeItem(`proj_pending_${convId}`); } catch { /* ignore */ }
      sendText(pending);
    }
  }, [isConvsLoaded, convId]);

  const handleStop = () => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    setGenerating(false);
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant') {
      markAborted(convId, last.id);
      const m = useChatStore.getState().conversations.find((c) => c.id === convId)?.messages.find((x) => x.id === last.id);
      if (m) saveAssistantMessage(convId, m);
    }
  };

  // [단축키] Esc → 생성 중지 (KeyboardShortcuts가 dy:stop 디스패치)
  const handleStopRef = useRef(handleStop);
  handleStopRef.current = handleStop;
  useEffect(() => {
    const fn = () => handleStopRef.current();
    window.addEventListener('dy:stop', fn);
    return () => window.removeEventListener('dy:stop', fn);
  }, []);

  const handleEdit = async (msgId: string, newContent: string) => {
    if (!newContent.trim() || isGenerating) return;
    editMessage(convId, msgId, newContent);
    fetch(`/api/conversations/${convId}/messages/from/${msgId}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    const edited = useChatStore.getState().conversations.find((c) => c.id === convId)?.messages.find((m) => m.id === msgId);
    if (edited) saveUserMessage(convId, edited);
    const updated = useChatStore.getState().conversations.find((c) => c.id === convId);
    const history = (updated?.messages || []).slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
    abortRef.current = new AbortController();
    await streamChatResponse({ targetId: convId, query: newContent, history, projectId, userProfile, signal: abortRef.current.signal });
  };

  const handleRegenerate = async (assistantMsgId: string) => {
    if (isGenerating) return;
    const c = conversations.find((x) => x.id === convId);
    if (!c) return;
    const idx = c.messages.findIndex((m) => m.id === assistantMsgId);
    if (idx <= 0) return;
    const userMsg = c.messages[idx - 1];
    if (userMsg.role !== 'user') return;
    editMessage(convId, userMsg.id, userMsg.content);
    fetch(`/api/conversations/${convId}/messages/from/${assistantMsgId}`, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    const updated = useChatStore.getState().conversations.find((x) => x.id === convId);
    const history = (updated?.messages || []).slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
    abortRef.current = new AbortController();
    await streamChatResponse({ targetId: convId, query: userMsg.content, history, projectId, userProfile, signal: abortRef.current.signal });
  };

  // [에러 팝업 '다시 시도'] → 마지막 답변 재생성 (ErrorModal이 dy:retry 디스패치)
  const handleRegenerateRef = useRef(handleRegenerate);
  handleRegenerateRef.current = handleRegenerate;
  useEffect(() => {
    const onRetry = () => {
      const c = useChatStore.getState().conversations.find((x) => x.id === convId);
      const lastA = c?.messages.filter((m) => m.role === 'assistant').slice(-1)[0];
      if (lastA) handleRegenerateRef.current(lastA.id);
    };
    window.addEventListener('dy:retry', onRetry);
    return () => window.removeEventListener('dy:retry', onRetry);
  }, [convId]);

  return (
    <div className="flex-1 h-screen flex bg-white dark:bg-[#1a1c1e] overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0">
        {/* 헤더 */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <button onClick={() => router.push('/')} className="flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 px-3 py-1.5 rounded-lg transition-colors">
            <Home size={15} /> 일반 채팅
          </button>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <button onClick={() => router.push(`/projects/${projectId}`)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors">
            <ArrowLeft size={15} /> {project?.name || '프로젝트'}
          </button>
        </div>

        {/* 메시지 */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-3xl mx-auto">
            {!isConvsLoaded ? (
              <div className="flex items-center justify-center py-24 text-gray-400"><Loader2 size={20} className="animate-spin mr-2" /> 대화를 불러오는 중...</div>
            ) : (
              messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} onEdit={handleEdit} onRegenerate={handleRegenerate} />
              ))
            )}
            <div ref={endRef} className="h-4" />
          </div>
        </div>

        {/* 입력 */}
        <div className="border-t border-gray-200 dark:border-gray-800 p-4 flex-shrink-0">
          <div className="max-w-3xl mx-auto flex items-end gap-2 bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-gray-700 rounded-3xl px-4 py-2 focus-within:border-blue-500 transition-colors">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if ((e.nativeEvent as any).isComposing || e.keyCode === 229) return; if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="프로젝트 문서에 대해 질문하세요..."
              rows={1}
              className="flex-1 bg-transparent border-none outline-none resize-none py-2 max-h-[160px] text-[15px] dark:text-white placeholder-gray-400"
            />
            {isGenerating ? (
              <button onClick={handleStop} className="p-2.5 bg-gray-700 hover:bg-gray-800 text-white rounded-full transition-all flex-shrink-0">
                <Square size={16} />
              </button>
            ) : (
              <button onClick={send} disabled={!input.trim()}
                className="p-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-full transition-all active:scale-95 flex-shrink-0">
                <Send size={18} />
              </button>
            )}
          </div>
        </div>
      </div>

      <ProjectFilePanel projectId={projectId} canEdit={(project?.my_role ?? 'owner') !== 'viewer'} />
    </div>
  );
}
