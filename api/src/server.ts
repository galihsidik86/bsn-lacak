import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { env } from './env.js';
import './db.js';
import swaggerUi from 'swagger-ui-express';
import { httpLogger, logger } from './lib/logger.js';
import { httpMetrics, registry, startMetricsSamplers } from './lib/metrics.js';
import { buildOpenApi } from './lib/openapi.js';
import { apiLimiter, loginLimiter } from './lib/rateLimit.js';
import { startAuditRetention } from './workers/auditRetention.js';
import { startBlastWorker } from './workers/blastWorker.js';
import { prisma } from './db.js';

import auth from './routes/auth.js';
import petugas from './routes/petugas.js';
import nasabah from './routes/nasabah.js';
import kunjungan from './routes/kunjungan.js';
import angsuran from './routes/angsuran.js';
import blast from './routes/blast.js';
import distribusi from './routes/distribusi.js';
import events from './routes/events.js';
import notifications from './routes/notifications.js';
import branches from './routes/branches.js';
import auditLogs from './routes/audit.js';
import users from './routes/users.js';
import push from './routes/push.js';

const app = express();
app.disable('x-powered-by');

// Trust first proxy (e.g. nginx / load balancer) so req.ip reflects client IP.
app.set('trust proxy', 1);

app.use(httpLogger);
app.use(httpMetrics);

// Helmet: this is a JSON API, no inline HTML, so CSP can be strict.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: env.NODE_ENV === 'production'
    ? { maxAge: 60 * 60 * 24 * 365, includeSubDomains: true, preload: true }
    : false,
}));

app.use(cors({
  origin: env.WEB_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

// Liveness — always 200 if the process is up.
app.get('/health', (_req, res) => res.json({ ok: true }));

// Readiness — only 200 when DB is reachable. nginx/compose poll this.
app.get('/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'up' });
  } catch (err) {
    logger.warn({ err }, 'readiness_db_unreachable');
    res.status(503).json({ ok: false, db: 'down' });
  }
});

// Prometheus scrape endpoint — keep it on the same port; restrict via nginx.
app.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

// OpenAPI spec + Swagger UI. Internal-only via nginx allow-list.
const openApiDoc = buildOpenApi();
app.get('/api/openapi.json', (_req, res) => res.json(openApiDoc));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc, {
  customSiteTitle: 'BSN Lacak API',
  swaggerOptions: { persistAuthorization: true },
}));

// Rate limiters — strict on login, general on /api.
app.use('/api/auth/login', loginLimiter);
app.use('/api', apiLimiter);

app.use('/api/auth', auth);
app.use('/api/petugas', petugas);
app.use('/api/nasabah', nasabah);
app.use('/api/kunjungan', kunjungan);
app.use('/api/angsuran', angsuran);
app.use('/api/blast', blast);
app.use('/api/distribusi', distribusi);
app.use('/api/events', events);
app.use('/api/notifications', notifications);
app.use('/api/branches', branches);
app.use('/api/audit', auditLogs);
app.use('/api/users', users);
app.use('/api/push', push);

// Static uploads — Cache-Control prevents stale photo IDs from sticking.
app.use('/uploads', express.static(path.resolve(env.UPLOAD_DIR), {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  },
}));

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const id = (req as any).id ?? res.getHeader('x-request-id');
  logger.error({ err, reqId: id, path: req.path, method: req.method }, 'request_error');
  const payload: Record<string, unknown> = { error: 'internal_error', requestId: id };
  if (env.NODE_ENV !== 'production' && err instanceof Error) {
    payload.message = err.message;
  }
  res.status(500).json(payload);
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'bsn_api_listening');
});

const stopWorker = startBlastWorker();
const stopSamplers = startMetricsSamplers();
const stopRetention = startAuditRetention();

// Graceful shutdown — give in-flight requests up to 10s before killing.
const shutdown = (sig: string) => {
  logger.info({ sig }, 'shutdown_initiated');
  stopWorker();
  stopSamplers();
  stopRetention();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
