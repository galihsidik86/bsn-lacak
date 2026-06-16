import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import { generateApiKey } from '../lib/apiKey.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole('ADMIN'));

router.get('/', async (_req, res) => {
  const rows = await prisma.apiKey.findMany({
    select: {
      id: true, name: true, tokenPrefix: true, branchId: true, scope: true,
      expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true,
      createdBy: { select: { username: true, nama: true } },
      branch: { select: { kode: true, nama: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(rows);
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  branchId: z.string().optional(),
  scope: z.enum(['read', 'write']).default('read'),
  expiresAt: z.string().datetime().optional(),
});

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  if (parsed.data.branchId) {
    const b = await prisma.branch.findUnique({ where: { id: parsed.data.branchId } });
    if (!b) return res.status(400).json({ error: 'unknown_branch' });
  }

  const { raw, prefix, hash } = generateApiKey();
  const row = await prisma.apiKey.create({
    data: {
      name: parsed.data.name,
      tokenHash: hash,
      tokenPrefix: prefix,
      createdById: req.user!.sub,
      branchId: parsed.data.branchId ?? null,
      scope: parsed.data.scope,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    },
  });
  await audit({
    action: 'api_key.create', target: row.id, ...fromReq(req),
    meta: { name: row.name, prefix: row.tokenPrefix, scope: row.scope },
  });
  // The raw token is the ONLY chance to capture it — DB only stores the
  // hash. UI must surface it once + warn the operator.
  res.status(201).json({ id: row.id, token: raw, prefix, name: row.name, scope: row.scope });
});

router.post('/:id/revoke', async (req, res) => {
  const id = String(req.params.id);
  const row = await prisma.apiKey.findUnique({ where: { id } });
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.revokedAt) return res.json({ ok: true, alreadyRevoked: true });
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit({ action: 'api_key.revoke', target: id, ...fromReq(req) });
  res.json({ ok: true });
});

export default router;
