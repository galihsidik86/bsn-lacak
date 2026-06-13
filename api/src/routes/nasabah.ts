import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import { bus } from '../lib/events.js';
import { enqueueNotification } from './notifications.js';

const router = Router();
router.use(requireAuth);

// Build a `where` clause combining branch-tenancy + role scoping.
// ADMIN: no branch filter; SUPERVISOR/PETUGAS: filter to token's branchId.
// PETUGAS also pinned to their own assignments.
function scope(req: any) {
  const w: Record<string, unknown> = {};
  if (req.user?.role === 'PETUGAS') w.petugasId = req.user.petugasId ?? '__none__';
  const branchId = scopedBranchId(req);
  if (branchId !== null && branchId !== undefined) w.branchId = branchId;
  return w;
}

router.get('/', async (req, res) => {
  const str = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined;
  const q = str(req.query.q)?.trim();
  const kol = str(req.query.kol);
  const petugasId = str(req.query.petugasId);
  const akad = str(req.query.akad);

  const list = await prisma.nasabah.findMany({
    where: {
      ...scope(req),
      ...(q ? { OR: [{ nama: { contains: q, mode: 'insensitive' } }, { kode: { contains: q, mode: 'insensitive' } }] } : {}),
      ...(kol ? { kol: kol as any } : {}),
      ...(petugasId ? { petugasId } : {}),
      ...(akad ? { akad: akad as any } : {}),
    },
    include: { petugas: true },
    orderBy: { kode: 'asc' },
    take: 500,
  });
  res.json(list);
});

router.get('/postur', async (req, res) => {
  const rows = await prisma.nasabah.groupBy({
    by: ['kol'],
    where: scope(req),
    _count: { _all: true },
    _sum: { sisa: true },
  });
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const n = await prisma.nasabah.findFirst({
    where: { id: String(req.params.id), ...scope(req) },
    include: { petugas: true },
  });
  if (!n) return res.status(404).json({ error: 'not_found' });
  res.json(n);
});

const reassign = z.object({ petugasId: z.string().min(1).max(64) });
router.patch('/:id/petugas', requireRole('SUPERVISOR', 'ADMIN'), async (req, res) => {
  const parsed = reassign.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const id = String(req.params.id);

  // Source nasabah must be inside the requester's branch scope.
  const before = await prisma.nasabah.findFirst({ where: { id, ...scope(req) } });
  if (!before) return res.status(404).json({ error: 'not_found' });

  // Target petugas must live in the same branch unless requester is ADMIN.
  const targetPetugas = await prisma.petugas.findUnique({ where: { id: parsed.data.petugasId } });
  if (!targetPetugas) return res.status(400).json({ error: 'unknown_petugas' });
  if (req.user?.role !== 'ADMIN' && targetPetugas.branchId !== before.branchId) {
    return res.status(403).json({ error: 'cross_branch_forbidden' });
  }

  const updated = await prisma.nasabah.update({
    where: { id },
    // When ADMIN moves nasabah across branches, branchId follows the new petugas.
    data: { petugasId: parsed.data.petugasId, branchId: targetPetugas.branchId },
  });
  await audit({
    action: 'nasabah.reassign', target: id,
    ...fromReq(req),
    meta: { from: before.petugasId, to: parsed.data.petugasId },
  });
  bus.publish('nasabah.reassign', { nasabahId: id, from: before.petugasId, to: parsed.data.petugasId });

  // Notify the receiving petugas so they see "Nasabah baru ditugaskan" in their bell.
  const targetUser = await prisma.user.findFirst({ where: { petugasId: parsed.data.petugasId } });
  if (targetUser) {
    await enqueueNotification({
      userIds: [targetUser.id],
      type: 'nasabah.reassigned_to_you',
      title: 'Nasabah baru ditugaskan',
      body: `${updated.nama} (${updated.kode}) sekarang ada di binaan Anda.`,
      severity: 'INFO',
      link: 'kolektabilitas',
    }).catch(() => undefined);
  }

  res.json(updated);
});

export default router;
