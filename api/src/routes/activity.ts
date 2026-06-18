import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth, scopedBranchId } from '../auth.js';

const router = Router();
router.use(requireAuth);

// Per-branch activity feed (BH). Union of recent kunjungan, pembayaran,
// blast completions, and selected audit-log entries — all annotated with
// a uniform shape so the frontend can render one timeline.
//
// PETUGAS is forbidden because the timeline crosses other petugas's
// activity. SUPERVISOR is auto-scoped to their branch; ADMIN may pass
// an x-branch-id override via the standard flow.

export interface ActivityItem {
  id: string;
  type: 'kunjungan.created' | 'kunjungan.reviewed' | 'pembayaran.received' | 'blast.completed' | 'audit';
  timestamp: string;
  branchKode: string;
  actor: string;        // petugas / supervisor / system label
  summary: string;
  link?: string;        // in-app deep link, e.g. 'laporan'
}

router.get('/feed', async (req, res) => {
  if (req.user?.role === 'PETUGAS') return res.status(403).json({ error: 'forbidden' });
  const branchId = scopedBranchId(req);
  const days = Number.parseInt(String(req.query.days ?? '7'), 10);
  const window = Number.isFinite(days) && days > 0 && days <= 30 ? days : 7;
  const limitRaw = Number.parseInt(String(req.query.limit ?? '100'), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 500 ? limitRaw : 100;
  const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);

  // Pull the four sources in parallel. Each query is capped so a busy
  // branch can't dominate the feed and starve the others.
  const perSourceCap = Math.min(limit, 200);
  const [kunjunganRows, pembayaranRows, blastRows] = await Promise.all([
    prisma.kunjungan.findMany({
      where: {
        tanggal: { gte: since },
        ...(branchId ? { branchId } : {}),
      },
      orderBy: { tanggal: 'desc' },
      take: perSourceCap,
      include: {
        petugas: { select: { kode: true, nama: true } },
        nasabah: { select: { kode: true, nama: true } },
        branch: { select: { kode: true } },
        reviewer: { select: { username: true, nama: true } },
      },
    }),
    prisma.pembayaran.findMany({
      where: {
        tanggal: { gte: since },
        status: 'berhasil',
        ...(branchId ? { branchId } : {}),
      },
      orderBy: { tanggal: 'desc' },
      take: perSourceCap,
      include: {
        nasabah: { include: { petugas: { select: { kode: true, nama: true } } } },
        branch: { select: { kode: true } },
      },
    }),
    prisma.blast.findMany({
      where: {
        scheduledAt: { gte: since },
        status: 'SELESAI',
        ...(branchId ? { branchId } : {}),
      },
      orderBy: { scheduledAt: 'desc' },
      take: perSourceCap,
      include: { branch: { select: { kode: true } } },
    }),
  ]);

  const items: ActivityItem[] = [];

  for (const k of kunjunganRows) {
    items.push({
      id: `k-${k.id}`,
      type: 'kunjungan.created',
      timestamp: k.tanggal.toISOString(),
      branchKode: k.branch.kode,
      actor: k.petugas.nama,
      summary: `Kunjungan ${k.nasabah.nama} (${k.nasabah.kode}) — ${k.hasil.toLowerCase()}` +
        (k.nominal > 0n ? ` · Rp ${Number(k.nominal).toLocaleString('id-ID')}` : ''),
      link: 'laporan',
    });
    if (k.reviewStatus !== 'PENDING' && k.reviewedAt && k.reviewer) {
      items.push({
        id: `kr-${k.id}`,
        type: 'kunjungan.reviewed',
        timestamp: k.reviewedAt.toISOString(),
        branchKode: k.branch.kode,
        actor: k.reviewer.nama,
        summary: `Laporan ${k.nasabah.kode} ${k.reviewStatus.toLowerCase()} oleh supervisor`,
        link: 'laporan',
      });
    }
  }

  for (const p of pembayaranRows) {
    items.push({
      id: `p-${p.id}`,
      type: 'pembayaran.received',
      timestamp: p.tanggal.toISOString(),
      branchKode: p.branch.kode,
      actor: p.nasabah.petugas.nama,
      summary: `Pembayaran Rp ${Number(p.nominal).toLocaleString('id-ID')} dari ${p.nasabah.nama} (${p.metode})`,
      link: 'angsuran',
    });
  }

  for (const b of blastRows) {
    items.push({
      id: `b-${b.id}`,
      type: 'blast.completed',
      timestamp: (b.scheduledAt ?? b.createdAt).toISOString(),
      branchKode: b.branch?.kode ?? '—',
      actor: 'Blast worker',
      summary: `Blast "${b.judul}" selesai (${b.kanal})`,
      link: 'blast',
    });
  }

  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  res.json({ windowDays: window, items: items.slice(0, limit) });
});

export default router;
