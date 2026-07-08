'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useChatStore } from '@/store/useChatStore';
import { Keyboard, X } from 'lucide-react';
import { MOD_KEY as MOD } from '@/utils/platform';

// 전역 키보드 단축키 (Claude.ai 웹 스타일). 루트 레이아웃에 마운트.
// MOD = ⌘(Mac) / Ctrl(Win·Linux) — 윈도우 사용자는 자동으로 "Ctrl"로 표시됨

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: [MOD, 'Shift', 'O'], label: '새 채팅 시작' },
  { keys: [MOD, 'K'], label: '대화 검색 (사이드바)' },
  { keys: [MOD, 'F'], label: '대화 내 검색' },
  { keys: [MOD, 'B'], label: '사이드바 열기 / 닫기' },
  { keys: [MOD, 'Shift', 'C'], label: '마지막 답변 복사' },
  { keys: [MOD, '/'], label: '단축키 도움말 열기 / 닫기' },
  { keys: ['Enter'], label: '메시지 전송' },
  { keys: ['Shift', 'Enter'], label: '줄바꿈' },
  { keys: ['↑'], label: '빈 입력창에서 마지막 질문 불러와 수정' },
  { keys: ['Esc'], label: '생성 중지 / 팝업 닫기' },
];

export default function KeyboardShortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const s = useChatStore.getState();

      // 단축키 도움말 토글
      if (mod && e.key === '/') { e.preventDefault(); setHelpOpen((v) => !v); return; }

      // 새 채팅
      if (mod && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        s.startNewChat();   // 빈 새 채팅 재사용 (중복 방지)
        router.push('/');
        return;
      }
      // 사이드바 토글
      if (mod && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        s.toggleSidebar();
        return;
      }
      // 대화 검색 포커스 (사이드바 자동 오픈)
      if (mod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (!s.isSidebarOpen) s.toggleSidebar();
        setTimeout(() => (document.getElementById('conv-search') as HTMLInputElement | null)?.focus(), 60);
        return;
      }
      // 대화 내 검색 (메시지가 있을 때만 브라우저 찾기를 가로챔)
      if (mod && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        const conv = s.conversations.find((c) => c.id === s.activeId);
        if (conv && conv.messages.length > 0) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('dy:find'));
        }
        return;
      }
      // 마지막 답변 복사
      if (mod && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        const conv = s.conversations.find((c) => c.id === s.activeId);
        const lastA = conv?.messages.filter((m) => m.role === 'assistant').slice(-1)[0];
        const text = lastA?.content?.split('\n\n---')[0].trim();
        if (text) { e.preventDefault(); navigator.clipboard?.writeText(text); }
        return;
      }
      // Enter — 어디서든(입력 필드·버튼·모달 밖) 바로 입력창으로 포커스 이동
      if (e.key === 'Enter' && !mod && !e.shiftKey && !helpOpen) {
        const el = document.activeElement as HTMLElement | null;
        const inEditable = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
        const onButton = !!el && (el.tagName === 'BUTTON' || el.tagName === 'A');
        if (!inEditable && !onButton) {
          const ta = document.getElementById('chat-input') as HTMLTextAreaElement | null;
          if (ta) { e.preventDefault(); ta.focus(); }
        }
        return;
      }

      // Esc — 도움말 닫기 → 생성 중지
      if (e.key === 'Escape') {
        if (helpOpen) { setHelpOpen(false); return; }
        if (s.isGenerating) { window.dispatchEvent(new CustomEvent('dy:stop')); return; }
      }
    };
    window.addEventListener('keydown', onKey);
    // 다른 컴포넌트(예: 도움말 버튼)에서 모달 열기
    const openHelp = () => setHelpOpen(true);
    window.addEventListener('dy:show-shortcuts', openHelp as EventListener);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('dy:show-shortcuts', openHelp as EventListener);
    };
  }, [helpOpen, router]);

  // 구석에 항상 떠 있는 단축키 도움말(?) 버튼
  if (!helpOpen) {
    return (
      <button
        onClick={() => setHelpOpen(true)}
        title={`키보드 단축키 (${MOD} + /)`}
        aria-label="키보드 단축키"
        className="fixed bottom-4 right-4 z-[9000] w-8 h-8 rounded-full bg-white/80 dark:bg-[#2A2B2E]/80 backdrop-blur border border-gray-200 dark:border-gray-700 shadow-md flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:scale-110 transition-all"
      >
        <span className="text-[13px] font-bold">?</span>
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white dark:bg-[#1E1F22] shadow-2xl border border-gray-100 dark:border-gray-700/50 p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setHelpOpen(false)}
          className="absolute top-5 right-5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          aria-label="닫기"
        >
          <X size={20} />
        </button>
        <div className="flex items-center gap-2 mb-5">
          <Keyboard size={20} className="text-blue-500" />
          <h3 className="text-lg font-black text-gray-900 dark:text-gray-100">키보드 단축키</h3>
        </div>
        <div className="space-y-1.5">
          {SHORTCUTS.map((sc, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 px-1">
              <span className="text-sm text-gray-700 dark:text-gray-300">{sc.label}</span>
              <span className="flex items-center gap-1">
                {sc.keys.map((k, j) => (
                  <kbd
                    key={j}
                    className="px-2 py-1 text-[11px] font-bold rounded-md bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-white/10 shadow-sm min-w-[24px] text-center"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[11px] text-gray-400 text-center">
          {MOD} + / 로 이 창을 다시 열 수 있습니다
        </p>
      </div>
    </div>
  );
}
