import { useState, useRef, useEffect } from 'react';
import { APP_NAME } from "@/utils/branding";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { Message, useChatStore } from '@/store/useChatStore';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Copy, ThumbsUp, ThumbsDown, RotateCcw, Pencil, Check,
  Square, Paperclip, FileText, ExternalLink, Search, X,
  Sparkles, ChevronDown, Globe, ArrowUpRight
} from 'lucide-react';
import { API_BASE } from '@/utils/config';
import TableVisualizer from './TableVisualizer';

function replaceBR(node: React.ReactNode): React.ReactNode {
  if (typeof node === 'string') {
    const parts = node.split('XBRX');
    if (parts.length === 1) return node;
    return parts.flatMap((part, i) =>
      i < parts.length - 1 ? [part, <br key={i} />] : [part]
    );
  }
  if (Array.isArray(node)) {
    return node.flatMap((child) => {
      const result = replaceBR(child);
      return Array.isArray(result) ? result : [result];
    });
  }
  return node;
}

const CodeBlock = ({ node, inline, className, children, ...props }: any) => {
  const match = /language-(\w+)/.exec(className || '');
  const [copied, setCopied] = useState(false);
  const codeContent = String(children).replace(/\n$/, '');

  const handleCopy = () => {
    const textToCopy = codeContent;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = textToCopy;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) { }
      document.body.removeChild(textArea);
    }
  };

  if (!inline && match) {
    return (
      <div className="relative group rounded-xl my-4 text-sm bg-gray-900 border border-gray-700 overflow-hidden">
        <div className="absolute right-2 top-2 z-10 hidden group-hover:block pb-1">
          <button
            onClick={handleCopy}
            className="text-xs px-2 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-200 transition"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <SyntaxHighlighter
          style={vscDarkPlus}
          language={match[1]}
          PreTag="div"
          customStyle={{ margin: 0, padding: '24px 16px 16px', background: 'transparent' }}
          {...props}
        >
          {codeContent}
        </SyntaxHighlighter>
      </div>
    );
  }
  return (
    <code className="bg-gray-100 dark:bg-gray-700/50 px-1.5 py-0.5 rounded-md text-[0.9em] text-red-500 dark:text-red-400 font-mono" {...props}>
      {children}
    </code>
  );
};

export default function MessageBubble({ message, onEdit, onRegenerate, isLast, onSelectSuggestion }: { message: Message; onEdit?: (id: string, content: string) => void; onRegenerate?: (id: string) => void; isLast?: boolean; onSelectSuggestion?: (q: string) => void }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [alertModal, setAlertModal] = useState<{ title: string; message: string; type?: 'error' | 'warning' } | null>(null);
  const [isCommentOpen, setIsCommentOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [expanded, setExpanded] = useState(false);
  // 매우 긴 답변은 접어서 표시(스트리밍 끝난 메시지에만 적용)
  const isLong = !message.isStreaming && (message.content?.length || 0) > 1400;
  const fmtTime = (ts?: number) => {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };
  const { activeId, conversations, setFeedback } = useChatStore();
  // 프로젝트 채팅이면 업로드 문서는 PDF로 열 수 없어 발췌 모달, 사내 채팅이면 실제 PDF 페이지를 연다.
  const isProjectChat = !!conversations.find(c => c.id === activeId)?.projectId;

  // [Premium] AI 추론 과정 펼침 상태 및 자동 제어
  const [isExpanded, setIsExpanded] = useState(true);
  
  useEffect(() => {
    if (message.isStreaming) {
      setIsExpanded(true); // 답변 중일 때는 항상 펼침
    } else if (message.thoughtSteps && message.thoughtSteps.length > 0) {
      const timer = setTimeout(() => setIsExpanded(false), 2000); // 2초 뒤 자동 접기
      return () => clearTimeout(timer);
    }
  }, [message.isStreaming, !!message.thoughtSteps]);

  const handleFeedback = async (score: number, userComment?: string) => {
    if (isUser || !activeId) return;

    const conv = conversations.find(c => c.id === activeId);
    if (!conv) return;
    const idx = conv.messages.findIndex(m => m.id === message.id);
    const question = idx > 0 ? conv.messages[idx - 1].content : "질문 정보를 찾을 수 없음";

    const content = message.content.replace(/\\n/g, '\n');
    const parts = content.split('**[참조된 문서 목록]**');
    const sources = parts.length > 1 ? parts[1].trim() : "";

    try {
      const resp = await fetch(`${API_BASE}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: message.id,
          question,
          answer: parts[0]?.trim() || message.content,
          score,
          sources,
          comment: userComment
        })
      });

      if (resp.ok) {
        setFeedback(activeId, message.id, score);
        setIsCommentOpen(false);
      } else {
        throw new Error('전송 실패');
      }
    } catch (err) {
      console.error(err);
      setAlertModal({ title: '오류', message: '피드백 전송에 실패했습니다.', type: 'error' });
    }
  };

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      return new Promise<void>((resolve, reject) => {
        try {
          document.execCommand('copy');
          resolve();
        } catch (err) {
          reject(err);
        }
        document.body.removeChild(textArea);
      });
    }
  };

  const handleCopyMsg = () => {
    copyToClipboard(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error('복사패치 실패:', err);
    });
  };

  const handleSaveEdit = () => {
    if (editValue.trim() && editValue !== message.content) {
      onEdit?.(message.id, editValue);
    }
    setIsEditing(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} group mb-8 message-bubble`}
    >
      <div className={`flex items-end space-x-2 ${isUser ? 'flex-row-reverse space-x-reverse' : 'flex-row'}`}>

        <div className={`max-w-[720px] rounded-[1.5rem] px-6 py-4 shadow-sm transition-all ${isUser
            ? isEditing ? 'w-[720px] bg-white dark:bg-[#2B2D31] shadow-xl ring-2 ring-blue-500/50' : 'bg-[#F0F4F9] dark:bg-[#1E1F22] text-gray-900 dark:text-gray-100 ml-auto border border-transparent dark:border-gray-700'
            : 'bg-transparent text-gray-800 dark:text-gray-200'
          }`}>
          {!isUser && (
            <div className="flex items-center space-x-2 font-bold mb-3 text-lg bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              <Sparkles size={16} className="text-blue-400 flex-shrink-0" /> <span>{APP_NAME}</span>
            </div>
          )}

          {/* [Premium] AI 추론 과정 (제미나이 스타일 접이식 UI) */}
          {!isUser && message.thoughtSteps && message.thoughtSteps.length > 0 && (
            <motion.div 
              layout
              className="mb-6 rounded-2xl bg-gray-50/50 dark:bg-white/5 border border-gray-100 dark:border-white/5 overflow-hidden shadow-sm"
            >
              <button 
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between p-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors group text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Sparkles size={16} className="text-blue-500 animate-pulse" />
                    <div className="absolute inset-0 bg-blue-400 blur-md opacity-20 animate-pulse" />
                  </div>
                  <span className="text-xs font-bold text-gray-500 dark:text-gray-400 tracking-tight">
                    {message.isStreaming ? "AI 추론 과정 분석 중..." : "AI 추론 과정 요약 확인"}
                  </span>
                </div>
                <motion.div
                  animate={{ rotate: isExpanded ? 0 : 180 }}
                  className="text-gray-400"
                >
                  <ChevronDown size={16} />
                </motion.div>
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-t border-gray-100 dark:border-white/5 bg-gray-50/30 dark:bg-white/[0.02]"
                  >
                    <div className="p-4 space-y-2.5">
                      {message.thoughtSteps.map((step, idx) => (
                        <motion.div 
                          key={idx}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="flex items-start gap-4"
                        >
                          <div className="relative mt-1.5 flex flex-col items-center">
                            <div className={`w-2 h-2 rounded-full ${idx === message.thoughtSteps!.length - 1 && message.isStreaming ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)] animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}`} />
                            {idx < message.thoughtSteps!.length - 1 && (
                              <div className="w-[1px] h-4 bg-gray-200 dark:bg-gray-700/50 my-1" />
                            )}
                          </div>
                          <span className={`${idx === message.thoughtSteps!.length - 1 && message.isStreaming ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-gray-500 dark:text-gray-400'} text-[12.5px] leading-relaxed`}>
                            {step}
                          </span>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {isUser && message.files && message.files.length > 0 && !isEditing && (
            <div className="flex flex-wrap gap-2 mb-3">
              {message.files.map((fileName, idx) => (
                <div key={idx} className="flex items-center bg-white/50 dark:bg-white/10 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300 shadow-sm">
                  <Paperclip size={12} className="mr-1.5 text-blue-500" />
                  <span className="truncate max-w-[120px]">{fileName}</span>
                </div>
              ))}
            </div>
          )}

          {!isUser && message.isStreaming && message.content.length === 0 ? (
            <div className="flex space-x-1.5 h-6 items-center flex-row">
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
            </div>
          ) : (
            <div className={`prose dark:prose-invert max-w-none text-[15px] leading-relaxed relative ${isUser ? '' : 'prose-headings:text-gray-900 dark:prose-headings:text-gray-100'}`}>
              {isUser && isEditing ? (
                <div className="flex flex-col space-y-4 py-2">
                  <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="w-full bg-transparent border-none focus:ring-0 text-[15px] text-gray-900 dark:text-gray-100 min-h-[100px] resize-none outline-none"
                    autoFocus
                  />
                  <div className="flex justify-end space-x-2">
                    <button
                      onClick={() => { setIsEditing(false); setEditValue(message.content); }}
                      className="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      className="px-4 py-2 text-sm font-bold bg-blue-500 hover:bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-500/25 transition"
                    >
                      저장 및 다시 전송
                    </button>
                  </div>
                </div>
              ) : (
                <div className={!expanded && isLong ? 'relative max-h-[480px] overflow-hidden' : ''}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code: CodeBlock,
                    table: ({ children }) => <TableVisualizer>{children}</TableVisualizer>,
                    td: ({ children }) => <td>{replaceBR(children as React.ReactNode)}</td>,
                    th: ({ children }) => <th>{replaceBR(children as React.ReactNode)}</th>,
                    p: ({ children }) => {
                      if (typeof children === 'string') {
                        const parts = children.split(/(\[참조 \d+\])/g);
                        return (
                          <p className="mb-4 last:mb-0 inline">
                            {parts.map((part, i) => {
                              const match = part.match(/\[참조 (\d+)\]/);
                              if (match) {
                                const num = match[1];
                                const handleBadgeClick = (e: React.MouseEvent) => {
                                  e.stopPropagation();
                                  const content = message.content.replace(/\\n/g, '\n');
                                  const footerSplit = content.split('**[참조된 문서 목록]**');
                                  if (footerSplit.length < 2) return;
                                  const footerLines = footerSplit[1].trim().split('\n');
                                  const dbSourceLines = footerLines.filter(l => l.match(/^\d+\. 📄/));
                                  const idx = parseInt(num) - 1;
                                  if (dbSourceLines[idx]) {
                                    const targetLine = dbSourceLines[idx];
                                    const nameMatch = targetLine.match(/📄 (.+?)(?: \(p\.(\d+)\))?(?: ⟪(.+?)⟫)?$/);
                                    if (nameMatch) {
                                      const fileName = nameMatch[1].trim();
                                      const page = nameMatch[2] || '1';
                                      const snippet = nameMatch[3] || '';
                                      if (snippet && isProjectChat) {
                                        // 프로젝트 업로드 문서: PDF로 못 여니 근거 발췌문을 모달로 표시
                                        setAlertModal({ title: `📄 ${fileName.replace(/\.pdf$/i, '')}${page ? ` · p.${page}` : ''}`, message: `"${snippet}"`, type: 'warning' });
                                      } else if (fileName.includes("(단독 분석)")) {
                                        setAlertModal({ title: '로컬 파일 안내', message: '이 문서는 대화 중에 수동으로 업로드된 파일입니다.', type: 'warning' });
                                      } else {
                                        window.open(`${API_BASE}/api/docs/${encodeURIComponent(fileName)}#page=${page}`, '_blank');
                                      }
                                    }
                                  }
                                };
                                return (
                                  <span key={i} onClick={handleBadgeClick} className="inline-flex items-center px-2 py-0.5 mx-0.5 my-0.5 rounded-full text-[11px] font-bold bg-white dark:bg-white/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 cursor-pointer hover:bg-blue-600 hover:text-white transition-all shadow-sm active:scale-90 select-none no-prose align-top">
                                    출처 {num}
                                  </span>
                                );
                              }
                              return part;
                            })}
                          </p>
                        );
                      }
                      return <p className="mb-4 last:mb-0 inline">{children}</p>;
                    }
                  }}
                >
                  {(() => {
                    const content = message.content.replace(/\\n/g, '\n').replace(/<br\s*\/?>/gi, 'XBRX');
                    const withoutDocs = content.split('**[참조된 문서 목록]**')[0];
                    const withoutWeb = withoutDocs.split('**[참조된 웹 페이지]**')[0];
                    return withoutWeb.trim();
                  })()}
                </ReactMarkdown>
                  {!expanded && isLong && (
                    <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white dark:from-[#1a1c1e] to-transparent pointer-events-none" />
                  )}
                </div>
              )}
              {isLong && !isEditing && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1 text-[12px] font-bold text-blue-500 hover:text-blue-600 transition-colors"
                >
                  {expanded ? '접기 ▲' : '더 보기 ▼'}
                </button>
              )}

              {!isUser && message.isStreaming && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 1, 0] }}
                  transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                  className="inline-block w-[2px] h-[15px] ml-1 bg-blue-500 align-middle shadow-[0_0_8px_rgba(59,130,246,0.5)]"
                />
              )}

              {!isUser && !message.isStreaming && message.content.includes('**[참조된 문서 목록]**') && (() => {
                const content = message.content.replace(/\\n/g, '\n');
                const footerSplit = content.split('**[참조된 문서 목록]**');
                if (footerSplit.length < 2) return null;
                const footerLines = footerSplit[1].trim().split('\n');
                const dbSourceLines = footerLines.filter(l => l.match(/^\d+\. 📄/));
                // 각 출처 라인 파싱: 파일명 / 페이지 / 발췌문(⟪⟫, 프로젝트 업로드 문서에만 존재)
                const parsed = dbSourceLines.map(line => {
                  const m = line.match(/📄 (.+?)(?: \(p\.(\d+)\))?(?: ⟪(.+?)⟫)?$/);
                  return m ? { fileName: m[1].trim(), page: m[2] || '1', snippet: m[3] || '' } : null;
                }).filter((x): x is { fileName: string; page: string; snippet: string } => !!x);
                if (parsed.length === 0) return null;
                const hasSnippet = parsed.some(p => p.snippet);

                // [출처 강화] 프로젝트 업로드 문서: 근거 발췌문을 팝업에 미리보기 + 클릭 시 전문 모달
                if (hasSnippet) {
                  return (
                    <div className="mt-3 flex items-center gap-1.5">
                      <div className="relative group/doc">
                        <button className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-[11px] text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors">
                          <FileText size={11} />
                          <span>출처 {parsed.length}건</span>
                        </button>
                        <div className="absolute bottom-full left-0 mb-2 hidden group-hover/doc:block z-50 w-80">
                          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-2 flex flex-col gap-1 max-h-80 overflow-y-auto">
                            {parsed.map((s, idx) => (
                              <button key={idx} onClick={() => {
                                if (isProjectChat) {
                                  // 프로젝트 업로드 문서: 발췌 전문 모달
                                  setAlertModal({ title: `📄 ${s.fileName.replace(/\.pdf$/i, '')}${s.page ? ` · p.${s.page}` : ''}`, message: `"${s.snippet || '발췌 내용이 없습니다.'}"`, type: 'warning' });
                                } else if (s.fileName.includes("(단독 분석)")) {
                                  setAlertModal({ title: '로컬 파일 안내', message: '이 문서는 대화 중에 수동으로 업로드된 파일입니다.', type: 'warning' });
                                } else {
                                  // 사내 문서: 실제 PDF를 해당 페이지로 열기 (기존 동작 유지)
                                  window.open(`${API_BASE}/api/docs/${encodeURIComponent(s.fileName)}#page=${s.page || '1'}`, '_blank');
                                }
                              }}
                                className="px-2.5 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left w-full">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <FileText size={10} className="text-blue-500 flex-shrink-0" />
                                  <span className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">{s.fileName.replace(/\.pdf$/i, '')}{s.page && ` (p.${s.page})`}</span>
                                  {!isProjectChat && <span className="text-[8px] text-blue-400 flex-shrink-0">PDF 열기 ↗</span>}
                                </div>
                                <p className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-2 leading-snug pl-4">{s.snippet}</p>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                // 사내 문서(발췌 없음): 기존 동작 유지 — 파일명 dedup + 클릭 시 PDF 열기
                const sourceMap = new Map<string, { pages: Set<string>, isIsolated: boolean }>();
                parsed.forEach(({ fileName, page }) => {
                  const isIsolated = fileName.includes("(단독 분석)");
                  if (!sourceMap.has(fileName)) sourceMap.set(fileName, { pages: new Set([page]), isIsolated });
                  else sourceMap.get(fileName)?.pages.add(page);
                });
                const sources = Array.from(sourceMap.entries());
                if (sources.length === 0) return null;
                return (
                  <div className="mt-3 flex items-center gap-1.5">
                    <div className="relative group/doc">
                      <button className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-[11px] text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors">
                        <FileText size={11} />
                        <span>문서 {sources.length}건</span>
                      </button>
                      <div className="absolute bottom-full left-0 mb-2 hidden group-hover/doc:block z-50 w-72">
                        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-2 flex flex-col gap-1">
                          {sources.map(([fileName, data], idx) => {
                            const sortedPages = Array.from(data.pages).sort((a, b) => parseInt(a) - parseInt(b));
                            const firstPage = sortedPages[0] || '1';
                            const displayName = fileName.replace(/\.pdf$/i, '');
                            return (
                              <button key={idx} onClick={() => {
                                if (data.isIsolated) setAlertModal({ title: '로컬 파일 안내', message: '이 문서는 대화 중에 수동으로 업로드된 파일입니다.', type: 'warning' });
                                else window.open(`${API_BASE}/api/docs/${encodeURIComponent(fileName)}#page=${firstPage}`, '_blank');
                              }} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left w-full">
                                <FileText size={10} className="text-blue-500 flex-shrink-0" />
                                <span className="text-[11px] text-gray-700 dark:text-gray-300 truncate">{displayName}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 웹 페이지 출처 */}
              {!isUser && !message.isStreaming && message.content.includes('**[참조된 웹 페이지]**') && (() => {
                const raw = message.content.replace(/\\n/g, '\n');
                const webPart = raw.split('**[참조된 웹 페이지]**')[1] || '';
                const lines = webPart.trim().split('\n').filter(l => l.match(/^\d+\. 🌐/));
                const webLinks = lines.map(line => {
                  const m = line.match(/\[(.+?)\]\((.+?)\)/);
                  return { title: m ? m[1] : line.replace(/^\d+\. 🌐\s*/, ''), url: m ? m[2] : '#' };
                });
                if (webLinks.length === 0) return null;
                return (
                  <div className="mt-3 flex items-center gap-1.5">
                    <div className="relative group/web">
                      <button className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors">
                        <Globe size={11} />
                        <span>웹 {webLinks.length}건</span>
                      </button>
                      <div className="absolute bottom-full left-0 mb-2 hidden group-hover/web:block z-50 w-72">
                        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-2 flex flex-col gap-1">
                          {webLinks.map((link, idx) => (
                            <a key={idx} href={link.url} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-[11px] text-gray-700 dark:text-gray-300 truncate">
                              <Globe size={10} className="text-emerald-500 flex-shrink-0" />
                              <span className="truncate">{link.title}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* [출처 등급 배지] "규정이 아닐 때 = 조심"의 경고 신호로만 사용 → 웹·일반에만 표시.
              규정 근거(기본·신뢰)는 배지 없음(노이즈 제거). 배지가 뜨면 "공식 규정 아님"을 뜻함. */}
          {!isUser && (message.sourceTier === 'web' || message.sourceTier === 'general') && !message.isStreaming && !message.isAborted && (() => {
            const badge = {
              web:        { label: '웹 참고',   icon: '🌐', cls: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800', tip: '사내 문서에 없어 외부 웹에서 찾은 정보입니다. 공식 규정이 아니니 참고만 하세요.' },
              general:    { label: '일반 답변', icon: '💬', cls: 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800', tip: 'AI의 일반 지식으로 답한 것입니다. 사내 규정과 무관하며 검증되지 않았습니다.' },
            }[message.sourceTier]!;
            return (
              <div className="mt-2.5">
                <span title={badge.tip} className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border ${badge.cls}`}>
                  <span>{badge.icon}</span> {badge.label}
                </span>
              </div>
            );
          })()}

          {!isUser && message.content.length > 0 && !message.isStreaming && !message.isAborted && (
            <div className="flex items-center space-x-3 mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => handleFeedback(1)} className={`p-1 transition ${message.feedback === 1 ? 'text-blue-500 scale-110' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'}`} title="좋아요"><ThumbsUp size={16} strokeWidth={message.feedback === 1 ? 2.5 : 1.5} /></button>
              <button onClick={() => { if (message.feedback === -1) return; setIsCommentOpen(!isCommentOpen); }} className={`p-1 transition ${message.feedback === -1 ? 'text-red-500 scale-110' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'}`} title="싫어요"><ThumbsDown size={16} strokeWidth={message.feedback === -1 ? 2.5 : 1.5} /></button>
              <button onClick={() => onRegenerate?.(message.id)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition" title="재생성"><RotateCcw size={16} strokeWidth={1.5} /></button>
              <button onClick={handleCopyMsg} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition relative" title="복사">{copied ? <Check size={16} strokeWidth={1.5} className="text-green-500" /> : <Copy size={16} strokeWidth={1.5} />}</button>
            </div>
          )}

          {/* [후속 질문 추천] 마지막 AI 답변에만, 게이트 통과한 질문이 있을 때만 노출 */}
          {!isUser && isLast && !message.isStreaming && !message.isAborted && (message.suggestions?.length ?? 0) > 0 && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2 flex items-center gap-1.5"><Sparkles size={12} /> 이어서 물어보기</p>
              <div className="flex flex-col gap-2">
                {message.suggestions!.map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => onSelectSuggestion?.(s)}
                    className="group/sg flex items-center justify-between gap-2 text-left px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1e1f22] hover:bg-gray-50 dark:hover:bg-[#2a2b2e] hover:border-gray-300 dark:hover:border-gray-600 transition-all active:scale-[0.99] text-[13.5px] text-gray-700 dark:text-gray-200"
                  >
                    <span>{s}</span>
                    <ArrowUpRight size={15} className="text-gray-300 dark:text-gray-500 group-hover/sg:text-gray-500 dark:group-hover/sg:text-gray-300 flex-shrink-0 transition-colors" />
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          <AnimatePresence>
            {isCommentOpen && !message.feedback && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-4 overflow-hidden">
                <div className="bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 shadow-inner">
                  <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5 uppercase tracking-wider"><Search size={10} /> 왜 별로인가요? (정확도, 말투 등)</p>
                  <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="부족한 점을 상세히 적어주시면 AI 품질 개선에 큰 도움이 됩니다." className="w-full bg-white dark:bg-black/30 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-xs text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-red-500/30 outline-none min-h-[80px] transition-all" />
                  <div className="flex justify-end gap-2 mt-3">
                    <button onClick={() => setIsCommentOpen(false)} className="px-3 py-1.5 text-[11px] font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition">취소</button>
                    <button onClick={() => handleFeedback(-1, comment)} disabled={!comment.trim()} className="px-4 py-1.5 text-[11px] font-bold bg-red-500 hover:bg-red-600 text-white rounded-lg transition-all shadow-lg shadow-red-500/20 disabled:opacity-50">피드백 제출하기</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {!isUser && message.isAborted && (
            <div className="flex items-center space-x-2 mt-4 pt-3 border-t border-gray-200 dark:border-gray-700/50">
              <Square size={13} className="text-gray-400 flex-shrink-0" fill="currentColor" strokeWidth={0} />
              <div><p className="text-[12px] font-semibold text-gray-500 dark:text-gray-400">{APP_NAME}의 응답</p><p className="text-[12px] text-gray-400 dark:text-gray-500">대답이 중지되었습니다.</p></div>
            </div>
          )}

          {!message.isStreaming && !!message.timestamp && (
            <div className={`text-[10px] text-gray-400 dark:text-gray-500 mt-2 select-none ${isUser ? 'text-right' : ''}`}>
              {fmtTime(message.timestamp)}
            </div>
          )}
        </div>

        {isUser && !isEditing && (
          <div className="flex flex-col items-center space-y-1 mb-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
              title="수정"
              onClick={() => setIsEditing(true)}
            >
              <Pencil size={15} strokeWidth={1.5} />
            </button>
            <button
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition"
              title="복사"
              onClick={handleCopyMsg}
            >
              {copied ? <Check size={15} strokeWidth={1.5} className="text-green-500" /> : <Copy size={15} strokeWidth={1.5} />}
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {alertModal && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAlertModal(null)} className="absolute inset-0 bg-black/50 backdrop-blur-[6px]" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 30 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 30 }} className="relative w-full max-w-sm bg-white dark:bg-[#1a1c1e] rounded-[32px] shadow-2xl p-8 border border-gray-200 dark:border-gray-800 text-center">
              <div className={`mx-auto w-16 h-16 rounded-[24px] flex items-center justify-center mb-6 ${alertModal.type === 'warning' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30' : 'bg-red-100 text-red-600 dark:bg-red-950/30'}`}><Search size={32} /></div>
              <h3 className="text-2xl font-bold dark:text-white mb-3 tracking-tight">{alertModal.title}</h3>
              <p className="text-[15px] text-gray-500 dark:text-gray-400 mb-8 leading-relaxed px-2">{alertModal.message}</p>
              <button onClick={() => setAlertModal(null)} className="w-full py-4 bg-blue-600 dark:bg-[#A8C7FA] dark:text-[#062E6F] text-white rounded-[20px] font-bold text-lg transition-all shadow-xl shadow-blue-500/20 active:scale-95">닫기</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

