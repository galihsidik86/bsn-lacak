import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { runMorningReminderSweep } from '../../src/workers/morningReminderWorker.js';
import { runInactivitySweep } from '../../src/workers/inactivityWorker.js';
import { petugasOnLeaveOn } from '../../src/lib/leaveCheck.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('petugas leave (CS) + audit CSV export (CT)', () => {
  const app = buildApp();
  let s: SeedOut;
  let adminTok: string;
  let supTok: string;
  let petTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    adminTok = await login(app, s.adminUsername, s.password);
    supTok = await login(app, s.supervisorAUsername, s.password);
    petTok = await login(app, s.petugasAUsername, s.password);
  });

  // --- CS ---------------------------------------------------------------

  it('SUPERVISOR creates approved leave; lib reports on-leave', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const r = await request(app).post('/api/leaves')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        petugasId: s.petugasAId,
        startDate: today.toISOString(),
        endDate: new Date(today.getTime() + 86400_000).toISOString(),
        type: 'cuti_tahunan', status: 'approved',
      });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('approved');

    const onLeave = await petugasOnLeaveOn(new Date());
    expect(onLeave.has(s.petugasAId)).toBe(true);
  });

  it('PETUGAS can list own leaves; not others', async () => {
    await prisma.petugasLeave.create({
      data: {
        petugasId: s.petugasAId,
        startDate: new Date(), endDate: new Date(),
        type: 'sakit', status: 'approved',
      },
    });
    const ok = await request(app).get(`/api/leaves?petugasId=${s.petugasAId}`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(ok.status).toBe(200);
    expect(ok.body.length).toBe(1);

    const denied = await request(app).get(`/api/leaves?petugasId=${s.otherPetugasAId}`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(denied.status).toBe(403);
  });

  it('cross-branch SUPERVISOR create → 404', async () => {
    const r = await request(app).post('/api/leaves')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        petugasId: s.petugasBId,
        startDate: new Date(), endDate: new Date(),
        type: 'sakit',
      });
    expect(r.status).toBe(404);
  });

  it('reversed range → 400', async () => {
    const r = await request(app).post('/api/leaves')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        petugasId: s.petugasAId,
        startDate: new Date('2026-06-20'),
        endDate: new Date('2026-06-19'),
        type: 'sakit',
      });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('date_range_invalid');
  });

  it('morning reminder skips petugas on approved leave', async () => {
    // Give petugas A an email so they're eligible…
    await prisma.user.update({ where: { id: s.petugasUserAId }, data: { email: 'p@x.io' } });
    // …then put them on leave today.
    await prisma.petugasLeave.create({
      data: {
        petugasId: s.petugasAId,
        startDate: new Date(Date.now() - 86400_000),
        endDate: new Date(Date.now() + 86400_000),
        type: 'sakit', status: 'approved',
      },
    });
    const out = await runMorningReminderSweep({ force: true });
    // Only petugas A had email + is on leave → no_recipients.
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no_recipients');
  });

  it('inactivity sweep skips petugas on leave', async () => {
    await prisma.petugasLeave.createMany({
      data: [
        { petugasId: s.petugasAId, startDate: new Date(Date.now() - 86400_000), endDate: new Date(Date.now() + 86400_000), type: 'cuti_tahunan', status: 'approved' },
        { petugasId: s.otherPetugasAId, startDate: new Date(Date.now() - 86400_000), endDate: new Date(Date.now() + 86400_000), type: 'cuti_tahunan', status: 'approved' },
        { petugasId: s.petugasBId, startDate: new Date(Date.now() - 86400_000), endDate: new Date(Date.now() + 86400_000), type: 'cuti_tahunan', status: 'approved' },
      ],
    });
    const out = await runInactivitySweep({ force: true });
    expect(out.alerted).toBe(0);
  });

  // --- CT ---------------------------------------------------------------

  it('ADMIN exports audit CSV with header + at least one login row', async () => {
    // The setup logged in adminTok above which writes an auth.login.ok
    // audit row, so we know the table isn't empty.
    const r = await request(app)
      .get('/api/audit/export.csv')
      .set('Authorization', `Bearer ${adminTok}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/csv/);
    const text = (r.body as Buffer).toString('utf-8');
    // BOM + header row first.
    expect(text.startsWith('\ufeff')).toBe(true);
    expect(text.includes('createdAt,action,actor')).toBe(true);
    expect(text.includes('auth.login.ok')).toBe(true);
  });

  it('SUPERVISOR forbidden on audit CSV', async () => {
    const r = await request(app).get('/api/audit/export.csv')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(403);
  });

  it('CSV action filter narrows the result', async () => {
    const r = await request(app)
      .get('/api/audit/export.csv?action=auth.login')
      .set('Authorization', `Bearer ${adminTok}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const text = (r.body as Buffer).toString('utf-8');
    const lines = text.split('\n').slice(1).filter(Boolean);
    // Every data line should contain "auth.login" via the action column.
    expect(lines.every(l => l.includes('auth.login'))).toBe(true);
  });
});
