'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderOpen, Plus, Search, ChevronDown, Loader2, MoreVertical, Star, StarOff, Pencil, Archive, Trash2, X, ArchiveRestore, Users } from 'lucide-react';
import { useProjectStore } from '@/store/useProjectStore';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

function formatUpdated(raw?: string): string {
  if (!raw) return '';
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일 업데이트됨`;
}

type ModalState =
  | { mode: 'create' }
  | { mode: 'edit'; id: string; name: string; description: string }
  | null;

export default function ProjectsLandingPage() {
  const router = useRouter();
  const { projects, isLoaded, loadProjects, createProject, updateProject, deleteProject } = useProjectStore();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'mine' | 'archived'>('mine');
  const [sortOpen, setSortOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'name'>('updated');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [pendingDeleteProject, setPendingDeleteProject] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => { if (!isLoaded) loadProjects(); }, [isLoaded, loadProjects]);

  const sortLabel = { updated: '마지막 업데이트', created: '생성일', name: '이름' }[sortBy];

  const visible = useMemo(() => {
    let list = projects
      .filter((p) => (tab === 'archived' ? p.archived : !p.archived))
      .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    list = [...list].sort((a, b) => {
      if (a.is_starred && !b.is_starred) return -1;
      if (!a.is_starred && b.is_starred) return 1;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      const ka = new Date((sortBy === 'created' ? a.created_at : a.updated_at)?.replace(' ', 'T') || 0).getTime();
      const kb = new Date((sortBy === 'created' ? b.created_at : b.updated_at)?.replace(' ', 'T') || 0).getTime();
      return kb - ka;
    });
    return list;
  }, [projects, search, sortBy, tab]);

  const openCreate = () => { setForm({ name: '', description: '' }); setModal({ mode: 'create' }); };

  const submitModal = async () => {
    if (busy || !form.name.trim()) return;   // 이중 제출 방지
    setBusy(true);
    if (modal?.mode === 'create') {
      const id = await createProject(form.name.trim(), form.description.trim());
      setBusy(false); setModal(null);
      router.push(`/projects/${id}`);
    } else if (modal?.mode === 'edit') {
      await updateProject(modal.id, { name: form.name.trim(), description: form.description.trim() });
      setBusy(false); setModal(null);
    }
  };

  return (
    <div className="flex-1 h-screen overflow-y-auto bg-white dark:bg-[#1a1c1e]">
      <div className="max-w-5xl mx-auto px-6 py-10 md:py-14">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-[28px] font-bold dark:text-white">프로젝트</h1>
          <div className="flex items-center gap-3">
            <div className="relative">
              <button onClick={() => setSortOpen((v) => !v)} className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-gray-500 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors">
                정렬 기준 <span className="font-semibold text-gray-700 dark:text-gray-100">{sortLabel}</span>
                <ChevronDown size={15} className={`transition-transform ${sortOpen ? 'rotate-180' : ''}`} />
              </button>
              {sortOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                  <div className="absolute right-0 top-11 w-44 bg-white dark:bg-[#202124] border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl z-20 py-1.5">
                    {([['updated', '마지막 업데이트'], ['created', '생성일'], ['name', '이름']] as const).map(([k, label]) => (
                      <button key={k} onClick={() => { setSortBy(k); setSortOpen(false); }}
                        className={`w-full px-4 py-2.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700/50 ${sortBy === k ? 'font-semibold text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}`}>{label}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button onClick={openCreate}
              className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-[#202124] border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-800 dark:text-gray-100 rounded-xl font-semibold text-sm shadow-sm transition-all active:scale-95">
              <Plus size={16} /> 새 프로젝트
            </button>
          </div>
        </div>

        {/* 검색바 */}
        <div className="relative mb-6">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none"><Search size={16} className="text-gray-400" /></div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="프로젝트 검색"
            className="w-full pl-11 pr-4 py-3.5 bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-gray-800 focus:border-blue-500 rounded-2xl text-sm outline-none transition-all dark:text-gray-100 placeholder-gray-400" />
        </div>

        {/* 탭 */}
        <div className="flex items-center gap-2 mb-6">
          {(['mine', 'archived'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${tab === t ? 'bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}>
              {t === 'mine' ? '내 프로젝트' : '보관됨'}
            </button>
          ))}
        </div>

        {/* 본문 */}
        {!isLoaded ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map((i) => <div key={i} className="h-40 rounded-2xl bg-black/5 dark:bg-white/5 animate-pulse" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-24">
            <FolderOpen size={48} className="mx-auto text-gray-300 dark:text-gray-700 mb-4" />
            <p className="text-gray-400 mb-6">{tab === 'archived' ? '보관된 프로젝트가 없습니다.' : search ? '검색 결과가 없습니다.' : '아직 프로젝트가 없습니다.'}</p>
            {tab === 'mine' && !search && (
              <button onClick={openCreate} className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-semibold transition-all">
                <Plus size={18} /> 첫 프로젝트 만들기
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {visible.map((p) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => router.push(`/projects/${p.id}`)}
                className="relative cursor-pointer text-left h-40 flex flex-col p-6 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-black/20 hover:border-blue-500/40 hover:shadow-lg transition-all group"
              >
                <div className="flex items-start gap-3 mb-2 pr-8">
                  <div className="p-2 bg-white dark:bg-[#202124] rounded-xl border border-gray-100 dark:border-gray-800 group-hover:scale-105 transition-transform flex-shrink-0">
                    <FolderOpen size={18} className="text-blue-500" />
                  </div>
                  <h3 className="font-bold text-base dark:text-white line-clamp-2 pt-1 flex items-center gap-1.5">
                    {p.is_starred && <Star size={14} className="text-amber-400 fill-amber-400 flex-shrink-0" />}
                    {p.name}
                  </h3>
                </div>
                <p className="text-[13px] text-gray-400 dark:text-gray-500 line-clamp-1">
                  {p.description?.trim() || (p.files.length > 0 ? `${p.files.length}개 파일` : '파일을 업로드해 시작하세요')}
                </p>
                <div className="mt-auto flex items-center gap-2 text-[12px] text-gray-400 dark:text-gray-500">
                  {p.shared && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium">
                      <Users size={11} /> {p.my_role === 'owner' ? `공유 ${p.members?.length}명` : '공유받음'}
                    </span>
                  )}
                  <span>{formatUpdated(p.updated_at) || ' '}</span>
                </div>

                {/* ⋮ 메뉴 */}
                <div className="absolute top-4 right-3" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => setMenuId(menuId === p.id ? null : p.id)}
                    className={`p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 transition-opacity ${menuId === p.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <MoreVertical size={16} />
                  </button>
                  <AnimatePresence>
                    {menuId === p.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setMenuId(null)} />
                        <motion.div initial={{ opacity: 0, scale: 0.95, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                          className="absolute right-0 top-9 w-44 bg-white dark:bg-[#202124] border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl z-20 py-1.5">
                          <button onClick={() => { updateProject(p.id, { is_starred: !p.is_starred }); setMenuId(null); }}
                            className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700/50 flex items-center gap-2.5">
                            {p.is_starred ? <StarOff size={14} className="text-gray-400" /> : <Star size={14} className="text-gray-400" />}
                            {p.is_starred ? '별표 제거' : '별표 추가'}
                          </button>
                          <button onClick={() => { setForm({ name: p.name, description: p.description || '' }); setModal({ mode: 'edit', id: p.id, name: p.name, description: p.description || '' }); setMenuId(null); }}
                            className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700/50 flex items-center gap-2.5">
                            <Pencil size={14} className="text-gray-400" /> 세부사항 수정
                          </button>
                          <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />
                          <button onClick={() => { updateProject(p.id, { archived: !p.archived }); setMenuId(null); }}
                            className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700/50 flex items-center gap-2.5">
                            {p.archived ? <ArchiveRestore size={14} className="text-gray-400" /> : <Archive size={14} className="text-gray-400" />}
                            {p.archived ? '보관 해제' : '보관'}
                          </button>
                          <button onClick={() => { setMenuId(null); setPendingDeleteProject({ id: p.id, name: p.name }); }}
                            className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 flex items-center gap-2.5">
                            <Trash2 size={14} /> 삭제
                          </button>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* 생성/수정 모달 */}
      <AnimatePresence>
        {modal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !busy && setModal(null)} className="absolute inset-0 bg-black/60 backdrop-blur-[4px]" />
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 20 }}
              className="relative w-full max-w-lg bg-white dark:bg-[#1f2123] rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-800 p-7">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold dark:text-white">{modal.mode === 'create' ? '프로젝트 생성' : '세부사항 수정'}</h2>
                <button onClick={() => !busy && setModal(null)} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-gray-400"><X size={22} /></button>
              </div>

              <label className="block text-sm font-bold dark:text-gray-200 mb-2">무엇을 작업 중이신가요?</label>
              <input autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => { if ((e.nativeEvent as any).isComposing || e.keyCode === 229) return; if (e.key === 'Enter') submitModal(); }}
                placeholder="프로젝트 이름 지정"
                className="w-full px-4 py-3.5 mb-5 bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-gray-700 focus:border-blue-500 rounded-xl text-[15px] outline-none transition-all dark:text-white placeholder-gray-400" />

              <label className="block text-sm font-bold dark:text-gray-200 mb-2">어떤 목표를 달성하려고 하시나요?</label>
              <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="프로젝트, 목표, 주제 등을 설명해주세요."
                rows={4}
                className="w-full px-4 py-3.5 bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-gray-700 focus:border-blue-500 rounded-xl text-[15px] outline-none transition-all dark:text-white placeholder-gray-400 resize-y" />

              <div className="flex justify-end gap-3 mt-7">
                <button onClick={() => !busy && setModal(null)} className="px-5 py-2.5 rounded-xl font-semibold text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors">취소</button>
                <button onClick={submitModal} disabled={!form.name.trim() || busy}
                  className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-[#2d2f31] border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-900 dark:text-white rounded-xl font-bold transition-all active:scale-95">
                  {busy && <Loader2 size={16} className="animate-spin" />}
                  {modal.mode === 'create' ? '프로젝트 만들기' : '저장'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 프로젝트 삭제 확인 다이얼로그 (테마 적용) */}
      <ConfirmDialog
        open={!!pendingDeleteProject}
        title="프로젝트 삭제"
        message={`'${pendingDeleteProject?.name ?? ''}' 프로젝트와 업로드한 모든 파일·대화가 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.`}
        confirmText="삭제"
        onCancel={() => setPendingDeleteProject(null)}
        onConfirm={async () => { if (pendingDeleteProject) await deleteProject(pendingDeleteProject.id); setPendingDeleteProject(null); }}
      />
    </div>
  );
}
