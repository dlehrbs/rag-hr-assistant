'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, UserPlus, Loader2, Crown, Trash2, ChevronDown } from 'lucide-react';
import { useProjectStore } from '@/store/useProjectStore';

export default function MemberManagerModal({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const { getProject, inviteMember, removeMember, searchUsers } = useProjectStore();
  const project = getProject(projectId);
  const members = project?.members || [];

  const [query, setQuery] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [picked, setPicked] = useState<string | null>(null);   // 자동완성에서 선택한 사번
  const [suggests, setSuggests] = useState<{ username: string; name: string; dept?: string | null }[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) { setQuery(''); setPicked(null); setSuggests([]); setError(null); }
  }, [open]);

  // 자동완성 (디바운스)
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (!query.trim()) { setSuggests([]); return; }
    debRef.current = setTimeout(async () => {
      const r = await searchUsers(query);
      setSuggests(r);
      setShowSug(true);
    }, 250);
  }, [query, searchUsers]);

  const handleInvite = async () => {
    const target = (picked || query).trim();
    if (!target || busy) return;
    setBusy(true); setError(null);
    try {
      await inviteMember(projectId, target, role);
      setQuery(''); setPicked(null); setSuggests([]);
    } catch (e: any) {
      setError(e?.message || '초대에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const roleLabel = (r: string) => r === 'owner' ? '소유자' : r === 'editor' ? '편집자' : '뷰어';

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-[6px]" />
          <motion.div initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 20 }}
            className="relative w-full max-w-lg bg-white dark:bg-[#1a1c1e] rounded-[28px] shadow-2xl border border-gray-200 dark:border-gray-800 p-7">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-xl font-bold dark:text-white flex items-center gap-2"><UserPlus size={20} className="text-blue-500" /> 멤버 관리</h2>
              <button onClick={onClose} className="p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-white/5 text-gray-400"><X size={20} /></button>
            </div>
            <p className="text-[13px] text-gray-400 mb-5">사번이나 이름으로 초대하세요. 초대 즉시 공유되며, 대화는 각자 비공개입니다.</p>

            {/* 초대 입력 */}
            <div className="relative mb-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setPicked(null); }}
                    onFocus={() => suggests.length && setShowSug(true)}
                    onKeyDown={(e) => { if ((e.nativeEvent as any).isComposing || e.keyCode === 229) return; if (e.key === 'Enter') handleInvite(); }}
                    placeholder="사번 또는 이름 (예: 2025088, 홍길동)"
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-gray-700 focus:border-blue-500 rounded-xl text-sm outline-none dark:text-white placeholder-gray-400"
                  />
                  {showSug && suggests.length > 0 && (
                    <div className="absolute z-10 top-12 left-0 right-0 bg-white dark:bg-[#202124] border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl py-1.5 max-h-52 overflow-y-auto">
                      {suggests.map((u) => (
                        <button key={u.username}
                          onClick={() => { setPicked(u.username); setQuery(`${u.name} (${u.username})`); setShowSug(false); }}
                          className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700/50 flex items-center justify-between">
                          <span className="dark:text-gray-200">{u.name} <span className="text-gray-400">({u.username})</span></span>
                          {u.dept && <span className="text-[11px] text-gray-400">{u.dept}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative">
                  <select value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
                    className="appearance-none h-full pl-3 pr-8 bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-gray-700 rounded-xl text-sm dark:text-white outline-none cursor-pointer">
                    <option value="editor">편집자</option>
                    <option value="viewer">뷰어</option>
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
                <button onClick={handleInvite} disabled={busy || !query.trim()}
                  className="px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl font-semibold text-sm transition-all active:scale-95 flex items-center gap-1.5">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} 초대
                </button>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mb-1">편집자: 파일 추가·삭제 가능 / 뷰어: 문서로 질문만 가능</p>
            {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

            {/* 멤버 목록 */}
            <div className="mt-4 space-y-1.5 max-h-64 overflow-y-auto">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1">멤버 ({members.length})</p>
              {members.map((m) => (
                <div key={m.username} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-100 dark:border-gray-800">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {(m.name || m.username)[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium dark:text-gray-100 truncate">{m.name} <span className="text-gray-400 font-normal">({m.username})</span></p>
                    {m.dept && <p className="text-[11px] text-gray-400 truncate">{m.dept}</p>}
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${m.role === 'owner' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600' : m.role === 'editor' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                    {m.role === 'owner' && <Crown size={11} />} {roleLabel(m.role)}
                  </span>
                  {m.role !== 'owner' && (
                    <button onClick={() => removeMember(projectId, m.username)} className="p-1 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
