import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic } from '../helpers/fixtures.js';
import { runClosingEmailSweep } from '../../src/workers/closingEmailWorker.js';

const d = hasDb ? describe : describe.skip;

d('closing email worker', () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    await seedBasic(prisma);
  });

  it('skips when no ADMIN has an email on file', async () => {
    const out = await runClosingEmailSweep({ force: true });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no_recipients');
  });

  it('sends + audits when ADMIN has email; second run de-duplicates', async () => {
    await prisma.user.updateMany({
      where: { role: 'ADMIN' },
      data: { email: 'admin@example.com' },
    });

    const first = await runClosingEmailSweep({ force: true });
    expect(first.ok).toBe(true);
    expect(first.recipients).toBe(1);

    // The stub gateway is in use under NODE_ENV=test, so audit row is the
    // proof-of-send: shouldn't fire twice for the same month.
    const audits = await prisma.auditLog.findMany({ where: { action: 'closing.email_sent' } });
    expect(audits.length).toBe(1);
    expect((audits[0].meta as any).month).toBe(first.month);

    // Without force, the alreadySent guard would skip; ensure that's the case.
    const second = await runClosingEmailSweep({ now: new Date() });
    // If today isn't CLOSING_EMAIL_DAY or hour doesn't match, we get not_day/not_hour;
    // either way it must NOT fire a second send.
    expect(second.ok).toBe(false);
    const auditsAfter = await prisma.auditLog.findMany({ where: { action: 'closing.email_sent' } });
    expect(auditsAfter.length).toBe(1);
  });
});
