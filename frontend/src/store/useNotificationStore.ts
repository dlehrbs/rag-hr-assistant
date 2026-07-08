'use client';

import { create } from 'zustand';
import { API_BASE } from '@/utils/config';

export interface Notification {
  id: string;
  type: string;
  project_id: string | null;
  message: string;
  read: boolean;
  created_at: string;
}

interface NotificationState {
  items: Notification[];
  unreadCount: number;
  load: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unreadCount: 0,

  load: async () => {
    try {
      const res = await fetch(`${API_BASE}/api/notifications`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      set({ items: data.items || [], unreadCount: data.unread_count || 0 });
    } catch (e) {
      console.error('알림 로드 실패', e);
    }
  },

  markRead: async (id) => {
    set((s) => ({
      items: s.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
      unreadCount: Math.max(0, s.unreadCount - (s.items.find((n) => n.id === id && !n.read) ? 1 : 0)),
    }));
    try {
      await fetch(`${API_BASE}/api/notifications/${id}/read`, { method: 'PATCH', credentials: 'include' });
    } catch (e) {
      console.error('알림 읽음 처리 실패', e);
    }
  },

  markAllRead: async () => {
    set((s) => ({ items: s.items.map((n) => ({ ...n, read: true })), unreadCount: 0 }));
    try {
      await fetch(`${API_BASE}/api/notifications/read-all`, { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.error('전체 읽음 처리 실패', e);
    }
  },
}));
