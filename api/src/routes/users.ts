// User onboarding. SUPERVISOR can manage PETUGAS within their branch;
// ADMIN can manage anyone. Initial / reset passwords are generated server-
// side, returned ONCE in the response, and force-change is flagged so the
// new user is locked out until they pick their own.

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, scopedBranchId } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import { generatePassword } from '../lib/genPassword.js';

const router = Router();
router.use(requireAuth);

// Limits a SUPERVISOR to PETUGAS-only within their own branch. ADMIN bypasses.
function canManageRole(actor: { role: string; branchId?: string | null }, targetRole: string, targetBranchId: string | null) {
  if (actor.role === 'ADMIN') return true;
  if (actor.role !== 'SUPERVISOR') return false;
  if (targetRole !== 'PETUGAS') return false;
  return targetBranchId === actor.branchId;
}

// ---- list ----
router.get('/', async (req, res) => {
  const role = req.user!.role;
  if (role !== 'ADMIN' && role !== 'SUPERVISOR') return res.status(403).json({ error: 'forbidden' });

  const branchId = scopedBranchId(req);
  // SUPERVISOR sees only PETUGAS in their branch (no peers, no admins).
  const where: Record<string, unknown> = {};
  if (role === 'SUPERVISOR') {
    where.role = 'PETUGAS';
    where.branchId = req.user!.branchId ?? '__none__';
  } else if (branchId) {
    where.branchId = branchId;
  }

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true, username: true, nama: true, role: true,
      branchId: true, petugasId: true, active: true,
      mustChangePassword: true, lastLoginAt: true, createdAt: true,
      branch: { select: { kode: true, nama: true } },
      petugas: { select: { kode: true, nama: true } },
    },
    orderBy: [{ active: 'desc' }, { role: 'asc' }, { username: 'asc' }],
  });
  res.json(users);
});

// ---- create ----
const createSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-z0-9_]+$/, 'huruf kecil/angka/garis bawah'),
  nama: z.string().min(1).max(200),
  role: z.enum(['ADMIN', 'SUPERVISOR', 'PETUGAS']),
  branchId: z.string().nullable().optional(),
  petugasId: z.string().nullable().optional(),
});

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  // ADMIN role MUST NOT be tied to a single branch — that contradicts the
  // "ADMIN sees all" semantics. SUPERVISOR/PETUGAS MUST have a branch.
  if (parsed.data.role === 'ADMIN' && parsed.data.branchId) {
    return res.status(400).json({ error: 'admin_must_be_branchless' });
  }
  if (parsed.data.role !== 'ADMIN' && !parsed.data.branchId) {
    return res.status(400).json({ error: 'branch_required' });
  }
  if (!canManageRole(req.user!, parsed.data.role, parsed.data.branchId ?? null)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  // Validate petugas link if provided.
  if (parsed.data.petugasId) {
    if (parsed.data.role !== 'PETUGAS') {
      return res.status(400).json({ error: 'petugas_id_only_for_petugas_role' });
    }
    const pet = await prisma.petugas.findUnique({ where: { id: parsed.data.petugasId } });
    if (!pet) return res.status(400).json({ error: 'unknown_petugas' });
    if (pet.branchId !== parsed.data.branchId) {
      return res.status(400).json({ error: 'petugas_branch_mismatch' });
    }
    const existing = await prisma.user.findFirst({ where: { petugasId: parsed.data.petugasId } });
    if (existing) return res.status(409).json({ error: 'petugas_already_linked' });
  }

  const password = generatePassword(16);
  try {
    const u = await prisma.user.create({
      data: {
        username: parsed.data.username,
        nama: parsed.data.nama,
        role: parsed.data.role,
        branchId: parsed.data.branchId ?? null,
        petugasId: parsed.data.petugasId ?? null,
        passwordHash: await bcrypt.hash(password, 12),
        mustChangePassword: true,
      },
    });
    await audit({
      action: 'user.create', target: u.id, ...fromReq(req),
      meta: { username: u.username, role: u.role, branchId: u.branchId },
    });
    res.status(201).json({
      id: u.id, username: u.username, nama: u.nama, role: u.role,
      branchId: u.branchId, petugasId: u.petugasId,
      // Plaintext password is intentionally exposed ONCE so the admin can hand
      // it to the new user. It is never persisted in plaintext anywhere.
      tempPassword: password,
    });
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'username_taken' });
    throw err;
  }
});

// ---- patch ----
const patchSchema = z.object({
  nama: z.string().min(1).max(200).optional(),
  role: z.enum(['ADMIN', 'SUPERVISOR', 'PETUGAS']).optional(),
  branchId: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

router.patch('/:id', async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request', details: parsed.error.flatten() });

  const id = String(req.params.id);
  const before = await prisma.user.findUnique({ where: { id } });
  if (!before) return res.status(404).json({ error: 'not_found' });

  // Authorisation is checked against the *current* user state — a SUPERVISOR
  // can't reach into another branch even by patching to their own.
  if (!canManageRole(req.user!, before.role, before.branchId)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  // If a role/branch change is requested, validate the *new* target too.
  const newRole = parsed.data.role ?? before.role;
  const newBranchId = parsed.data.branchId !== undefined ? parsed.data.branchId : before.branchId;
  if (!canManageRole(req.user!, newRole, newBranchId)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (newRole === 'ADMIN' && newBranchId) {
    return res.status(400).json({ error: 'admin_must_be_branchless' });
  }
  if (newRole !== 'ADMIN' && !newBranchId) {
    return res.status(400).json({ error: 'branch_required' });
  }

  const updated = await prisma.user.update({
    where: { id },
    data: parsed.data,
    select: {
      id: true, username: true, nama: true, role: true,
      branchId: true, petugasId: true, active: true, mustChangePassword: true,
    },
  });

  // If deactivated, also kill in-flight sessions.
  if (parsed.data.active === false) {
    await prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  await audit({
    action: 'user.update', target: id, ...fromReq(req),
    meta: parsed.data,
  });
  res.json(updated);
});

// ---- reset password ----
router.post('/:id/reset-password', async (req, res) => {
  const id = String(req.params.id);
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) return res.status(404).json({ error: 'not_found' });
  if (!canManageRole(req.user!, u.role, u.branchId)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  const password = generatePassword(16);
  await prisma.user.update({
    where: { id },
    data: {
      passwordHash: await bcrypt.hash(password, 12),
      passwordChangedAt: new Date(),
      mustChangePassword: true,
      failedAttempts: 0,
      lockedUntil: null,
    },
  });
  // Revoke existing sessions so the new password takes effect everywhere.
  await prisma.refreshToken.updateMany({
    where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() },
  });

  await audit({
    action: 'user.reset_password', target: id, ...fromReq(req),
    meta: { username: u.username },
  });

  res.json({ ok: true, tempPassword: password });
});

export default router;
