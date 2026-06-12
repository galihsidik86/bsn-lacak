import { create } from 'zustand';
import axios from 'axios';
import { tokenStore } from './api';

const BASE = import.meta.env.VITE_API_URL || '/api';
const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false';

export type Role = 'SUPERVISOR' | 'PETUGAS' | 'ADMIN';

interface User {
  id?: string;
  username?: string;
  nama: string;
  role: Role;
  petugasId?: string | null;
  mustChangePassword?: boolean;
}

interface AuthState {
  user: User | null;
  bootstrapped: boolean;
  setUser: (u: User | null) => void;
  setBootstrapped: (b: boolean) => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  bootstrapped: false,
  setUser: (user) => set({ user }),
  setBootstrapped: (bootstrapped) => set({ bootstrapped }),
}));

export interface LoginResult { mustChangePassword: boolean }

export async function doLogin(username: string, password: string): Promise<LoginResult> {
  if (USE_MOCK) {
    const role: Role = username === 'supervisor' ? 'SUPERVISOR' : 'PETUGAS';
    tokenStore.set('mock.' + btoa(JSON.stringify({ u: username, t: Date.now() })));
    useAuth.getState().setUser({ username, nama: username, role, mustChangePassword: false });
    return { mustChangePassword: false };
  }
  const { data } = await axios.post(`${BASE}/auth/login`, { username, password }, { withCredentials: true });
  tokenStore.set(data.token);
  useAuth.getState().setUser({
    nama: data.nama, role: data.role, username,
    mustChangePassword: !!data.mustChangePassword,
  });
  return { mustChangePassword: !!data.mustChangePassword };
}

export async function doLogout() {
  try {
    if (!USE_MOCK) await axios.post(`${BASE}/auth/logout`, {}, {
      withCredentials: true,
      headers: tokenStore.get() ? { Authorization: `Bearer ${tokenStore.get()}` } : {},
    });
  } catch { /* ignore */ }
  tokenStore.clear();
  useAuth.getState().setUser(null);
}

export async function fetchMe(): Promise<User | null> {
  if (USE_MOCK) return null;
  try {
    const { data } = await axios.get(`${BASE}/auth/me`, {
      withCredentials: true,
      headers: tokenStore.get() ? { Authorization: `Bearer ${tokenStore.get()}` } : {},
    });
    return data;
  } catch {
    return null;
  }
}

export async function changePassword(currentPassword: string, newPassword: string) {
  if (USE_MOCK) {
    useAuth.getState().setUser({ ...(useAuth.getState().user ?? { nama: 'User', role: 'SUPERVISOR' as Role }), mustChangePassword: false });
    return { ok: true };
  }
  const { data } = await axios.post(
    `${BASE}/auth/change-password`,
    { currentPassword, newPassword },
    {
      withCredentials: true,
      headers: tokenStore.get() ? { Authorization: `Bearer ${tokenStore.get()}` } : {},
    },
  );
  return data;
}
