import axios from 'axios';
import { tokenStore } from './api';

const BASE = import.meta.env.VITE_API_URL || '/api';

export interface Attendance {
  id: string;
  petugasId: string;
  branchId: string;
  clockInAt: string;
  clockInLat: number | null;
  clockInLng: number | null;
  clockOutAt: string | null;
  clockOutLat: number | null;
  clockOutLng: number | null;
  kmStart: number | null;
  kmEnd: number | null;
}

export interface MyAttendance {
  current: Attendance | null;
  today: Attendance[];
}

function authHeaders(): Record<string, string> {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function getMyAttendance(): Promise<MyAttendance> {
  return (await axios.get(`${BASE}/attendance/mine`, {
    withCredentials: true, headers: authHeaders(),
  })).data;
}

export async function clockIn(payload: { lat?: number; lng?: number; km?: number }): Promise<Attendance> {
  return (await axios.post(`${BASE}/attendance/clock-in`, payload, {
    withCredentials: true, headers: authHeaders(),
  })).data;
}

export async function clockOut(payload: { lat?: number; lng?: number; km?: number }): Promise<Attendance> {
  return (await axios.post(`${BASE}/attendance/clock-out`, payload, {
    withCredentials: true, headers: authHeaders(),
  })).data;
}

export async function listTodayAttendance(): Promise<Array<Attendance & {
  petugas: { id: string; kode: string; nama: string; inisial: string; hue: number; wilayah: string };
  branch: { kode: string; nama: string };
}>> {
  const headers: Record<string, string> = { ...authHeaders() };
  // branch-override is set by app when admin picks a branch in switcher; this
  // file is also imported by mobile path (petugas only), so reading from
  // window is fine — we don't pull the auth store here to keep the lib lean.
  try {
    const o = localStorage.getItem('bsn_branch_override');
    if (o) headers['x-branch-id'] = o;
  } catch { /* private mode */ }
  return (await axios.get(`${BASE}/attendance/today`, {
    withCredentials: true, headers,
  })).data;
}
