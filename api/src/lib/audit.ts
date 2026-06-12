import type { Request } from 'express';
import { prisma } from '../db.js';
import { logger } from './logger.js';

export interface AuditEvent {
  action: string;
  actorId?: string | null;
  actor?: string | null;
  target?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown> | null;
}

export async function audit(ev: AuditEvent) {
  try {
    await prisma.auditLog.create({
      data: {
        action: ev.action,
        actorId: ev.actorId ?? null,
        actor: ev.actor ?? null,
        target: ev.target ?? null,
        ip: ev.ip ?? null,
        userAgent: ev.userAgent ?? null,
        meta: (ev.meta ?? null) as any,
      },
    });
  } catch (err) {
    // Never let audit failure crash the request — but do log it.
    logger.error({ err, ev }, 'audit_write_failed');
  }
}

export function fromReq(req: Request): Pick<AuditEvent, 'actorId' | 'ip' | 'userAgent'> {
  return {
    actorId: req.user?.sub ?? null,
    ip: req.ip ?? null,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 256),
  };
}
