'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open, title, message,
  confirmText = '삭제', cancelText = '취소',
  danger = true, onConfirm, onCancel,
}: ConfirmDialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onCancel}
            className="absolute inset-0 bg-black/60 backdrop-blur-[6px]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 24 }}
            className="relative w-full max-w-md bg-white dark:bg-[#1a1c1e] rounded-[28px] shadow-2xl border border-gray-200 dark:border-gray-800 p-8"
          >
            <button onClick={onCancel} className="absolute top-5 right-5 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-white/5 text-gray-400 transition-colors">
              <X size={20} />
            </button>

            <div className="text-center space-y-5">
              <div className={`mx-auto w-16 h-16 rounded-[24px] flex items-center justify-center shadow-inner ${danger ? 'bg-red-100 dark:bg-red-900/20 text-red-600' : 'bg-blue-100 dark:bg-blue-900/20 text-blue-600'}`}>
                {danger ? <Trash2 size={30} /> : <AlertTriangle size={30} />}
              </div>
              <div>
                <h3 className="text-xl font-bold dark:text-white mb-2 tracking-tight">{title}</h3>
                <p className="text-[14px] text-gray-500 dark:text-gray-400 leading-relaxed whitespace-pre-line">{message}</p>
              </div>
              <div className="flex gap-3 justify-center pt-1">
                <button
                  onClick={onCancel}
                  className="flex-1 py-3.5 font-bold text-gray-500 border border-gray-200 dark:border-gray-700 rounded-2xl hover:bg-gray-50 dark:hover:bg-white/5 transition-all"
                >
                  {cancelText}
                </button>
                <button
                  onClick={onConfirm}
                  className={`flex-1 py-3.5 text-white font-bold rounded-2xl shadow-xl transition-all active:scale-95 ${danger ? 'bg-red-500 hover:bg-red-600 shadow-red-500/30' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/30'}`}
                >
                  {confirmText}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
