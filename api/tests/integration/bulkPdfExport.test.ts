import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, username: string, password: string): Promise<string> {
  const r = await request(app).post('/api/auth/login').send({ username, password });
  if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
  return r.body.token as string;
}

async function makeKunjungan(seed: SeedOut, kode: string) {
  const n = await prisma.nasabah.findFirst({ where: { kode } });
  return prisma.kunjungan.create({
    data: {
      nasabahId: n!.id, petugasId: seed.petugasAId, branchId: seed.branchAId,
      hasil: 'BAYAR', nominal: 0n, catatan: 'x', lokasi: 'x',
      jam: '10:00', tanggal: new Date(),
      reviewStatus: 'APPROVED',
    },
  });
}

d('bulk PDF export', () => {
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

  it('streams a zip when there are matching rows', async () => {
    await makeKunjungan(s, 'N0001');
    await makeKunjungan(s, 'N0002');

    const r = await request(app)
      .get('/api/kunjungan/bulk-export.zip')
      .set('Authorization', `Bearer ${supTok}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/zip/);
    // PK magic at the head of a real zip.
    const body = r.body as Buffer;
    expect(body.length).toBeGreaterThan(100);
    expect(body.subarray(0, 2).toString('utf-8')).toBe('PK');
  });

  it('returns 404 when no rows match', async () => {
    const r = await request(app)
      .get('/api/kunjungan/bulk-export.zip?since=2099-01-01')
      .set('Authorization', `Bearer ${supTok}`);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('empty');
  });

  it('SUPERVISOR cannot pull cross-branch rows', async () => {
    // Create one in branch A, then request as supervisor B.
    await makeKunjungan(s, 'N0001');
    const supBTok = await login(app, s.supervisorBUsername, s.password);
    const r = await request(app)
      .get('/api/kunjungan/bulk-export.zip')
      .set('Authorization', `Bearer ${supBTok}`);
    expect(r.status).toBe(404); // empty after scope filter
  });
});
