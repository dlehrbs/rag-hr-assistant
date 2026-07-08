'use client';

import React, { useState } from 'react';
import { Download, FileText, Share2, Printer, ChevronDown } from 'lucide-react';
import { exportToMarkdown, exportToPDF } from '@/utils/exportUtils';
import { useChatStore } from '@/store/useChatStore';
import { motion, AnimatePresence } from 'framer-motion';

export default function ExportActions() {
  const [isOpen, setIsOpen] = useState(false);
  const { activeId, conversations } = useChatStore();

  const currentConv = conversations.find(c => c.id === activeId);
  const title = currentConv?.title || '채팅 내역';
  const messages = currentConv?.messages || [];

  const handleExportMD = () => {
    exportToMarkdown(title, messages);
    setIsOpen(false);
  };

  const handleExportPDF = async () => {
    // page.tsx에서 지정한 채팅 컨테이너 ID 사용
    await exportToPDF(title, 'chat-scroll-container');
    setIsOpen(false);
  };

  if (!activeId || messages.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/10 transition-all text-xs font-bold text-gray-600 dark:text-gray-300 shadow-sm active:scale-95"
      >
        <Download size={14} className="text-blue-500" />
        <span>내보내기</span>
        <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setIsOpen(false)} 
            />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute right-0 mt-2 w-48 bg-white dark:bg-[#1e1f22] border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl z-50 overflow-hidden"
            >
              <div className="p-2 space-y-1">
                <button
                  onClick={handleExportMD}
                  className="w-full flex items-center space-x-3 p-2.5 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-700 dark:text-gray-200 transition-colors text-left group"
                >
                  <div className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/50 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    <FileText size={16} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[13px] font-bold">Markdown</span>
                    <span className="text-[10px] text-gray-400">텍스트 문서로 저장</span>
                  </div>
                </button>

                <button
                  onClick={handleExportPDF}
                  className="w-full flex items-center space-x-3 p-2.5 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/30 text-gray-700 dark:text-gray-200 transition-colors text-left group"
                >
                  <div className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 group-hover:bg-purple-100 dark:group-hover:bg-purple-900/50 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                    <Printer size={16} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[13px] font-bold">PDF</span>
                    <span className="text-[10px] text-gray-400">화면 그대로 캡처 저장</span>
                  </div>
                </button>

                <button
                  disabled
                  className="w-full flex items-center space-x-3 p-2.5 rounded-xl opacity-50 cursor-not-allowed text-gray-400 text-left"
                >
                  <div className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-800">
                    <Share2 size={16} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[13px] font-bold">공유하기</span>
                    <span className="text-[10px]">준비 중...</span>
                  </div>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
