'use client';

import { useState } from 'react';
import { Lock, User, KeyRound, Loader2, Sparkles, UserPlus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        // 쿠키를 브라우저가 완전히 저장한 후 강제 새로고침으로 홈으로 이동
        window.location.replace('/');
      } else {
        const data = await res.json();
        setError(data.message || '아이디 또는 비밀번호가 올바르지 않습니다.');
      }
    } catch (err) {
      setError('서버와 통신할 수 없습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    // fixed + inset-0 으로 sidebar/wrapper를 완전히 덮어서 로그인 전용 전체화면 구현
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0d1117]"
      style={{
        background: 'radial-gradient(ellipse 80% 80% at 50% -20%, rgba(120,119,198,0.2), #0d1117)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md px-6 relative z-10"
      >
        {/* 글로우 배경 */}
        <div className="absolute -inset-4 bg-gradient-to-r from-purple-600/20 to-blue-600/20 blur-3xl rounded-3xl pointer-events-none" />

        <div className="relative bg-white/5 backdrop-blur-2xl border border-white/10 p-10 rounded-3xl shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
          {/* 로고 영역 */}
          <div className="flex flex-col items-center mb-10">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.15, type: 'spring', stiffness: 200 }}
              className="w-16 h-16 bg-gradient-to-br from-violet-500 to-blue-500 rounded-2xl flex items-center justify-center mb-5 shadow-xl shadow-purple-500/30"
            >
              <Sparkles className="text-white w-8 h-8" />
            </motion.div>
            <h1 className="text-[28px] font-bold text-white tracking-tight">DY HR Chatbot</h1>
            <p className="text-gray-400 mt-1.5 text-sm">사내 전용 지식베이스에 접속합니다</p>
          </div>

          {/* 폼 */}
          <form onSubmit={handleLogin} className="space-y-4">
            {/* 아이디 */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest ml-1">Username</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within:text-violet-400 transition-colors duration-200">
                  <User className="w-[18px] h-[18px]" />
                </div>
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 bg-black/30 border border-white/8 rounded-xl text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/30 transition-all"
                  placeholder="사내 아이디를 입력하세요"
                />
              </div>
            </div>

            {/* 비밀번호 */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest ml-1">Password</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within:text-violet-400 transition-colors duration-200">
                  <KeyRound className="w-[18px] h-[18px]" />
                </div>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 bg-black/30 border border-white/8 rounded-xl text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/30 transition-all"
                  placeholder="비밀번호를 입력하세요"
                />
              </div>
            </div>

            {/* 에러 메시지 */}
            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="text-red-400 text-xs text-center py-2 px-3 bg-red-500/10 rounded-lg border border-red-500/20"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            {/* 로그인 버튼 */}
            <button
              type="submit"
              disabled={loading}
              className="mt-4 w-full flex justify-center items-center gap-2 py-3.5 px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-violet-500/25 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  보안 접속
                </>
              )}
            </button>

            {/* 회원가입 링크 */}
            <div className="pt-2 border-t border-white/8 mt-4">
              <Link
                href="/register"
                className="w-full flex justify-center items-center gap-2 py-3 px-4 rounded-xl text-sm font-medium text-gray-400 hover:text-gray-200 bg-white/5 hover:bg-white/10 border border-white/8 hover:border-white/15 transition-all"
              >
                <UserPlus className="w-4 h-4" />
                계정이 없으신가요? 회원가입 신청
              </Link>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
