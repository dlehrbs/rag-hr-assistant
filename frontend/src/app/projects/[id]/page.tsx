'use client';

import { useEffect, useRef, useState, use as usePromise } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, MoreVertical, Edit2, Trash2, Send, MessageSquare, Star, Pin, FolderInput, FolderMinus, ChevronRight, Home, Users } from 'lucide-react';
import { useChatStore } from '@/store/useChatStore';
import { useProjectStore } from '@/store/useProjectStore';
import ProjectFilePanel from '@/components/projects/ProjectFilePanel';
import MemberManagerModal from '@/components/projects/MemberManagerModal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export default function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = usePromise(params);
  const router = useRouter();
  const { conversations, isConvsLoaded, loadConversations, createNewChat, addMessage, saveUserMessage, userProfile,
    togglePin, updateTitle, deleteChat, moveConversation } = useChatStore();
  const { projects, isLoaded, loadProjects, getProject, renameProject, deleteProject } = useProjectStore();
  const project = getProject(projectId);

  const [input, setInput] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState('');
  // 대화 행 메뉴
  const [convMenuId, setConvMenuId] = useState<string | null>(null);
  const [moveSubId, setMoveSubId] = useState<string | null>(null);
  const [convRenameId, setConvRenameId] = useState<string | null>(null);
  const [convRenameVal, setConvRenameVal] = useState('');
  // 삭제 확인 다이얼로그 (프로젝트 삭제 / 대화 삭제)
  const [confirmState, setConfirmState] = useState<{ kind: 'project' } | { kind: 'conv'; id: string; title: string } | null>(null);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const isOwner = (project?.my_role ?? 'owner') === 'owner';

  useEffect(() => { if (!isLoaded) loadProjects(); }, [isLoaded, loadProjects]);
  useEffect(() => { if (!isConvsLoaded) loadConversations(); }, [isConvsLoaded, loadConversations]);

  const projectConvs = conversations
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const startingRef = useRef(false);
  const handleStart = () => {
    const text = input.trim();
    if (!text || startingRef.current) return;   // 중복 실행 방지(IME 이중 Enter·더블클릭)
    startingRef.current = true;
    setInput('');
    // 대화만 생성하고 첫 메시지는 채팅 페이지가 로드 완료 후 전송한다
    // (개요에서 fire-and-forget 스트리밍 시 loadConversations 레이스로 응답 유실/중복 발생)
    const cid = createNewChat(projectId);
    try { sessionStorage.setItem(`proj_pending_${cid}`, text); } catch { /* ignore */ }
    router.push(`/projects/${projectId}/${cid}`);
  };

  return (
    <div className="flex-1 h-screen flex bg-white dark:bg-[#1a1c1e] overflow-hidden">
      {/* 본문 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="max-w-3xl w-full mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => router.push('/')} className="flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 px-3 py-1.5 rounded-lg transition-colors">
              <Home size={15} /> 일반 채팅
            </button>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <button onClick={() => router.push('/projects')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors">
              <ArrowLeft size={15} /> 모든 프로젝트
            </button>
          </div>

          {/* 제목 + 메뉴 */}
          <div className="flex items-start justify-between mb-8 gap-3">
            {renaming ? (
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={() => { if (nameInput.trim()) renameProject(projectId, nameInput.trim()); setRenaming(false); }}
                onKeyDown={(e) => {
                  if ((e.nativeEvent as any).isComposing || e.keyCode === 229) return;
                  if (e.key === 'Enter') { if (nameInput.trim()) renameProject(projectId, nameInput.trim()); setRenaming(false); }
                  if (e.key === 'Escape') setRenaming(false);
                }}
                className="flex-1 min-w-0 bg-gray-50 dark:bg-black/30 border border-blue-500 rounded-xl px-3 py-2 text-2xl font-bold dark:text-white outline-none"
              />
            ) : (
              <h1 className="text-[30px] leading-tight font-bold dark:text-white flex-1 break-words">{project?.name || '프로젝트'}</h1>
            )}
            <div className="flex items-center gap-2 flex-shrink-0 pt-2">
              {/* 공유 버튼 — 소유자만 멤버 관리, 멤버는 공유 인원수만 표시 */}
              {isOwner ? (
                <button onClick={() => setMemberModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors">
                  <Users size={15} /> 공유{project?.shared ? ` · ${project.members?.length}명` : ''}
                </button>
              ) : (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-400">
                  <Users size={15} /> 공유받음 ({project?.my_role === 'editor' ? '편집자' : '뷰어'})
                </span>
              )}
              {isOwner && (
              <div className="relative">
                <button onClick={() => setMenuOpen((v) => !v)} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-gray-400">
                  <MoreVertical size={18} />
                </button>
                <AnimatePresence>
                  {menuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                        className="absolute right-0 top-9 w-40 bg-white dark:bg-[#202124] border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl z-20 py-1.5"
                      >
                        <button
                          onClick={() => { setNameInput(project?.name || ''); setRenaming(true); setMenuOpen(false); }}
                          className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700/50 flex items-center gap-2.5"
                        ><Edit2 size={14} className="text-gray-400" /> 이름 변경</button>
                        <button
                          onClick={() => { setMenuOpen(false); setConfirmState({ kind: 'project' }); }}
                          className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 flex items-center gap-2.5"
                        ><Trash2 size={14} /> 프로젝트 삭제</button>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
              )}
            </div>
          </div>

          {/* 입력박스 */}
          <div className="bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-gray-700 rounded-3xl px-5 py-4 mb-8 focus-within:border-blue-500 transition-colors">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if ((e.nativeEvent as any).isComposing || e.keyCode === 229) return; if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleStart(); } }}
              placeholder="오늘 어떤 도움을 드릴까요?"
              rows={2}
              className="w-full bg-transparent border-none outline-none resize-none text-[15px] dark:text-white placeholder-gray-400 leading-relaxed"
            />
            <div className="flex justify-end mt-2">
              <button onClick={handleStart} disabled={!input.trim()}
                className="p-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-full transition-all active:scale-95">
                <Send size={18} />
              </button>
            </div>
          </div>

          {/* 대화 목록 */}
          <div className="space-y-1">
            {projectConvs.length === 0 ? (
              <p className="text-sm text-gray-400 italic text-center py-8">이 프로젝트에서 나눈 대화가 여기에 쌓입니다.</p>
            ) : projectConvs.map((c) => (
              <div
                key={c.id}
                onClick={() => convRenameId !== c.id && router.push(`/projects/${projectId}/${c.id}`)}
                className="group relative w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left border-b border-gray-50 dark:border-gray-800/50 last:border-0 cursor-pointer"
              >
                {c.isPinned ? <Pin size={15} className="text-blue-400 flex-shrink-0" /> : <MessageSquare size={16} className="text-gray-400 flex-shrink-0" />}
                {convRenameId === c.id ? (
                  <input
                    autoFocus
                    value={convRenameVal}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setConvRenameVal(e.target.value)}
                    onBlur={() => { if (convRenameVal.trim()) updateTitle(c.id, convRenameVal.trim()); setConvRenameId(null); }}
                    onKeyDown={(e) => {
                      if ((e.nativeEvent as any).isComposing || e.keyCode === 229) return;
                      if (e.key === 'Enter') { if (convRenameVal.trim()) updateTitle(c.id, convRenameVal.trim()); setConvRenameId(null); }
                      if (e.key === 'Escape') setConvRenameId(null);
                    }}
                    className="flex-1 bg-white dark:bg-black/40 border border-blue-500 rounded-lg px-2 py-1 text-[15px] dark:text-white outline-none"
                  />
                ) : (
                  <span className="flex-1 truncate text-[15px] dark:text-gray-100">{c.title}</span>
                )}
                <span className="text-[12px] text-gray-400 flex-shrink-0 group-hover:opacity-0 transition-opacity">마지막 메시지 {relTime(c.updatedAt)}</span>

                {/* ⋮ 메뉴 */}
                <div className="absolute right-2" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => { setConvMenuId(convMenuId === c.id ? null : c.id); setMoveSubId(null); }}
                    className={`p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 transition-opacity ${convMenuId === c.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <MoreVertical size={16} />
                  </button>
                  <AnimatePresence>
                    {convMenuId === c.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => { setConvMenuId(null); setMoveSubId(null); }} />
                        <motion.div initial={{ opacity: 0, scale: 0.95, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                          className="absolute right-0 top-9 w-48 bg-white dark:bg-[#202124] border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl z-20 py-1.5">
                          <button onClick={() => { togglePin(c.id); setConvMenuId(null); }}
                            className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700/50 flex items-center gap-2.5">
                            <Star size={14} className="text-gray-400" /> {c.isPinned ? '즐겨찾기 해제' : '즐겨찾기'}
                          </button>
                          <button onClick={() => { setConvRenameVal(c.title); setConvRenameId(c.id); setConvMenuId(null); }}
                            className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700/50 flex items-center gap-2.5">
                            <Edit2 size={14} className="text-gray-400" /> 이름 변경
                          </button>

                          {/* 프로젝트 변경 (서브메뉴) */}
                          <div className="relative">
                            <button onClick={() => setMoveSubId(moveSubId === c.id ? null : c.id)}
                              className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700/50 flex items-center gap-2.5">
                              <FolderInput size={14} className="text-gray-400" /> 프로젝트 변경
                              <ChevronRight size={13} className="ml-auto text-gray-400" />
                            </button>
                            {moveSubId === c.id && (
                              <div className="mx-2 mb-1 max-h-44 overflow-y-auto rounded-lg bg-gray-50 dark:bg-black/30 border border-gray-100 dark:border-gray-800">
                                {projects.filter((pp) => !pp.archived && pp.id !== projectId).length === 0 ? (
                                  <p className="px-3 py-2 text-[12px] text-gray-400 italic">이동할 다른 프로젝트 없음</p>
                                ) : projects.filter((pp) => !pp.archived && pp.id !== projectId).map((pp) => (
                                  <button key={pp.id}
                                    onClick={() => { moveConversation(c.id, pp.id); setConvMenuId(null); setMoveSubId(null); }}
                                    className="w-full px-3 py-2 text-left text-[13px] hover:bg-gray-100 dark:hover:bg-gray-700/50 truncate dark:text-gray-200">
                                    {pp.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          <button onClick={() => { moveConversation(c.id, null); setConvMenuId(null); }}
                            className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700/50 flex items-center gap-2.5">
                            <FolderMinus size={14} className="text-gray-400" /> 프로젝트에서 제거
                          </button>
                          <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />
                          <button onClick={() => { setConfirmState({ kind: 'conv', id: c.id, title: c.title }); setConvMenuId(null); }}
                            className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 flex items-center gap-2.5">
                            <Trash2 size={14} /> 삭제
                          </button>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 우측 패널 (뷰어는 파일 추가·삭제 불가) */}
      <ProjectFilePanel projectId={projectId} canEdit={(project?.my_role ?? 'owner') !== 'viewer'} />

      {/* 멤버 관리 모달 */}
      <MemberManagerModal projectId={projectId} open={memberModalOpen} onClose={() => setMemberModalOpen(false)} />

      {/* 삭제 확인 다이얼로그 (테마 적용) */}
      <ConfirmDialog
        open={!!confirmState}
        title={confirmState?.kind === 'project' ? '프로젝트 삭제' : '대화 삭제'}
        message={
          confirmState?.kind === 'project'
            ? `'${project?.name ?? ''}' 프로젝트와 업로드한 모든 파일·대화가 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.`
            : `'${confirmState?.kind === 'conv' ? confirmState.title : ''}' 대화를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`
        }
        confirmText="삭제"
        onCancel={() => setConfirmState(null)}
        onConfirm={async () => {
          if (confirmState?.kind === 'project') {
            await deleteProject(projectId);
            setConfirmState(null);
            router.push('/projects');
          } else if (confirmState?.kind === 'conv') {
            deleteChat(confirmState.id);
            setConfirmState(null);
          }
        }}
      />
    </div>
  );
}
