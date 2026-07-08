import { useState, useRef, useEffect } from 'react';
import { APP_NAME } from "@/utils/branding";
import { Paperclip, Mic, Send, Square, Loader2, X, AlertTriangle, AlertCircle, Zap, Sparkles, BookOpen, MessageCircle, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '@/store/useChatStore';
import { API_BASE } from '@/utils/config';  // [W-04] URL 상수화

interface ChatInputProps {
  onSend: (message: string, fileId?: string, filenames?: string[]) => void;
  onStop?: () => void;
  disabled: boolean;
}

// 질문 길이 한도 — 백엔드(분기 C 입력 예산: 질문 8000자 캡)와 동기화.
// AI가 한 번에 처리할 수 있는 토큰(16384) 한계 때문. 초과 시 전송 차단 + 안내.
const MAX_QUERY_CHARS = 8000;
const WARN_QUERY_CHARS = 6000;  // 이 길이부터 카운터 경고 표시

export default function ChatInput({ onSend, onStop, disabled }: ChatInputProps) {
  const { activeId, activeFileId, attachedFiles, setFileToChat, answerMode, setAnswerMode } = useChatStore();
  const [input, setInput] = useState('');
  const [lastSent, setLastSent] = useState('');
  const [parsingMode, setParsingMode] = useState<'fast' | 'quality'>('fast');
  const [parsePopup, setParsePopup] = useState(false);   // 첨부 클릭 시 분석 방식 선택 팝업
  // 첨부 버튼 → 분석 방식 팝업 → 선택 시 해당 모드로 파일 선택창 열기
  const pickAndUpload = (mode: 'fast' | 'quality') => {
    setParsingMode(mode);
    setParsePopup(false);
    setTimeout(() => fileInputRef.current?.click(), 0);   // 모드 상태 반영 후 파일창
  };
  const [modeOnboard, setModeOnboard] = useState(false);   // 첫 사용자 안내 팝업
  const [modeTip, setModeTip] = useState(false);           // ⓘ 툴팁
  useEffect(() => {
    try { if (!localStorage.getItem('dy_mode_onboarded')) setModeOnboard(true); } catch {}
  }, []);
  const dismissOnboard = () => { setModeOnboard(false); try { localStorage.setItem('dy_mode_onboarded', '1'); } catch {} };
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [alertModal, setAlertModal] = useState<{ title: string; message: string; type?: 'error' | 'warning' } | null>(null);
  const wasStoppedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      textarea.style.height = 'auto';
      const currentScrollHeight = textarea.scrollHeight;
      textarea.style.height = `${Math.min(currentScrollHeight, 200)}px`;
      textarea.style.overflowY = currentScrollHeight > 200 ? 'auto' : 'hidden';
    }
  }, [input]);

  // 중지 후 복원 로직
  useEffect(() => {
    if (!disabled && wasStoppedRef.current) {
      wasStoppedRef.current = false;
      setInput(lastSent);
    }
  }, [disabled, lastSent]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || disabled || isUploading) return;

    // [길이 한도] AI 입력 토큰 한계로 너무 긴 질문은 차단 + 이유·대안 안내
    if (input.trim().length > MAX_QUERY_CHARS) {
      setAlertModal({
        title: '질문이 너무 깁니다',
        message:
          `질문이 ${input.trim().length.toLocaleString()}자입니다. ` +
          `AI가 한 번에 읽을 수 있는 양에 한계가 있어, ${MAX_QUERY_CHARS.toLocaleString()}자 이내로 줄여주세요.\n\n` +
          `긴 문서를 분석하려면 질문칸에 붙여넣지 말고, 아래 📎 파일 첨부 기능으로 업로드해주세요.`,
        type: 'warning',
      });
      return;
    }
    setLastSent(input);

    const filenames = attachedFiles.length > 0
      ? attachedFiles.map(f => f.name)
      : undefined;

    onSend(input, activeFileId || undefined, filenames);

    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 한글 IME 조합 중 Enter는 무시 (조합확정 Enter가 중복 발생해 중복 전송되는 문제 방지)
    if ((e.nativeEvent as any).isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }
    // [단축키] 빈 입력창에서 ↑ → 마지막으로 보낸 내 질문을 불러와 수정
    if (e.key === 'ArrowUp' && !input.trim()) {
      const { activeId, conversations } = useChatStore.getState();
      const conv = conversations.find((c) => c.id === activeId);
      const lastUser = conv?.messages.filter((m) => m.role === 'user').slice(-1)[0];
      if (lastUser?.content) {
        e.preventDefault();
        setInput(lastUser.content);
      }
    }
  };

  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;

    setIsUploading(true);
    setFileToChat(null, []);

    for (const file of files) {
      if (!/\.(pdf|txt|md|html?|docx|xlsx?|pptx)$/i.test(file.name)) {
        setAlertModal({
          title: '파일 형식 오류',
          message: `'${file.name}'은(는) 지원하지 않는 형식입니다.\nPDF·txt·md·HTML·Word·Excel·PPT 파일을 지원합니다.`,
          type: 'warning'
        });
        continue;
      }

      setUploadStatus(`${file.name} 서버로 전송 중...`);
      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch(`${API_BASE}/api/upload_temp?mode=${parsingMode}`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        const data = await res.json();

        if (data.error) {
          setAlertModal({
            title: '업로드 오류',
            message: data.error,
            type: 'error'
          });
          continue;
        }

        if (data.status === "task_started") {
          const taskId = data.task_id;
          let isDone = false;
          let pollCount = 0;
          const MAX_POLL_ATTEMPTS = 90; // 최대 3분 (90 * 2초)

          while (!isDone) {
            if (pollCount >= MAX_POLL_ATTEMPTS) {
              setAlertModal({
                title: '⏱️ 인덱싱 시간 초과',
                message: `'${file.name}' 분석이 ${MAX_POLL_ATTEMPTS * 2}초 이내에 완료되지 않았습니다. 더 작은 파일로 시도하거나 서버 상태를 확인해주세요.`,
                type: 'error'
              });
              isDone = true;
              break;
            }
            pollCount++;
            setUploadStatus(`${file.name} 인덱싱 및 벡터화 진행 중... (${pollCount * 2}초)`);
            await new Promise(r => setTimeout(r, 2000));

            try {
              const statusRes = await fetch(`${API_BASE}/api/upload/status/${taskId}`);
              const statusData = await statusRes.json();

              if (statusData.status === "ready") {
                setFileToChat(taskId, [{ id: taskId, name: file.name }]);
                isDone = true;
              } else if (statusData.status === "error") {
                if (statusData.error === "텍스트 추출 불가") {
                  setAlertModal({
                    title: '⚠️ 문서 분석 실패',
                    message: `'${file.name}' 파일에서 글자를 읽을 수 없습니다. (이미지 위주 문서일 가능성 높음)\n\n📎 첨부 버튼을 다시 눌러 '💎 정밀 분석'을 선택해 업로드해 보세요!`,
                    type: 'error'
                  });
                } else {
                  setAlertModal({
                    title: '분석 오류',
                    message: `'${file.name}' 분석 중 오류가 발생했습니다: ${statusData.error}`,
                    type: 'error'
                  });
                }
                isDone = true;
              }
            } catch (pollErr) {
              // 폴링 중 개별 네트워크 오류는 재시도 (while 루프는 계속됨)
              console.warn('폴링 데이터 획득 실패, 재시도:', pollErr);
            }
          }
        }
      } catch (err) {
        setAlertModal({
          title: '네트워크 상태 확인',
          message: '서버와 연결할 수 없습니다. 백엔드 서비스(run.sh)가 정상 작동 중인지 확인해 주세요.',
          type: 'error'
        });
      }
    }

    setIsUploading(false);
    setUploadStatus(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(Array.from(e.target.files || []));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // [드래그앤드롭 / 붙여넣기] 파일을 채팅창에 끌어 놓거나 Ctrl+V(⌘V)로 붙여넣어 업로드
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled || isUploading) return;
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) processFiles(files);
  };
  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) { e.preventDefault(); processFiles(files); }
  };

  /** [Vanish UI] 세션 남은 시간 계산 (1시간 기준) */
  const [sessionTimeLeft, setSessionTimeLeft] = useState<Record<string, number>>({});

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const newTimes: Record<string, number> = {};
      attachedFiles.forEach(f => {
        if (f.uploadedAt) {
          const diff = 3600 - Math.floor((now - f.uploadedAt) / 1000);
          newTimes[f.id] = Math.max(0, diff);
        }
      });
      setSessionTimeLeft(newTimes);
    }, 1000);
    return () => clearInterval(timer);
  }, [attachedFiles]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className="w-full max-w-[850px] mx-auto px-4 md:px-0 mb-6 relative z-20"
      onDragOver={(e) => { e.preventDefault(); if (!isDragging) setIsDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); if (e.currentTarget === e.target) setIsDragging(false); }}
      onDrop={handleDrop}
    >
      {/* 드래그 오버레이 */}
      {isDragging && (
        <div className="absolute inset-0 z-30 flex items-center justify-center rounded-[32px] border-2 border-dashed border-blue-400 bg-blue-50/90 dark:bg-blue-900/40 backdrop-blur-sm pointer-events-none">
          <span className="text-sm font-bold text-blue-600 dark:text-blue-300">📎 여기에 파일을 놓으면 업로드됩니다</span>
        </div>
      )}

      <div className="mx-3 mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* [답변 모드] 사내규정(기본) ↔ 일반대화 — 파일 파싱 토글과 별개 */}
          <div className="relative flex items-center gap-1">
            <div className="flex bg-[#F0F4F9] dark:bg-[#1E1F22] p-1 rounded-full border border-gray-200 dark:border-gray-700 shadow-sm">
              <button
                onClick={() => setAnswerMode('regulation')}
                title="회사 규정 문서를 근거로 답변 (출처 표시)"
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all ${answerMode === 'regulation' ? 'bg-blue-500 text-white shadow-md' : 'text-gray-500 hover:text-blue-400'}`}
              >
                <BookOpen size={11} /> 사내규정
              </button>
              <button
                onClick={() => setAnswerMode('general')}
                title="회사 문서와 무관하게 무엇이든 자유롭게 답변"
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all ${answerMode === 'general' ? 'bg-emerald-500 text-white shadow-md' : 'text-gray-500 hover:text-emerald-400'}`}
              >
                <MessageCircle size={11} /> 일반대화
              </button>
            </div>
            <button onMouseEnter={() => setModeTip(true)} onMouseLeave={() => setModeTip(false)} onClick={() => setModeTip(v => !v)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-0.5" aria-label="답변 모드 설명">
              <Info size={13} />
            </button>

            {/* ⓘ 툴팁 */}
            <AnimatePresence>
              {modeTip && !modeOnboard && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                  className="absolute bottom-full left-0 mb-2 z-40 w-64 bg-white dark:bg-[#2A2B2E] border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-300">
                  <p className="mb-1"><b className="text-blue-500">📘 사내규정</b> — 회사 규정 문서 근거로 답하고 출처를 보여줍니다.</p>
                  <p><b className="text-emerald-500">💬 일반대화</b> — 회사 문서와 무관하게 상식·번역·작문·코딩 등 무엇이든 자유롭게 답합니다.</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 첫 사용자 온보딩 코치마크 */}
            <AnimatePresence>
              {modeOnboard && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                  className="absolute bottom-full left-0 mb-2 z-50 w-72 bg-white dark:bg-[#2A2B2E] border border-blue-200 dark:border-blue-800 rounded-2xl shadow-2xl p-4">
                  <p className="text-[13px] font-bold text-gray-800 dark:text-gray-100 mb-1.5 flex items-center gap-1.5"><Sparkles size={13} className="text-blue-500" /> 답변 모드를 골라보세요</p>
                  <p className="text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-300 mb-1"><b className="text-blue-500">📘 사내규정</b>: 회사 규정 문서 근거 + 출처(기본).</p>
                  <p className="text-[11.5px] leading-relaxed text-gray-600 dark:text-gray-300 mb-3"><b className="text-emerald-500">💬 일반대화</b>: 상식·번역·작문·코딩 등 무엇이든 자유롭게.</p>
                  <button onClick={dismissOnboard} className="w-full py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-[12px] font-bold rounded-lg transition">알겠어요</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </div>
        {uploadStatus && (
          <div className="text-xs text-blue-500 font-bold bg-blue-50 dark:bg-blue-900/20 px-3 py-1 rounded-full animate-pulse flex items-center border border-blue-100 dark:border-blue-800">
            <div className="mr-2 w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
            {uploadStatus}
          </div>
        )}
        {/* [길이 경고] 질문이 길어지면 글자수 카운터 + 안내 (한도 초과 시 빨강) */}
        {input.trim().length > WARN_QUERY_CHARS && (
          <div className={`text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5 border ${
            input.trim().length > MAX_QUERY_CHARS
              ? 'text-red-600 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
              : 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
          }`}>
            <AlertTriangle size={12} className="shrink-0" />
            {input.trim().length > MAX_QUERY_CHARS
              ? `질문이 너무 깁니다 (${input.trim().length.toLocaleString()}/${MAX_QUERY_CHARS.toLocaleString()}자) — 긴 문서는 📎 파일 업로드를 이용하세요`
              : `질문이 깁니다 (${input.trim().length.toLocaleString()}/${MAX_QUERY_CHARS.toLocaleString()}자)`}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="relative flex items-end bg-[#F0F4F9] dark:bg-[#1E1F22] rounded-[32px] px-3 py-3 border border-transparent dark:border-gray-700/50 focus-within:border-blue-400 dark:focus-within:border-blue-800 transition-all shadow-sm">

        <input
          type="file"
          multiple
          ref={fileInputRef}
          onChange={handleFileUpload}
          accept=".pdf,.txt,.md,.html,.htm,.docx,.xlsx,.xls,.pptx"
          className="hidden"
        />

        <div className="relative">
          <button
            type="button"
            className={`p-3 mb-1 transition-colors rounded-full hover:bg-black/5 dark:hover:bg-white/5 ${isUploading ? 'text-blue-500 animate-pulse' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
            title="문서 첨부 (PDF·txt·md·HTML·Word·Excel·PPT)"
            onClick={() => setParsePopup(v => !v)}
            disabled={isUploading}
          >
            <Paperclip size={22} strokeWidth={2.5} />
          </button>

          {/* 분석 방식 선택 팝업 (첨부 클릭 시) */}
          <AnimatePresence>
            {parsePopup && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setParsePopup(false)} />
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97 }}
                  className="absolute bottom-full left-0 mb-3 z-50 w-[300px] bg-white dark:bg-[#2A2B2E] border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl p-3"
                >
                  <p className="text-[12px] font-bold text-gray-800 dark:text-gray-100 px-1 mb-2 flex items-center gap-1.5"><Paperclip size={12} /> 어떻게 분석할까요?</p>
                  <button onClick={() => pickAndUpload('fast')}
                    className="w-full text-left p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition border border-transparent hover:border-gray-200 dark:hover:border-gray-700 mb-1.5">
                    <div className="flex items-center gap-1.5 text-[13px] font-bold text-blue-600 dark:text-blue-400"><Zap size={13} /> 빠른 분석 <span className="text-[10px] font-medium text-gray-400 ml-auto">기본 · 추천</span></div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">일반 문서(글자가 살아있는 PDF·Word·Excel 등)에 적합. 빠르고 무료.</p>
                  </button>
                  <button onClick={() => pickAndUpload('quality')}
                    className="w-full text-left p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition border border-transparent hover:border-gray-200 dark:hover:border-gray-700">
                    <div className="flex items-center gap-1.5 text-[13px] font-bold text-violet-600 dark:text-violet-400"><Sparkles size={13} /> 정밀 분석</div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">스캔본·표가 많은 복잡한 문서에 적합. 표·구조·이미지 속 글자(OCR)까지 읽음. 조금 느림.</p>
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        <textarea
          ref={textareaRef}
          id="chat-input"
          className={`flex-1 bg-transparent border-none outline-none resize-none px-3 py-3 mb-1 placeholder-gray-500 dark:placeholder-[#8E918F] max-h-[200px] overflow-hidden leading-relaxed text-[16px] font-medium ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
          rows={1}
          placeholder={isUploading ? "문서 구조 분석 및 인덱싱 중..." : `${APP_NAME}에게 질문하기`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled || isUploading}
        />

        <div className="flex items-center mb-1 space-x-1">
          {isUploading && (
            <div className="flex items-center px-4 py-2 mr-2 bg-blue-600 text-white rounded-full animate-pulse text-xs font-black shadow-lg">
              <Loader2 size={16} className="mr-2 animate-spin shrink-0" />
              <span className="truncate max-w-[120px]">분석 진행 중</span>
            </div>
          )}



          {disabled ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                wasStoppedRef.current = true;
                if (onStop) onStop();
              }}
              className="p-3 rounded-full bg-gray-900 dark:bg-red-500 text-white shadow-xl transition-all flex items-center justify-center transform active:scale-95"
            >
              <Square size={20} fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className={`p-3 rounded-full transition-all flex items-center justify-center ${input.trim()
                ? 'bg-[#1a73e8] dark:bg-[#A8C7FA] text-white dark:text-[#062E6F] shadow-lg transform active:scale-95'
                : 'text-gray-400 bg-transparent opacity-40'
                }`}
            >
              <Send size={20} strokeWidth={2.5} className={`${input.trim() ? 'translate-x-[2px]' : ''}`} />
            </button>
          )}
        </div>
      </form>

      {/* [프리미엄 리뉴얼] 사진 속 ⚠️ 경고 테마를 반영한 알림 모달 (AlertModal v3) */}
      <AnimatePresence>
        {alertModal && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 text-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAlertModal(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-[10px]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.85, y: 50 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 150 }}
              exit={{ opacity: 0, scale: 0.8, y: 40 }}
              className="relative w-full max-w-sm bg-white dark:bg-[#1a1c1e] rounded-[40px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] p-10 border border-gray-200/50 dark:border-gray-800/50 flex flex-col items-center"
            >
              <div className={`w-20 h-20 rounded-[30px] flex items-center justify-center mb-8 shadow-inner ${alertModal.type === 'warning'
                  ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
                  : 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400'
                }`}>
                {alertModal.type === 'warning' ? <AlertTriangle size={40} strokeWidth={2.5} /> : <AlertCircle size={40} strokeWidth={2.5} />}
              </div>

              <h3 className="text-2xl font-black dark:text-white mb-3 tracking-tighter leading-tight">
                {alertModal.title}
              </h3>
              <p className="text-[16px] font-medium text-gray-500 dark:text-gray-400 mb-10 whitespace-pre-wrap leading-relaxed px-1">
                {alertModal.message}
              </p>

              <button
                onClick={() => setAlertModal(null)}
                className={`w-full py-4.5 rounded-[24px] font-black text-xl transition-all shadow-2xl active:scale-95 ${alertModal.type === 'warning'
                    ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/30'
                    : 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/30'
                  }`}
              >
                확인
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {attachedFiles.length > 0 && (
        <div className="mx-3 mt-3 flex flex-wrap gap-2">
          {attachedFiles.map(file => {
            const timeLeft = sessionTimeLeft[file.id] ?? 3600;
            const isExpired = timeLeft <= 0;
            const isWarning = timeLeft > 0 && timeLeft <= 600; // 10분 이내

            return (
              <motion.div 
                key={file.id} 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex items-center px-4 py-2 rounded-2xl border shadow-sm transition-all group ${
                  isExpired 
                    ? 'bg-gray-100 dark:bg-gray-800/50 text-gray-400 border-gray-200 dark:border-gray-700 opacity-80' 
                    : isWarning
                      ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                      : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-900/50'
                }`}
              >
                <div className="relative mr-2">
                  <Paperclip size={14} className={isExpired ? 'opacity-30' : ''} />
                  {!isExpired && (
                    <motion.div 
                      className={`absolute -top-1 -right-1 w-2 h-2 rounded-full ${isWarning ? 'bg-amber-500' : 'bg-blue-500'}`}
                      animate={{ opacity: isWarning ? [1, 0.4, 1] : 1 }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}
                </div>
                
                <div className="flex flex-col">
                  <span className={`text-sm font-bold truncate max-w-[180px] ${isExpired ? 'line-through decoration-1' : ''}`}>
                    {file.name}
                  </span>
                  <span className="text-[10px] font-medium opacity-70">
                    {isExpired ? '파일 분석 세션이 만료되었습니다' : isWarning ? `곧 만료 (${formatTime(timeLeft)})` : `남은 시간: ${formatTime(timeLeft)}`}
                  </span>
                </div>

                <div className="flex items-center ml-3 space-x-1">
                  {isExpired ? (
                    <button
                      onClick={() => setParsePopup(true)}
                      className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-gray-500 transition-colors"
                      title="다시 업로드하여 분석 시작"
                    >
                      <Loader2 size={13} strokeWidth={3} />
                    </button>
                  ) : (
                    <button onClick={() => setFileToChat(null, [])} className="p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded-full transition-colors">
                      <X size={13} strokeWidth={3} />
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
