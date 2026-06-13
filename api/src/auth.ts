import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { env } from './env.js';

export interface JwtPayload {
  sub: string;
  role: Role;
  petugasId?: string | null;
  // null for ADMIN (HQ users with full cross-branch visibility), set for
  // SUPERVISOR + PETUGAS who only see their own branch.
  branchId?: string | null;
  // Optional: when an ADMIN switches branch via the UI, an "effective"
  // branchId rides on subsequent requests. Implemented as a header today;
  // can be promoted into the token later if needed.
}

// Resolves the branch scope the current request operates under. Returns
// `null` only for ADMINs who haven't picked a specific branch — they see
// data across all branches. Everyone else is scoped to their token's branch.
export function scopedBranchId(req: Request): string | null | undefined {
  if (!req.user) return undefined;
  if (req.user.role === 'ADMIN') {
    const override = req.headers['x-branch-id'];
    if (typeof override === 'string' && override.length > 0) return override;
    return null; // ADMIN: no scope → see everything
  }
  return req.user.branchId ?? '__none__'; // SUPERVISOR/PETUGAS: token-fixed
}

export function hash(password: string) {
  return bcrypt.hash(password, 10);
}

export function compare(password: string, hashed: string) {
  return bcrypt.compare(password, hashed);
}

export function sign(payload: JwtPayload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });
}

export function verify(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

declare global {
  namespace Express {
    interface Request { user?: JwtPayload }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const hdr = req.headers.authorization;
  if (!hdr?.startsWith('Bearer ')) return res.status(401).json({ error: 'unauthorized' });
  try {
    req.user = verify(hdr.slice(7));
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}
