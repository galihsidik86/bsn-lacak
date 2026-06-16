import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('Attendance clock-in/out', () => {
  const app = buildApp();
  let s: SeedOut;
  let petTok: string;
  let supTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    petTok = await login(app, s.petugasAUsername, s.password);
    supTok = await login(app, s.supervisorAUsername, s.password);
  });

  it('PETUGAS clocks in successfully', async () => {
    const r = await request(app).post('/api/attendance/clock-in')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ lat: -6.48, lng: 106.85 });
    expect(r.status).toBe(201);
    expect(r.body.clockInAt).toBeTruthy();
    expect(r.body.clockOutAt).toBeNull();
    expect(r.body.petugasId).toBe(s.petugasAId);
  });

  it('rejects second clock-in while session is open', async () => {
    await request(app).post('/api/attendance/clock-in')
      .set('Authorization', `Bearer ${petTok}`).send({});
    const r = await request(app).post('/api/attendance/clock-in')
      .set('Authorization', `Bearer ${petTok}`).send({});
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('already_clocked_in');
  });

  it('clock-out closes the open session', async () => {
    await request(app).post('/api/attendance/clock-in')
      .set('Authorization', `Bearer ${petTok}`).send({});
    const r = await request(app).post('/api/attendance/clock-out')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ lat: -6.49, lng: 106.86 });
    expect(r.status).toBe(200);
    expect(r.body.clockOutAt).toBeTruthy();
    expect(r.body.clockOutLat).toBe(-6.49);
  });

  it('clock-out without an open session returns 404', async () => {
    const r = await request(app).post('/api/attendance/clock-out')
      .set('Authorization', `Bearer ${petTok}`).send({});
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('not_clocked_in');
  });

  it('SUPERVISOR cannot clock in (403)', async () => {
    const r = await request(app).post('/api/attendance/clock-in')
      .set('Authorization', `Bearer ${supTok}`).send({});
    expect(r.status).toBe(403);
  });

  it('GET /mine returns current open session', async () => {
    await request(app).post('/api/attendance/clock-in')
      .set('Authorization', `Bearer ${petTok}`).send({});
    const r = await request(app).get('/api/attendance/mine')
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(200);
    expect(r.body.current).not.toBeNull();
    expect(r.body.today).toHaveLength(1);
  });

  it('SUPERVISOR sees today list scoped to their branch', async () => {
    await request(app).post('/api/attendance/clock-in')
      .set('Authorization', `Bearer ${petTok}`).send({});
    const r = await request(app).get('/api/attendance/today')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(1);
    expect(r.body[0].branchId).toBe(s.branchAId);
  });
});
