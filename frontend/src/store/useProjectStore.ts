'use client';

import { create } from 'zustand';
import { API_BASE } from '@/utils/config';

export interface ProjectFile {
  id: string;
  filename: string;
  status: 'indexing' | 'ready' | 'error';
  chunks_count: number;
  error: string | null;
  created_at?: string;
  progress?: number;     // 0~100 인덱싱 진행률
  stage?: string;        // '문서 분석 중' | '인덱싱 중 (3/14)' | '완료' 등
  startedAt?: number;    // 클라이언트 업로드 시작 시각(ms) — 경과시간 표시용
}

export interface ProjectMember {
  username: string;
  name: string;
  dept?: string | null;
  role: 'owner' | 'editor' | 'viewer';
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  instruction?: string;
  is_starred?: boolean;
  archived?: boolean;
  created_at?: string;
  updated_at?: string;
  files: ProjectFile[];
  my_role?: 'owner' | 'editor' | 'viewer';
  shared?: boolean;
  members?: ProjectMember[];
}

interface ProjectState {
  projects: Project[];
  isLoaded: boolean;
  loadProjects: () => Promise<void>;
  createProject: (name?: string, description?: string) => Promise<string>;
  renameProject: (id: string, name: string) => Promise<void>;
  updateProject: (id: string, fields: { name?: string; description?: string; is_starred?: boolean; archived?: boolean; instruction?: string }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  uploadFile: (projectId: string, file: File, mode?: string) => Promise<string | null>;
  deleteFile: (projectId: string, fileId: string) => Promise<void>;
  getProject: (id: string) => Project | undefined;
  inviteMember: (projectId: string, username: string, role: 'editor' | 'viewer') => Promise<void>;
  removeMember: (projectId: string, username: string) => Promise<void>;
  searchUsers: (q: string) => Promise<{ username: string; name: string; dept?: string | null }[]>;
}

const genId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  isLoaded: false,

  loadProjects: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/projects`, { credentials: 'include' });
      if (!res.ok) return;
      const data: Project[] = await res.json();
      set({ projects: data, isLoaded: true });
    } catch (e) {
      console.error('프로젝트 목록 로드 실패', e);
    }
  },

  createProject: async (name = '새 프로젝트', description = '') => {
    const id = genId();
    // 낙관적 추가(즉시 반영) — 단, id 중복 방지를 위해 기존에 같은 id가 없을 때만
    set((s) => (s.projects.some((p) => p.id === id)
      ? s
      : { projects: [{ id, name, description, is_starred: false, archived: false, files: [] }, ...s.projects] }));
    try {
      await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, description }),
      });
      // 서버 권위 목록으로 재동기화 → 낙관적 추가와의 불일치/유령 중복 제거
      await get().loadProjects();
    } catch (e) {
      console.error('프로젝트 생성 실패', e);
    }
    return id;
  },

  renameProject: async (id, name) => {
    await get().updateProject(id, { name });
  },

  updateProject: async (id, fields) => {
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...fields } : p)) }));
    try {
      await fetch(`${API_BASE}/api/projects/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
    } catch (e) {
      console.error('프로젝트 수정 실패', e);
    }
  },

  deleteProject: async (id) => {
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
    try {
      await fetch(`${API_BASE}/api/projects/${id}`, { method: 'DELETE', credentials: 'include' });
    } catch (e) {
      console.error('프로젝트 삭제 실패', e);
    }
  },

  uploadFile: async (projectId, file, mode = 'fast') => {
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/files?mode=${mode}`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `업로드 실패 (${res.status})`);
      }
      const data = await res.json();
      const fileId: string = data.file_id;
      // 목록에 indexing 상태로 즉시 추가
      set((s) => ({
        projects: s.projects.map((p) =>
          p.id === projectId
            ? { ...p, files: [...p.files, { id: fileId, filename: file.name, status: 'indexing', chunks_count: 0, error: null, progress: 0, stage: '업로드됨', startedAt: Date.now() }] }
            : p
        ),
      }));
      // 상태 폴링
      const poll = async () => {
        try {
          const r = await fetch(`${API_BASE}/api/projects/${projectId}/files/status/${fileId}`, { credentials: 'include' });
          if (!r.ok) return;
          const st = await r.json();
          set((s) => ({
            projects: s.projects.map((p) =>
              p.id === projectId
                ? { ...p, files: p.files.map((f) => (f.id === fileId ? { ...f, status: st.status, chunks_count: st.chunks_count, error: st.error, progress: st.progress ?? f.progress, stage: st.stage ?? f.stage } : f)) }
                : p
            ),
          }));
          if (st.status === 'indexing') setTimeout(poll, 2000);
        } catch { /* ignore */ }
      };
      setTimeout(poll, 1500);
      return fileId;
    } catch (e: any) {
      console.error('파일 업로드 실패', e);
      throw e;
    }
  },

  deleteFile: async (projectId, fileId) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId ? { ...p, files: p.files.filter((f) => f.id !== fileId) } : p
      ),
    }));
    try {
      await fetch(`${API_BASE}/api/projects/${projectId}/files/${fileId}`, { method: 'DELETE', credentials: 'include' });
    } catch (e) {
      console.error('파일 삭제 실패', e);
    }
  },

  getProject: (id) => get().projects.find((p) => p.id === id),

  inviteMember: async (projectId, username, role) => {
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/members`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, role }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `초대 실패 (${res.status})`);
      }
      await get().loadProjects();   // 멤버 목록 갱신
    } catch (e) {
      console.error('멤버 초대 실패', e);
      throw e;
    }
  },

  removeMember: async (projectId, username) => {
    set((s) => ({
      projects: s.projects.map((p) => p.id === projectId
        ? { ...p, members: (p.members || []).filter((m) => m.username !== username) }
        : p),
    }));
    try {
      await fetch(`${API_BASE}/api/projects/${projectId}/members/${encodeURIComponent(username)}`, {
        method: 'DELETE', credentials: 'include',
      });
    } catch (e) {
      console.error('멤버 제거 실패', e);
    }
  },

  searchUsers: async (q) => {
    if (!q.trim()) return [];
    try {
      const res = await fetch(`${API_BASE}/api/users/search?q=${encodeURIComponent(q.trim())}`, { credentials: 'include' });
      if (!res.ok) return [];
      const data = await res.json();
      return data.users || [];
    } catch {
      return [];
    }
  },
}));
