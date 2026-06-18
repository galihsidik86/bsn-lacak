import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic } from '../helpers/fixtures.js';
import { runMorningReminderSweep } from '../../src/workers/morningReminderWorker.js';

const d = hasDb ? describe : describe.skip;

d('Morning reminder worker', () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    await seedBasic(prisma);
  });

  it('sends to PETUGAS and writes notification + audit on force', async () => {
    const out = await runMorningReminderSweep({ force: true });
    expect(out.ok).toBe(true);
    expect((out.recipients ?? 0)).toBeGreaterThanOrEqual(1);

    const notif = await prisma.notification.findFirst({ where: { type: 'morning.reminder' } });
    expect(notif).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({ where: { action: 'morning_reminder.sent' } });
    expect(audit).not.toBeNull();
  });

  it('dedups within the same day', async () => {
    await runMorningReminderSweep({ force: true });
    const second = await runMorningReminderSweep({ now: new Date() });
    // Without force, sweeps gate on hour/day match. Either way it must NOT
    // produce a second audit row.
    expect(second.ok).toBe(false);
    const audits = await prisma.auditLog.count({ where: { action: 'morning_reminder.sent' } });
    expect(audits).toBe(1);
  });

  it('skips weekends', async () => {
    // Find next Sunday at the configured hour.
    const sunday = new Date();
    while (sunday.getDay() !== 0) sunday.setDate(sunday.getDate() + 1);
    sunday.setHours(7, 0, 0, 0);
    const out = await runMorningReminderSweep({ now: sunday });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('weekend');
  });

  it('reports no_recipients when there are no PETUGAS users', async () => {
    await prisma.user.deleteMany({ where: { role: 'PETUGAS' } });
    const out = await runMorningReminderSweep({ force: true });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no_recipients');
  });
});
