'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database, FileText, Search, Trash2, ArrowLeft,
  RefreshCw, Upload, AlertTriangle, CheckCircle2, XCircle,
  X, File, FileType, HardDrive, Calendar, MessageSquare, ThumbsUp, ThumbsDown, Clock,
  BarChart, Cpu, Activity, Zap, Bot, ChevronDown, Users, UserPlus, Shield, User, KeyRound, Check, UserCheck, UserX,
  Paperclip, AlignLeft, SlidersHorizontal, TrendingUp, TrendingDown, Minus, Bell
} from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { API_BASE } from '@/utils/config';

interface DocInfo {
  name: string;
  size: number;
  modified: number;
  extension: string;
}

interface Feedback {
  id: string;
  question: string;
  answer: string;
  score: number;
  sources: string;
  comment?: string;
  timestamp: string;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

type ToastType = 'success' | 'error' | 'warning';
interface Toast { id: number; type: ToastType; message: string; }

export default function AdminDashboardPage() {
  const [activeTab, setActiveTab] = useState<'documents' | 'feedback' | 'dashboard' | 'users' | 'usage' | 'ragtest'>('dashboard');
  const [documents, setDocuments] = useState<DocInfo[]>([]);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [feedbackStats, setFeedbackStats] = useState<any>(null);
  const [usageStats, setUsageStats] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [queryLogs, setQueryLogs] = useState<{ total: number; logs: any[] } | null>(null);
  const [queryLogsLoading, setQueryLogsLoading] = useState(false);
  const [metrics, setMetrics] = useState<any>(null);
  const [logSearch, setLogSearch] = useState('');
  const [logView, setLogView] = useState<'recent' | 'frequent'>('recent');
  const [ragQuery, setRagQuery] = useState('');
  const [ragResults, setRagResults] = useState<any>(null);
  const [ragLoading, setRagLoading] = useState(false);
  const [selectedRagDoc, setSelectedRagDoc] = useState<any>(null);
  const [parentExpanded, setParentExpanded] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ label: string; desc: string; fn: () => Promise<void> } | null>(null);
  const [confirmPw, setConfirmPw] = useState('');
  const [confirmPwError, setConfirmPwError] = useState('');
  const [confirmPwLoading, setConfirmPwLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DocInfo | null>(null);
  const [confirmDeleteFeedback, setConfirmDeleteFeedback] = useState<Feedback | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [switchingModel, setSwitchingModel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 사용자 관리
  const [users, setUsers] = useState<any[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<string | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [resetPasswordFor, setResetPasswordFor] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const pendingUsers = users.filter(u => u.status === 'pending');
  const activeUsers = users.filter(u => u.status !== 'pending');
  const [reindexing, setReindexing] = useState(false);
  const [reindexStatus, setReindexStatus] = useState<{status: string; progress: string; error: string} | null>(null);
  const reindexPollRef = useRef<any>(null);
  // 검색 파라미터 튜닝
  const [testParams, setTestParams] = useState({ vector_k: 20, bm25_k: 20, final_top_k: 5, mode: 'hybrid' });
  const [liveParams, setLiveParams] = useState<{ vector_k: number; bm25_k: number; final_top_k: number; mode: string } | null>(null);
  const [prevRagResults, setPrevRagResults] = useState<any[] | null>(null);
  // 알림 임계값
  const [alertSettings, setAlertSettings] = useState<{ gpu_temp_threshold: number; zero_hit_interval_hours: number; daily_summary_hour: number } | null>(null);
  // 전역 관리자 지침 (admin 전용) — 사내 채팅 답변에 적용
  const [globalInstr, setGlobalInstr] = useState<string>('');
  const [globalDraft, setGlobalDraft] = useState<string>('');
  const [globalSaving, setGlobalSaving] = useState(false);
  const [alertDraft, setAlertDraft] = useState<{ gpu_temp_threshold: number; zero_hit_interval_hours: number; daily_summary_hour: number } | null>(null);
  const [alertSaving, setAlertSaving] = useState(false);
  let toastId = useRef(0);

  const addToast = (type: ToastType, message: string) => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/documents`, { credentials: 'include' });
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch {
      addToast('error', '문서 목록을 불러오지 못했습니다.');
    } finally {
      if (activeTab === 'documents') setLoading(false);
    }
  };

  const fetchFeedbacks = async () => {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/feedbacks`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/admin/feedbacks/stats`, { credentials: 'include' }),
      ]);
      const listData = await listRes.json();
      const statsData = await statsRes.json();
      setFeedbacks(listData.feedbacks || []);
      setFeedbackStats(statsData);
    } catch {
      addToast('error', '피드백 목록을 불러오지 못했습니다.');
    } finally {
      if (activeTab === 'feedback') setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/stats`, { credentials: 'include' });
      const data = await res.json();
      setStats(data);
      // 최초 로드 시 현재 모델을 드롭다운 초기값으로 설정
      if (data?.service?.current_model) {
        setSelectedModel(prev => prev || data.service.current_model);
      }
    } catch {
      // ignore
    }
  };

  const fetchQueryLogs = async () => {
    setQueryLogsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/query-logs`, { credentials: 'include' });
      if (res.ok) setQueryLogs(await res.json());
    } catch {
      // ignore
    } finally {
      setQueryLogsLoading(false);
    }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/metrics`, { credentials: 'include' });
      if (res.ok) setMetrics(await res.json());
    } catch {
      // ignore
    }
  };

  const handleSwitchModel = async () => {
    if (!selectedModel || switchingModel) return;
    setSwitchingModel(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/switch-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ model: selectedModel }),
      });
      const data = await res.json();
      if (res.ok) {
        addToast('success', `모델 전환 완료: ${data.current_model}`);
        fetchStats();
      } else {
        addToast('error', data.detail || '모델 전환에 실패했습니다.');
      }
    } catch {
      addToast('error', '모델 전환 중 오류가 발생했습니다.');
    } finally {
      setSwitchingModel(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, { credentials: 'include' });
      if (res.ok) { const d = await res.json(); setUsers(d.users || []); }
    } catch {}
  };

  const handleCreateUser = async () => {
    if (!newUsername.trim() || !newPassword.trim()) return;
    setCreatingUser(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, role: newRole }),
      });
      const data = await res.json();
      if (res.ok) {
        addToast('success', `계정 생성 완료: ${data.username}`);
        setNewUsername(''); setNewPassword(''); setNewRole('user');
        fetchUsers();
      } else {
        addToast('error', data.detail || '계정 생성 실패');
      }
    } catch { addToast('error', '오류 발생'); }
    finally { setCreatingUser(false); }
  };

  const handleDeleteUser = async (username: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(username)}`, {
        method: 'DELETE', credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) { addToast('success', `계정 삭제: ${username}`); fetchUsers(); }
      else addToast('error', data.detail || '삭제 실패');
    } catch { addToast('error', '오류 발생'); }
    finally { setConfirmDeleteUser(null); }
  };

  const doReindex = async () => {
    if (reindexing) return;
    setReindexing(true);
    setReindexStatus({ status: 'running', progress: '재인덱싱 요청 중...', error: '' });
    try {
      const res = await fetch(`${API_BASE}/api/admin/reindex`, { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (!res.ok) { addToast('error', data.detail || '재인덱싱 시작 실패'); setReindexing(false); return; }
      reindexPollRef.current = setInterval(async () => {
        try {
          const sr = await fetch(`${API_BASE}/api/admin/reindex/status`, { credentials: 'include' });
          const sd = await sr.json();
          setReindexStatus(sd);
          if (sd.status !== 'running') {
            clearInterval(reindexPollRef.current);
            setReindexing(false);
            if (sd.status === 'done') addToast('success', sd.progress);
            else addToast('error', `재인덱싱 실패: ${sd.error}`);
          }
        } catch {}
      }, 2000);
    } catch { addToast('error', '오류 발생'); setReindexing(false); }
  };

  const handleReindex = () => requirePassword(
    'DB 재인덱싱',
    '모든 문서를 다시 임베딩하여 ChromaDB와 BM25 인덱스를 갱신합니다. 완료까지 수 분이 소요됩니다.',
    doReindex
  );

  const handleResetPassword = async (username: string) => {
    if (!resetPasswordValue.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(username)}/password`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: resetPasswordValue }),
      });
      const data = await res.json();
      if (res.ok) addToast('success', `${username} 비밀번호 초기화 완료`);
      else addToast('error', data.detail || '비밀번호 초기화 실패');
    } catch { addToast('error', '오류 발생'); }
    finally { setResetPasswordFor(null); setResetPasswordValue(''); }
  };

  const handleApproveUser = async (username: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(username)}/approve`, {
        method: 'POST', credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) { addToast('success', `${username} 가입 승인 완료`); fetchUsers(); }
      else addToast('error', data.detail || '승인 실패');
    } catch { addToast('error', '오류 발생'); }
  };

  const handleRejectUser = async (username: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(username)}/reject`, {
        method: 'POST', credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) { addToast('success', `${username} 가입 거절`); fetchUsers(); }
      else addToast('error', data.detail || '거절 실패');
    } catch { addToast('error', '오류 발생'); }
  };

  const handleToggleActive = async (username: string, isActive: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(username)}/active`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: isActive }),
      });
      const data = await res.json();
      if (res.ok) { addToast('success', `${isActive ? '계정 활성화' : '계정 정지'}: ${username}`); fetchUsers(); }
      else addToast('error', data.detail || '변경 실패');
    } catch { addToast('error', '오류 발생'); }
  };

  const handleChangeRole = async (username: string, role: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(username)}/role`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (res.ok) { addToast('success', `${username} 역할 변경 → ${role}`); fetchUsers(); }
      else addToast('error', data.detail || '역할 변경 실패');
    } catch { addToast('error', '오류 발생'); }
  };

  const fetchUsageStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/usage-stats`, { credentials: 'include' });
      const data = await res.json();
      setUsageStats(data);
    } catch { /* silent */ }
  };

  const fetchRagTest = async (q?: string, params?: typeof testParams) => {
    const query = (q ?? ragQuery).trim();
    if (!query) return;
    if (q) setRagQuery(q);
    // 이전 결과 저장 (diff 비교용)
    if (ragResults?.results) setPrevRagResults(ragResults.results);
    setRagLoading(true);
    setRagResults(null);
    setSelectedRagDoc(null);
    const useParams = params ?? testParams;
    try {
      const res = await fetch(`${API_BASE}/api/admin/rag-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ query, ...useParams }),
      });
      const data = await res.json();
      setRagResults(data);
    } catch { addToast('error', 'RAG 테스트 실패'); }
    finally { setRagLoading(false); }
  };

  function highlightKeywords(text: string, query: string) {
    const keywords = query.split(/\s+/).filter(k => k.length >= 2);
    if (!keywords.length) return <span>{text}</span>;
    const regex = new RegExp(`(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    const parts = text.split(regex);
    return <span>{parts.map((p, i) => regex.test(p) ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/60 text-inherit rounded px-0.5">{p}</mark> : p)}</span>;
  }

  useEffect(() => {
    if (activeTab === 'documents') fetchDocuments();
    else if (activeTab === 'feedback') fetchFeedbacks();
    else if (activeTab === 'users') fetchUsers();
    else if (activeTab === 'usage') fetchUsageStats();
    else if (activeTab === 'ragtest') {
      if (!ragResults) fetchRagTest(' ');
      if (!liveParams) {
        fetch(`${API_BASE}/api/admin/search-params`, { credentials: 'include' })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) { setLiveParams(d); setTestParams(d); } })
          .catch(() => {});
      }
    }
    else fetchStats();

    if (activeTab === 'dashboard') { fetchQueryLogs(); fetchMetrics(); }

    if (activeTab === 'dashboard' && !alertSettings) {
      fetch(`${API_BASE}/api/admin/alert-settings`, { credentials: 'include' })
        .then(r => r.json())
        .then(d => { setAlertSettings(d); setAlertDraft(d); })
        .catch(() => {});
      fetch(`${API_BASE}/api/admin/global-instruction`, { credentials: 'include' })
        .then(r => r.json())
        .then(d => { setGlobalInstr(d.instruction || ''); setGlobalDraft(d.instruction || ''); })
        .catch(() => {});
    }

    let interval: any;
    if (activeTab === 'dashboard') {
      interval = setInterval(fetchStats, 3000);
    }
    return () => clearInterval(interval);
  }, [activeTab]);

  const saveGlobalInstruction = async () => {
    setGlobalSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/global-instruction`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ instruction: globalDraft.slice(0, 1500) }),
      });
      if (!res.ok) { const d = await res.json(); addToast('error', d.detail || '저장 실패'); return; }
      const updated = await res.json();
      setGlobalInstr(updated.instruction || '');
      setGlobalDraft(updated.instruction || '');
      addToast('success', '전역 지침이 저장됐습니다.');
    } catch { addToast('error', '서버 오류'); }
    finally { setGlobalSaving(false); }
  };

  const saveAlertSettings = async () => {
    if (!alertDraft) return;
    setAlertSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/alert-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(alertDraft),
      });
      if (!res.ok) { const d = await res.json(); addToast('error', d.detail || '저장 실패'); return; }
      const updated = await res.json();
      setAlertSettings(updated);
      setAlertDraft(updated);
      addToast('success', '알림 설정이 저장됐습니다.');
    } catch { addToast('error', '서버 오류'); }
    finally { setAlertSaving(false); }
  };

  const requirePassword = (label: string, desc: string, fn: () => Promise<void>) => {
    setConfirmPw('');
    setConfirmPwError('');
    setPendingAction({ label, desc, fn });
  };

  const executeWithPassword = async () => {
    if (!confirmPw.trim()) { setConfirmPwError('비밀번호를 입력하세요.'); return; }
    setConfirmPwLoading(true);
    setConfirmPwError('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/verify-password`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: confirmPw }),
      });
      if (!res.ok) { setConfirmPwError('비밀번호가 올바르지 않습니다.'); setConfirmPwLoading(false); return; }
      setPendingAction(null);
      setConfirmPw('');
      await pendingAction!.fn();
    } catch { setConfirmPwError('오류가 발생했습니다.'); }
    finally { setConfirmPwLoading(false); }
  };

  const handleClearVram = () => requirePassword(
    'VRAM 캐시 초기화',
    'GPU 메모리 캐시를 비웁니다. 다음 요청 시 재로딩이 발생할 수 있습니다.',
    async () => {
      const res = await fetch(`${API_BASE}/api/admin/clear-vram`, { method: 'POST', credentials: 'include' });
      if (res.ok) addToast('success', 'VRAM 캐시가 초기화되었습니다.');
      else addToast('error', '캐시 초기화 실패');
    }
  );

  const handleClearLogs = () => requirePassword(
    '로그 기록 초기화',
    '실시간 질의 로그와 지식 공백 기록이 모두 삭제됩니다. 복구 불가능합니다.',
    async () => {
      const res = await fetch(`${API_BASE}/api/admin/clear-logs`, { method: 'POST', credentials: 'include' });
      if (res.ok) { addToast('success', '모든 로그 기록이 초기화되었습니다.'); fetchStats(); fetchQueryLogs(); }
      else addToast('error', '로그 초기화 실패');
    }
  );

  const handleClearUsageStats = () => requirePassword(
    '사용 통계 초기화',
    '누적된 질문 로그 데이터가 모두 삭제됩니다. 복구 불가능합니다.',
    async () => {
      const res = await fetch(`${API_BASE}/api/admin/usage-stats/reset`, { method: 'POST', credentials: 'include' });
      if (res.ok) { addToast('success', '사용 통계가 초기화되었습니다.'); fetchUsageStats(); }
      else addToast('error', '초기화 실패');
    }
  );

  const handleApplySearchParams = () => requirePassword(
    '검색 파라미터 실서비스 적용',
    `vector_k=${testParams.vector_k}, bm25_k=${testParams.bm25_k}, final_top_k=${testParams.final_top_k}, mode=${testParams.mode}\n다음 질문부터 즉시 적용됩니다. 서버 재시작 시 기본값(20/20/5/hybrid)으로 복귀됩니다.`,
    async () => {
      const res = await fetch(`${API_BASE}/api/admin/search-params`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testParams),
      });
      const data = await res.json();
      if (res.ok) { setLiveParams(data); addToast('success', '검색 파라미터가 실서비스에 적용되었습니다.'); }
      else addToast('error', data.detail || '적용 실패');
    }
  );

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (documents.some(d => d.name === file.name)) {
      addToast('error', `"${file.name}"은(는) 이미 등록된 문서입니다. 삭제 후 재업로드하세요.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(`${API_BASE}/api/admin/upload`, { method: 'POST', body: form, credentials: 'include' });
      const data = await res.json();
      if (res.ok) {
        addToast('success', `"${file.name}" 사내 DB에 추가되었습니다.`);
        await fetchDocuments();
      } else {
        addToast('error', data.detail || '업로드 실패');
      }
    } catch {
      addToast('error', '업로드 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (doc: DocInfo) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/documents/${encodeURIComponent(doc.name)}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        addToast('success', `"${doc.name}" 삭제 완료`);
        await fetchDocuments();
      } else {
        const data = await res.json();
        addToast('error', data.detail || '삭제 실패');
      }
    } catch {
      addToast('error', '삭제 중 오류가 발생했습니다.');
    } finally {
      setConfirmDelete(null);
    }
  };

  const handleDeleteFeedback = async (fb: Feedback) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/feedbacks/${fb.id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        addToast('success', '피드백이 삭제되었습니다.');
        await fetchFeedbacks();
      } else {
        addToast('error', '삭제 실패');
      }
    } catch {
      addToast('error', '오류 발생');
    } finally {
      setConfirmDeleteFeedback(null);
    }
  };

  const filteredDocs = documents.filter(d => d.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const totalSize = documents.reduce((acc, d) => acc + d.size, 0);

  const extIcon = (ext: string) => {
    if (ext === 'pdf') return <FileText size={20} className="text-red-500" />;
    if (['docx', 'doc'].includes(ext)) return <FileType size={20} className="text-blue-500" />;
    if (['xlsx', 'xls'].includes(ext)) return <BarChart size={20} className="text-emerald-500" />;
    if (ext === 'pptx') return <BarChart size={20} className="text-orange-500" />;
    if (ext === 'txt') return <AlignLeft size={20} className="text-gray-500" />;
    return <Paperclip size={20} className="text-gray-400" />;
  };

  return (
    <div className="flex-1 h-screen overflow-y-auto bg-[#F0F4F9] dark:bg-[#0d1117] transition-colors pb-24">
      {/* Toast 알림 */}
      <div className="fixed top-6 right-6 z-[9999] space-y-3 pointer-events-none">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 60, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.9 }}
              className={`pointer-events-auto flex items-start gap-3 px-5 py-4 rounded-2xl shadow-2xl border text-sm font-medium max-w-sm backdrop-blur-md
                ${t.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/60 dark:border-emerald-700 dark:text-emerald-200'
                  : t.type === 'error' ? 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/60 dark:border-red-700 dark:text-red-200'
                  : 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/60 dark:border-amber-700 dark:text-amber-200'}`}
            >
              {t.type === 'success' ? <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0" />
                : <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />}
              <span>{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 모달: 문서 삭제/피드백 삭제 */}
      <AnimatePresence>
        {(confirmDelete || confirmDeleteFeedback) && (
          <div className="fixed inset-0 z-[500] flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => { setConfirmDelete(null); setConfirmDeleteFeedback(null); }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white dark:bg-[#1a1c1e] rounded-3xl border border-gray-200 dark:border-gray-800 shadow-2xl p-8 w-full max-w-md"
            >
              <div className="flex items-center gap-4 mb-5">
                <div className="w-12 h-12 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <Trash2 size={22} className="text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-white text-lg">기록 삭제</h3>
                  <p className="text-sm text-gray-500">이 작업은 되돌릴 수 없습니다.</p>
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-black/30 rounded-2xl p-4 mb-6 border border-gray-200 dark:border-gray-800">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 break-all">
                  {confirmDelete?.name || "선택된 피드백 기록을 삭제하시겠습니까?"}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setConfirmDelete(null); setConfirmDeleteFeedback(null); }}
                  className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={() => confirmDelete ? handleDelete(confirmDelete) : confirmDeleteFeedback && handleDeleteFeedback(confirmDeleteFeedback)}
                  className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold transition-colors shadow-lg shadow-red-500/20"
                >
                  영구 삭제
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="max-w-6xl mx-auto px-8 py-10 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <button
              onClick={() => window.location.href = '/'}
              className="p-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-800 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            >
              <ArrowLeft size={20} className="text-gray-700 dark:text-gray-300" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <Database className="text-emerald-500" size={28} />
                챗봇 운영 관리 센터
                <span className="px-3 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold rounded-full border border-emerald-200 dark:border-emerald-800">
                  Admin
                </span>
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                사내 데이터 인덱싱 관리 및 사용자 피드백 분석을 통합 관리합니다.
              </p>
            </div>
          </div>
        </div>

        {/* Tab Switching */}
        <div className="flex p-1 bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-800 rounded-2xl w-fit">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'dashboard' ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5'}`}
          >
            <Activity size={16} /> 실시간 대시보드
          </button>
          <button
            onClick={() => setActiveTab('documents')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'documents' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5'}`}
          >
            <FileText size={16} /> 사내 지식 관리
          </button>
          <button
            onClick={() => setActiveTab('feedback')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'feedback' ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5'}`}
          >
            <MessageSquare size={16} /> 품질 피드백 분석
          </button>
          <button
            onClick={() => setActiveTab('usage')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'usage' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5'}`}
          >
            <Activity size={16} /> 사용 통계
          </button>
          <button
            onClick={() => setActiveTab('ragtest')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'ragtest' ? 'bg-teal-500 text-white shadow-lg shadow-teal-500/20' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6M8 11h6"/></svg>
            검색 품질 테스트
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'users' ? 'bg-violet-500 text-white shadow-lg shadow-violet-500/20' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5'}`}
          >
            <Users size={16} /> 사용자 관리
            {pendingUsers.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                {pendingUsers.length}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'dashboard' ? (
          <div className="space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4">
              <h2 className="text-xl font-bold dark:text-white flex items-center gap-2"><Activity className="text-indigo-500"/> 시스템 실시간 상태</h2>
                   <div className="flex gap-2">
                     <button 
                       onClick={handleClearLogs}
                       className="flex items-center space-x-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl transition-all text-sm font-bold border border-gray-200 dark:border-gray-700"
                     >
                       <Trash2 size={16} />
                       <span>로그 기록 초기화</span>
                     </button>
                     <button 
                       onClick={handleClearVram}
                       className="flex items-center space-x-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-xl transition-all text-sm font-bold border border-red-100 dark:border-red-900/30"
                     >
                       <Zap size={16} />
                       <span>VRAM 캐시 초기화 (Kill Switch)</span>
                     </button>
                   </div>
            </div>
            
            {/* [관제] 실측 지표 — 응답시간 p50/p95·에러율·질의량 (회귀 통과율이 아닌 실서비스 품질 근거) */}
            {metrics && (
              <div className="mb-6 bg-white dark:bg-[#1a1c1e] p-6 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="text-emerald-500" size={18} />
                  <h3 className="font-bold text-gray-700 dark:text-gray-300">관제 지표 <span className="text-xs font-medium text-gray-400">({metrics.window})</span></h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: '응답시간 p50', value: metrics.latency_ms?.p50 != null ? `${(metrics.latency_ms.p50/1000).toFixed(1)}s` : '—', color: 'text-blue-500' },
                    { label: '응답시간 p95', value: metrics.latency_ms?.p95 != null ? `${(metrics.latency_ms.p95/1000).toFixed(1)}s` : '—', color: 'text-indigo-500' },
                    { label: '에러율', value: `${metrics.error_rate_pct ?? 0}%`, color: (metrics.error_rate_pct ?? 0) > 2 ? 'text-red-500' : 'text-emerald-500' },
                    { label: '완료 질의(7일)', value: `${metrics.latency_ms?.count ?? 0}건`, color: 'text-gray-700 dark:text-gray-200' },
                  ].map((m) => (
                    <div key={m.label} className="bg-gray-50 dark:bg-white/5 rounded-2xl p-4">
                      <div className={`text-2xl font-bold ${m.color}`}>{m.value}</div>
                      <div className="text-xs text-gray-500 mt-1">{m.label}</div>
                    </div>
                  ))}
                </div>
                {Array.isArray(metrics.daily_volume) && metrics.daily_volume.length > 0 && (
                  <div className="mt-5">
                    <div className="text-xs font-bold text-gray-500 mb-2">일별 질의량 (최근 14일)</div>
                    <div className="flex items-end gap-1 h-20">
                      {[...metrics.daily_volume].reverse().map((d: any) => {
                        const max = Math.max(...metrics.daily_volume.map((x: any) => x.count), 1);
                        return (
                          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group" title={`${d.date}: ${d.count}건`}>
                            <div className="w-full bg-emerald-400/70 dark:bg-emerald-500/60 rounded-t transition-all group-hover:bg-emerald-500" style={{ height: `${(d.count/max)*100}%`, minHeight: '2px' }} />
                            <span className="text-[9px] text-gray-400">{d.date.slice(5)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {metrics.status_counts?.disconnected ? (
                  <div className="mt-3 text-xs text-gray-400">중도 이탈(disconnected): {metrics.status_counts.disconnected}건 · 에러: {metrics.status_counts.error ?? 0}건</div>
                ) : null}
              </div>
            )}

            {stats ? (
               <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                 {/* GPU 카드 — 전체 GPU 표시 */}
                 <div className="bg-white dark:bg-[#1a1c1e] p-6 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col gap-5">
                   <div className="flex items-center gap-2">
                     <Cpu className="text-blue-500" />
                     <h3 className="font-bold text-gray-700 dark:text-gray-300">GPU 상태</h3>
                   </div>
                   {(stats.hardware?.gpus ?? [stats.hardware]).filter(Boolean).map((gpu: any) => (
                     <div key={gpu.gpu_index} className="space-y-3">
                       <div className="flex justify-between items-center">
                         <span className="text-xs font-bold text-gray-600 dark:text-gray-400 flex items-center gap-1">
                           GPU #{gpu.gpu_index}
                           {gpu.is_rag_device && <span className="ml-1 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded text-[10px]">RAG</span>}
                         </span>
                         <span className="text-xs font-bold px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg text-gray-500">{gpu.gpu_temp}°C</span>
                       </div>
                       <div>
                         <div className="flex justify-between text-xs mb-1">
                           <span className="text-gray-500">VRAM</span>
                           <span className="font-bold dark:text-white">{(gpu.vram_used || 0).toFixed(0)} / {(gpu.vram_total || 0).toFixed(0)} MB</span>
                         </div>
                         <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                           <div className="bg-blue-500 h-2.5 rounded-full transition-all" style={{ width: `${((gpu.vram_used || 0) / (gpu.vram_total || 1)) * 100}%` }} />
                         </div>
                       </div>
                       <div>
                         <div className="flex justify-between text-xs mb-1">
                           <span className="text-gray-500">활용률</span>
                           <span className="font-bold dark:text-white">{gpu.gpu_util}%</span>
                         </div>
                         <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
                           <div className="bg-purple-500 h-2.5 rounded-full transition-all" style={{ width: `${gpu.gpu_util}%` }} />
                         </div>
                       </div>
                     </div>
                   ))}
                 </div>

                 {/* TPS 카드 */}
                 <div className="bg-white dark:bg-[#1a1c1e] p-6 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm">
                   <div className="flex justify-between items-start mb-4">
                     <div className="flex items-center gap-2">
                       <Zap className="text-amber-500" />
                       <h3 className="font-bold text-gray-700 dark:text-gray-300">생성 속도 (TPS)</h3>
                     </div>
                     <span className="text-xs font-bold px-2 py-1 bg-amber-50 dark:bg-amber-900/20 text-amber-600 rounded-lg">평균 {stats.performance?.tps_avg?.toFixed(1)} t/s</span>
                   </div>
                   <div className="h-32">
                     <ResponsiveContainer width="100%" height="100%">
                       <LineChart data={(stats.performance?.tps_history || []).map((v:any, i:number) => ({ i, val: v }))}>
                         <Line type="monotone" dataKey="val" stroke="#f59e0b" strokeWidth={3} dot={false} isAnimationActive={false} />
                       </LineChart>
                     </ResponsiveContainer>
                   </div>
                 </div>

                 {/* Service 카드 */}
                 <div className="bg-white dark:bg-[#1a1c1e] p-6 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm flex flex-col justify-center space-y-6">
                   <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-white/5 rounded-2xl">
                     <span className="text-sm font-bold text-gray-500">엔진 상태</span>
                     <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${stats.service?.vllm_health ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                       {stats.service?.vllm_health
                         ? <><CheckCircle2 size={12} /> 쾌적</>
                         : <><XCircle size={12} /> 연결 끊김</>}
                     </span>
                   </div>
                   <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-white/5 rounded-2xl">
                     <span className="text-sm font-bold text-gray-500">서버 업타임</span>
                     <span className="font-bold dark:text-white font-mono">{stats.service?.uptime}</span>
                   </div>
                 </div>

                 {/* 전사 공통 지침 (admin 전용 · 사내 채팅 답변에 적용) — 모델 관리 위 */}
                 <div className="md:col-span-3 bg-white dark:bg-[#1a1b1e] rounded-3xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
                   <div className="flex items-center gap-2 mb-1">
                     <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">전사 공통 지침</h3>
                     <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">관리자 전용</span>
                   </div>
                   <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
                     모든 사내 문서 채팅 답변에 적용되는 회사 차원 지침입니다. 안전 원칙(문서 근거·환각 차단)은 항상 우선하며, 개인 사용자 지침보다 우선합니다.
                   </p>
                   <textarea
                     value={globalDraft}
                     onChange={(e) => setGlobalDraft(e.target.value)}
                     maxLength={1500}
                     rows={4}
                     placeholder={"예: 답변은 항상 존댓말과 회사 표준 용어로 작성.\n규정 출처를 우선 표기."}
                     className="w-full text-[13px] rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-black/20 p-3 leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-indigo-400 text-gray-700 dark:text-gray-200"
                   />
                   <div className="flex items-center justify-between mt-2">
                     <span className="text-[11px] text-gray-400">{globalDraft.length}/1500</span>
                     <button
                       onClick={saveGlobalInstruction}
                       disabled={globalSaving || globalDraft.slice(0, 1500) === globalInstr}
                       className="px-5 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-bold rounded-xl transition-all"
                     >{globalSaving ? '저장 중...' : '저장'}</button>
                   </div>
                 </div>

                 {/* 모델 전환 카드 */}
                 <div className="md:col-span-3 bg-white dark:bg-[#1a1c1e] p-6 rounded-3xl border border-indigo-200 dark:border-indigo-800 shadow-sm">
                   <div className="flex items-center gap-2 mb-5">
                     <Bot className="text-indigo-500" size={20} />
                     <h3 className="font-bold text-gray-700 dark:text-gray-300">활성 LLM 모델 관리</h3>
                     <span className="ml-auto px-3 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 text-xs font-bold rounded-full">
                       현재: {stats.service?.current_model ?? '—'}
                     </span>
                   </div>
                   <div className="flex items-center gap-3 flex-wrap">
                     <div className="relative flex-1 min-w-[200px]">
                       <select
                         value={selectedModel}
                         onChange={e => setSelectedModel(e.target.value)}
                         disabled={switchingModel}
                         className="w-full appearance-none bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 pr-10 text-sm font-medium text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
                       >
                         {(stats.service?.available_models ?? []).map((m: string) => (
                           <option key={m} value={m}>{m}</option>
                         ))}
                       </select>
                       <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                     </div>
                     <button
                       onClick={handleSwitchModel}
                       disabled={switchingModel || selectedModel === stats.service?.current_model}
                       className="flex items-center gap-2 px-5 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-bold text-sm rounded-xl transition-colors shadow-lg shadow-indigo-500/20 disabled:shadow-none"
                     >
                       {switchingModel
                         ? <><RefreshCw size={15} className="animate-spin" /> 전환 중...</>
                         : <><Bot size={15} /> 모델 전환</>}
                     </button>
                     {selectedModel === stats.service?.current_model && (
                       <span className="flex items-center gap-1 text-xs text-emerald-500 font-medium"><CheckCircle2 size={12} /> 현재 활성 모델</span>
                     )}
                   </div>
                   <p className="text-xs text-gray-400 mt-3">
                     전환 가능한 모델은 서버의 <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">AVAILABLE_MODELS</code> 환경변수로 제어합니다.
                     vLLM 서버에서 모델을 로드하며, 전환 시 서버 재시작 없이 즉시 적용됩니다.
                   </p>
                 </div>

                 {/* 사용자 질의 로그 — 검색 + 날짜그룹 + 빈도순 토글 */}
                 <div className="md:col-span-2 bg-white dark:bg-[#1a1c1e] p-6 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm">
                   <div className="flex items-center justify-between mb-3">
                     <h3 className="font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                       <MessageSquare className="text-blue-500"/> 사용자 질의 로그
                       <span className="text-xs font-bold px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-full">전체 {queryLogs?.total ?? 0}건</span>
                     </h3>
                     <button onClick={fetchQueryLogs} disabled={queryLogsLoading} className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-blue-500 disabled:opacity-50 transition-colors">
                       <RefreshCw size={13} className={queryLogsLoading ? 'animate-spin' : ''} /> 새로고침
                     </button>
                   </div>
                   {/* 컨트롤 바 */}
                   <div className="flex items-center gap-2 mb-3">
                     <div className="relative flex-1">
                       <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                       <input
                         value={logSearch}
                         onChange={(e) => setLogSearch(e.target.value)}
                         placeholder="질문·사용자 검색..."
                         className="w-full pl-9 pr-8 py-2 text-[13px] rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:text-gray-200"
                       />
                       {logSearch && <button onClick={() => setLogSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14} /></button>}
                     </div>
                     <div className="flex rounded-xl bg-gray-100 dark:bg-white/5 p-0.5 text-xs font-bold">
                       <button onClick={() => setLogView('recent')} className={`px-3 py-1.5 rounded-lg transition-all ${logView === 'recent' ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-500'}`}>최신순</button>
                       <button onClick={() => setLogView('frequent')} className={`px-3 py-1.5 rounded-lg transition-all ${logView === 'frequent' ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-500'}`}>자주 물어본 순</button>
                     </div>
                   </div>
                   <div className="h-80 overflow-y-auto pr-2">
                     {(() => {
                       const all = queryLogs?.logs || [];
                       const kw = logSearch.trim().toLowerCase();
                       const filtered = kw ? all.filter((q: any) => (q.query || '').toLowerCase().includes(kw) || (q.username || '').toLowerCase().includes(kw)) : all;
                       if (filtered.length === 0) {
                         return <div className="text-center py-10 text-gray-400 italic text-sm">{queryLogsLoading ? '불러오는 중...' : kw ? '검색 결과가 없습니다.' : '접수된 질문이 없습니다.'}</div>;
                       }
                       if (logView === 'frequent') {
                         const cnt: Record<string, number> = {};
                         filtered.forEach((q: any) => { const t = (q.query || '').trim(); if (t) cnt[t] = (cnt[t] || 0) + 1; });
                         const ranked = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 100);
                         return (
                           <div className="space-y-2">
                             {ranked.map(([q, n], i) => (
                               <div key={i} className="flex items-center gap-3 text-sm p-3 bg-gray-50 dark:bg-white/5 rounded-xl">
                                 <span className={`flex-shrink-0 w-6 text-center font-bold text-xs ${i < 3 ? 'text-blue-500' : 'text-gray-400'}`}>{i + 1}</span>
                                 <span className="font-medium dark:text-gray-200 break-words flex-1">{q}</span>
                                 <span className="flex-shrink-0 text-xs font-bold px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full">{n}회</span>
                               </div>
                             ))}
                           </div>
                         );
                       }
                       // 최신순 + 날짜 그룹 (렌더 부하 방지 위해 최대 400건)
                       const shown = filtered.slice(0, 400);
                       const groups: { label: string; items: any[] }[] = [];
                       const dLabel = (ts: string) => {
                         const d = (ts || '').slice(0, 10);
                         const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
                         const yest = new Date(Date.now() + 9 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
                         return d === today ? '오늘' : d === yest ? '어제' : d;
                       };
                       shown.forEach((q: any) => {
                         const lb = dLabel(q.timestamp);
                         const g = groups[groups.length - 1];
                         if (g && g.label === lb) g.items.push(q); else groups.push({ label: lb, items: [q] });
                       });
                       return (
                         <div className="space-y-3">
                           {groups.map((g, gi) => (
                             <div key={gi}>
                               <div className="sticky top-0 bg-white dark:bg-[#1a1c1e] py-1 text-[11px] font-bold text-gray-400 dark:text-gray-500">{g.label} · {g.items.length}건</div>
                               <div className="space-y-1.5">
                                 {g.items.map((q: any) => (
                                   <div key={q.id} className="flex gap-2.5 text-sm p-2.5 bg-gray-50 dark:bg-white/5 rounded-xl">
                                     <span className="text-gray-400 font-mono text-[11px] mt-0.5 whitespace-nowrap">{q.timestamp?.slice(11, 16)}</span>
                                     <span className="flex-shrink-0 text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 max-w-[110px] truncate" title={q.username || '알 수 없음'}>
                                       {q.username || '—'}
                                     </span>
                                     <span className="font-medium dark:text-gray-200 break-words">{q.query}</span>
                                   </div>
                                 ))}
                               </div>
                             </div>
                           ))}
                           {filtered.length > 400 && (
                             <div className="text-center py-3 text-[11px] text-gray-400">…최근 400건만 표시 중 (총 {filtered.length}건). 검색으로 좁혀보세요.</div>
                           )}
                         </div>
                       );
                     })()}
                   </div>
                 </div>

                 {/* Zero Hits — 지식 공백 마이닝 (같은 질문 빈도순 TOP) */}
                 <div className="bg-white dark:bg-[#1a1c1e] p-6 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm">
                   <h3 className="font-bold text-red-600 dark:text-red-400 mb-2 flex items-center gap-2">
                     <AlertTriangle size={18}/> 지식 공백 마이닝 (Zero-Hit)
                     <span className="text-xs font-bold px-2 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-full">최근 {stats.zero_hits_summary?.window_days ?? 14}일 {((stats.zero_hits_summary?.regulation ?? 0) + (stats.zero_hits_summary?.general ?? 0))}건</span>
                     <span className="text-[10px] font-normal text-gray-400">(누적 {(stats.zero_hits || []).length}건)</span>
                   </h3>
                   <p className="text-xs text-gray-500 mb-3"><b>최근 {stats.zero_hits_summary?.window_days ?? 14}일</b> 답변 못 찾은 질문을 같은 질문끼리 묶어 빈도순으로 표시(오래된 테스트 기록은 자동 제외). 반복 질문(🔴 규정)은 검색 보강·HR 규정 문의 대상입니다.</p>
                   {stats.zero_hits_summary && (
                     <div className="flex gap-2 mb-3 text-xs">
                       <span className="px-2 py-1 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg font-semibold">🔴 규정 관련 {stats.zero_hits_summary.regulation}건</span>
                       <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-500 rounded-lg font-semibold">🟢 일반·잡담 {stats.zero_hits_summary.general}건</span>
                     </div>
                   )}
                   <div className="space-y-2 h-72 overflow-y-auto pr-2">
                     {(stats.zero_hits_top || []).map((zh: any, i: number) => (
                       <div key={i} className={`flex items-start gap-3 p-3 rounded-xl border ${zh.category === 'regulation' ? 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/20' : 'bg-gray-50 dark:bg-gray-800/40 border-gray-100 dark:border-gray-800'}`}>
                         <span className={`shrink-0 text-sm font-extrabold w-11 text-center py-1 rounded-lg ${zh.count >= 3 ? 'bg-red-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>{zh.count}회</span>
                         <div className="min-w-0">
                           <p className="text-sm font-bold dark:text-gray-200 line-clamp-2">{zh.query}</p>
                           <div className="flex items-center gap-2 mt-1">
                             <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${zh.category === 'regulation' ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-gray-200 dark:bg-gray-700 text-gray-500'}`}>{zh.category === 'regulation' ? '🔴 규정' : '🟢 일반'}</span>
                             <span className="text-[10px] text-gray-400">최근 {zh.last_seen?.slice(0, 10)}</span>
                           </div>
                         </div>
                       </div>
                     ))}
                     {(!stats.zero_hits_top || stats.zero_hits_top.length === 0) && (
                       <div className="text-center py-10 text-emerald-500 italic text-sm flex flex-col items-center gap-2"><CheckCircle2 size={24} />현재 탐지된 공백이 없습니다.</div>
                     )}
                   </div>
                 </div>

               </div>
            ) : (
               <div className="py-32 flex justify-center"><RefreshCw className="animate-spin text-indigo-500" size={32} /></div>
            )}

            {/* 알림 임계값 설정 */}
            <div className="bg-white dark:bg-[#1a1c1e] rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
              <h3 className="font-bold text-gray-700 dark:text-gray-300 mb-4 flex items-center gap-2">
                <Bell size={18} className="text-orange-500" /> 알림 임계값 설정
                <span className="text-xs font-normal text-gray-400 ml-1">(재시작 시 기본값으로 초기화)</span>
              </h3>
              {alertDraft ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {/* GPU 온도 */}
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1">
                        <Cpu size={14} className="text-red-400" /> GPU 온도 경고 기준
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="range" min={50} max={100} step={1}
                          value={alertDraft.gpu_temp_threshold}
                          onChange={e => setAlertDraft(prev => prev ? { ...prev, gpu_temp_threshold: Number(e.target.value) } : prev)}
                          className="flex-1 accent-red-500"
                        />
                        <span className="text-lg font-bold text-red-500 w-14 text-right">{alertDraft.gpu_temp_threshold}°C</span>
                      </div>
                      <p className="text-xs text-gray-400">현재 기본값: 90°C</p>
                    </div>

                    {/* Zero-hit 알림 간격 */}
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1">
                        <Search size={14} className="text-yellow-500" /> Zero-hit 알림 간격
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="range" min={1} max={24} step={1}
                          value={alertDraft.zero_hit_interval_hours}
                          onChange={e => setAlertDraft(prev => prev ? { ...prev, zero_hit_interval_hours: Number(e.target.value) } : prev)}
                          className="flex-1 accent-yellow-500"
                        />
                        <span className="text-lg font-bold text-yellow-600 w-14 text-right">{alertDraft.zero_hit_interval_hours}시간</span>
                      </div>
                      <p className="text-xs text-gray-400">현재 기본값: 2시간</p>
                    </div>

                    {/* 일일 요약 발송 시각 */}
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1">
                        <Activity size={14} className="text-blue-400" /> 일일 요약 발송 시각
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="range" min={0} max={23} step={1}
                          value={alertDraft.daily_summary_hour}
                          onChange={e => setAlertDraft(prev => prev ? { ...prev, daily_summary_hour: Number(e.target.value) } : prev)}
                          className="flex-1 accent-blue-500"
                        />
                        <span className="text-lg font-bold text-blue-500 w-14 text-right">오전 {alertDraft.daily_summary_hour}시</span>
                      </div>
                      <p className="text-xs text-gray-400">현재 기본값: 오전 9시</p>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={() => setAlertDraft(alertSettings)}
                      className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                    >초기화</button>
                    <button
                      onClick={saveAlertSettings}
                      disabled={alertSaving || JSON.stringify(alertDraft) === JSON.stringify(alertSettings)}
                      className="px-5 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white text-sm font-bold rounded-xl transition-all"
                    >{alertSaving ? '저장 중...' : '저장'}</button>
                  </div>
                </div>
              ) : (
                <div className="py-8 flex justify-center"><RefreshCw className="animate-spin text-gray-400" size={20} /></div>
              )}
            </div>
          </div>
        ) : activeTab === 'documents' ? (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { icon: <FileText size={22} className="text-blue-500" />, label: '등록 문서', value: `${documents.length}건`, bg: 'from-blue-500/10 to-indigo-500/10 border-blue-200 dark:border-blue-800' },
                { icon: <HardDrive size={22} className="text-purple-500" />, label: '총 용량', value: formatBytes(totalSize), bg: 'from-purple-500/10 to-pink-500/10 border-purple-200 dark:border-purple-800' },
                { icon: <CheckCircle2 size={22} className="text-emerald-500" />, label: '인덱싱 상태', value: `정상 기동 중`, bg: 'from-emerald-500/10 to-teal-500/10 border-emerald-200 dark:border-emerald-800' },
              ].map((s, i) => (
                <div key={i} className={`bg-gradient-to-br ${s.bg} border rounded-2xl p-4 flex items-center gap-4`}>
                  <div className="p-2.5 bg-white dark:bg-black/20 rounded-xl">{s.icon}</div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{s.label}</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">{s.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  placeholder="파일명으로 관리 대상을 찾으세요..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-800 rounded-2xl text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>
              <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.txt,.md,.html,.htm,.docx,.xlsx,.xls,.pptx" onChange={handleUpload} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-2 px-6 py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-bold shadow-lg shadow-emerald-500/30 transition-all disabled:opacity-50"
              >
                {uploading ? <RefreshCw className="animate-spin" size={18} /> : <Upload size={18} />}
                신규 문서 추가
              </button>
              <button
                onClick={handleReindex}
                disabled={reindexing}
                className="flex items-center gap-2 px-6 py-3.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-500/30 transition-all disabled:opacity-50"
                title="DOCS_PATH의 모든 파일을 다시 임베딩하여 ChromaDB와 BM25 인덱스를 갱신합니다."
              >
                <RefreshCw size={18} className={reindexing ? 'animate-spin' : ''} />
                DB 재인덱싱
              </button>
            </div>
            {reindexStatus && reindexStatus.status !== 'idle' && (
              <div className={`px-5 py-3 rounded-2xl text-sm font-medium flex items-center gap-3 ${
                reindexStatus.status === 'running'
                  ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                  : reindexStatus.status === 'done'
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
              }`}>
                {reindexStatus.status === 'running' && <RefreshCw size={16} className="animate-spin flex-shrink-0" />}
                {reindexStatus.status === 'done' && <CheckCircle2 size={16} className="flex-shrink-0" />}
                {reindexStatus.status === 'error' && <AlertTriangle size={16} className="flex-shrink-0" />}
                <span>{reindexStatus.status === 'error' ? reindexStatus.error : reindexStatus.progress}</span>
              </div>
            )}

            {/* Document Table */}
            <div className="bg-white dark:bg-[#1a1c1e] rounded-3xl border border-gray-200 dark:border-gray-800 shadow-xl overflow-hidden">
               <table className="w-full text-left">
                  <thead className="bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-gray-800">
                    <tr className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      <th className="px-6 py-4">파일명</th>
                      <th className="px-6 py-4 text-center">확장자</th>
                      <th className="px-6 py-4 text-right">용량</th>
                      <th className="px-6 py-4 text-right">업로드 일시</th>
                      <th className="px-6 py-4 text-center">삭제</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50 text-sm">
                    {loading ? (
                       <tr><td colSpan={5} className="py-20 text-center"><RefreshCw className="animate-spin mx-auto text-emerald-500" size={32} /></td></tr>
                    ) : filteredDocs.map((doc) => (
                      <tr key={doc.name} className="hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            {extIcon(doc.extension)}
                            <span className="font-medium text-gray-900 dark:text-gray-200 truncate max-w-xs">{doc.name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-[10px] font-bold text-gray-500 uppercase">{doc.extension}</span>
                        </td>
                        <td className="px-6 py-4 text-right text-gray-500">{formatBytes(doc.size)}</td>
                        <td className="px-6 py-4 text-right text-gray-500">{formatDate(doc.modified)}</td>
                        <td className="px-6 py-4 text-center">
                          <button onClick={() => setConfirmDelete(doc)} className="p-2 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
               </table>
            </div>
          </>
        ) : activeTab === 'feedback' ? (
          /* QUALITY FEEDBACK ANALYTICS TAB */
          <div className="space-y-6">
            {/* 요약 지표 카드 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: '전체 피드백', value: `${feedbackStats?.total ?? feedbacks.length}건`, icon: <MessageSquare className="text-blue-500" /> },
                { label: '긍정', value: `${feedbackStats?.likes ?? feedbacks.filter(f => f.score > 0).length}건`, icon: <ThumbsUp className="text-green-500" /> },
                { label: '부정', value: `${feedbackStats?.dislikes ?? feedbacks.filter(f => f.score < 0).length}건`, icon: <ThumbsDown className="text-red-500" /> },
                { label: '만족도', value: `${feedbackStats?.total ? ((feedbackStats.likes / feedbackStats.total) * 100).toFixed(1) : 0}%`, icon: <CheckCircle2 className="text-emerald-500" /> },
              ].map((s, i) => (
                <div key={i} className="bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-800 rounded-2xl p-4">
                  <div className="flex items-center gap-3 mb-2">{s.icon}<p className="text-xs font-semibold text-gray-500">{s.label}</p></div>
                  <p className="text-2xl font-bold dark:text-white">{s.value}</p>
                </div>
              ))}
            </div>

            {/* 👍/👎 비율 바 + 날짜별 추이 */}
            {feedbackStats && feedbackStats.total > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 비율 바 */}
                <div className="bg-white dark:bg-[#1a1c1e] border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
                  <h3 className="font-bold text-gray-700 dark:text-gray-300 mb-4 text-sm flex items-center gap-1.5"><ThumbsUp size={13} className="text-emerald-500" /> / <ThumbsDown size={13} className="text-red-400" /> 비율</h3>
                  <div className="flex rounded-full overflow-hidden h-6 mb-2">
                    <div className="bg-emerald-400 transition-all flex items-center justify-center text-white text-xs font-bold"
                         style={{width: `${(feedbackStats.likes/feedbackStats.total*100).toFixed(0)}%`}}>
                      {(feedbackStats.likes/feedbackStats.total*100).toFixed(0)}%
                    </div>
                    <div className="bg-red-400 flex-1 flex items-center justify-center text-white text-xs font-bold">
                      {(feedbackStats.dislikes/feedbackStats.total*100).toFixed(0)}%
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span className="flex items-center gap-1"><ThumbsUp size={11} className="text-emerald-500" /> {feedbackStats.likes}건</span>
                    <span className="flex items-center gap-1"><ThumbsDown size={11} className="text-red-400" /> {feedbackStats.dislikes}건</span>
                  </div>
                </div>

                {/* 날짜별 추이 */}
                <div className="bg-white dark:bg-[#1a1c1e] border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
                  <h3 className="font-bold text-gray-700 dark:text-gray-300 mb-3 text-sm">최근 14일 피드백 추이</h3>
                  {feedbackStats.daily.length > 0 ? (
                    <ResponsiveContainer width="100%" height={80}>
                      <LineChart data={feedbackStats.daily}>
                        <Line type="monotone" dataKey="likes" stroke="#10b981" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="dislikes" stroke="#ef4444" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <p className="text-gray-400 text-xs text-center py-6">최근 14일 데이터 없음</p>}
                </div>
              </div>
            )}

            {/* 부정 평가 TOP 질문 + 사유 분포 */}
            {feedbackStats && (feedbackStats.top_disliked.length > 0 || feedbackStats.reasons.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* TOP 부정 질문 */}
                {feedbackStats.top_disliked.length > 0 && (
                  <div className="bg-white dark:bg-[#1a1c1e] border border-red-200 dark:border-red-900/40 rounded-2xl p-5">
                    <h3 className="font-bold text-red-600 dark:text-red-400 mb-3 text-sm flex items-center gap-2"><ThumbsDown size={14}/>부정 평가 많은 질문 TOP 5</h3>
                    <div className="space-y-2">
                      {feedbackStats.top_disliked.map((item: any, i: number) => (
                        <div key={i} className="flex justify-between items-center text-sm">
                          <span className="text-gray-700 dark:text-gray-300 truncate flex-1 mr-2">{item.question || '(질문 없음)'}</span>
                          <span className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0">{item.cnt}회</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 사유 분포 */}
                {feedbackStats.reasons.length > 0 && (
                  <div className="bg-white dark:bg-[#1a1c1e] border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
                    <h3 className="font-bold text-gray-700 dark:text-gray-300 mb-3 text-sm flex items-center gap-1.5"><ThumbsDown size={13} className="text-red-400" /> 사유 분포</h3>
                    <div className="space-y-2">
                      {feedbackStats.reasons.map((r: any, i: number) => {
                        const pct = feedbackStats.dislikes ? Math.round(r.cnt / feedbackStats.dislikes * 100) : 0;
                        return (
                          <div key={i}>
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-gray-600 dark:text-gray-400">{r.comment}</span>
                              <span className="font-bold text-gray-700 dark:text-gray-300">{r.cnt}건 ({pct}%)</span>
                            </div>
                            <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full bg-red-400 rounded-full" style={{width: `${pct}%`}} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Feedback List */}
            <div className="space-y-4">
              {loading ? (
                  <div className="py-20 text-center"><RefreshCw className="animate-spin mx-auto text-blue-500" size={32} /></div>
              ) : feedbacks.length === 0 ? (
                  <div className="py-32 text-center bg-white dark:bg-white/5 border border-dashed border-gray-300 dark:border-gray-700 rounded-3xl">
                     <MessageSquare size={48} className="mx-auto text-gray-300 mb-4" />
                     <p className="text-gray-500 font-medium tracking-tight text-lg">아직 수집된 피드백이 없습니다.</p>
                     <p className="text-gray-400 text-sm mt-1">사용자들이 답변에 따봉을 누르면 이곳에 쌓입니다.</p>
                  </div>
              ) : feedbacks.map((fb) => (
                <motion.div 
                  key={fb.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white dark:bg-[#1a1c1e] border border-gray-200 dark:border-gray-800 rounded-3xl p-6 shadow-sm hover:shadow-md transition-all group"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl ${fb.score > 0 ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                        {fb.score > 0 ? <ThumbsUp size={18} /> : <ThumbsDown size={18} />}
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 flex items-center gap-1.5 font-medium uppercase tracking-wider">
                          <Clock size={12} /> {new Date(fb.timestamp).toLocaleString('ko-KR')}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => setConfirmDeleteFeedback(fb)} className="p-2 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                       <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Question</p>
                       <p className="text-sm font-bold text-gray-800 dark:text-gray-200 leading-relaxed bg-gray-50 dark:bg-white/5 p-3 rounded-xl border border-gray-100 dark:border-gray-800/50">{fb.question}</p>
                    </div>
                    <div className="space-y-2">
                       <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">AI Answer</p>
                       <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed bg-blue-50/30 dark:bg-blue-900/10 p-3 rounded-xl border border-blue-100/50 dark:border-blue-900/30">{fb.answer}</p>
                    </div>
                  </div>

                  {fb.comment && (
                    <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl">
                       <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                         <AlertTriangle size={12} /> User's Reason for Thumbs Down
                       </p>
                       <p className="text-sm text-red-700 dark:text-red-300 italic">"{fb.comment}"</p>
                    </div>
                  )}
                  
                  {fb.sources && (
                    <div className="mt-4 pt-4 border-t border-gray-50 dark:border-gray-800/50">
                       <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                         <FileText size={10} /> Referenced Documents
                       </p>
                       <div className="flex flex-wrap gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                         {fb.sources.split('\n').map((s, i) => (
                           <span key={i} className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded-lg">{s}</span>
                         ))}
                       </div>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        ) : activeTab === 'usage' ? (
          /* ── 사용 통계 탭 ── */
          <div className="space-y-6">
            {/* 헤더 + 초기화 버튼 */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-gray-700 dark:text-gray-200 text-lg">사용 통계</h2>
                <p className="text-xs text-gray-400 mt-0.5">위젯 및 메인 챗봇의 누적 질의 데이터를 분석합니다.</p>
              </div>
              <button
                onClick={handleClearUsageStats}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 dark:text-red-400 border border-red-200 dark:border-red-800 transition-all"
              >
                <Trash2 size={13} />
                통계 초기화
              </button>
            </div>
            {/* 요약 카드 */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: '전체 누적 질문', value: `${usageStats?.total ?? 0}건`, icon: <MessageSquare className="text-orange-500" /> },
                { label: '오늘 질문', value: `${usageStats?.today ?? 0}건`, icon: <Activity className="text-blue-500" /> },
                { label: '이번 주 질문', value: `${usageStats?.this_week ?? 0}건`, icon: <CheckCircle2 className="text-emerald-500" /> },
              ].map((s, i) => (
                <div key={i} className="bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-2">{s.icon}<p className="text-xs font-semibold text-gray-500">{s.label}</p></div>
                  <p className="text-2xl font-bold dark:text-white">{s.value}</p>
                </div>
              ))}
            </div>

            {usageStats && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 최근 14일 일별 추이 */}
                <div className="bg-white dark:bg-[#1a1c1e] border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
                  <h3 className="font-bold text-gray-700 dark:text-gray-300 mb-3 text-sm flex items-center gap-2"><Activity size={14} className="text-orange-500"/>최근 14일 질문 추이</h3>
                  {usageStats.daily.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={100}>
                        <LineChart data={usageStats.daily}>
                          <Line type="monotone" dataKey="cnt" stroke="#f97316" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                      <div className="flex justify-between text-xs text-gray-400 mt-1">
                        <span>{usageStats.daily[0]?.day}</span>
                        <span>{usageStats.daily[usageStats.daily.length-1]?.day}</span>
                      </div>
                    </>
                  ) : <p className="text-gray-400 text-xs text-center py-8">데이터 없음</p>}
                </div>

                {/* 시간대별 분포 */}
                <div className="bg-white dark:bg-[#1a1c1e] border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
                  <h3 className="font-bold text-gray-700 dark:text-gray-300 mb-3 text-sm">시간대별 사용 패턴 (최근 30일)</h3>
                  {usageStats.hourly.length > 0 ? (
                    <div className="flex items-end gap-0.5 h-20">
                      {Array.from({length: 24}, (_, h) => {
                        const found = usageStats.hourly.find((r: any) => parseInt(r.hour) === h);
                        const cnt = found ? found.cnt : 0;
                        const max = Math.max(...usageStats.hourly.map((r: any) => r.cnt), 1);
                        const height = cnt ? Math.max(4, Math.round(cnt / max * 72)) : 2;
                        const isWork = h >= 9 && h <= 18;
                        return (
                          <div key={h} className="flex-1 flex flex-col items-center gap-0.5" title={`${h}시: ${cnt}건`}>
                            <div className={`w-full rounded-sm ${cnt > 0 ? (isWork ? 'bg-orange-400' : 'bg-orange-200 dark:bg-orange-900/40') : 'bg-gray-100 dark:bg-gray-800'}`}
                                 style={{height: `${height}px`}} />
                          </div>
                        );
                      })}
                    </div>
                  ) : <p className="text-gray-400 text-xs text-center py-8">데이터 없음</p>}
                  <div className="flex justify-between text-xs text-gray-400 mt-1"><span>0시</span><span>12시</span><span>23시</span></div>
                </div>
              </div>
            )}

            {/* TOP 10 자주 묻는 질문 */}
            {usageStats && usageStats.top_queries.length > 0 && (
              <div className="bg-white dark:bg-[#1a1c1e] border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
                <h3 className="font-bold text-gray-700 dark:text-gray-300 mb-4 text-sm flex items-center gap-2"><MessageSquare size={14} className="text-orange-500"/>자주 묻는 질문 TOP 10</h3>
                <div className="space-y-2">
                  {usageStats.top_queries.map((q: any, i: number) => {
                    const max = usageStats.top_queries[0]?.cnt || 1;
                    const pct = Math.round(q.cnt / max * 100);
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-xs font-bold text-gray-400 w-5 flex-shrink-0">{i+1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-700 dark:text-gray-300 truncate flex-1 mr-2">{q.query}</span>
                            <span className="font-bold text-orange-500 flex-shrink-0">{q.cnt}회</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full bg-orange-400 rounded-full transition-all" style={{width: `${pct}%`}} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {usageStats && usageStats.total === 0 && (
              <div className="py-32 text-center bg-white dark:bg-white/5 border border-dashed border-gray-300 dark:border-gray-700 rounded-3xl">
                <Activity size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500 font-medium text-lg">아직 질문 데이터가 없습니다.</p>
                <p className="text-gray-400 text-sm mt-1">위젯에서 질문이 들어오면 이곳에 통계가 쌓입니다.</p>
              </div>
            )}
          </div>

        ) : activeTab === 'ragtest' ? (
          /* ── RAG 검색 품질 테스트 탭 ── */
          <div className="space-y-5">

            {/* Zero-hits 빠른 테스트 */}
            {ragResults?.zero_hits?.length > 0 && (
              <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-2xl p-4">
                <p className="text-xs font-bold text-red-600 dark:text-red-400 mb-2 flex items-center gap-1.5">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  최근 검색 실패 쿼리 — 클릭하면 바로 테스트
                </p>
                <div className="flex flex-wrap gap-2">
                  {ragResults.zero_hits.map((q: string, i: number) => (
                    <button key={i} onClick={() => fetchRagTest(q)}
                      className="px-3 py-1.5 text-xs bg-white dark:bg-white/5 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 파라미터 패널 */}
            <div className="bg-white dark:bg-[#1a1c1e] border border-indigo-200 dark:border-indigo-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <SlidersHorizontal size={16} className="text-indigo-500" /> 검색 파라미터 튜닝
                </h2>
                {liveParams && (
                  <span className="text-[11px] text-gray-400 bg-gray-50 dark:bg-white/5 px-3 py-1 rounded-full border border-gray-200 dark:border-gray-700">
                    현재 실서비스: V={liveParams.vector_k} B={liveParams.bm25_k} K={liveParams.final_top_k} [{liveParams.mode}]
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'vector_k', label: '벡터 후보 수', min: 1, max: 50, color: 'accent-purple-500' },
                  { key: 'bm25_k',   label: 'BM25 후보 수', min: 1, max: 50, color: 'accent-green-500' },
                  { key: 'final_top_k', label: '최종 결과 수 (리랭킹)', min: 1, max: 10, color: 'accent-teal-500' },
                ].map(({ key, label, min, max, color }) => (
                  <div key={key} className={key === 'final_top_k' ? 'col-span-2' : ''}>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span className="font-semibold">{label}</span>
                      <span className="font-black text-gray-700 dark:text-gray-300">{(testParams as any)[key]}</span>
                    </div>
                    <input type="range" min={min} max={max} value={(testParams as any)[key]}
                      onChange={e => setTestParams(p => ({ ...p, [key]: Number(e.target.value) }))}
                      className={`w-full h-1.5 rounded-full ${color} cursor-pointer`} />
                    <div className="flex justify-between text-[10px] text-gray-300 mt-0.5"><span>{min}</span><span>{max}</span></div>
                  </div>
                ))}

                <div className="col-span-2">
                  <p className="text-xs font-semibold text-gray-500 mb-2">검색 모드</p>
                  <div className="flex gap-2">
                    {(['hybrid', 'vector', 'bm25'] as const).map(m => (
                      <button key={m} onClick={() => setTestParams(p => ({ ...p, mode: m }))}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${testParams.mode === m ? 'bg-indigo-500 text-white shadow-md' : 'bg-gray-100 dark:bg-white/5 text-gray-500 hover:bg-gray-200 dark:hover:bg-white/10'}`}>
                        {m === 'hybrid' ? 'Hybrid (V+B)' : m === 'vector' ? 'Vector only' : 'BM25 only'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-1 border-t border-gray-100 dark:border-gray-800">
                <button
                  onClick={() => { if (liveParams) setTestParams(liveParams); }}
                  className="text-xs font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                >
                  실서비스 값으로 초기화
                </button>
                <button
                  onClick={() => setTestParams({ vector_k: 20, bm25_k: 20, final_top_k: 7, mode: 'hybrid' })}
                  className="text-xs font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                >
                  기본값(20/20/7)으로
                </button>
                <button
                  onClick={handleApplySearchParams}
                  className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-500 hover:bg-indigo-600 text-white transition-all shadow-md shadow-indigo-500/20"
                >
                  <CheckCircle2 size={13} /> 실제 채팅에 적용
                </button>
              </div>
            </div>

            {/* 검색 입력 */}
            <div className="bg-white dark:bg-[#1a1c1e] border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
              <div className="flex gap-3">
                <input
                  value={ragQuery}
                  onChange={e => setRagQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && fetchRagTest()}
                  placeholder="테스트할 질문을 입력하세요..."
                  className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
                <button onClick={() => fetchRagTest()} disabled={ragLoading || !ragQuery.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-teal-500 hover:bg-teal-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-bold text-sm rounded-xl transition shadow-lg shadow-teal-500/20 disabled:shadow-none">
                  {ragLoading
                    ? <><svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>분석 중...</>
                    : <><Search size={15}/> 이 설정으로 테스트</>}
                </button>
              </div>
            </div>

            {/* 결과 영역 */}
            {ragResults && !ragLoading && (() => {
              // Diff 계산
              const diffMap = new Map<string, { diff: 'new'|'up'|'down'|'same'; prevRank?: number }>();
              let dropped: any[] = [];
              if (prevRagResults) {
                const prevRankMap = new Map<string, number>();
                prevRagResults.forEach(r => prevRankMap.set(`${r.filename}|${r.page_no}`, r.rank));
                const currKeys = new Set(ragResults.results.map((r: any) => `${r.filename}|${r.page_no}`));
                ragResults.results.forEach((r: any) => {
                  const key = `${r.filename}|${r.page_no}`;
                  const pr = prevRankMap.get(key);
                  diffMap.set(key, pr === undefined ? { diff: 'new' } : pr > r.rank ? { diff: 'up', prevRank: pr } : pr < r.rank ? { diff: 'down', prevRank: pr } : { diff: 'same', prevRank: pr });
                });
                dropped = prevRagResults.filter(r => !currKeys.has(`${r.filename}|${r.page_no}`));
              }
              const newCount  = [...diffMap.values()].filter(v => v.diff === 'new').length;
              const upCount   = [...diffMap.values()].filter(v => v.diff === 'up').length;
              const downCount = [...diffMap.values()].filter(v => v.diff === 'down').length;

              return (
                <div className="space-y-4">
                  {/* 적용된 파라미터 배너 */}
                  {ragResults.applied_params && (
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl text-xs text-indigo-700 dark:text-indigo-300 font-semibold">
                      <SlidersHorizontal size={13} className="flex-shrink-0" />
                      적용 설정: Vector={ragResults.applied_params.vector_k} · BM25={ragResults.applied_params.bm25_k} · Top={ragResults.applied_params.final_top_k} · [{ragResults.applied_params.mode}]
                      {prevRagResults && (
                        <span className="ml-auto flex items-center gap-2 font-bold">
                          {newCount > 0 && <span className="text-blue-600 dark:text-blue-400 flex items-center gap-0.5"><TrendingUp size={11}/>신규 {newCount}</span>}
                          {upCount > 0 && <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5"><TrendingUp size={11}/>상승 {upCount}</span>}
                          {downCount > 0 && <span className="text-orange-500 flex items-center gap-0.5"><TrendingDown size={11}/>하락 {downCount}</span>}
                          {dropped.length > 0 && <span className="text-red-500 flex items-center gap-0.5"><Minus size={11}/>탈락 {dropped.length}</span>}
                          {newCount === 0 && upCount === 0 && downCount === 0 && dropped.length === 0 && <span className="text-gray-400">이전과 동일</span>}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* 왼쪽: 검색 결과 */}
                    <div className="bg-white dark:bg-[#1a1c1e] border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-gray-700 dark:text-gray-300 text-sm flex items-center gap-2">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-teal-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          검색 결과
                        </h3>
                        <span className="text-xs text-gray-400">후보 {ragResults.total_candidates}개 → 최종 {ragResults.results.length}개</span>
                      </div>
                      <div className="space-y-2">
                        {ragResults.results.map((doc: any) => {
                          const key = `${doc.filename}|${doc.page_no}`;
                          const d = diffMap.get(key);
                          const isLow = doc.rerank_score < 50;
                          const sourceColor = doc.search_source === 'both' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' : doc.search_source === 'vector' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
                          const sourceLabel = doc.search_source === 'both' ? 'Both' : doc.search_source === 'vector' ? 'Vector' : 'BM25';
                          const diffBadge = d ? (
                            d.diff === 'new'  ? <span className="flex items-center gap-0.5 text-[9px] font-black text-blue-600 bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 rounded-full"><TrendingUp size={9}/>신규</span> :
                            d.diff === 'up'   ? <span className="flex items-center gap-0.5 text-[9px] font-black text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded-full"><TrendingUp size={9}/>{d.prevRank}→{doc.rank}</span> :
                            d.diff === 'down' ? <span className="flex items-center gap-0.5 text-[9px] font-black text-orange-500 bg-orange-100 dark:bg-orange-900/30 px-1.5 py-0.5 rounded-full"><TrendingDown size={9}/>{d.prevRank}→{doc.rank}</span> :
                            null
                          ) : null;
                          return (
                            <button key={doc.rank} onClick={() => { setSelectedRagDoc(doc); setParentExpanded(false); }}
                              className={`w-full text-left p-3 rounded-xl border transition hover:shadow-md ${isLow ? 'border-red-100 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/5' : 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-white/5'} hover:border-teal-300 dark:hover:border-teal-700`}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-xs font-black text-gray-400 w-4 flex-shrink-0">#{doc.rank}</span>
                                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">{doc.filename}</span>
                                  <span className="text-xs text-gray-400 flex-shrink-0">p.{doc.page_no}</span>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  {diffBadge}
                                  {doc.is_truncated && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-yellow-500"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${sourceColor}`}>{sourceLabel}</span>
                                  <span className={`text-xs font-bold ${isLow ? 'text-red-500' : 'text-teal-600 dark:text-teal-400'}`}>{doc.rerank_score}%</span>
                                </div>
                              </div>
                              <div className="mt-1.5 text-[11px] text-gray-400 truncate pl-6">{doc.child_content || doc.parent_content}</div>
                            </button>
                          );
                        })}
                      </div>

                      {/* 탈락 문서 */}
                      {dropped.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-dashed border-red-200 dark:border-red-900/40">
                          <p className="text-[10px] font-black text-red-500 mb-2 flex items-center gap-1"><Minus size={10}/>이전 결과에서 탈락</p>
                          {dropped.map((doc: any) => (
                            <div key={doc.rank} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 mb-1">
                              <span className="text-[10px] font-bold text-red-400 line-through">#{doc.rank}</span>
                              <span className="text-[11px] text-red-500 truncate">{doc.filename} p.{doc.page_no}</span>
                              <span className="ml-auto text-[10px] text-red-400 flex-shrink-0">{doc.rerank_score}%</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 오른쪽: LLM 생성 답변 */}
                    <div className="bg-white dark:bg-[#1a1c1e] border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
                      <h3 className="font-bold text-gray-700 dark:text-gray-300 text-sm flex items-center gap-2 mb-4">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        실제 생성 답변
                        <span className="ml-auto text-[10px] text-gray-400 font-normal">해당 파라미터 파이프라인 적용</span>
                      </h3>
                      <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap bg-gray-50 dark:bg-white/5 rounded-xl p-4 max-h-96 overflow-y-auto">
                        {ragResults.answer}
                      </div>
                      <p className="mt-3 text-[11px] text-gray-400 flex items-center gap-1">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                        검색 OK + 답변 이상 → 프롬프트 문제 / 검색 이상 + 답변 이상 → 파이프라인 문제
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* 빈 상태 */}
            {!ragResults && !ragLoading && (
              <div className="py-24 text-center bg-white dark:bg-white/5 border border-dashed border-gray-300 dark:border-gray-700 rounded-3xl">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto text-gray-300 mb-4"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6M8 11h6"/></svg>
                <p className="text-gray-500 font-medium">질문을 입력하고 검색을 실행하세요</p>
                <p className="text-gray-400 text-sm mt-1">어떤 문서가 검색되는지, 실제 답변은 어떻게 생성되는지 확인할 수 있습니다</p>
              </div>
            )}

            {/* 상세 모달 */}
            {selectedRagDoc && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setSelectedRagDoc(null)}>
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm"/>
                <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white dark:bg-[#1a1c1e] rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-800" onClick={e => e.stopPropagation()}>
                  <div className="p-6">
                    {/* 모달 헤더 */}
                    <div className="flex items-start justify-between mb-5">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-black text-gray-400">#{selectedRagDoc.rank}</span>
                          <span className="font-bold text-gray-800 dark:text-white text-sm">{selectedRagDoc.filename}</span>
                          <span className="text-xs text-gray-400">p.{selectedRagDoc.page_no}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-black ${selectedRagDoc.rerank_score < 50 ? 'text-red-500' : 'text-teal-600'}`}>{selectedRagDoc.rerank_score}% 관련도</span>
                          {selectedRagDoc.rank_change !== 0 && (
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${selectedRagDoc.rank_change > 0 ? 'bg-teal-100 text-teal-700' : 'bg-red-100 text-red-700'}`}>
                              리랭킹 {selectedRagDoc.rank_change > 0 ? `↑${selectedRagDoc.rank_change}` : `↓${Math.abs(selectedRagDoc.rank_change)}`} (전: {selectedRagDoc.pre_rerank_rank}위)
                            </span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => setSelectedRagDoc(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl transition">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>

                    {/* 검색 경로 + 청크 크기 */}
                    <div className="flex flex-wrap gap-2 mb-5">
                      <span className={`text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 ${selectedRagDoc.search_source === 'both' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' : selectedRagDoc.search_source === 'vector' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                        {selectedRagDoc.search_source === 'both' ? 'Vector + BM25 동시 히트' : selectedRagDoc.search_source === 'vector' ? 'Vector 검색 전용' : 'BM25 검색 전용'}
                      </span>
                      <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                        Child {selectedRagDoc.child_size}자 / Parent {selectedRagDoc.parent_size}자
                      </span>
                    </div>

                    {/* Child 청크 */}
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-teal-500"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                          검색된 청크 (Child) — 실제 검색에 사용
                        </span>
                        {selectedRagDoc.is_truncated && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 flex items-center gap-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
                            청크 절단 감지
                          </span>
                        )}
                      </div>
                      <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-4 text-xs text-gray-700 dark:text-gray-300 leading-relaxed max-h-48 overflow-y-auto">
                        {highlightKeywords(selectedRagDoc.child_content || selectedRagDoc.parent_content, ragResults?.query || '')}
                      </div>
                    </div>

                    {/* Parent 청크 (접이식) */}
                    <div>
                      <button onClick={() => setParentExpanded(!parentExpanded)}
                        className="flex items-center gap-2 text-xs font-bold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition mb-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${parentExpanded ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9"/></svg>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        부모 청크 (Parent) — LLM에 실제 전달되는 전체 맥락 {parentExpanded ? '접기' : '펼치기'}
                      </button>
                      {parentExpanded && (
                        <div className="bg-blue-50 dark:bg-blue-900/10 rounded-xl p-4 text-xs text-gray-700 dark:text-gray-300 leading-relaxed max-h-64 overflow-y-auto border border-blue-100 dark:border-blue-900/30">
                          {highlightKeywords(selectedRagDoc.parent_content, ragResults?.query || '')}
                        </div>
                      )}
                    </div>

                    {/* PDF 바로가기 */}
                    <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
                      <a href={`${API_BASE}/api/docs/${encodeURIComponent(selectedRagDoc.filename)}#page=${selectedRagDoc.page_no}`}
                        target="_blank" rel="noopener"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-300 rounded-xl text-xs font-bold transition">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        원본 PDF 해당 페이지 열기
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

        ) : activeTab === 'users' ? (
          /* ── 사용자 관리 탭 ── */
          <div className="space-y-6">
            <h2 className="text-xl font-bold dark:text-white flex items-center gap-2">
              <Users className="text-violet-500" /> 사용자 계정 관리
            </h2>

            {/* 승인 대기 섹션 */}
            {pendingUsers.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 rounded-3xl overflow-hidden">
                <div className="px-6 py-4 border-b border-amber-200 dark:border-amber-800/40 flex items-center gap-2">
                  <UserCheck size={16} className="text-amber-500" />
                  <span className="font-bold text-amber-700 dark:text-amber-400">승인 대기 ({pendingUsers.length})</span>
                  <span className="text-xs text-amber-600 dark:text-amber-500 ml-1">— 가입 신청한 사용자 목록</span>
                </div>
                <div className="divide-y divide-amber-100 dark:divide-amber-800/30">
                  {pendingUsers.map(u => (
                    <div key={u.id} className="flex items-center justify-between px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center bg-amber-400 text-white text-xs font-bold">
                          {u.username[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-sm text-gray-800 dark:text-gray-200">{u.username}</p>
                          <p className="text-xs text-gray-400">{new Date(u.created_at).toLocaleDateString('ko-KR')} 신청</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleApproveUser(u.username)}
                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white transition-all"
                        >
                          <Check size={12} /> 승인
                        </button>
                        <button
                          onClick={() => handleRejectUser(u.username)}
                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold bg-red-100 dark:bg-red-900/20 hover:bg-red-200 dark:hover:bg-red-900/30 text-red-600 transition-all"
                        >
                          <UserX size={12} /> 거절
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 신규 계정 생성 폼 */}
            <div className="bg-white dark:bg-[#1a1c1e] p-6 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm">
              <h3 className="font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-4">
                <UserPlus size={16} className="text-violet-500" /> 신규 계정 생성
              </h3>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-gray-500">아이디</label>
                  <input
                    type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)}
                    placeholder="아이디 입력"
                    className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-gray-500">비밀번호</label>
                  <input
                    type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                    placeholder="비밀번호 입력"
                    className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-gray-500">역할</label>
                  <select value={newRole} onChange={e => setNewRole(e.target.value as 'user' | 'admin')}
                    className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400">
                    <option value="user">일반 사용자</option>
                    <option value="admin">관리자</option>
                  </select>
                </div>
                <button
                  onClick={handleCreateUser} disabled={creatingUser || !newUsername.trim() || !newPassword.trim()}
                  className="flex items-center gap-2 px-5 py-2 bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-all"
                >
                  <UserPlus size={14} /> {creatingUser ? '생성 중...' : '계정 생성'}
                </button>
              </div>
            </div>

            {/* 사용자 목록 */}
            <div className="bg-white dark:bg-[#1a1c1e] rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
                <Users size={16} className="text-violet-500" />
                <span className="font-bold text-gray-700 dark:text-gray-300">등록된 계정 ({activeUsers.length})</span>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {activeUsers.map(u => (
                  <div key={u.id} className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${u.role === 'admin' ? 'bg-violet-500' : 'bg-blue-400'}`}>
                        {u.username[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm text-gray-800 dark:text-gray-200">{u.username}</p>
                          {u.display_name && <p className="text-sm text-gray-600 dark:text-gray-300">{u.display_name}</p>}
                        </div>
                        <p className="text-xs text-gray-400">
                          {u.dept && <span className="mr-2">{u.dept}</span>}
                          {new Date(u.created_at).toLocaleDateString('ko-KR')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1 ${u.role === 'admin' ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'}`}>
                        {u.role === 'admin' ? <Shield size={10} /> : <User size={10} />}
                        {u.role === 'admin' ? '관리자' : '일반 사용자'}
                      </span>
                      <button
                        onClick={() => handleChangeRole(u.username, u.role === 'admin' ? 'user' : 'admin')}
                        className="px-3 py-1 rounded-xl text-xs font-bold bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-all"
                      >
                        역할 전환
                      </button>
                      <button
                        onClick={() => handleToggleActive(u.username, !u.is_active)}
                        className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${u.is_active ? 'bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-600' : 'bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/30 text-orange-500'}`}
                      >
                        {u.is_active ? '정상' : '정지됨'}
                      </button>
                      {resetPasswordFor === u.username ? (
                        <div className="flex gap-1 items-center">
                          <input
                            type="password"
                            value={resetPasswordValue}
                            onChange={e => setResetPasswordValue(e.target.value)}
                            placeholder="새 비밀번호"
                            className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs w-28 focus:outline-none"
                          />
                          <button onClick={() => handleResetPassword(u.username)} className="px-2 py-1 rounded-lg text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 transition-all">확인</button>
                          <button onClick={() => { setResetPasswordFor(null); setResetPasswordValue(''); }} className="px-2 py-1 rounded-lg text-xs font-bold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 transition-all">취소</button>
                        </div>
                      ) : (
                        <button onClick={() => setResetPasswordFor(u.username)} className="px-3 py-1 rounded-xl text-xs font-bold bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 text-amber-600 transition-all">
                          <KeyRound size={12} />
                        </button>
                      )}
                      {confirmDeleteUser === u.username ? (
                        <div className="flex gap-1">
                          <button onClick={() => handleDeleteUser(u.username)} className="px-3 py-1 rounded-xl text-xs font-bold bg-red-500 text-white hover:bg-red-600 transition-all">삭제 확인</button>
                          <button onClick={() => setConfirmDeleteUser(null)} className="px-3 py-1 rounded-xl text-xs font-bold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 transition-all">취소</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDeleteUser(u.username)} className="px-3 py-1 rounded-xl text-xs font-bold bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-all">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {activeUsers.length === 0 && (
                  <div className="px-6 py-10 text-center text-sm text-gray-400">등록된 계정이 없습니다.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── 관리자 비밀번호 확인 모달 ── */}
      {pendingAction && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setPendingAction(null); setConfirmPw(''); setConfirmPwError(''); }}
          />
          <div className="relative w-full max-w-sm bg-white dark:bg-[#1a1c1e] rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-800 p-8 space-y-5">
            {/* 헤더 */}
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-2xl bg-red-100 dark:bg-red-900/30 flex-shrink-0">
                <AlertTriangle size={22} className="text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-gray-800 dark:text-gray-100 text-base">{pendingAction.label}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{pendingAction.desc}</p>
              </div>
            </div>

            {/* 비밀번호 입력 */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">관리자 비밀번호 확인</label>
              <input
                type="password"
                value={confirmPw}
                onChange={e => { setConfirmPw(e.target.value); setConfirmPwError(''); }}
                onKeyDown={e => e.key === 'Enter' && executeWithPassword()}
                placeholder="비밀번호를 입력하세요"
                autoFocus
                className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-black/30 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-400/40 focus:border-red-400 transition-all"
              />
              {confirmPwError && (
                <p className="text-xs text-red-500 flex items-center gap-1.5">
                  <X size={11} /> {confirmPwError}
                </p>
              )}
            </div>

            {/* 버튼 */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setPendingAction(null); setConfirmPw(''); setConfirmPwError(''); }}
                className="flex-1 py-3 rounded-xl font-bold text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 transition-all"
              >
                취소
              </button>
              <button
                onClick={executeWithPassword}
                disabled={confirmPwLoading || !confirmPw.trim()}
                className="flex-1 py-3 rounded-xl font-bold text-sm text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-500/25"
              >
                {confirmPwLoading ? '확인 중...' : '실행'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
