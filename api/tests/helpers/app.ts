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

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api/auth', auth);
  app.use('/api/petugas', petugas);
  app.use('/api/nasabah', nasabah);
  app.use('/api/kunjungan', kunjungan);
  app.use('/api/blast', blast);
  app.use('/api/distribusi', distribusi);
  return app;
}

export const prisma = new PrismaClient();

export async function resetDb() {
  // Truncate in dependency order. CASCADE handles FKs.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditLog",
      "BlastRecipient", "Blast",
      "Foto", "Kunjungan",
      "Pembayaran",
      "RefreshToken",
      "PetugasPosition",
      "Nasabah",
      "User",
      "Petugas"
    RESTART IDENTITY CASCADE
  `);
}

export const hasDb = process.env.BSN_TEST_HAS_DB === '1';
