import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { CookieOptions, Response, Request } from 'express';
import { prisma } from '../db.js';
import { env } from '../env.js';

export const REFRESH_COOKIE = 'bsn_rt';

export function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api/auth',
    domain: env.COOKIE_DOMAIN,
    maxAge: env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

interface IssueArgs {
  userId: string;
  family?: string;
  parentId?: string;
  req?: Request;
}

export async function issueRefreshToken({ userId, family, parentId, req }: IssueArgs) {
  const raw = randomBytes(48).toString('base64url');
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: {
      id,
      tokenHash: hash(raw),
      userId,
      family: family ?? id,
      parentId: parentId ?? null,
      ip: req?.ip ?? null,
      userAgent: String(req?.headers['user-agent'] ?? '').slice(0, 256),
      expiresAt,
    },
  });
  return { raw, id, expiresAt };
}

export async function rotateRefreshToken(raw: string, req?: Request) {
  const tokenHash = hash(raw);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash }, include: { user: true },
  });
  if (!existing) return { kind: 'unknown' as const };

  // Reuse detection: presented token was already rotated → entire family is hostile.
  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { family: existing.family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { kind: 'reuse' as const, userId: existing.userId, family: existing.family };
  }

  if (existing.expiresAt < new Date()) return { kind: 'expired' as const };

  await prisma.refreshToken.update({
    where: { id: existing.id }, data: { revokedAt: new Date() },
  });
  const issued = await issueRefreshToken({
    userId: existing.userId, family: existing.family, parentId: existing.id, req,
  });
  return { kind: 'ok' as const, user: existing.user, refresh: issued };
}

export async function revokeFamily(raw: string) {
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: hash(raw) } });
  if (!existing) return;
  await prisma.refreshToken.updateMany({
    where: { family: existing.family, revokedAt: null }, data: { revokedAt: new Date() },
  });
}

export function setRefreshCookie(res: Response, value: string) {
  res.cookie(REFRESH_COOKIE, value, refreshCookieOptions());
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: 0 });
}
