import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('API keys', () => {
  const app = buildApp();
  let s: SeedOut;
  let adminTok: string;
  let supTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    adminTok = await login(app, s.adminUsername, s.password);
    supTok = await login(app, s.supervisorAUsername, s.password);
  });

  it('ADMIN creates a key and gets the raw token once', async () => {
    const r = await request(app).post('/api/api-keys')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'Reporting', scope: 'read' });
    expect(r.status).toBe(201);
    expect(r.body.token).toMatch(/^bsn_apikey_[a-f0-9]{32}$/);
    expect(r.body.prefix.startsWith('bsn_apikey_')).toBe(true);
  });

  it('SUPERVISOR cannot create keys (403)', async () => {
    const r = await request(app).post('/api/api-keys')
      .set('Authorization', `Bearer ${supTok}`)
      .send({ name: 'X' });
    expect(r.status).toBe(403);
  });

  it('API key authenticates subsequent requests', async () => {
    const create = await request(app).post('/api/api-keys')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'Reader', scope: 'read' });
    const key = create.body.token;

    const r = await request(app).get('/api/petugas')
      .set('Authorization', `Bearer ${key}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it('revoked key is rejected', async () => {
    const create = await request(app).post('/api/api-keys')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'TempKey' });
    const key = create.body.token;
    const id = create.body.id;

    await request(app).post(`/api/api-keys/${id}/revoke`)
      .set('Authorization', `Bearer ${adminTok}`);

    const r = await request(app).get('/api/petugas')
      .set('Authorization', `Bearer ${key}`);
    expect(r.status).toBe(401);
  });

  it('LIST returns prefix + masks token in stored hash', async () => {
    await request(app).post('/api/api-keys')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: 'List Me' });
    const r = await request(app).get('/api/api-keys')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.body.length).toBeGreaterThan(0);
    const row = r.body[0];
    expect(row.tokenPrefix.startsWith('bsn_apikey_')).toBe(true);
    expect(row).not.toHaveProperty('tokenHash'); // hash is not exposed to clients
  });
});
