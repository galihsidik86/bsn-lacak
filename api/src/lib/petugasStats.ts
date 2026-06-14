// Computes per-petugas operational stats for "today" in one round-trip.
// Used by the /api/petugas list endpoint so the frontend dashboard doesn't
// need a separate stats query per row.

import { prisma } from '../db.js';

export interface PetugasStats {
  terkumpul: number;     // sum of pembayaran nominal nasabah-binaan today
  kunjungan: number;     // count of kunjungan today
  rencana: number;       // total nasabah binaan
  mulai: string | null;  // earliest position recorded today (HH:mm) or null
  terakhir: string;      // humanized last activity ("3 menit lalu" / "—")
  lat: number | null;
  lng: number | null;
}

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatTime(d: Date): string {
  return d.toTimeString().slice(0, 5);
}

function humanizeAgo(d: Date | null): string {
  if (!d) return '—';
  const diff = Math.max(0, Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'baru saja';
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return `${Math.floor(diff / 86400)} hari lalu`;
}

export async function computeStatsFor(petugasIds: string[]): Promise<Map<string, PetugasStats>> {
  const out = new Map<string, PetugasStats>();
  if (petugasIds.length === 0) return out;

  // Seed defaults so even petugas with zero activity get a complete record.
  for (const id of petugasIds) {
    out.set(id, { terkumpul: 0, kunjungan: 0, rencana: 0, mulai: null, terakhir: '—', lat: null, lng: null });
  }

  const start = todayStart();

  // 1. Today's pembayaran sum joined back to petugasId via nasabah.
  const pay = await prisma.$queryRaw<Array<{ petugasId: string; total: bigint }>>`
    SELECT n."petugasId" as "petugasId",
           COALESCE(SUM(p."nominal"), 0)::bigint AS "total"
    FROM "Pembayaran" p
    JOIN "Nasabah" n ON n."id" = p."nasabahId"
    WHERE p."tanggal" >= ${start} AND n."petugasId" = ANY(${petugasIds})
    GROUP BY n."petugasId"
  `;
  for (const r of pay) {
    const s = out.get(r.petugasId);
    if (s) s.terkumpul = Number(r.total);
  }

  // 2. Today's kunjungan count.
  const visits = await prisma.kunjungan.groupBy({
    by: ['petugasId'],
    where: { petugasId: { in: petugasIds }, tanggal: { gte: start } },
    _count: { _all: true },
  });
  for (const v of visits) {
    const s = out.get(v.petugasId);
    if (s) s.kunjungan = v._count._all;
  }

  // 3. Rencana = nasabah yang perlu dikunjungi minggu ini (jatuh tempo
  // dalam 7 hari ke depan ATAU sudah lewat tempo). Bukan jumlah binaan total —
  // itu salah-konsep yang bikin angka "kunjungan/rencana" jadi misleading.
  const rencanaCounts = await prisma.nasabah.groupBy({
    by: ['petugasId'],
    where: { petugasId: { in: petugasIds }, dueIn: { lte: 7 } },
    _count: { _all: true },
  });
  for (const n of rencanaCounts) {
    const s = out.get(n.petugasId);
    if (s) s.rencana = n._count._all;
  }

  // 4. Earliest + latest position today per petugas, plus latest coords.
  // Postgres pattern: aggregate min(recordedAt) plus latest row via ORDER + DISTINCT ON.
  const earliest = await prisma.petugasPosition.groupBy({
    by: ['petugasId'],
    where: { petugasId: { in: petugasIds }, recordedAt: { gte: start } },
    _min: { recordedAt: true },
  });
  for (const e of earliest) {
    const s = out.get(e.petugasId);
    if (s && e._min.recordedAt) s.mulai = formatTime(e._min.recordedAt);
  }

  const latest = await prisma.$queryRaw<Array<{ petugasId: string; lat: number; lng: number; recordedAt: Date }>>`
    SELECT DISTINCT ON ("petugasId") "petugasId", "lat", "lng", "recordedAt"
    FROM "PetugasPosition"
    WHERE "petugasId" = ANY(${petugasIds})
    ORDER BY "petugasId", "recordedAt" DESC
  `;
  for (const l of latest) {
    const s = out.get(l.petugasId);
    if (s) {
      s.lat = l.lat;
      s.lng = l.lng;
      s.terakhir = humanizeAgo(l.recordedAt);
    }
  }

  return out;
}
