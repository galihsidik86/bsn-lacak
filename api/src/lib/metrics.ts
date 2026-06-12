// Prometheus metrics — scraped by Prometheus at /metrics.
// Cardinality stays small: HTTP route templates only, no path params/IDs.

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';

export const registry = new Registry();
registry.setDefaultLabels({ service: 'bsn-api' });
collectDefaultMetrics({ register: registry });

export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.6, 1, 2, 5],
  registers: [registry],
});

export const loginFails = new Counter({
  name: 'auth_login_failed_total',
  help: 'Failed login attempts (wrong password or unknown user)',
  labelNames: ['reason'],
  registers: [registry],
});

export const loginLockouts = new Counter({
  name: 'auth_lockouts_total',
  help: 'Accounts that crossed the lockout threshold',
  registers: [registry],
});

export const blastQueueDepth = new Gauge({
  name: 'blast_queue_pending',
  help: 'BlastRecipient rows still in `pending` status',
  registers: [registry],
});

export const blastSent = new Counter({
  name: 'blast_messages_sent_total',
  help: 'Blast messages successfully sent',
  labelNames: ['channel'],
  registers: [registry],
});

export const blastFailed = new Counter({
  name: 'blast_messages_failed_total',
  help: 'Blast messages that failed to send',
  labelNames: ['channel'],
  registers: [registry],
});

export const dbUp = new Gauge({
  name: 'db_up',
  help: '1 if the last DB ping succeeded, 0 otherwise',
  registers: [registry],
});

// Express middleware — wrap each request with timing + status labelling.
// Uses req.route.path (the *template*) to keep cardinality bounded.
export function httpMetrics(req: Request, res: Response, next: NextFunction) {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = (req.route?.path as string | undefined) ?? req.baseUrl + (req.path?.replace(/\/[a-z0-9]{20,}/gi, '/:id') ?? '');
    end({
      method: req.method,
      route: route || 'unknown',
      status: String(res.statusCode),
    });
  });
  next();
}

// Periodic samplers — populate gauges that are not naturally event-driven.
export function startMetricsSamplers() {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbUp.set(1);
    } catch {
      dbUp.set(0);
    }
    try {
      const pending = await prisma.blastRecipient.count({ where: { status: 'pending' } });
      blastQueueDepth.set(pending);
    } catch {
      /* ignore */
    }
    if (!stopped) setTimeout(tick, 15_000);
  };
  setTimeout(tick, 5_000);
  return () => { stopped = true; };
}
