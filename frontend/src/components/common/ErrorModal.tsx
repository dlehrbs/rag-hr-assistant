'use client';

import type { ReactNode } from 'react';
import { useErrorStore } from '@/store/useErrorStore';
import { AlertTriangle, WifiOff, Lock, Clock, ServerCrash, X } from 'lucide-react';

// 전역 에러 팝업 — 루트 레이아웃에 마운트. 어디서든 useErrorStore.report(err) 호출 시 표시됨.
export default function ErrorModal() {
  const { current, clear } = useErrorStore();
  if (!current) return null;

  const iconFor: Record<string, ReactNode> = {
    auth: <Lock size={36} strokeWidth={2.5} />,
    forbidden: <Lock size={36} strokeWidth={2.5} />,
    rate: <Clock size={36} strokeWidth={2.5} />,
    server: <ServerCrash size={36} strokeWidth={2.5} />,
    network: <WifiOff size={36} strokeWidth={2.5} />,
    timeout: <Clock size={36} strokeWidth={2.5} />,
  };
  const icon = iconFor[current.kind] ?? <AlertTriangle size={36} strokeWidth={2.5} />;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={clear}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#1E1F22] shadow-2xl border border-gray-100 dark:border-gray-700/50 p-7 text-center relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={clear}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          aria-label="닫기"
        >
          <X size={20} />
        </button>

        <div className="w-16 h-16 mx-auto rounded-3xl flex items-center justify-center mb-5 bg-amber-50 dark:bg-amber-900/30 text-amber-500 shadow-inner">
          {icon}
        </div>

        <h3 className="text-lg font-black text-gray-900 dark:text-gray-100 mb-2">{current.title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line mb-6">
          {current.message}
        </p>

        <div className="flex gap-2">
          {current.kind === 'auth' ? (
            <>
              <button
                onClick={clear}
                className="flex-1 py-3 rounded-2xl font-bold text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 transition-all"
              >
                닫기
              </button>
              <button
                onClick={() => { clear(); window.location.href = '/login'; }}
                className="flex-1 py-3 rounded-2xl font-black text-sm text-white bg-blue-600 hover:bg-blue-700 transition-all shadow-lg active:scale-95"
              >
                로그인하기
              </button>
            </>
          ) : ['network', 'server', 'timeout', 'rate', 'unknown'].includes(current.kind) ? (
            <>
              <button
                onClick={clear}
                className="flex-1 py-3 rounded-2xl font-bold text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 transition-all"
              >
                닫기
              </button>
              <button
                onClick={() => { clear(); window.dispatchEvent(new CustomEvent('dy:retry')); }}
                className="flex-1 py-3 rounded-2xl font-black text-sm text-white bg-gray-900 dark:bg-blue-600 hover:opacity-90 transition-all shadow-lg active:scale-95"
              >
                다시 시도
              </button>
            </>
          ) : (
            <button
              onClick={clear}
              className="flex-1 py-3 rounded-2xl font-black text-sm text-white bg-gray-900 dark:bg-blue-600 hover:opacity-90 transition-all shadow-lg active:scale-95"
            >
              확인
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
