'use client';

import { useState } from 'react';
import { User, KeyRound, Loader2, Sparkles, CheckCircle2, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (username.trim().length < 2) {
      setError('아이디는 최소 2자 이상이어야 합니다.');
      return;
    }
    if (password.length < 4) {
      setError('비밀번호는 최소 4자 이상이어야 합니다.');
      return;
    }
    if (password !== confirmPassword) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (res.ok) {
        setDone(true);
      } else {
        setError(data.detail || '가입 신청 중 오류가 발생했습니다.');
      }
    } catch {
      setError('서버와 통신할 수 없습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
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
        <div className="absolute -inset-4 bg-gradient-to-r from-purple-600/20 to-blue-600/20 blur-3xl rounded-3xl pointer-events-none" />

        <div className="relative bg-white/5 backdrop-blur-2xl border border-white/10 p-10 rounded-3xl shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
          <div className="flex flex-col items-center mb-8">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.15, type: 'spring', stiffness: 200 }}
              className="w-16 h-16 bg-gradient-to-br from-violet-500 to-blue-500 rounded-2xl flex items-center justify-center mb-5 shadow-xl shadow-purple-500/30"
            >
              <Sparkles className="text-white w-8 h-8" />
            </motion.div>
            <h1 className="text-[28px] font-bold text-white tracking-tight">회원가입 신청</h1>
            <p className="text-gray-400 mt-1.5 text-sm">관리자 승인 후 로그인이 가능합니다</p>
          </div>

          <AnimatePresence mode="wait">
            {done ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-4 py-6"
              >
                <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                </div>
                <div className="text-center">
                  <p className="text-white font-bold text-lg">신청 완료!</p>
                  <p className="text-gray-400 text-sm mt-1">
                    관리자 승인 후 로그인하실 수 있습니다.
                  </p>
                </div>
                <Link
                  href="/login"
                  className="mt-2 flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 transition-all"
                >
                  <ArrowLeft className="w-4 h-4" />
                  로그인 페이지로
                </Link>
              </motion.div>
            ) : (
              <motion.form key="form" onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest ml-1">Username</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within:text-violet-400 transition-colors duration-200">
                      <User className="w-[18px] h-[18px]" />
                    </div>
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 bg-black/30 border border-white/8 rounded-xl text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/30 transition-all"
                      placeholder="사용할 아이디 (2자 이상)"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest ml-1">Password</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within:text-violet-400 transition-colors duration-200">
                      <KeyRound className="w-[18px] h-[18px]" />
                    </div>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 bg-black/30 border border-white/8 rounded-xl text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/30 transition-all"
                      placeholder="비밀번호 (4자 이상)"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest ml-1">Confirm Password</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within:text-violet-400 transition-colors duration-200">
                      <KeyRound className="w-[18px] h-[18px]" />
                    </div>
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 bg-black/30 border border-white/8 rounded-xl text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/30 transition-all"
                      placeholder="비밀번호 확인"
                    />
                  </div>
                </div>

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

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 w-full flex justify-center items-center gap-2 py-3.5 px-4 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-violet-500/25 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : '가입 신청하기'}
                </button>

                <div className="text-center pt-2">
                  <Link href="/login" className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center justify-center gap-1">
                    <ArrowLeft className="w-3 h-3" />
                    로그인으로 돌아가기
                  </Link>
                </div>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
