'use client';

import { create } from 'zustand';
import { AppError, classifyError } from '@/utils/errorMessage';

interface ErrorState {
  current: AppError | null;
  /** 분류된 AppError를 직접 표시 */
  show: (e: AppError) => void;
  /** 원시 에러/예외를 분류해 표시 (aborted면 무시) */
  report: (err: any) => void;
  clear: () => void;
}

export const useErrorStore = create<ErrorState>((set) => ({
  current: null,
  show: (e) => {
    if (e.kind === 'aborted') return;
    set({ current: e });
  },
  report: (err) => {
    const e = classifyError(err);
    if (e.kind === 'aborted') return;
    set({ current: e });
  },
  clear: () => set({ current: null }),
}));
