// Hook that streams the device's GPS position to the backend on a throttled
// schedule. Designed for the petugas mobile app — fires only when the user
// either moved a meaningful distance OR the cadence elapsed, so we don't
// spam the API while the petugas is at a stop.

import { useEffect, useRef } from 'react';
import axios from 'axios';
import { tokenStore } from './api';

const BASE = import.meta.env.VITE_API_URL || '/api';
const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false';

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

// Equirectangular approximation — accurate enough at metro-scale (~50m).
function distMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371_000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const x = dLng * Math.cos(lat);
  return Math.hypot(dLat, x) * R;
}

export function useGeolocationStream({
  petugasId,
  enabled = true,
  minDistanceMeters = 50,
  maxIntervalMs = 60_000,
}: Options) {
  const lastSent = useRef<LastSent | null>(null);

  useEffect(() => {
    if (!enabled || !petugasId) return;
    if (USE_MOCK) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    const send = async (lat: number, lng: number, accuracy: number | undefined) => {
      const tok = tokenStore.get();
      if (!tok) return;
      try {
        await axios.post(`${BASE}/petugas/${petugasId}/position`,
          { lat, lng, accuracy: accuracy ?? null },
          { withCredentials: true, headers: { Authorization: `Bearer ${tok}` } },
        );
        lastSent.current = { lat, lng, ts: Date.now() };
      } catch {
        // Swallow — next sample will retry. Avoid burning battery on a tight
        // failure loop by letting the throttle gate the next attempt.
      }
    };

    const onPosition = (p: GeolocationPosition) => {
      const { latitude: lat, longitude: lng, accuracy } = p.coords;
      const now = Date.now();
      const last = lastSent.current;
      if (last) {
        const moved = distMeters(last, { lat, lng });
        const aged = now - last.ts;
        if (moved < minDistanceMeters && aged < maxIntervalMs) return;
      }
      void send(lat, lng, accuracy);
    };

    const onError = (_err: GeolocationPositionError) => {
      // Don't spam audit — most errors are PERMISSION_DENIED or stale fixes.
      // Component is responsible for surfacing the permission UX.
    };

    const id = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 10_000,
      timeout: 20_000,
    });

    return () => navigator.geolocation.clearWatch(id);
  }, [petugasId, enabled, minDistanceMeters, maxIntervalMs]);
}
