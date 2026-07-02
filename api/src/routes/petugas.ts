import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import { bus } from '../lib/events.js';
import { computeStatsFor } from '../lib/petugasStats.js';
import { computePetugasPerformance } from '../lib/petugasPerformance.js';
import { evalSpeed } from '../lib/antiFraud.js';
import { checkPetugasGeofence, notifyGeofenceViolation } from '../lib/geofence.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const branchId = scopedBranchId(req);
  const includeInactive = String(req.query.includeInactive) === '1';
  const list = await prisma.petugas.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(includeInactive ? {} : { active: true }),
    },
    orderBy: { kode: 'asc' },
  });
  const stats = await computeStatsFor(list.map(p => p.id));
  res.json(list.map(p => ({ ...p, ...(stats.get(p.id) ?? {}) })));
});

// Per-petugas performance rollup (SUPERVISOR + ADMIN). Returns approval /
// rejection / risk metrics over the configurable window (default 30 days).
// Mount before `/:id` so 'performance' is not consumed as an id.
router.get('/performance', async (req, res) => {
  if (req.user?.role === 'PETUGAS') return res.status(403).json({ error: 'forbidden' });
  const branchId = scopedBranchId(req);
  const days = Number.parseInt(String(req.query.days ?? '30'), 10);
  const window = Number.isFinite(days) && days > 0 && days <= 365 ? days : 30;
  const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);
  const rows = await computePetugasPerformance({
    branchId: branchId === null ? null : branchId,
    since,
  });
  res.json({ since: since.toISOString(), windowDays: window, rows });
});

// Latest position per active petugas — used by Tracking screen to bootstrap
// `livePositions` on mount so the map shows real coords immediately instead
// of waiting up to 60s for the next SSE ping. Branch-scoped, freshness cap
// keeps stale-but-recorded pings (e.g. from this morning) from being shown
// as "live". Mount BEFORE `/:id` so the path isn't consumed.
router.get('/positions/latest', async (req, res) => {
  const branchId = scopedBranchId(req);
  const maxAgeHours = Number.parseInt(String(req.query.maxAgeHours ?? '12'), 10);
  const since = new Date(Date.now() - (Number.isFinite(maxAgeHours) ? maxAgeHours : 12) * 60 * 60 * 1000);

  const petugas = await prisma.petugas.findMany({
    where: { active: true, ...(branchId ? { branchId } : {}) },
    select: { id: true },
  });
  const ids = petugas.map(p => p.id);
  if (ids.length === 0) return res.json([]);

  // DISTINCT ON (petugasId) ORDER BY recordedAt DESC returns latest ping per
  // petugas in one query — cheaper than N findFirst calls.
  const rows = await prisma.$queryRaw<Array<{
    petugasId: string; lat: number; lng: number; accuracy: number | null; recordedAt: Date;
  }>>`
    SELECT DISTINCT ON ("petugasId") "petugasId", "lat", "lng", "accuracy", "recordedAt"
    FROM "PetugasPosition"
    WHERE "petugasId" = ANY(${ids}) AND "recordedAt" >= ${since}
    ORDER BY "petugasId", "recordedAt" DESC
  `;
  res.json(rows.map(r => ({
    petugasId: r.petugasId,
    lat: r.lat, lng: r.lng,
    accuracy: r.accuracy,
    ts: r.recordedAt.getTime(),
  })));
});

// On-demand retention sweep — admin bisa trigger prune manual di luar
// jadwal harian. Contoh use case: mau hapus data > retention days
// sebelum backup ekspor, atau setelah menaikkan retention days
// sementara untuk investigasi, mau kembali normal.
// ADMIN ONLY — supervisor tidak boleh menghapus data trail.
router.post('/positions/prune', async (req, res) => {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'forbidden' });
  const { runPositionRetentionSweep } = await import('../workers/positionRetentionWorker.js');
  const result = await runPositionRetentionSweep();
  res.json(result);
});

// Trail pergerakan petugas — semua PetugasPosition dalam window waktu,
// urut kronologis. Dipakai supervisor Tracking untuk render polyline
// "history pergerakan hari ini". Scope branch wajib: petugas hanya boleh
// dilihat oleh supervisor cabang yang sama / admin.
// Mount sebelum '/:id' supaya '/positions/trail/:id' tidak ke-konsumsi
// sebagai id petugas. Pakai segmen "positions/trail" eksplisit.
router.get('/:id/positions/trail', async (req, res) => {
  const branchId = scopedBranchId(req);
  const id = String(req.params.id);
  // Default window: hari ini (midnight local server time → sekarang).
  // Bisa override via ?since=ISO&until=ISO untuk audit lintas-hari.
  const sinceParam = String(req.query.since ?? '');
  const untilParam = String(req.query.until ?? '');
  const sinceDt = sinceParam ? new Date(sinceParam) : (() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  })();
  const untilDt = untilParam ? new Date(untilParam) : new Date();
  if (Number.isNaN(sinceDt.getTime()) || Number.isNaN(untilDt.getTime())) {
    return res.status(400).json({ error: 'bad_request' });
  }
  // Cap max points untuk lindungi browser dari render polyline 10k+ titik.
  const maxPoints = Math.min(2000, Number.parseInt(String(req.query.max ?? '1000'), 10) || 1000);

  // Verify petugas ada + dalam scope branch supervisor.
  const target = await prisma.petugas.findFirst({
    where: { id, ...(branchId ? { branchId } : {}) },
    select: { id: true },
  });
  if (!target) return res.status(404).json({ error: 'not_found' });

  const rows = await prisma.petugasPosition.findMany({
    where: {
      petugasId: id,
      recordedAt: { gte: sinceDt, lte: untilDt },
    },
    orderBy: { recordedAt: 'asc' },
    take: maxPoints,
    select: { lat: true, lng: true, accuracy: true, recordedAt: true },
  });
  res.json({
    petugasId: id,
    sinceIso: sinceDt.toISOString(),
    untilIso: untilDt.toISOString(),
    count: rows.length,
    points: rows.map(r => ({
      lat: r.lat, lng: r.lng,
      accuracy: r.accuracy,
      ts: r.recordedAt.getTime(),
    })),
  });
});

router.get('/:id', async (req, res) => {
  const branchId = scopedBranchId(req);
  const p = await prisma.petugas.findFirst({
    where: { id: String(req.params.id), ...(branchId ? { branchId } : {}) },
  });
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.json(p);
});

// Petugas detail dashboard (BQ) — profile + 30d rollups + recent activity.
// SUPERVISOR/ADMIN. Returned in a single call so the screen renders without
// chaining queries.
router.get('/:id/profile', async (req, res) => {
  if (req.user?.role === 'PETUGAS') return res.status(403).json({ error: 'forbidden' });
  const branchId = scopedBranchId(req);
  const id = String(req.params.id);
  const petugas = await prisma.petugas.findFirst({
    where: { id, ...(branchId ? { branchId } : {}) },
    include: {
      branch: { select: { kode: true, nama: true } },
      wilayahZone: { select: { id: true, nama: true } },
    },
  });
  if (!petugas) return res.status(404).json({ error: 'not_found' });

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [nasabahCount, visitsByHasil, collected30d, attendanceLast, recentKunjungan] = await Promise.all([
    prisma.nasabah.count({ where: { petugasId: id, active: true } }),
    prisma.kunjungan.groupBy({
      by: ['hasil'],
      where: { petugasId: id, tanggal: { gte: since30 } },
      _count: { _all: true },
    }),
    prisma.pembayaran.aggregate({
      where: {
        status: 'berhasil', tanggal: { gte: since30 },
        nasabah: { petugasId: id },
      },
      _sum: { nominal: true },
    }),
    prisma.attendance.findFirst({
      where: { petugasId: id },
      orderBy: { clockInAt: 'desc' },
    }),
    prisma.kunjungan.findMany({
      where: { petugasId: id },
      orderBy: { tanggal: 'desc' },
      take: 10,
      select: {
        id: true, tanggal: true, jam: true, hasil: true, nominal: true,
        reviewStatus: true, riskFlags: true,
        nasabah: { select: { kode: true, nama: true } },
      },
    }),
  ]);

  const visits = visitsByHasil.reduce((m, r) => { m[r.hasil] = r._count._all; return m; },
    { BAYAR: 0, JANJI: 0, TIDAKADA: 0, TOLAK: 0 } as Record<string, number>);

  res.json({
    petugas,
    rollup30d: {
      nasabahActive: nasabahCount,
      visits,
      totalVisits: Object.values(visits).reduce((s, n) => s + n, 0),
      collected: Number(collected30d._sum.nominal ?? 0n),
    },
    attendanceLast,
    recentKunjungan,
  });
});

// Ambang akurasi maksimum (m). Browser yang tidak punya GPS chip aktif
// jatuh ke IP / WiFi triangulation, akurasi biasanya 1000-3000m. Real GPS
// di luar ruangan <50m, di dalam ruangan 100-500m. 500m adalah kompromi
// yang masuk akal: tolak data yang pasti bukan GPS, tetap terima fix
// indoor yang lumayan.
const MAX_POSITION_ACCURACY_M = 500;

// Window untuk clientTs: 24 jam ke belakang max. Lebih lama dari ini =
// drain queue yang sudah basi (mis. petugas re-online setelah berhari).
// Lebih baik server simpan dengan recordedAt = now() supaya tidak
// merusak chart historis.
const CLIENT_TS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Toleransi clock skew client di masa depan — max 5 menit. Lebih dari
// ini server tolak ke fallback NOW().
const CLIENT_TS_FUTURE_SKEW_MS = 5 * 60 * 1000;

router.post('/:id/position', async (req, res) => {
  const { lat, lng, accuracy, clientTs } = req.body ?? {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'bad_request' });
  }
  // Resolve recordedAt: pakai clientTs (epoch ms atau ISO) kalau valid,
  // selain itu fallback ke DB default NOW(). Tujuannya: ping yang
  // di-buffer di retry queue tetap tersimpan dengan waktu capture asli,
  // bukan waktu drain (yang bisa menumpuk ratusan ping di 1 menit).
  let recordedAtOverride: Date | null = null;
  if (clientTs != null) {
    const parsed = typeof clientTs === 'number' ? new Date(clientTs) : new Date(String(clientTs));
    const now = Date.now();
    const ts = parsed.getTime();
    if (Number.isFinite(ts)
      && ts <= now + CLIENT_TS_FUTURE_SKEW_MS
      && ts >= now - CLIENT_TS_MAX_AGE_MS) {
      recordedAtOverride = parsed;
    }
    // clientTs di luar window: silently ignore + pakai NOW(). Tidak return
    // error supaya tidak break drain loop di sisi client kalau ada satu
    // ping basi di queue.
  }
  // Reject coarse fixes (IP / cell tower). Audit 1x per session implicit
  // via attendance.id — tapi posisi sendiri tidak punya session id, jadi
  // log per kejadian saja. Throttle sisi client kalau noise.
  if (typeof accuracy === 'number' && accuracy > MAX_POSITION_ACCURACY_M) {
    await audit({
      action: 'petugas.position.coarse_rejected', target: String(req.params.id),
      ...fromReq(req),
      meta: { accuracy, lat, lng, threshold: MAX_POSITION_ACCURACY_M },
    });
    return res.status(202).json({ ok: false, error: 'accuracy_too_low', threshold: MAX_POSITION_ACCURACY_M });
  }
  const id = String(req.params.id);
  // A petugas can only update their own position; supervisor of the petugas's
  // branch + ADMIN can update any.
  if (req.user?.role === 'PETUGAS' && req.user.petugasId !== id) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (req.user?.role === 'SUPERVISOR') {
    const target = await prisma.petugas.findUnique({ where: { id }, select: { branchId: true } });
    if (!target || target.branchId !== req.user.branchId) {
      return res.status(403).json({ error: 'forbidden' });
    }
  }
  // Lapis B: deteksi lonjakan kecepatan vs ping terakhir. Tidak menolak —
  // hanya catat audit, supervisor bisa review pola.
  const prevRow = await prisma.petugasPosition.findFirst({
    where: { petugasId: id },
    orderBy: { recordedAt: 'desc' },
    select: { lat: true, lng: true, recordedAt: true },
  });
  const pos = await prisma.petugasPosition.create({
    data: {
      petugasId: id, lat, lng, accuracy: accuracy ?? null,
      ...(recordedAtOverride ? { recordedAt: recordedAtOverride } : {}),
    },
  });
  const speed = evalSpeed({
    prev: prevRow ? { lat: prevRow.lat, lng: prevRow.lng, recordedAt: prevRow.recordedAt } : null,
    next: { lat, lng, recordedAt: pos.recordedAt },
  });
  if (speed.flags.length > 0) {
    await audit({
      action: 'petugas.position.speed_jump', target: id, ...fromReq(req),
      meta: { flags: speed.flags },
    });
  }
  // Geofence — fire-and-forget supaya tidak block response. Petugas
  // tetap mendapat 201 walau notif lambat / gagal. Cek silently di
  // background; kalau out of zone + belum dialerted sesi ini → audit
  // + notif supervisor.
  void (async () => {
    try {
      const geo = await checkPetugasGeofence({ petugasId: id, lat, lng });
      if (geo.hasZone && !geo.inside) {
        await notifyGeofenceViolation({ petugasId: id, lat, lng });
      }
    } catch { /* silently swallow — pings high-frequency, jangan spam logs */ }
  })();
  bus.publish('petugas.position', { petugasId: id, lat, lng, accuracy, ts: pos.recordedAt });
  res.status(201).json(pos);
});

// ---- create / patch (ADMIN + SUPERVISOR within own branch) ----
// commissionBps is optional here — when omitted, we fall back first to
// Branch.defaultCommissionBps (DP), then to the system-wide 150 floor.
const SYSTEM_DEFAULT_COMMISSION_BPS = 150;
const createSchema = z.object({
  kode: z.string().min(2).max(20).regex(/^[A-Z0-9]+$/, 'Huruf besar + angka'),
  nama: z.string().min(1).max(200),
  inisial: z.string().min(1).max(8),
  wilayah: z.string().min(1).max(200),
  hp: z.string().min(4).max(40),
  branchId: z.string().min(1),
  target: z.coerce.bigint().nonnegative().default(0n),
  status: z.enum(['LAPANGAN', 'ISTIRAHAT', 'KANTOR']).default('LAPANGAN'),
  hue: z.coerce.number().int().min(0).max(360).default(156),
  // Commission rate as basis points (0..10_000 = 0..100%). Optional —
  // when omitted, branch's defaultCommissionBps is used.
  commissionBps: z.coerce.number().int().min(0).max(10_000).optional(),
  // DR — kendaraan dinas; opsional, plat hanya divalidasi panjang.
  kendaraanPlat:  z.string().min(1).max(20).nullable().optional(),
  kendaraanModel: z.string().min(1).max(80).nullable().optional(),
});

function canManagePetugas(req: any, branchId: string): boolean {
  if (req.user?.role === 'ADMIN') return true;
  if (req.user?.role === 'SUPERVISOR') return req.user.branchId === branchId;
  return false;
}

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });
  if (!canManagePetugas(req, parsed.data.branchId)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  let commissionBps = parsed.data.commissionBps;
  if (commissionBps == null) {
    const branch = await prisma.branch.findUnique({
      where: { id: parsed.data.branchId },
      select: { defaultCommissionBps: true },
    });
    commissionBps = branch?.defaultCommissionBps ?? SYSTEM_DEFAULT_COMMISSION_BPS;
  }

  try {
    const p = await prisma.petugas.create({ data: { ...parsed.data, commissionBps } });
    await audit({
      action: 'petugas.create', target: p.id, ...fromReq(req),
      meta: { kode: p.kode, branchId: p.branchId, commissionBps },
    });
    res.status(201).json(p);
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'kode_taken' });
    throw err;
  }
});

const patchSchema = createSchema.partial().extend({
  // Kode is immutable — tying historical Kunjungan/Pembayaran to an old kode
  // and renaming it later would mismatch printed receipts in the wild.
  kode: z.never().optional(),
  active: z.boolean().optional(),
});

router.patch('/:id', async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const id = String(req.params.id);
  const before = await prisma.petugas.findUnique({ where: { id } });
  if (!before) return res.status(404).json({ error: 'not_found' });
  if (!canManagePetugas(req, before.branchId)) return res.status(403).json({ error: 'forbidden' });
  if (parsed.data.branchId && !canManagePetugas(req, parsed.data.branchId)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const updated = await prisma.petugas.update({ where: { id }, data: parsed.data });
  // CC — log a transfer row whenever the branch actually changes.
  if (parsed.data.branchId && parsed.data.branchId !== before.branchId) {
    await prisma.petugasTransfer.create({
      data: {
        petugasId: id,
        fromBranchId: before.branchId,
        toBranchId: parsed.data.branchId,
        movedById: req.user!.sub,
        reason: typeof req.body?.transferReason === 'string' && req.body.transferReason.length <= 2000
          ? req.body.transferReason
          : null,
      },
    });
  }
  await audit({
    action: 'petugas.update', target: id, ...fromReq(req),
    meta: parsed.data,
  });
  res.json(updated);
});

// CC — list a petugas's branch-transfer history. Same scope as the read
// endpoint (PETUGAS can fetch their own; supervisor sees in scope).
router.get('/:id/transfers', async (req, res) => {
  const branchId = scopedBranchId(req);
  const id = String(req.params.id);
  if (req.user?.role === 'PETUGAS' && req.user.petugasId !== id) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const p = await prisma.petugas.findFirst({
    where: { id, ...(branchId ? { branchId } : {}) },
    select: { id: true },
  });
  if (!p) return res.status(404).json({ error: 'not_found' });
  const rows = await prisma.petugasTransfer.findMany({
    where: { petugasId: id },
    include: {
      fromBranch: { select: { kode: true, nama: true } },
      toBranch: { select: { kode: true, nama: true } },
      movedBy: { select: { username: true, nama: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(rows);
});

router.get('/:id/route', async (req, res) => {
  const since = req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 24 * 3600 * 1000);
  const branchId = scopedBranchId(req);
  // Ensure the requester's branch contains this petugas before returning route.
  const petugas = await prisma.petugas.findFirst({
    where: { id: String(req.params.id), ...(branchId ? { branchId } : {}) },
    select: { id: true },
  });
  if (!petugas) return res.status(404).json({ error: 'not_found' });
  const route = await prisma.petugasPosition.findMany({
    where: { petugasId: req.params.id, recordedAt: { gte: since } },
    orderBy: { recordedAt: 'asc' },
  });
  res.json(route);
});

// Soft-delete via active flag — historical kunjungan/pembayaran FKs stay
// intact. SUPERVISOR limited to their own branch.
router.delete('/:id', async (req, res) => {
  const id = String(req.params.id);
  if (req.user?.role === 'PETUGAS') return res.status(403).json({ error: 'forbidden' });

  const branchId = scopedBranchId(req);
  const before = await prisma.petugas.findFirst({
    where: { id, ...(branchId ? { branchId } : {}) },
  });
  if (!before) return res.status(404).json({ error: 'not_found' });

  await prisma.petugas.update({ where: { id }, data: { active: false } });
  await audit({ action: 'petugas.deactivate', target: id, ...fromReq(req) });
  res.json({ ok: true });
});

export default router;
