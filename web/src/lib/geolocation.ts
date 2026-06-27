// Hook that streams the device's GPS position to the backend on a throttled
// schedule. Designed for the petugas mobile app — fires only when the user
// either moved a meaningful distance OR the cadence elapsed, so we don't
// spam the API while the petugas is at a stop.
//
// Dual runtime:
//  - Browser PWA: navigator.geolocation.watchPosition. Browser akan
//    suspend tab saat layar mati → cakupan ~70-85%.
//  - Capacitor native (Android APK): plugin BackgroundGeolocation jalan
//    di foreground service. GPS tetap aktif walau layar mati / app
//    background → cakupan ~95-99%.

import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';
import { tokenStore } from './api';

const BASE = import.meta.env.VITE_API_URL || '/api';
const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false';

// registerPlugin selalu return Proxy yang aman dipanggil di web — call
// site yang invoke method-nya yang akan reject di non-native platform.
// Maka kita gate pemakaian via Capacitor.isNativePlatform().
const BgGeo = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');
const isNative = Capacitor.isNativePlatform();

interface Options {
  petugasId: string | null | undefined;
  enabled?: boolean;
  // Minimum movement to trigger a send when a position arrives early (m).
  minDistanceMeters?: number;
  // Maximum gap between sends regardless of movement (ms).
  maxIntervalMs?: number;
}

interface LastSent {
  lat: number;
  lng: number;
  ts: number;
}

// Retry queue untuk ping yang gagal POST (offline, network error, timeout).
// localStorage cukup karena payload kecil + frekuensi tinggi; IDB overkill.
// Setiap item drop saat sukses replay atau saat >24 jam (basi, supervisor
// tidak butuh trail GPS hari kemarin yang baru sampai sekarang).
interface QueuedPing { lat: number; lng: number; accuracy: number | null; ts: number }
const QUEUE_KEY = 'bsn-lacak:position-queue';
const QUEUE_MAX = 500; // ±8 jam jam kerja × 60 ping/jam max — cap supaya tidak overflow storage.
const QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function loadQueue(): QueuedPing[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedPing[];
    const cutoff = Date.now() - QUEUE_MAX_AGE_MS;
    return Array.isArray(parsed) ? parsed.filter(p => p.ts >= cutoff) : [];
  } catch { return []; }
}
function saveQueue(q: QueuedPing[]) {
  try {
    const trimmed = q.length > QUEUE_MAX ? q.slice(-QUEUE_MAX) : q;
    localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
  } catch { /* quota — drop silently, real-time pings prioritas */ }
}
function enqueue(p: QueuedPing) {
  const q = loadQueue();
  q.push(p);
  saveQueue(q);
}

// Equirectangular approximation — accurate enough at metro-scale (~50m).
function distMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371_000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const x = dLng * Math.cos(lat);
  return Math.hypot(dLat, x) * R;
}

export interface GeoFix {
  lat: number;
  lng: number;
  accuracy: number | null;
  ts: number;
}

// Status GPS yang surface ke UI petugas — supaya mereka tahu kalau fix
// mereka jelek tanpa harus tanya supervisor.
export type GeoStatus =
  | 'idle'         // belum aktif (belum clock-in / petugasId belum siap)
  | 'waiting'     // diaktifkan, belum dapat fix pertama
  | 'precise'     // accuracy <= 50m, GPS chip sehat
  | 'moderate'    // 50-200m, masih ok untuk visit verification
  | 'poor'        // 200-500m, mulai meragukan
  | 'coarse'      // > 500m, ditolak backend, kemungkinan IP-based
  | 'denied'      // user tolak izin lokasi
  | 'unavailable' // device tidak punya geolocation / kegagalan lain
  | 'timeout';    // tidak dapat fix dalam window

// Ambang harus selaras dengan backend `MAX_POSITION_ACCURACY_M = 500`.
const COARSE_THRESHOLD_M = 500;

function classifyAccuracy(acc: number | null): GeoStatus {
  if (acc == null) return 'waiting';
  if (acc <= 50) return 'precise';
  if (acc <= 200) return 'moderate';
  if (acc <= COARSE_THRESHOLD_M) return 'poor';
  return 'coarse';
}

export function useGeolocationStream({
  petugasId,
  enabled = true,
  minDistanceMeters = 50,
  maxIntervalMs = 60_000,
}: Options): { latest: GeoFix | null; status: GeoStatus } {
  const lastSent = useRef<LastSent | null>(null);
  const [latest, setLatest] = useState<GeoFix | null>(null);
  const [status, setStatus] = useState<GeoStatus>('idle');

  useEffect(() => {
    if (!enabled) { setStatus('idle'); return; }
    if (!isNative && (typeof navigator === 'undefined' || !navigator.geolocation)) {
      setStatus('unavailable');
      return;
    }
    setStatus('waiting');

    const send = async (lat: number, lng: number, accuracy: number | null, captureTs: number) => {
      // Backend POST is gated on having a real petugasId AND not being in
      // mock mode — UI position tracking runs regardless so the route
      // ordering still works in dev/preview.
      if (USE_MOCK || !petugasId) return;
      const tok = tokenStore.get();
      if (!tok) return;
      try {
        await axios.post(`${BASE}/petugas/${petugasId}/position`,
          { lat, lng, accuracy, clientTs: captureTs },
          { withCredentials: true, headers: { Authorization: `Bearer ${tok}` } },
        );
        lastSent.current = { lat, lng, ts: captureTs };
      } catch {
        // POST gagal (offline / network error / timeout). Buffer ke
        // localStorage queue; drain handler bawah akan replay saat
        // online/focus. Hindari burn battery di tight loop — throttle
        // ngatur cadence retry berikutnya.
        enqueue({ lat, lng, accuracy, ts: captureTs });
      }
    };

    // Drain queue: POST batch ping yang ter-buffer saat offline. Dipanggil
    // saat mount (kalau ada residu dari sesi sebelumnya), saat online
    // event fire, dan saat tab regain focus.
    const drain = async () => {
      if (USE_MOCK || !petugasId) return;
      const tok = tokenStore.get();
      if (!tok) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const q = loadQueue();
      if (q.length === 0) return;
      const remaining: QueuedPing[] = [];
      for (const p of q) {
        try {
          // Forward clientTs supaya server menyimpan recordedAt sesuai
          // waktu capture asli (saat ping di-enqueue), bukan waktu
          // drain. Tanpa ini polyline trail menumpuk di 1 menit waktu
          // drain dan kehilangan timing kronologis.
          await axios.post(`${BASE}/petugas/${petugasId}/position`,
            { lat: p.lat, lng: p.lng, accuracy: p.accuracy, clientTs: p.ts },
            { withCredentials: true, headers: { Authorization: `Bearer ${tok}` } },
          );
        } catch {
          // Pertama gagal → stop, simpan sisanya kembali ke queue supaya
          // attempt selanjutnya tidak hammer endpoint yang lagi error.
          remaining.push(p, ...q.slice(q.indexOf(p) + 1));
          break;
        }
      }
      saveQueue(remaining);
    };
    void drain();
    const onlineHandler = () => { void drain(); };
    const focusHandler = () => { void drain(); };
    window.addEventListener('online', onlineHandler);
    window.addEventListener('focus', focusHandler);

    // Common path setelah fix tiba — throttle, classify, POST.
    const handleFix = (lat: number, lng: number, accuracy: number | null) => {
      const now = Date.now();
      setLatest({ lat, lng, accuracy, ts: now });
      setStatus(classifyAccuracy(accuracy));
      const last = lastSent.current;
      if (last) {
        const moved = distMeters(last, { lat, lng });
        const aged = now - last.ts;
        if (moved < minDistanceMeters && aged < maxIntervalMs) return;
      }
      void send(lat, lng, accuracy, now);
    };

    // --- Native path: foreground service via Capacitor plugin ---
    if (isNative) {
      let watcherId: string | null = null;
      let cancelled = false;
      BgGeo.addWatcher(
        {
          // backgroundMessage non-empty = plugin start foreground service
          // & show notifikasi. Tanpa ini GPS hanya jalan saat foreground.
          backgroundMessage: 'GPS petugas dipantau supervisor. Tap untuk kembali.',
          backgroundTitle: 'BSN Lacak — Tracking aktif',
          requestPermissions: true,
          stale: false,
          // Plugin punya server-side throttle sendiri; biarkan 0 supaya
          // semua fix masuk dan throttle JS yang putuskan POST/skip.
          // Ini bikin status badge UI tetap update meski jarak < 50m.
          distanceFilter: 0,
        },
        (position, err) => {
          if (cancelled) return;
          if (err) {
            const code = err.code ?? '';
            if (code === 'NOT_AUTHORIZED' || code === 'PERMISSION_DENIED') setStatus('denied');
            else setStatus('unavailable');
            return;
          }
          if (!position) return;
          handleFix(position.latitude, position.longitude, position.accuracy ?? null);
        },
      ).then(id => {
        if (cancelled) {
          void BgGeo.removeWatcher({ id });
        } else {
          watcherId = id;
        }
      }).catch(() => {
        if (!cancelled) setStatus('unavailable');
      });

      return () => {
        cancelled = true;
        if (watcherId) void BgGeo.removeWatcher({ id: watcherId });
        window.removeEventListener('online', onlineHandler);
        window.removeEventListener('focus', focusHandler);
      };
    }

    // --- Web path: standard browser geolocation watch ---
    const onPosition = (p: GeolocationPosition) => {
      const { latitude: lat, longitude: lng, accuracy } = p.coords;
      handleFix(lat, lng, accuracy ?? null);
    };

    const onError = (err: GeolocationPositionError) => {
      // Surface kategori error spesifik supaya badge UI bisa kasih hint
      // yang actionable ("buka pengaturan izin" vs "GPS unavailable").
      if (err.code === err.PERMISSION_DENIED) setStatus('denied');
      else if (err.code === err.TIMEOUT) setStatus('timeout');
      else setStatus('unavailable');
    };

    const id = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 10_000,
      timeout: 20_000,
    });

    return () => {
      navigator.geolocation.clearWatch(id);
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('focus', focusHandler);
    };
  }, [petugasId, enabled, minDistanceMeters, maxIntervalMs]);

  return { latest, status };
}
