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
import { startSlaWorker } from './workers/slaWorker.js';
import { startClosingEmailWorker, stopClosingEmailWorker } from './workers/closingEmailWorker.js';
import { startMorningReminderWorker, stopMorningReminderWorker } from './workers/morningReminderWorker.js';
import { startArchiveWorker, stopArchiveWorker } from './workers/archiveWorker.js';
import { startFollowupWorker, stopFollowupWorker } from './workers/followupWorker.js';
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
import analytics from './routes/analytics.js';
import attendance from './routes/attendance.js';
import announcements from './routes/announcements.js';
import wilayah from './routes/wilayah.js';
import feedback from './routes/feedback.js';
import backup from './routes/backup.js';
import search from './routes/search.js';
import apiKeys from './routes/apiKeys.js';
import savedFilters from './routes/savedFilters.js';
import webhooks from './routes/webhooks.js';
import foto from './routes/foto.js';
import receipt from './routes/receipt.js';
import holidays from './routes/holidays.js';
import activity from './routes/activity.js';
import verify from './routes/verify.js';
import certifications from './routes/certifications.js';
import systemHealth from './routes/systemHealth.js';
import escalation from './routes/escalation.js';
import leaves from './routes/leaves.js';
import tags from './routes/tags.js';
import restructures from './routes/restructures.js';
import nasabahDocs from './routes/nasabahDocs.js';
import attendanceDisputes from './routes/attendanceDisputes.js';
import petugasSwaps from './routes/petugasSwaps.js';
import { startEscalationWorker, stopEscalationWorker } from './workers/escalationWorker.js';
import { startWeeklyDigestWorker, stopWeeklyDigestWorker } from './workers/weeklyDigestWorker.js';
import { startInactivityWorker, stopInactivityWorker } from './workers/inactivityWorker.js';
import { startLeaveAssignmentWorker, stopLeaveAssignmentWorker } from './workers/leaveAssignmentWorker.js';
import { startStaleNasabahWorker, stopStaleNasabahWorker } from './workers/staleNasabahWorker.js';
import { startTagRuleWorker, stopTagRuleWorker } from './workers/tagRuleWorker.js';
import { startJanjiReminderWorker, stopJanjiReminderWorker } from './workers/janjiReminderWorker.js';
import { startIdleDetectorWorker, stopIdleDetectorWorker } from './workers/idleDetectorWorker.js';
import { startWebhookDispatcher } from './lib/webhookDispatcher.js';
import { initSentry, sentryErrorHandler, setupSentryRequest } from './lib/sentry.js';
import { apiKeyAuth } from './lib/apiKey.js';

// Sentry must initialize BEFORE other modules use it. No-op when DSN is
// absent so dev/test stays clean.
initSentry();

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
// Resolve API key tokens early so downstream requireAuth treats them as
// authenticated. JWT path is left untouched — apiKeyAuth no-ops when the
// Authorization header isn't a bsn_apikey_* bearer.
app.use((req, res, next) => { void apiKeyAuth(req, res, next); });

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
app.use('/api/analytics', analytics);
app.use('/api/attendance', attendance);
app.use('/api/announcements', announcements);
app.use('/api/wilayah', wilayah);
app.use('/api/feedback', feedback);
app.use('/api/backup', backup);
app.use('/api/search', search);
app.use('/api/api-keys', apiKeys);
app.use('/api/saved-filters', savedFilters);
app.use('/api/webhooks', webhooks);
app.use('/api/foto', foto);
app.use('/api/receipt', receipt);
app.use('/api/holidays', holidays);
app.use('/api/activity', activity);
app.use('/api/verify', verify);
app.use('/api/certifications', certifications);
app.use('/api/system-health', systemHealth);
app.use('/api/escalation', escalation);
app.use('/api/leaves', leaves);
app.use('/api/tags', tags);
app.use('/api/restructures', restructures);
app.use('/api/nasabah-docs', nasabahDocs);
app.use('/api/attendance-disputes', attendanceDisputes);
app.use('/api/petugas-swaps', petugasSwaps);

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

// Sentry must run before the JSON error responder so it captures the
// exception while we still own the request lifecycle. setupSentryRequest
// registers Sentry's own express handler; sentryErrorHandler then forwards
// to next so our own JSON 500 below still answers.
setupSentryRequest(app);
app.use(sentryErrorHandler);

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
startSlaWorker();
startClosingEmailWorker();
startMorningReminderWorker();
startArchiveWorker();
startFollowupWorker();
startEscalationWorker();
startWeeklyDigestWorker();
startInactivityWorker();
startLeaveAssignmentWorker();
startStaleNasabahWorker();
startTagRuleWorker();
startJanjiReminderWorker();
startIdleDetectorWorker();
if (env.NODE_ENV !== 'test') startWebhookDispatcher();
const stopSamplers = startMetricsSamplers();
const stopRetention = startAuditRetention();

// Graceful shutdown — give in-flight requests up to 10s before killing.
const shutdown = (sig: string) => {
  logger.info({ sig }, 'shutdown_initiated');
  stopWorker();
  stopSamplers();
  stopRetention();
  stopClosingEmailWorker();
  stopMorningReminderWorker();
  stopArchiveWorker();
  stopFollowupWorker();
  stopEscalationWorker();
  stopWeeklyDigestWorker();
  stopInactivityWorker();
  stopLeaveAssignmentWorker();
  stopStaleNasabahWorker();
  stopTagRuleWorker();
  stopJanjiReminderWorker();
  stopIdleDetectorWorker();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
