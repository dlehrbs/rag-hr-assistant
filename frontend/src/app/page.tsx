'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { APP_NAME } from "@/utils/branding";
import { useChatStore } from '@/store/useChatStore';
import MessageBubble from '@/components/chat/MessageBubble';
import ChatInput from '@/components/chat/ChatInput';
import ThemeToggle from '@/components/layout/ThemeToggle';
import ExportActions from '@/components/chat/ExportActions';
import { fetchSSE } from '@/utils/sseClient';
import { streamChatResponse } from '@/utils/chatSend';
import { API_BASE } from '@/utils/config';   // [W-04] URL 상수화
import { motion } from 'framer-motion';
import { Sparkles, Activity, Globe, Search, Bot, ChevronDown, Loader2, ArrowRight, Lightbulb, FileText, CheckCircle2, XCircle, ThumbsUp, ThumbsDown, FolderOpen, Plane, Gift, CalendarDays, GraduationCap, Smartphone, Car, Stamp, Home } from 'lucide-react';

// [분야별 가이드] 적재된 사내 규정과 1:1 매핑 — 첫 사용자가 "이 봇이 뭘 아는지"를 한눈에.
// 각 분야에 질문 여러 개 → 클릭할 때마다 그중 하나를 랜덤 전송(탐색성). 아이콘은 lucide SVG(이모지 배제).
const CATEGORY_GUIDE = [
  { icon: Plane,         label: '출장·경비',   qs: ['출장 여비는 어떻게 정산해?', '해외 출장 지원은 어떻게 돼?', '경비 청구 기한은 언제까지야?'] },
  { icon: CalendarDays,  label: '연차·휴가',   qs: ['연차는 며칠까지 쓸 수 있어?', '연차는 어떻게 신청해?', '근속하면 연차가 늘어나?'] },
  { icon: Home,          label: '근무·재택',   qs: ['근무 시간이 어떻게 돼?', '재택근무는 며칠까지 가능해?', '유연근무 신청은 어떻게 해?'] },
  { icon: Gift,          label: '경조사',     qs: ['결혼 경조 지원은 어떻게 돼?', '경조 휴가는 며칠이야?', '경조사 신청은 어떻게 해?'] },
  { icon: GraduationCap, label: '교육·학자금', qs: ['학자금 지원 자격은 어떻게 돼?', '교육비 지원 받을 수 있어?', '신청 절차가 어떻게 돼?'] },
  { icon: Car,           label: '차량·교통',   qs: ['차량 지원 제도가 있어?', '교통비 지원은 어떻게 돼?', '주차 지원은 있어?'] },
  { icon: Smartphone,    label: '통신·장비',   qs: ['통신비 지원은 어떻게 돼?', '업무용 장비 지급 기준은?', '수습기간에도 지원돼?'] },
  { icon: Stamp,         label: '복지·지원',   qs: ['복지 제도가 뭐 있어?', '지원금 신청은 어디서 해?', '복지 대상 자격은 어떻게 돼?'] },
];

export default function ChatPage() {
  const {
    conversations,
    activeId,
    addMessage,
    appendChunk,
    isGenerating,
    setGenerating,
    isSidebarOpen,
    toggleSidebar,
    createNewChat,
    finishStreaming,
    markAborted,
    editMessage,
    userProfile,
    activeFileId,
    isPersonaActive,
    clearFileSession,
    loadConversations,
    saveUserMessage,
    saveAssistantMessage,
  } = useChatStore();


  const [isDragOver, setIsDragOver] = useState(false);
  const [documents, setDocuments] = useState<string[]>([]);
  const [docsExpanded, setDocsExpanded] = useState(false);
  const [expandedCard, setExpandedCard] = useState<number | null>(null);
  const [sessionExpiredToast, setSessionExpiredToast] = useState(false); // [W-09] 세션 만료 토스트

  // 모델 전환
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelSwitchToast, setModelSwitchToast] = useState<{type:'success'|'error', msg:string} | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false); // [보안] 모델 전환은 admin 전용 — 일반 사용자는 표시만
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 현재 활성화된 대화 찾기
  const currentConv = useMemo(() =>
    conversations.find((c) => c.id === activeId),
    [conversations, activeId]
  );

  const messages = currentConv?.messages || [];

  // 초기 상태 리셋 및 대화 + 문서 리스트 로드
  useEffect(() => {
    setGenerating(false);

    // [보안] 역할 쿠키로 admin 여부 확인 — 모델 전환 UI 노출 분기
    setIsAdminUser(/(^| )rag_role=admin(;|$)/.test(document.cookie));

    // 서버에서 대화 목록 로드 (계정별 영구 저장)
    loadConversations();

    const fetchDocs = async (retries = 10, delay = 3000) => {
      try {
        const res = await fetch(`${API_BASE}/api/documents`, {
          credentials: 'include' // 쿠키 포함 설정 추가
        });
        const data = await res.json();
        if (data.documents) {
          // API가 객체 배열({name, size, ...}) 또는 문자열 배열 모두 처리
          const docs = data.documents.map((d: any) =>
            typeof d === 'string' ? d : d.name
          );
          setDocuments(docs);
        }
      } catch (err) {
        if (retries > 0) {
          console.warn(`백엔드가 부팅 중입니다... ${retries}번 더 재시도합니다.`);
          setTimeout(() => fetchDocs(retries - 1, delay), delay);
        } else {
          console.error("문서 목록을 가져오지 못했습니다.", err);
        }
      }
    };
    fetchDocs();

    // 현재 모델 정보 조회
    fetch(`${API_BASE}/api/current-model`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setCurrentModel(d.current_model);
          setAvailableModels(d.available_models || []);
        }
      })
      .catch(() => {});
  }, [setGenerating]);

  // 스마트 자동 스크롤: 메시지 마지막 요소로 scrollIntoView
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // 끝에서 150px 이내면 하단으로 간주
      const nearBottom = scrollHeight - scrollTop - clientHeight < 150;
      isNearBottomRef.current = nearBottom;
      // 위로 충분히 올라갔을 때만 '맨 아래로' 버튼 노출
      setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 400);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // ── 대화 내 검색 (Ctrl/⌘+F) ──
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const findMatches = findQuery.trim()
    ? messages.filter((m) => m.content?.toLowerCase().includes(findQuery.toLowerCase())).map((m) => m.id)
    : [];
  const findMatchId = findOpen ? (findMatches[findIndex] ?? null) : null;

  const gotoMatch = (idx: number) => {
    if (findMatches.length === 0) return;
    const next = (idx + findMatches.length) % findMatches.length;
    setFindIndex(next);
    document.getElementById(`msg-${findMatches[next]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  useEffect(() => {
    const open = () => { setFindOpen(true); setTimeout(() => findInputRef.current?.focus(), 50); };
    window.addEventListener('dy:find', open);
    return () => window.removeEventListener('dy:find', open);
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages]);

  // [고도화] 실제 채팅 스트리밍 로직 — 공유 헬퍼(streamChatResponse)에 위임 (프로젝트 채팅과 단일 코드경로)
  const generateResponse = async (targetId: string, query: string, convMessages: any[], fileId?: string | null) => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    // 히스토리 구성 (현재 질문을 제외한 과거 기록만 전송해야 백엔드가 첫 대화임을 인식함)
    const history = convMessages.slice(0, -1).map(m => ({
      role: m.role,
      content: m.content
    }));

    const targetConv = useChatStore.getState().conversations.find(c => c.id === targetId);

    await streamChatResponse({
      targetId,
      query,
      history,
      fileId: fileId ?? null,
      projectId: targetConv?.projectId ?? null,   // 메인 채팅은 null → 기존 동작 유지
      userProfile,
      signal: abortControllerRef.current.signal,
      onSessionExpired: () => {
        clearFileSession();
        setSessionExpiredToast(true);
        setTimeout(() => setSessionExpiredToast(false), 5000);
      },
    });
  };

  const handleSend = async (messageText: string, fileId?: string, filenames?: string[]) => {
    if (!messageText.trim() || isGenerating) return;

    let targetId = activeId;
    if (!targetId || !conversations.some(c => c.id === targetId)) {
      targetId = createNewChat();
    }

    const userMsg = {
      id: Date.now().toString(),
      role: 'user' as const,
      content: messageText,
      timestamp: Date.now(),
      files: filenames,
    };

    addMessage(targetId, userMsg);
    // 사용자 메시지 서버 저장
    saveUserMessage(targetId, userMsg);

    const updatedConv = useChatStore.getState().conversations.find(c => c.id === targetId);
    await generateResponse(targetId, messageText, updatedConv?.messages || [], fileId || activeFileId);
  };

  const handleEditMessage = async (msgId: string, newContent: string) => {
    if (!newContent.trim() || isGenerating || !activeId) return;

    // 1. 스토어에서 메시지 수정 및 이후 내역 삭제
    editMessage(activeId, msgId, newContent);

    // 서버에서 해당 메시지 포함 이후 메시지 삭제
    fetch(`/api/conversations/${activeId}/messages/from/${msgId}`, {
      method: 'DELETE', credentials: 'include',
    }).catch(() => {});

    // 수정된 사용자 메시지 서버 저장
    const editedMsg = useChatStore.getState().conversations
      .find(c => c.id === activeId)?.messages
      .find(m => m.id === msgId);
    if (editedMsg) saveUserMessage(activeId, editedMsg);

    // 2. 수정된 대화 내역 기반으로 다시 생성
    const updatedConv = useChatStore.getState().conversations.find(c => c.id === activeId);
    if (updatedConv) {
      await generateResponse(activeId, newContent, updatedConv.messages.slice(0, -1), activeFileId);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setGenerating(false);
    // 현재 활성화된 마지막 AI 메시지를 isAborted로 표시 + 서버 저장
    if (activeId) {
      const activeConv = conversations.find(c => c.id === activeId);
      if (activeConv && activeConv.messages.length > 0) {
        const lastMsg = activeConv.messages[activeConv.messages.length - 1];
        if (lastMsg.role === 'assistant') {
          markAborted(activeId, lastMsg.id);
          // 중단된 부분 응답도 저장
          const abortedMsg = useChatStore.getState().conversations
            .find(c => c.id === activeId)?.messages
            .find(m => m.id === lastMsg.id);
          if (abortedMsg) saveAssistantMessage(activeId, abortedMsg);
        }
      }
    }
  };

  // [단축키] Esc → 생성 중지 (KeyboardShortcuts가 dy:stop 이벤트 디스패치)
  const handleStopRef = useRef(handleStop);
  handleStopRef.current = handleStop;
  useEffect(() => {
    const fn = () => handleStopRef.current();
    window.addEventListener('dy:stop', fn);
    return () => window.removeEventListener('dy:stop', fn);
  }, []);

  const handleRegenerate = async (assistantMsgId: string) => {
    if (isGenerating || !activeId) return;

    const conv = conversations.find(c => c.id === activeId);
    if (!conv) return;

    // 재생성 대상 AI 메시지의 바로 이전 사용자 메시지를 찾는다
    const assistantIdx = conv.messages.findIndex(m => m.id === assistantMsgId);
    if (assistantIdx <= 0) return;

    const userMsg = conv.messages[assistantIdx - 1];
    if (userMsg.role !== 'user') return;

    // editMessage로 AI 응답 이후 메시지를 모두 제거한 뒤 재생성
    editMessage(activeId, userMsg.id, userMsg.content);

    // 서버에서도 assistant 메시지 이후 삭제
    fetch(`/api/conversations/${activeId}/messages/from/${assistantMsgId}`, {
      method: 'DELETE', credentials: 'include',
    }).catch(() => {});

    const updatedConv = useChatStore.getState().conversations.find(c => c.id === activeId);
    if (updatedConv) {
      await generateResponse(activeId, userMsg.content, updatedConv.messages, activeFileId);
    }
  };

  // [에러 팝업 '다시 시도'] → 마지막 답변 재생성 (KeyboardShortcuts/ErrorModal이 dy:retry 디스패치)
  const handleRegenerateRef = useRef(handleRegenerate);
  handleRegenerateRef.current = handleRegenerate;
  useEffect(() => {
    const onRetry = () => {
      const s = useChatStore.getState();
      const conv = s.conversations.find((c) => c.id === s.activeId);
      const lastA = conv?.messages.filter((m) => m.role === 'assistant').slice(-1)[0];
      if (lastA) handleRegenerateRef.current(lastA.id);
    };
    window.addEventListener('dy:retry', onRetry);
    return () => window.removeEventListener('dy:retry', onRetry);
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleSwitchModel = async (model: string) => {
    if (model === currentModel || switchingModel) return;
    setSwitchingModel(true);
    setModelDropdownOpen(false);
    try {
      const res = await fetch(`${API_BASE}/api/switch-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ model }),
      });
      const data = await res.json();
      if (res.ok) {
        setCurrentModel(data.current_model);
        setModelSwitchToast({ type: 'success', msg: `${data.current_model} 으로 전환됨` });
      } else {
        setModelSwitchToast({ type: 'error', msg: data.detail || '모델 전환 실패' });
      }
    } catch {
      setModelSwitchToast({ type: 'error', msg: '모델 전환 중 오류 발생' });
    } finally {
      setSwitchingModel(false);
      setTimeout(() => setModelSwitchToast(null), 3000);
    }
  };

  return (
    <div
      className="flex flex-col h-full text-gray-800 dark:text-gray-200 relative w-full"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 상단 헤더 - 사이드바 토글 버튼 [☰] 추가 */}
      <header className="flex-shrink-0 flex items-center p-3 justify-between w-full h-14 z-10 transition-colors">
        <div className="flex items-center">
          <button
            onClick={toggleSidebar}
            className="p-2 mr-3 text-gray-500 hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-all"
            title={isSidebarOpen ? "대화 보관함 닫기" : "대화 보관함 열기"}
          >
            <span className="text-xl">☰</span>
          </button>
          <div className="flex items-center space-x-2">
            {/* 모델 선택 드롭다운 */}
            <div className="relative">
              <button
                onClick={() => { if (isAdminUser) setModelDropdownOpen(prev => !prev); }}
                disabled={switchingModel || (isAdminUser && availableModels.length === 0)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 transition-all text-[13px] font-semibold text-indigo-700 dark:text-indigo-300 disabled:opacity-60 ${isAdminUser ? 'hover:bg-indigo-100 dark:hover:bg-indigo-900/50' : 'cursor-default'}`}
              >
                <Bot size={14} className="flex-shrink-0" />
                <span>{currentModel || APP_NAME}</span>
                {switchingModel
                  ? <Loader2 size={12} className="animate-spin flex-shrink-0" />
                  : (isAdminUser && <ChevronDown size={12} className="flex-shrink-0" />)}
              </button>
              {modelDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setModelDropdownOpen(false)} />
                  <div className="absolute top-full left-0 mt-1.5 z-50 min-w-[180px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden">
                    <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider border-b border-gray-100 dark:border-gray-700">
                      모델 선택
                    </div>
                    {availableModels.map(m => (
                      <button
                        key={m}
                        onClick={() => handleSwitchModel(m)}
                        className={`w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors ${m === currentModel ? 'text-indigo-600 dark:text-indigo-400 font-semibold' : 'text-gray-700 dark:text-gray-300'}`}
                      >
                        <Bot size={12} className="flex-shrink-0 opacity-60" />
                        <span>{m}</span>
                        {m === currentModel && <span className="ml-auto text-[10px] bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-md">현재</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {isPersonaActive && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center space-x-1 px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 rounded-full border border-purple-200 dark:border-purple-800/50 shadow-[0_0_10px_rgba(168,85,247,0.2)]"
              >
                <Sparkles size={12} className="text-purple-500 animate-pulse" />
                <span className="text-[10px] font-black text-purple-600 dark:text-purple-400 uppercase tracking-tighter">Persona Active</span>
              </motion.div>
            )}
          </div>
        </div>

        {/* 우측 도구: 다크/라이트 토글 */}
        <div className="flex items-center space-x-2">
          <ExportActions />
          <ThemeToggle />
        </div>
      </header>

      {/* 모델 전환 토스트 */}
      {modelSwitchToast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-sm font-medium shadow-lg border ${modelSwitchToast.type === 'success' ? 'bg-indigo-50 dark:bg-indigo-900/80 border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300' : 'bg-red-50 dark:bg-red-900/80 border-red-200 dark:border-red-700 text-red-700 dark:text-red-300'}`}>
          <span className="flex items-center gap-1.5">
            {modelSwitchToast.type === 'success'
              ? <CheckCircle2 size={14} className="flex-shrink-0" />
              : <XCircle size={14} className="flex-shrink-0" />}
            {modelSwitchToast.msg}
          </span>
        </div>
      )}

      {/* 드롭존 오버레이 생략... */}

      {/* 1. Messages Area */}
      {/* 대화 내 검색 바 (Ctrl/⌘+F) */}
      {findOpen && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 bg-white dark:bg-[#2A2B2E] border border-gray-200 dark:border-gray-700 rounded-full shadow-lg px-3 py-1.5">
          <Search size={14} className="text-gray-400 flex-shrink-0" />
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(e) => {
              const q = e.target.value;
              setFindQuery(q); setFindIndex(0);
              const ms = q.trim() ? messages.filter((m) => m.content?.toLowerCase().includes(q.toLowerCase())).map((m) => m.id) : [];
              if (ms[0]) document.getElementById(`msg-${ms[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); gotoMatch(e.shiftKey ? findIndex - 1 : findIndex + 1); }
              if (e.key === 'Escape') { setFindOpen(false); setFindQuery(''); }
            }}
            placeholder="대화 내 검색"
            className="bg-transparent outline-none text-sm w-40 text-gray-700 dark:text-gray-200 placeholder-gray-400"
          />
          <span className="text-[11px] text-gray-400 tabular-nums min-w-[34px] text-center">
            {findMatches.length ? `${findIndex + 1}/${findMatches.length}` : (findQuery ? '0/0' : '')}
          </span>
          <button onClick={() => gotoMatch(findIndex - 1)} className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="이전 (Shift+Enter)"><ChevronDown size={14} className="rotate-180" /></button>
          <button onClick={() => gotoMatch(findIndex + 1)} className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="다음 (Enter)"><ChevronDown size={14} /></button>
          <button onClick={() => { setFindOpen(false); setFindQuery(''); }} className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" title="닫기 (Esc)"><XCircle size={15} /></button>
        </div>
      )}

      <main ref={scrollRef} onScroll={handleScroll} id="chat-scroll-container" className="flex-1 overflow-y-auto pt-4 md:pt-4 md:px-8 w-full max-w-[850px] mx-auto space-y-6 scroll-smooth">
        {messages.length === 0 ? (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.1 } }
            }}
            className="flex flex-col min-h-full items-start justify-start pt-4 pb-16"
          >
            <motion.h1
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: {
                  opacity: 1,
                  y: [0, -6, 0], // 둥둥 뜨는 효과
                  transition: {
                    opacity: { duration: 0.8 },
                    y: {
                      duration: 4,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }
                  }
                }
              }}
              className="text-[26px] leading-tight font-medium bg-gradient-to-r from-[#e37172] via-[#8f80d5] to-[#458bde] bg-clip-text text-transparent pb-1 tracking-tight"
            >
              안녕하세요,
            </motion.h1>
            <motion.h2
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: {
                  opacity: 1,
                  y: [0, -4, 0], // h1과 엇박자로 뜨는 효과
                  transition: {
                    opacity: { duration: 0.8, delay: 0.1 },
                    y: {
                      duration: 5,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: 0.5
                    }
                  }
                }
              }}
              className="text-[26px] leading-tight font-medium text-gray-300 dark:text-[#444746] tracking-tight mb-4"
            >
              무엇을 도와드릴까요?
            </motion.h2>

            {/* [분야별 가이드] 적재된 사내 규정과 1:1 매핑 — 첫 사용자가 봇의 지식 범위를 한눈에 파악.
                클릭 시 해당 분야 대표 질문 즉시 전송. 아이콘은 lucide SVG로 통일. */}
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0, transition: { delay: 0.2, duration: 0.7, ease: "easeOut" } }
              }}
              className="w-full mb-5 px-2"
            >
              <p className="text-[12px] text-gray-400 dark:text-gray-500 mb-2.5 flex items-center gap-1.5">
                <Sparkles size={12} className="text-blue-400" /> 분야별로 물어보세요
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {CATEGORY_GUIDE.map((cat, i) => {
                  const Icon = cat.icon;
                  return (
                    <button
                      key={i}
                      onClick={() => handleSend(cat.qs[Math.floor(Math.random() * cat.qs.length)])}
                      title={`${cat.label} 관련 질문 (누를 때마다 랜덤)`}
                      className="group flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1f22] hover:bg-gray-50 dark:hover:bg-[#2a2b2e] hover:border-blue-300 dark:hover:border-blue-500/50 transition-all active:scale-[0.98] text-left"
                    >
                      <span className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-gray-50 dark:bg-white/5 text-gray-400 group-hover:bg-blue-50 dark:group-hover:bg-blue-500/10 group-hover:text-blue-500 transition-colors">
                        <Icon size={16} strokeWidth={1.8} />
                      </span>
                      <span className="text-[13px] font-medium text-gray-700 dark:text-gray-200 truncate">{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>

            {/* [고도화] 시스템 지능형 가이드 섹션 */}
            <motion.div
              variants={{
                hidden: { opacity: 0, y: 30 },
                visible: { opacity: 1, y: 0, transition: { delay: 0.3, duration: 0.8, ease: "easeOut" } }
              }}
              className="grid grid-cols-2 gap-2 w-full mb-4 px-2"
            >
              {[
                {
                  icon: <Sparkles size={16} />,
                  title: "사내 지식 베이스 검색",
                  badge: "Standard",
                  badgeColor: "blue",
                  desc: "사내 규정·기술 매뉴얼·공지 등 학습된 사내 문서를 근거로 정확한 답변을 찾아줍니다. (현재 채팅의 기본 모드)",
                  example: "복리후생 제도 중 경조사 지원 범위는?",
                },
                {
                  icon: <FolderOpen size={16} />,
                  title: "프로젝트 공간 (내 파일 분석)",
                  badge: "Private",
                  badgeColor: "purple",
                  desc: "좌측 '프로젝트'에서 나만의 작업 공간을 만들고 PDF·Word·Excel·PPT·HTML을 올리면, 업로드한 문서만 근거로 요약·분석·대화합니다. 자료는 계정별로 격리됩니다.",
                  example: "이 보고서들에서 핵심 수치 5가지를 표로 요약해줘",
                },
                {
                  icon: <Globe size={16} />,
                  title: "자동 웹 검색 보완",
                  badge: "Web",
                  badgeColor: "emerald",
                  desc: "사내 문서에서 답을 찾지 못하면 자동으로 인터넷을 검색해 보완합니다. (별도 버튼 없이 자동 동작) 환율 정보도 자동 반영됩니다.",
                  example: "다른 회사들의 평균 연차 일수는 보통 며칠이야?",
                },
                {
                  icon: <Search size={16} />,
                  title: "출처 근거 확인",
                  badge: "Verify",
                  badgeColor: "green",
                  desc: "답변 하단의 출처 칩을 클릭하면 근거가 된 원문 발췌가 바로 표시되고, 사내 PDF는 해당 페이지가 새 창으로 열려 신뢰도를 확인할 수 있습니다.",
                  example: "답변 내 [📄 문서] 칩을 클릭해 원문 근거 확인",
                },
              ].map((card, i) => {
                const isOpen = expandedCard === i;
                const colorMap: Record<string, string> = {
                  blue: "border-blue-300/60 dark:border-blue-900/40 hover:border-blue-400",
                  purple: "border-purple-300/60 dark:border-purple-900/40 hover:border-purple-400",
                  emerald: "border-emerald-300/60 dark:border-emerald-900/40 hover:border-emerald-400",
                  green: "border-green-300/60 dark:border-green-900/40 hover:border-green-400",
                };
                const iconColorMap: Record<string, string> = {
                  blue: "text-blue-500 dark:text-blue-400",
                  purple: "text-purple-500 dark:text-purple-400",
                  emerald: "text-emerald-500 dark:text-emerald-400",
                  green: "text-green-500 dark:text-green-400",
                };
                const badgeBg: Record<string, string> = {
                  blue: "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300",
                  purple: "bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300",
                  emerald: "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300",
                  green: "bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300",
                };
                return (
                  <button
                    key={i}
                    onClick={() => setExpandedCard(isOpen ? null : i)}
                    className={`text-left p-3 rounded-xl bg-white/40 dark:bg-white/5 border backdrop-blur-sm transition-all shadow-sm ${colorMap[card.badgeColor]}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={iconColorMap[card.badgeColor]}>{card.icon}</span>
                      <span className="text-[12px] font-bold text-gray-800 dark:text-gray-100 flex-1 leading-tight">{card.title}</span>
                      <span className={`px-1.5 py-0.5 text-[8px] rounded font-black uppercase flex-shrink-0 ${badgeBg[card.badgeColor]}`}>{card.badge}</span>
                      <ChevronDown size={12} className={`text-gray-400 transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                    </div>
                    {isOpen && (
                      <div className="mt-2 pt-2 border-t border-white/30 dark:border-white/10">
                        <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed mb-1">{card.desc}</p>
                        <p className={`text-[10px] font-semibold flex items-center gap-1 ${iconColorMap[card.badgeColor]}`}>
                          <ArrowRight size={9} className="flex-shrink-0" />
                          "{card.example}"
                        </p>
                      </div>
                    )}
                  </button>
                );
              })}
            </motion.div>

            {documents.length > 0 && (
              <motion.div
                variants={{
                  hidden: { opacity: 0 },
                  visible: { opacity: 1, transition: { delay: 0.6, duration: 0.8 } }
                }}
                className="mt-2 w-full"
              >
                {/* 프로젝트 기능 안내 배너 */}
                <div className="w-full mb-4 px-4 py-3 rounded-2xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/40 flex items-start gap-3">
                  <span className="text-green-600 flex-shrink-0 mt-0.5"><FolderOpen size={18} /></span>
                  <div className="text-left">
                    <p className="text-sm font-bold text-green-700 dark:text-green-400">🗂️ 내 파일로 분석하는 '프로젝트 공간'</p>
                    <p className="text-xs text-green-600 dark:text-green-500 mt-0.5 leading-relaxed">
                      좌측 상단 <strong>'프로젝트'</strong>에서 나만의 작업 공간을 만들고 <strong>PDF·Word·Excel·PPT·HTML</strong> 파일을 올리면, 업로드한 문서만을 근거로 질문·요약·분석할 수 있습니다. 자료는 <strong>계정별로 안전하게 격리</strong>되며 사내 지식 베이스와 별개로 운영됩니다. 스캔된 이미지 PDF도 자동 인식하여 분석합니다.
                    </p>
                  </div>
                </div>

                {/* 피드백 활용 안내 배너 */}
                <div className="w-full mb-4 px-4 py-3 rounded-2xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/40 flex items-start gap-3">
                  <span className="flex-shrink-0 mt-0.5 flex items-center gap-0.5">
                    <ThumbsUp size={15} className="text-blue-500" />
                    <ThumbsDown size={15} className="text-blue-400" />
                  </span>
                  <div className="text-left">
                    <p className="text-sm font-bold text-blue-700 dark:text-blue-400">답변에 대한 평가를 남겨주세요</p>
                    <p className="text-xs text-blue-600 dark:text-blue-500 mt-0.5 leading-relaxed">
                      답변 아래 <strong>👍 좋아요 / 👎 싫어요</strong> 버튼을 적극적으로 눌러주세요. 여러분의 피드백은 잘못된 답변을 찾아내고 챗봇의 정확도를 높이는 데 직접 활용됩니다.
                    </p>
                  </div>
                </div>

                {/* 토글 헤더 */}
                <button
                  onClick={() => setDocsExpanded(prev => !prev)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 mb-3 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 hover:border-indigo-300 dark:hover:border-indigo-600/60 transition-all group"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <FileText size={18} className="text-indigo-500 flex-shrink-0" />
                    <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300 truncate">
                      학습된 문서 지식 (Knowledge Base)
                    </span>
                    <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-indigo-500 text-white text-[11px] font-bold">
                      {documents.length}건
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 flex-shrink-0 text-indigo-500 dark:text-indigo-400">
                    <span className="text-xs font-semibold hidden sm:inline">{docsExpanded ? '접기' : '전체 보기'}</span>
                    <ChevronDown
                      size={18}
                      className={`transition-transform duration-300 ${docsExpanded ? 'rotate-180' : ''}`}
                    />
                  </span>
                </button>

                {/* 토글 펼쳐지면 전체 문서 표시 */}
                {docsExpanded && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 w-full">
                    {documents.map((doc, idx) => (
                      <motion.a
                        key={idx}
                        href={`${API_BASE}/api/docs/${encodeURIComponent(doc)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: idx * 0.03 }}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="flex flex-col items-start p-4 rounded-2xl bg-[#F0F4F9] dark:bg-[#1E1F22] hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all border border-transparent hover:border-blue-200 dark:hover:border-blue-700/40 text-left group"
                      >
                        <FileText size={20} className="mb-2 text-gray-400 group-hover:text-blue-500 transition-colors" />
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300 line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400">{doc}</span>
                        <span className="text-[10px] text-gray-400 mt-1">📄 PDF 열기</span>
                      </motion.a>
                    ))}
                  </div>
                )}

                {/* 닫혀있을 때 미리보기 3개 */}
                {!docsExpanded && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 w-full">
                    {documents.slice(0, 3).map((doc, idx) => (
                      <motion.a
                        key={idx}
                        href={`${API_BASE}/api/docs/${encodeURIComponent(doc)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="flex flex-col items-start p-4 rounded-2xl bg-[#F0F4F9] dark:bg-[#1E1F22] hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all border border-transparent hover:border-blue-200 dark:hover:border-blue-700/40 text-left group"
                      >
                        <FileText size={20} className="mb-2 text-gray-400 group-hover:text-blue-500 transition-colors" />
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300 line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400">{doc}</span>
                        <span className="text-[10px] text-gray-400 mt-1">📄 PDF 열기</span>
                      </motion.a>
                    ))}
                  </div>
                )}

                {!docsExpanded && documents.length > 3 && (
                  <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-3">
                    외 {documents.length - 3}건 더 있습니다. 위 화살표를 클릭해 전체 보기
                  </p>
                )}
              </motion.div>
            )}
          </motion.div>
        ) : (
          <div className="pb-10">
            {messages.map((msg, mi) => (
              <div
                key={msg.id}
                id={`msg-${msg.id}`}
                className={findMatchId === msg.id ? 'rounded-2xl ring-2 ring-yellow-400 ring-offset-2 ring-offset-white dark:ring-offset-[#131314] transition-all' : ''}
              >
                <MessageBubble
                  message={msg}
                  onEdit={(id, content) => handleEditMessage(id, content)}
                  onRegenerate={(id) => handleRegenerate(id)}
                  isLast={mi === messages.length - 1 && !isGenerating}
                  onSelectSuggestion={(q) => handleSend(q)}
                />
              </div>
            ))}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        )}
      </main>

      {/* 맨 아래로 스크롤 버튼 (위로 충분히 올라갔을 때만) */}
      {showScrollBtn && messages.length > 0 && (
        <button
          onClick={scrollToBottom}
          aria-label="맨 아래로"
          className="absolute left-1/2 -translate-x-1/2 bottom-[140px] z-30 w-10 h-10 rounded-full bg-white dark:bg-[#2A2B2E] border border-gray-200 dark:border-gray-700 shadow-lg flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#35363a] transition-all active:scale-90"
        >
          <ChevronDown size={20} strokeWidth={2.5} />
        </button>
      )}

      {/* 2. Input Area */}
      <ChatInput onSend={handleSend} onStop={handleStop} disabled={isGenerating} />
    </div>
  );
}
