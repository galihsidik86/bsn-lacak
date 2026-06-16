import axios from 'axios';
import { tokenStore } from './api';

const BASE = import.meta.env.VITE_API_URL || '/api';

export interface ZonePolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface ZoneInfo {
  id: string;
  nama: string;
  polygon: ZonePolygon;
}

function authHeaders(): Record<string, string> {
  const t = tokenStore.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function getMyZone(): Promise<{ zone: ZoneInfo | null }> {
  return (await axios.get(`${BASE}/wilayah/mine/zone`, {
    withCredentials: true, headers: authHeaders(),
  })).data;
}

// Lightweight ray-casting point-in-polygon for the live "Anda di dalam zona?"
// indicator on the mobile beranda. Same algorithm turf uses on the server.
export function pointInPolygon(lat: number, lng: number, poly: ZonePolygon): boolean {
  const ring = poly.coordinates[0];
  if (!ring) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
