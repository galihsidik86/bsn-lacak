import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint, polygon as turfPolygon } from '@turf/helpers';
import { prisma } from '../db.js';
import { audit } from '../lib/audit.js';
import { enqueueNotification } from '../routes/notifications.js';
import { pushToUsers } from '../lib/webPush.js';

// Hasil cek geofence — caller boleh handle violation lebih lanjut
// (notifikasi, audit, dll).
export interface GeofenceCheck {
  hasZone: boolean;          // petugas punya wilayah binaan?
  inside: boolean;           // posisi di dalam salah satu wilayah?
  zonesChecked: number;      // berapa polygon yang di-evaluasi
}

interface PolygonShape {
  type?: string;
  coordinates?: number[][][] | unknown;
}

// Cek posisi terhadap polygon wilayah binaan petugas. Petugas dengan
// beberapa wilayah masuk "inside" kalau berada di salah satu polygon.
export async function checkPetugasGeofence(opts: {
  petugasId: string; lat: number; lng: number;
}): Promise<GeofenceCheck> {
  const polygons = await prisma.wilayah.findMany({
    where: { active: true, petugas: { some: { id: opts.petugasId } } },
    select: { polygon: true },
  });
  if (polygons.length === 0) return { hasZone: false, inside: false, zonesChecked: 0 };
  const pt = turfPoint([opts.lng, opts.lat]);
  let inside = false;
  for (const row of polygons) {
    const shape = row.polygon as PolygonShape;
    if (!shape || shape.type !== 'Polygon' || !Array.isArray(shape.coordinates)) continue;
    try {
      const pg = turfPolygon(shape.coordinates as number[][][]);
      if (booleanPointInPolygon(pt, pg)) { inside = true; break; }
    } catch { /* shape rusak — skip silently */ }
  }
  return { hasZone: true, inside, zonesChecked: polygons.length };
}

// Notifikasi geofence violation ke supervisor cabang petugas. Dedup
// per Attendance session (1 alert per sesi) supaya supervisor tidak
// di-bombard kalau petugas berkelana lama di luar zone.
const VIOLATION_ACTION = 'petugas.position.geofence_violation';

export async function notifyGeofenceViolation(opts: {
  petugasId: string; lat: number; lng: number;
}): Promise<{ notified: boolean; reason?: string }> {
  // Cari sesi aktif petugas (clock-in, belum clock-out).
  const session = await prisma.attendance.findFirst({
    where: { petugasId: opts.petugasId, clockOutAt: null },
    select: { id: true, branchId: true, clockInAt: true },
  });
  if (!session) return { notified: false, reason: 'no_active_session' };

  // Sudah dialerted di sesi ini? Skip.
  const existing = await prisma.auditLog.findFirst({
    where: { action: VIOLATION_ACTION, target: session.id },
    select: { id: true },
  });
  if (existing) return { notified: false, reason: 'already_alerted' };

  const petugas = await prisma.petugas.findUnique({
    where: { id: opts.petugasId },
    select: { kode: true, nama: true },
  });
  if (!petugas) return { notified: false, reason: 'petugas_not_found' };

  const supervisors = await prisma.user.findMany({
    where: { role: 'SUPERVISOR', branchId: session.branchId, active: true },
    select: { id: true },
  });
  const userIds = supervisors.map(u => u.id);

  await audit({
    action: VIOLATION_ACTION, target: session.id, // target = attendance session
    actor: null, actorId: null, ip: null, userAgent: null,
    meta: { petugasId: opts.petugasId, kode: petugas.kode, lat: opts.lat, lng: opts.lng },
  });

  if (userIds.length > 0) {
    const title = `Petugas keluar wilayah binaan`;
    const body = `${petugas.nama} (${petugas.kode}) berada di luar wilayah saat sesi lapangan.`;
    await enqueueNotification({
      userIds, type: 'petugas.geofence_violation',
      title, body, severity: 'WARN', link: 'tracking',
    }).catch(() => undefined);
    void pushToUsers(userIds, {
      title, body, link: '/#tracking', tag: `geofence-${session.id}`,
    });
  }
  return { notified: true };
}
