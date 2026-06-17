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

d('pembayaran bulk import', () => {
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

  it('imports valid rows and reduces sisa for berhasil status', async () => {
    const before = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const beforeSisa = before!.sisa;

    const r = await request(app).post('/api/angsuran/bulk')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        rows: [
          { kodeNasabah: 'N0001', tanggal: '2026-06-15', jam: '09:30', metode: 'tunai', status: 'berhasil', nominal: 100_000 },
          { kodeNasabah: 'N0002', tanggal: '2026-06-15', jam: '10:00', metode: 'transfer', status: 'berhasil', nominal: 50_000 },
        ],
      });
    expect(r.status).toBe(201);
    expect(r.body.imported).toBe(2);

    const after = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    expect(after!.sisa).toBe(beforeSisa - 100_000n);

    const pembayaranCount = await prisma.pembayaran.count();
    expect(pembayaranCount).toBe(2);
  });

  it('skips unknown nasabah without aborting the batch', async () => {
    const r = await request(app).post('/api/angsuran/bulk')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        rows: [
          { kodeNasabah: 'N9999', tanggal: '2026-06-15', nominal: 100_000 },
          { kodeNasabah: 'N0001', tanggal: '2026-06-15', nominal: 200_000 },
        ],
      });
    expect(r.status).toBe(201);
    expect(r.body.imported).toBe(1);
    expect(r.body.outcomes[0].status).toBe('unknown_nasabah');
    expect(r.body.outcomes[1].status).toBe('imported');
  });

  it('SUPERVISOR cannot import for nasabah outside their branch', async () => {
    const r = await request(app).post('/api/angsuran/bulk')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        rows: [
          // N0004 belongs to branch B; supervisor A is branch A → cross_branch
          { kodeNasabah: 'N0004', tanggal: '2026-06-15', nominal: 100_000 },
        ],
      });
    expect(r.status).toBe(201);
    expect(r.body.imported).toBe(0);
    expect(r.body.outcomes[0].status).toBe('cross_branch');
  });

  it('does not reduce sisa for pending/gagal rows', async () => {
    const before = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const r = await request(app).post('/api/angsuran/bulk')
      .set('Authorization', `Bearer ${supTok}`)
      .send({
        rows: [
          { kodeNasabah: 'N0001', tanggal: '2026-06-15', status: 'pending', nominal: 100_000 },
        ],
      });
    expect(r.status).toBe(201);
    const after = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    expect(after!.sisa).toBe(before!.sisa);
    const count = await prisma.pembayaran.count();
    expect(count).toBe(1);
  });
});
