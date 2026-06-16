// Builds a minimal Express app wired to the same routes as production but
// without the worker / metrics loops. Each test starts from a clean DB.

import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import auth from '../../src/routes/auth.js';
import petugas from '../../src/routes/petugas.js';
import nasabah from '../../src/routes/nasabah.js';
import kunjungan from '../../src/routes/kunjungan.js';
import blast from '../../src/routes/blast.js';
import distribusi from '../../src/routes/distribusi.js';
import push from '../../src/routes/push.js';
import analytics from '../../src/routes/analytics.js';
import attendance from '../../src/routes/attendance.js';
import announcements from '../../src/routes/announcements.js';
import wilayah from '../../src/routes/wilayah.js';
import feedback from '../../src/routes/feedback.js';
import search from '../../src/routes/search.js';
import notifications from '../../src/routes/notifications.js';
import apiKeys from '../../src/routes/apiKeys.js';
import savedFilters from '../../src/routes/savedFilters.js';
import webhooks from '../../src/routes/webhooks.js';
import foto from '../../src/routes/foto.js';
import { apiKeyAuth } from '../../src/lib/apiKey.js';

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use((req, res, next) => { void apiKeyAuth(req, res, next); });
  app.use('/api/auth', auth);
  app.use('/api/petugas', petugas);
  app.use('/api/nasabah', nasabah);
  app.use('/api/kunjungan', kunjungan);
  app.use('/api/blast', blast);
  app.use('/api/distribusi', distribusi);
  app.use('/api/push', push);
  app.use('/api/analytics', analytics);
  app.use('/api/attendance', attendance);
  app.use('/api/announcements', announcements);
  app.use('/api/wilayah', wilayah);
  app.use('/api/feedback', feedback);
  app.use('/api/search', search);
  app.use('/api/notifications', notifications);
  app.use('/api/api-keys', apiKeys);
  app.use('/api/saved-filters', savedFilters);
  app.use('/api/webhooks', webhooks);
  app.use('/api/foto', foto);
  return app;
}

export const prisma = new PrismaClient();

export async function resetDb() {
  // Truncate in dependency order. CASCADE handles FKs.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditLog",
      "Notification",
      "PushSubscription",
      "BlastRecipient", "Blast",
      "CustomerFeedback",
      "Foto", "Kunjungan",
      "Pembayaran",
      "RefreshToken",
      "PetugasPosition",
      "Attendance",
      "Nasabah",
      "User",
      "Petugas",
      "Wilayah",
      "ApiKey",
      "SavedFilter",
      "WebhookDelivery",
      "WebhookSubscription",
      "Branch"
    RESTART IDENTITY CASCADE
  `);
}

export const hasDb = process.env.BSN_TEST_HAS_DB === '1';
