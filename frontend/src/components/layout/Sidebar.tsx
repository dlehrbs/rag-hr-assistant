'use client';

import { useState, useEffect, useRef, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '@/store/useChatStore';
import { Settings, Activity, Sparkles, Sun, Moon, Trash2, Search, X, Check, Edit2, LogOut, Database, Bot, KeyRound, Pin, MessageSquare, FileText, CheckCircle2, Loader2, FolderOpen, Bell } from 'lucide-react';
import { useTheme } from 'next-themes';
import { API_BASE } from '@/utils/config';  // [W-04] URL 상수화
import { useNotificationStore } from '@/store/useNotificationStore';
import { MOD_KEY } from '@/utils/platform';

import { usePathname, useRouter } from 'next/navigation';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    conversations,
    activeId,
    createNewChat,
    startNewChat,
    setActiveChat,
    deleteChat,
    togglePin,
    updateTitle,
    isSidebarOpen,
    toggleSidebar,
    clearAll,
    userProfile,
    setUserProfile,
    isConvsLoaded,
    loadConversations,
  } = useChatStore();

  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<'profile' | 'activity' | 'password' | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ 
    type: 'rename' | 'delete' | 'clear_all'; 
    id?: string; 
    title?: string;
    inputValue?: string;
  } | null>(null);
  
  const { theme, setTheme } = useTheme();
  const menuRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [role, setRole] = useState<string | null>(null);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [loggedUsername, setLoggedUsername] = useState<string | null>(null);
  const [loggedDept, setLoggedDept] = useState<string | null>(null);
  const [isSsoUser, setIsSsoUser] = useState(false); // [SSO] 포털 입장 사용자 — 로그아웃 버튼 숨김
  const [pwForm, setPwForm] = useState({ current: '', new: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const { items: notifItems, unreadCount, load: loadNotifications, markRead, markAllRead } = useNotificationStore();

  // 분석 이력 가져오기
  const fetchTasks = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks`);
      const data = await res.json();
      setTasks(data);
    } catch (e) {
      console.error('Failed to fetch tasks', e);
    }
  };

  const handlePasswordChange = async () => {
    setPwError('');
    if (pwForm.new !== pwForm.confirm) { setPwError('새 비밀번호가 일치하지 않습니다.'); return; }
    if (pwForm.new.length < 4) { setPwError('비밀번호는 최소 4자 이상이어야 합니다.'); return; }
    setPwLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/users/me/password`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: pwForm.current, new_password: pwForm.new }),
      });
      const data = await res.json();
      if (res.ok) {
        setPwSuccess(true);
        setPwForm({ current: '', new: '', confirm: '' });
      } else {
        setPwError(data.detail || '비밀번호 변경 실패');
      }
    } catch { setPwError('서버 오류가 발생했습니다.'); }
    finally { setPwLoading(false); }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.replace('/login');
    } catch (e) {
      console.error('Logout failed', e);
    }
  };

  if (pathname === '/login' || pathname === '/register' || pathname === '/sso' || pathname === '/session-expired') return null;

  useEffect(() => {
    if (activeModal === 'activity') fetchTasks();
  }, [activeModal]);

  useEffect(() => {
    // 대화 목록 서버 로드 — page.tsx가 아닌 다른 경로(/admin 등)에서도 동작하도록
    if (!isConvsLoaded) loadConversations();

    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setIsSettingsOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);

    // 알림: 진입 시 1회 로드 + 60초마다 갱신
    loadNotifications();
    const notifInterval = setInterval(loadNotifications, 60000);

    // 권한 및 사용자명 확인
    const match = document.cookie.match(new RegExp('(^| )rag_role=([^;]+)'));
    if (match) setRole(match[2]);
    const matchUser = document.cookie.match(new RegExp('(^| )rag_username=([^;]+)'));
    if (matchUser) setLoggedUsername(decodeURIComponent(matchUser[2]).trim());
    const matchDept = document.cookie.match(new RegExp('(^| )rag_dept=([^;]+)'));
    if (matchDept) setLoggedDept(decodeURIComponent(matchDept[2]).trim());
    const matchAuth = document.cookie.match(new RegExp('(^| )rag_auth=([^;]+)'));
    if (matchAuth) setIsSsoUser(matchAuth[2] === 'sso');

    // 현재 활성 모델 조회 (10초마다 갱신 — 경량 엔드포인트 사용)
    const fetchModel = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/current-model`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.current_model) setCurrentModel(data.current_model);
      } catch { /* ignore */ }
    };
    fetchModel();
    const modelInterval = setInterval(fetchModel, 60000);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      clearInterval(modelInterval);
      clearInterval(notifInterval);
    };
  }, []);

  const sortedConversations = [...conversations]
    .filter(c => !c.projectId)   // 프로젝트 공간 대화는 '최근 대화'에서 제외 (프로젝트 페이지에서만 노출)
    .sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return b.updatedAt - a.updatedAt;
    });

  const searchLower = searchTerm.toLowerCase();
  const filteredConversations = sortedConversations.filter(conv => {
    if (!searchTerm) return true;
    if (conv.title.toLowerCase().includes(searchLower)) return true;
    return conv.messages.some(m => m.content.toLowerCase().includes(searchLower));
  });

  // 대화 날짜 그룹 라벨 (오늘/어제/지난 7일/지난 30일/YYYY년 M월). 고정 대화는 별도 그룹.
  const bucketOf = (conv: typeof conversations[number]) => {
    if (conv.isPinned) return '📌 고정됨';
    const now = new Date();
    const d = new Date(conv.updatedAt);
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((startToday - startDay) / 86400000);
    if (diff <= 0) return '오늘';
    if (diff === 1) return '어제';
    if (diff <= 7) return '지난 7일';
    if (diff <= 30) return '지난 30일';
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
  };

  // 제목 표시 — 백엔드 자동제목([TITLE])이 없고 내용이 있으면 첫 사용자 메시지로 대체
  const displayTitle = (conv: typeof conversations[number]) => {
    if (conv.title && conv.title !== '새로운 채팅') return conv.title;
    const firstUser = conv.messages.find(m => m.role === 'user');
    if (firstUser?.content) return firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 30);
    return conv.title || '새로운 채팅';
  };

  const handleRename = (id: string, currentTitle: string) => {
    setConfirmAction({ type: 'rename', id, title: currentTitle, inputValue: currentTitle });
    setMenuOpenId(null);
  };

  return (
    <>
      <aside
        className={`${isSidebarOpen ? 'w-[280px] opacity-100' : 'w-0 opacity-0'} 
          h-screen flex-shrink-0 bg-[#F0F4F9] dark:bg-[#1E1F22] overflow-hidden 
          transition-all duration-300 ease-in-out md:relative fixed z-50 flex shadow-xl md:shadow-none`}
      >
        <div className="p-4 pt-16 md:pt-6 w-[280px] h-full flex flex-col relative whitespace-nowrap">

          <button
            onClick={() => {
              startNewChat();   // 빈 새 채팅 있으면 재사용 (중복 탭 방지)
              if (pathname !== '/') router.push('/');   // 일반 채팅 화면으로 이동
            }}
            className="w-full md:w-fit flex items-center justify-start bg-white dark:bg-[#202124] hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors border border-gray-200 dark:border-gray-700 rounded-full px-5 py-3 shadow-sm text-[14px] font-medium text-gray-700 dark:text-gray-300 mb-4"
          >
            <span className="text-xl mr-3">+</span> 새로운 채팅
          </button>

          {/* 프로젝트 내비게이션 (→ 프로젝트 목록 페이지) + 알림 벨 */}
          <div className="flex items-center gap-2 mb-4 relative">
            <button
              onClick={() => router.push('/projects')}
              className={`flex-1 flex items-center px-4 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-200 ${pathname.startsWith('/projects')
                ? 'bg-[#D3E3FD] dark:bg-[#004A77]/40 text-[#041E49] dark:text-[#C2E7FF] font-semibold'
                : 'text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5'}`}
            >
              <FolderOpen size={16} className="mr-3 flex-shrink-0 text-blue-500" /> 프로젝트
            </button>
            <button
              onClick={() => setIsNotifOpen((v) => !v)}
              className="relative flex-shrink-0 p-2.5 rounded-xl text-gray-500 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              title="알림"
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            <AnimatePresence>
              {isNotifOpen && (
                <motion.div
                  ref={notifRef}
                  initial={{ opacity: 0, scale: 0.95, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -10 }}
                  className="absolute left-0 right-0 top-12 bg-white dark:bg-[#202124] border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl z-[100] overflow-hidden"
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                    <span className="text-sm font-bold text-gray-700 dark:text-gray-200">알림</span>
                    {unreadCount > 0 && (
                      <button onClick={() => markAllRead()} className="text-xs text-blue-500 hover:underline">
                        전체 읽음
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto no-scrollbar">
                    {notifItems.length === 0 ? (
                      <p className="px-4 py-8 text-center text-xs text-gray-400 italic">알림이 없습니다.</p>
                    ) : (
                      notifItems.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => {
                            if (!n.read) markRead(n.id);
                            setIsNotifOpen(false);
                            if (n.project_id) router.push(`/projects/${n.project_id}`);
                          }}
                          className={`w-full text-left px-4 py-3 border-b border-gray-50 dark:border-gray-800 last:border-0 transition-colors ${n.read ? 'opacity-60' : 'bg-blue-50/50 dark:bg-blue-900/10'} hover:bg-gray-50 dark:hover:bg-white/5`}
                        >
                          <p className="text-xs text-gray-700 dark:text-gray-200 leading-relaxed whitespace-normal break-words">{n.message}</p>
                          <p className="text-[10px] text-gray-400 mt-1 whitespace-normal">{n.created_at}</p>
                        </button>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 대화 검색 바 */}
          <div className="relative mb-6 group">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <Search size={14} className="text-gray-400 group-focus-within:text-blue-500 transition-colors" />
            </div>
            <input
              id="conv-search"
              type="text"
              placeholder={`대화 내용 검색... (${MOD_KEY}K)`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-8 py-2.5 bg-black/5 dark:bg-white/5 border border-transparent focus:border-blue-500/30 focus:bg-white dark:focus:bg-black/20 rounded-xl text-sm outline-none transition-all dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-2 flex items-center p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar space-y-1 pr-2">
            <p className="text-[11px] font-bold text-gray-400 dark:text-[#8E918F] mb-4 px-3 tracking-widest uppercase">
              {searchTerm ? '검색 결과' : '최근 대화'}
            </p>

            {/* 서버에서 로드 중 */}
            {!isConvsLoaded ? (
              <div className="space-y-2 px-3">
                {[1,2,3].map(i => (
                  <div key={i} className="h-8 rounded-full bg-black/5 dark:bg-white/5 animate-pulse" style={{width: `${70 + i*8}%`}} />
                ))}
              </div>
            ) : filteredConversations.length === 0 ? (
               <div className="px-3 py-10 text-center">
                  <p className="text-xs text-gray-400 italic">
                    {searchTerm ? '검색 결과가 없습니다.' : '대화 기록이 없습니다.'}
                  </p>
               </div>
            ) : filteredConversations.map((conv, i) => {
              const matchedMsg = searchTerm
                ? conv.messages.find(m => m.content.toLowerCase().includes(searchLower))
                : null;
              const isTitleMatch = searchTerm ? conv.title.toLowerCase().includes(searchLower) : false;
              const preview = matchedMsg && !isTitleMatch
                ? (() => {
                    const idx = matchedMsg.content.toLowerCase().indexOf(searchLower);
                    const start = Math.max(0, idx - 15);
                    return (start > 0 ? '...' : '') + matchedMsg.content.slice(start, idx + searchTerm.length + 20) + '...';
                  })()
                : null;
              // 검색 중이 아닐 때만 날짜 그룹 헤더 노출(직전 항목과 그룹이 바뀌면 헤더 삽입)
              const bucket = searchTerm ? null : bucketOf(conv);
              const showHeader = !!bucket && (i === 0 || bucketOf(filteredConversations[i - 1]) !== bucket);
              return (
              <Fragment key={conv.id}>
              {showHeader && (
                <p className="text-[11px] font-bold text-gray-400 dark:text-[#8E918F] mt-3 mb-1.5 px-3 tracking-wide">{bucket}</p>
              )}
              <div
                onClick={() => {
                  setActiveChat(conv.id);
                  if (pathname !== '/') router.push('/');   // 어느 화면(프로젝트 등)에서든 일반 채팅으로 이동
                }}
                onContextMenu={(e) => {
                  // 마우스 우클릭 → 점3개와 동일한 메뉴 열기
                  e.preventDefault();
                  setMenuOpenId(conv.id);
                }}
                className={`group relative flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer text-[14px] transition-all duration-200 ${activeId === conv.id
                    ? 'bg-[#D3E3FD] dark:bg-[#004A77]/40 text-[#041E49] dark:text-[#C2E7FF] font-semibold'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
              >
                <div className="flex items-center truncate max-w-[85%]">
                  <span className="mr-3 flex-shrink-0">
                    {conv.isPinned
                      ? <Pin size={14} className="text-blue-400" />
                      : <MessageSquare size={14} className="text-gray-400" />}
                  </span>
                  <div className="truncate min-w-0">
                    <span className="truncate block">{displayTitle(conv)}</span>
                    {preview && (
                      <span className="block text-[11px] text-gray-400 dark:text-gray-500 truncate font-normal mt-0.5">{preview}</span>
                    )}
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(menuOpenId === conv.id ? null : conv.id);
                  }}
                  className={`p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded-full transition-opacity ${menuOpenId === conv.id || activeId === conv.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                >
                  ⋮
                </button>

                <AnimatePresence>
                  {menuOpenId === conv.id && (
                    <motion.div
                      ref={menuRef}
                      initial={{ opacity: 0, scale: 0.95, y: -10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -10 }}
                      className="absolute right-0 top-12 w-44 bg-white dark:bg-[#202124] border border-gray-200 dark:border-gray-800 rounded-xl shadow-2xl z-[100] py-1.5 overflow-hidden"
                    >
                      <button onClick={() => { togglePin(conv.id); setMenuOpenId(null); }} className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700/50 flex items-center gap-2.5">
                        <Pin size={14} className="flex-shrink-0 text-gray-400" /> {conv.isPinned ? '고정 해제' : '상단 고정'}
                      </button>
                      <button onClick={() => handleRename(conv.id, conv.title)} className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700/50 flex items-center gap-2.5">
                        <Edit2 size={14} className="flex-shrink-0 text-gray-400" /> 이름 변경
                      </button>
                      <button
                        onClick={() => {
                          setConfirmAction({ type: 'delete', id: conv.id, title: conv.title });
                          setMenuOpenId(null);
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 flex items-center gap-2.5"
                      >
                        <Trash2 size={14} className="flex-shrink-0" /> 삭제
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              </Fragment>
            );})}
          </div>

          {/* 현재 활성 모델 배지 */}
          {currentModel && (
            <div className="mx-2 mb-2 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-xl flex items-center gap-2">
              <Bot size={14} className="text-indigo-500 flex-shrink-0" />
              <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium truncate">{currentModel}</span>
            </div>
          )}

          {/* 하단 설정 영역 */}
          <div className="mt-auto pt-4 border-t border-gray-200 dark:border-gray-800 flex-shrink-0 relative">
             <AnimatePresence>
                {isSettingsOpen && (
                   <motion.div
                      ref={settingsRef}
                      initial={{ opacity: 0, scale: 0.95, y: -20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: -10 }}
                      className="absolute bottom-full left-0 mb-4 w-64 bg-white dark:bg-[#202124] border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl z-[110] py-2 overflow-hidden"
                   >
                      <button 
                        onClick={() => { setActiveModal('profile'); setIsSettingsOpen(false); }}
                        className="w-full px-4 py-3 bg-blue-50/50 dark:bg-blue-900/10 hover:bg-blue-100/50 dark:hover:bg-blue-900/20 transition-colors group text-left"
                      >
                         <div className="flex items-center mb-1">
                           <Sparkles size={16} className="mr-3 text-purple-500" />
                           <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-tight">개인별 맞춤 AI 지침</span>
                         </div>
                         <p className="text-xs text-gray-400 truncate opacity-70">
                            {userProfile || '지침을 추가하려면 클릭하세요...'}
                         </p>
                      </button>
                      
                      <button 
                        onClick={() => { setActiveModal('activity'); setIsSettingsOpen(false); }}
                        className="w-full px-4 py-3 text-left text-sm hover:bg-gray-100 dark:hover:bg-white/5 flex items-center transition-colors group border-t border-gray-50 dark:border-gray-800"
                      >
                         <Activity size={18} className="mr-4 text-gray-500 group-hover:text-blue-500 transition-colors" />
                         <span className="font-medium text-gray-700 dark:text-gray-300">활동 및 분석 이력</span>
                      </button>
                      
                      <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />
                      
                      <button 
                        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        className="w-full px-4 py-3 text-left text-sm hover:bg-gray-100 dark:hover:bg-white/5 flex items-center justify-between transition-colors group"
                      >
                         <div className="flex items-center">
                            {theme === 'dark' ? <Moon size={18} className="mr-4 text-blue-400" /> : <Sun size={18} className="mr-4 text-orange-400" />}
                            <span className="font-medium text-gray-700 dark:text-gray-300">다크 모드</span>
                         </div>
                         <span className="text-[10px] px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-500 uppercase font-bold">
                            {theme === 'dark' ? 'ON' : 'OFF'}
                         </span>
                      </button>

                      <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />

                      {/* [SSO] 포털 입장 사용자는 비밀번호 자체가 없음 — 메뉴 숨김 */}
                      {!isSsoUser && (
                      <>
                      <button
                        onClick={() => { setActiveModal('password'); setIsSettingsOpen(false); setPwError(''); setPwSuccess(false); setPwForm({ current: '', new: '', confirm: '' }); }}
                        className="w-full px-4 py-3 text-left text-sm hover:bg-gray-100 dark:hover:bg-white/5 flex items-center transition-colors group"
                      >
                         <KeyRound size={18} className="mr-4 text-gray-500 group-hover:text-amber-500 transition-colors" />
                         <span className="font-medium text-gray-700 dark:text-gray-300">비밀번호 변경</span>
                      </button>

                      <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />
                      </>
                      )}

                      <button
                        onClick={() => {
                           setConfirmAction({ type: 'clear_all' });
                           setIsSettingsOpen(false);
                        }}
                        className="w-full px-4 py-3 text-left text-sm hover:bg-red-50 dark:hover:bg-red-950/20 text-red-500 flex items-center transition-colors group"
                      >
                         <Trash2 size={18} className="mr-4 group-hover:scale-110 transition-transform" />
                         <span className="font-semibold text-red-600">모든 대화 삭제</span>
                      </button>

                      <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />
                      
                      {role === 'admin' && (
                        <button 
                          onClick={() => { setIsSettingsOpen(false); window.location.href='/admin'; }}
                          className="w-full px-4 py-3 text-left text-sm hover:bg-gray-100 dark:hover:bg-white/5 flex items-center transition-colors group"
                        >
                           <Database size={18} className="mr-4 text-emerald-500 group-hover:scale-110 transition-transform" />
                           <span className="font-semibold text-emerald-600 dark:text-emerald-500">문서 DB 관리 (Admin)</span>
                        </button>
                      )}

                      {/* [SSO] 포털 입장 사용자는 로그아웃 개념이 없음 — 관리자/일반 로그인만 표시 */}
                      {!isSsoUser && (
                      <button
                        onClick={handleLogout}
                        className="w-full px-4 py-3 text-left text-sm hover:bg-gray-100 dark:hover:bg-white/5 flex items-center transition-colors group border-t border-gray-50 dark:border-gray-800"
                      >
                         <LogOut size={18} className="mr-4 text-gray-500 group-hover:text-red-500 transition-colors" />
                         <span className="font-medium text-gray-700 dark:text-gray-300 group-hover:text-red-500">로그아웃</span>
                      </button>
                      )}
                   </motion.div>
                )}
             </AnimatePresence>

             <button
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                className={`w-full flex items-center px-4 py-3 text-sm rounded-xl transition-all font-medium group ${isSettingsOpen ? 'bg-gray-100 dark:bg-white/10 text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5'}`}
             >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold mr-3 flex-shrink-0">
                  {loggedUsername ? loggedUsername[0].toUpperCase() : '?'}
                </div>
                <div className="min-w-0 flex-1">
                  {loggedUsername && <span className="block text-sm font-semibold text-gray-800 dark:text-gray-100 truncate leading-tight">{loggedUsername}</span>}
                  {loggedDept
                    ? <span className="block text-xs text-gray-400 truncate leading-tight">{loggedDept}</span>
                    : <span className={`block ${loggedUsername ? 'text-xs text-gray-400' : 'tracking-wide'}`}>설정 및 관리</span>
                  }
                </div>
                <Settings
                  size={16}
                  className={`ml-2 flex-shrink-0 transition-transform duration-500 ${isSettingsOpen ? 'rotate-90 text-blue-500' : 'group-hover:rotate-45'}`}
                />
             </button>
          </div>
        </div>

        <AnimatePresence>
          {(activeModal || confirmAction) && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => { setActiveModal(null); setConfirmAction(null); }}
                className="absolute inset-0 bg-black/60 backdrop-blur-[6px]"
              />
              
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 30 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 30 }}
                className={`relative w-full ${confirmAction ? 'max-w-md' : 'max-w-2xl'} bg-white dark:bg-[#1a1c1e] rounded-[32px] shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-800 transition-all`}
              >
                {/* 1. 서비스 모달 (프로필/활동) */}
                {activeModal && (
                  <>
                    <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                      <div className="flex items-center">
                        {activeModal === 'profile' ? (
                          <div className="flex items-center">
                            <div className="p-2.5 bg-purple-100 dark:bg-purple-900/30 rounded-2xl mr-4">
                              <Sparkles size={24} className="text-purple-600 dark:text-purple-400" />
                            </div>
                            <div>
                              <h3 className="text-xl font-bold dark:text-white mb-0.5">개인별 맞춤 AI 지침</h3>
                              <p className="text-sm text-gray-500">지능형 페르소나와 답변 스타일 설정</p>
                            </div>
                          </div>
                        ) : activeModal === 'password' ? (
                          <div className="flex items-center">
                            <div className="p-2.5 bg-amber-100 dark:bg-amber-900/30 rounded-2xl mr-4">
                              <KeyRound size={24} className="text-amber-600 dark:text-amber-400" />
                            </div>
                            <div>
                              <h3 className="text-xl font-bold dark:text-white mb-0.5">비밀번호 변경</h3>
                              <p className="text-sm text-gray-500">현재 비밀번호 확인 후 새 비밀번호를 설정하세요</p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center">
                            <div className="p-2.5 bg-blue-100 dark:bg-blue-900/30 rounded-2xl mr-4">
                              <Activity size={24} className="text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                              <h3 className="text-xl font-bold dark:text-white mb-0.5">활동 및 분석 이력</h3>
                              <p className="text-sm text-gray-500">진행된 문서 분석 내역 확인</p>
                            </div>
                          </div>
                        )}
                      </div>
                      <button 
                        onClick={() => setActiveModal(null)}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-full transition-colors text-gray-400"
                      >
                        <X size={24} />
                      </button>
                    </div>

                    <div className="p-8 max-h-[70vh] overflow-y-auto no-scrollbar">
                      {activeModal === 'profile' ? (
                        <div className="space-y-6">
                          <div className="space-y-4">
                            <label className="text-sm font-bold text-gray-400 uppercase tracking-widest pl-1">나만의 커스텀 지침</label>
                            <textarea
                              value={userProfile}
                              onChange={(e) => setUserProfile(e.target.value)}
                              placeholder="예: 간결하고 핵심적인 답변을 주시며, 마지막에는 항상 '감사합니다'를 덧붙여주세요."
                              className="w-full h-64 p-6 text-base bg-gray-50 dark:bg-black/30 border border-transparent focus:border-blue-500/50 dark:border-gray-800 dark:focus:border-blue-500 rounded-[24px] outline-none transition-all resize-none shadow-inner dark:text-white leading-relaxed"
                            />
                          </div>
                          <div className="flex justify-end mt-2">
                            <button 
                              onClick={() => setActiveModal(null)}
                              className="px-10 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold transition-all shadow-xl shadow-blue-500/30 active:scale-95"
                            >
                              저장 및 적용
                            </button>
                          </div>
                        </div>
                      ) : activeModal === 'password' ? (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-tighter pl-1">현재 비밀번호</label>
                            <input type="password" value={pwForm.current}
                              onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                              placeholder="현재 비밀번호"
                              className="w-full p-4 bg-gray-50 dark:bg-black/30 border border-gray-100 dark:border-gray-800 rounded-[16px] outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500 transition-all dark:text-white"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-tighter pl-1">새 비밀번호</label>
                            <input type="password" value={pwForm.new}
                              onChange={e => setPwForm(f => ({ ...f, new: e.target.value }))}
                              placeholder="새 비밀번호 (4자 이상)"
                              className="w-full p-4 bg-gray-50 dark:bg-black/30 border border-gray-100 dark:border-gray-800 rounded-[16px] outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500 transition-all dark:text-white"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-tighter pl-1">새 비밀번호 확인</label>
                            <input type="password" value={pwForm.confirm}
                              onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                              placeholder="새 비밀번호 재입력"
                              className="w-full p-4 bg-gray-50 dark:bg-black/30 border border-gray-100 dark:border-gray-800 rounded-[16px] outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500 transition-all dark:text-white"
                            />
                          </div>
                          {pwError && <p className="text-red-400 text-xs py-2 px-3 bg-red-500/10 rounded-lg border border-red-500/20">{pwError}</p>}
                          {pwSuccess && <p className="text-emerald-400 text-xs py-2 px-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20 flex items-center gap-1.5"><CheckCircle2 size={13} /> 비밀번호가 변경되었습니다!</p>}
                          <div className="flex justify-end mt-2">
                            <button
                              onClick={handlePasswordChange}
                              disabled={pwLoading || !pwForm.current || !pwForm.new || !pwForm.confirm}
                              className="px-10 py-4 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-2xl font-bold transition-all shadow-xl shadow-amber-500/30 active:scale-95"
                            >
                              {pwLoading ? '변경 중...' : '비밀번호 변경'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {tasks.length === 0 ? (
                            <div className="text-center py-20 text-gray-400 italic">현재 기록된 분석 활동이 아직 없습니다.</div>
                          ) : (
                            tasks.map((task) => (
                              <div key={task.id} className="p-5 bg-gray-50 dark:bg-black/20 border border-gray-100 dark:border-gray-800 rounded-3xl flex items-center justify-between group hover:border-blue-500/30 transition-all">
                                <div className="flex items-center">
                                  <div className={`p-3 rounded-2xl mr-5 flex items-center justify-center ${task.status === 'ready' ? 'bg-green-100 dark:bg-green-900/30 text-green-600' : 'bg-orange-100 dark:bg-orange-900/30 text-orange-600'}`}>
                                    <FileText size={20} />
                                  </div>
                                  <div>
                                    <h4 className="font-bold text-gray-800 dark:text-gray-200 line-clamp-1">{task.filename}</h4>
                                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                      {task.status === 'ready'
                                        ? <><CheckCircle2 size={11} className="text-green-500" /> 분석 완료</>
                                        : <><Loader2 size={11} className="animate-spin text-orange-500" /> 인덱싱 중...</>}
                                      &nbsp;• {task.chunks_count || 0} chunks
                                    </p>
                                  </div>
                                </div>
                                <div className="text-right flex flex-col items-end">
                                  <span className="text-[10px] text-gray-400 font-mono mb-1">
                                    {new Date(task.timestamp * 1000).toLocaleDateString()}
                                  </span>
                                  <span className="text-[10px] text-gray-400 font-mono">
                                    {new Date(task.timestamp * 1000).toLocaleTimeString()}
                                  </span>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* 2. 인터랙티브 액션 모달 (삭제/이름변경) */}
                {confirmAction && (
                   <div className="p-8">
                      {confirmAction.type === 'rename' ? (
                         <div className="space-y-6">
                            <div className="flex items-center space-x-5 mb-4">
                               <div className="p-4 bg-blue-100 dark:bg-blue-900/30 rounded-3xl text-blue-600">
                                  <Edit2 size={24} />
                               </div>
                               <div>
                                  <h3 className="text-2xl font-bold dark:text-white">대화 제목 변경</h3>
                                  <p className="text-sm text-gray-500">새로운 제목을 설정하세요</p>
                               </div>
                            </div>
                            <div className="space-y-2">
                               <label className="text-[10px] font-black text-gray-400 uppercase tracking-tighter pl-1">새 제목 입력</label>
                               <input 
                                  type="text"
                                  autoFocus
                                  value={confirmAction.inputValue}
                                  onChange={(e) => setConfirmAction({...confirmAction, inputValue: e.target.value})}
                                  onKeyDown={(e) => {
                                     if (e.key === 'Enter' && confirmAction.inputValue?.trim()) {
                                        updateTitle(confirmAction.id!, confirmAction.inputValue.trim());
                                        setConfirmAction(null);
                                     }
                                  }}
                                  className="w-full p-5 bg-gray-50 dark:bg-black/30 border border-gray-100 dark:border-gray-800 rounded-[20px] outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all dark:text-white font-medium"
                                  placeholder="새 제목 입력..."
                               />
                            </div>
                            <div className="flex space-x-4 justify-end pt-2">
                               <button onClick={() => setConfirmAction(null)} className="px-6 py-3 font-semibold text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 rounded-2xl transition-colors">취소</button>
                               <button 
                                 onClick={() => {
                                    if (confirmAction.inputValue?.trim()) {
                                       updateTitle(confirmAction.id!, confirmAction.inputValue.trim());
                                       setConfirmAction(null);
                                    }
                                 }}
                                 className="px-10 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-xl shadow-blue-500/30 transition-all active:scale-95"
                               >
                                 수정 완료
                               </button>
                            </div>
                         </div>
                      ) : (
                         <div className="space-y-8 text-center py-4">
                            <div className="mx-auto w-20 h-20 bg-red-100 dark:bg-red-900/20 rounded-[32px] flex items-center justify-center text-red-600 mb-2 shadow-inner">
                               <Trash2 size={36} />
                            </div>
                            <div>
                               <h3 className="text-2xl font-bold dark:text-white mb-2 tracking-tight">
                                  {confirmAction.type === 'delete' ? '대화 기록 삭제' : '전체 대화 초기화'}
                               </h3>
                               <p className="text-[15px] text-gray-500 dark:text-gray-400 leading-relaxed max-w-[300px] mx-auto">
                                  {confirmAction.type === 'delete' 
                                    ? `"${confirmAction.title}" 대화 내용을 삭제하시겠습니까? 이 작업은 복구할 수 없습니다.` 
                                    : '지금까지 데이터가 영구적으로 삭제됩니다. 기록을 비우시겠습니까?'}
                               </p>
                            </div>
                            <div className="flex space-x-4 justify-center pt-2 px-4">
                               <button onClick={() => setConfirmAction(null)} className="flex-1 py-4 font-bold text-gray-500 border border-gray-200 dark:border-gray-800 rounded-2xl hover:bg-gray-50 dark:hover:bg-white/5 transition-all">취소</button>
                               <button 
                                 onClick={() => {
                                    if (confirmAction.type === 'delete') deleteChat(confirmAction.id!);
                                    else clearAll();
                                    setConfirmAction(null);
                                 }}
                                 className="flex-1 py-4 bg-red-500 hover:bg-red-600 text-white font-bold rounded-2xl shadow-xl shadow-red-500/30 transition-all active:scale-95"
                               >
                                 삭제하기
                               </button>
                            </div>
                         </div>
                      )}
                   </div>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </aside>

      {/* 모바일 하단 오버레이 */}
      {isSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-[40] backdrop-blur-sm"
          onClick={toggleSidebar}
        />
      )}
    </>
  );
}
