import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('Announcement broadcast', () => {
  const app = buildApp();
  let s: SeedOut;
  let supTok: string;
  let adminTok: string;
  let petTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    supTok = await login(app, s.supervisorAUsername, s.password);
    adminTok = await login(app, s.adminUsername, s.password);
    petTok = await login(app, s.petugasAUsername, s.password);
  });

  it('SUPERVISOR broadcasts to petugas in own branch only', async () => {
    const r = await request(app).post('/api/announcements/broadcast')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ title: 'Briefing', body: 'Pagi 07:00', severity: 'INFO', audience: 'PETUGAS' });
    expect(r.status).toBe(201);
    expect(r.body.recipients).toBe(1); // only petugasA's user
    const notifs = await prisma.notification.findMany({
      where: { type: 'announcement', userId: s.petugasUserAId },
    });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].title).toBe('Briefing');
  });

  it('PETUGAS cannot broadcast (403)', async () => {
    const r = await request(app).post('/api/announcements/broadcast')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ title: 'x' });
    expect(r.status).toBe(403);
  });

  it('ADMIN can broadcast to ALL across branches', async () => {
    const r = await request(app).post('/api/announcements/broadcast')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ title: 'Sistem maintenance', severity: 'WARN', audience: 'ALL' });
    expect(r.status).toBe(201);
    expect(r.body.recipients).toBeGreaterThanOrEqual(3);    // petugas A + sup A + sup B at minimum
  });

  it('400 on empty title', async () => {
    const r = await request(app).post('/api/announcements/broadcast')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ title: '', severity: 'INFO' });
    expect(r.status).toBe(400);
  });

  it('400 when audience filter yields no recipients', async () => {
    // SUPERVISOR-only audience but no other supervisors in branch A.
    const r = await request(app).post('/api/announcements/broadcast')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ title: 'x', audience: 'SUPERVISOR' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('no_recipients');
  });
});
