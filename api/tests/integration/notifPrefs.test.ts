import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { enqueueNotification } from '../../src/routes/notifications.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('Notification preferences', () => {
  const app = buildApp();
  let s: SeedOut;
  let supTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    supTok = await login(app, s.supervisorAUsername, s.password);
  });

  it('defaults all categories to true', async () => {
    const r = await request(app).get('/api/notifications/prefs')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    expect(r.body.flagged).toBe(true);
    expect(r.body.reviewResult).toBe(true);
    expect(r.body.sla).toBe(true);
    expect(r.body.announcement).toBe(true);
    expect(r.body.assignment).toBe(true);
  });

  it('PATCH merges and persists changes', async () => {
    const r = await request(app).patch('/api/notifications/prefs')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ flagged: false });
    expect(r.status).toBe(200);
    expect(r.body.flagged).toBe(false);

    const r2 = await request(app).get('/api/notifications/prefs')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r2.body.flagged).toBe(false);
    // Other defaults remain true.
    expect(r2.body.sla).toBe(true);
  });

  it('enqueueNotification skips users who opted out of category', async () => {
    await request(app).patch('/api/notifications/prefs')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ sla: false });

    await enqueueNotification({
      userIds: [s.supervisorAId],
      type: 'sla.pending_breach',
      title: 'test', severity: 'WARN',
    });

    const count = await prisma.notification.count({
      where: { userId: s.supervisorAId, type: 'sla.pending_breach' },
    });
    expect(count).toBe(0);
  });

  it('enqueueNotification still delivers for unmapped types', async () => {
    await request(app).patch('/api/notifications/prefs')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ flagged: false });

    await enqueueNotification({
      userIds: [s.supervisorAId],
      type: 'unknown_category',
      title: 'test', severity: 'INFO',
    });

    const count = await prisma.notification.count({
      where: { userId: s.supervisorAId, type: 'unknown_category' },
    });
    expect(count).toBe(1);
  });
});
