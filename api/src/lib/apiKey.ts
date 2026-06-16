import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';
import { logger } from './logger.js';

// API keys live alongside JWT tokens as an alternative auth path for
// machine-to-machine integrations. Format: "bsn_apikey_<32-hex>" so the
// prefix is human-recognizable + 32 hex chars (128 bits) of entropy.

export const PREFIX = 'bsn_apikey_';

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = PREFIX + randomBytes(16).toString('hex');
  return { raw, prefix: raw.slice(0, 18), hash: hashToken(raw) };
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// Mounted alongside requireAuth — accepts EITHER a JWT (handled by the
// existing requireAuth) or a "Bearer bsn_apikey_*" token. On success
// req.user is populated with the creator's identity scoped to the key's
// branchId so downstream branch-tenancy still works.
export async function apiKeyAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const auth = String(req.headers.authorization ?? '');
  const match = auth.match(/^Bearer (bsn_apikey_[a-f0-9]+)$/);
  if (!match) return next();
  const raw = match[1];

  const key = await prisma.apiKey.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: {
      createdBy: { select: { id: true, role: true, petugasId: true, branchId: true } },
    },
  });
  if (!key) return next();
  if (key.revokedAt) return next();
  if (key.expiresAt && key.expiresAt < new Date()) return next();

  // Promote the creator's identity into the request, but scoped to the
  // key's branchId (overrides creator's own branch). If the key was minted
  // without a branch it inherits the creator's scope.
  req.user = {
    sub: key.createdBy.id,
    role: key.createdBy.role,
    petugasId: key.createdBy.petugasId,
    branchId: key.branchId ?? key.createdBy.branchId,
  };

  // Touch lastUsedAt on a coarse cadence — don't slam the DB on every
  // request. Once per hour per key is plenty for the UI.
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60 * 60 * 1000) {
    prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(e => logger.warn({ err: String(e), keyId: key.id }, 'api_key_touch_failed'));
  }
  next();
}
