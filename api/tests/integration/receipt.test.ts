import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { makeReceiptToken, verifyReceiptToken } from '../../src/lib/receiptToken.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, username: string, password: string): Promise<string> {
  const r = await request(app).post('/api/auth/login').send({ username, password });
  if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
  return r.body.token as string;
}

async function makeBayarKunjungan(seed: SeedOut, nominal: bigint): Promise<string> {
  const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
  const k = await prisma.kunjungan.create({
    data: {
      nasabahId: n!.id, petugasId: seed.petugasAId, branchId: seed.branchAId,
      hasil: 'BAYAR', nominal, catatan: 'thx', lokasi: 'rumah',
      jam: '10:00', tanggal: new Date(), reviewStatus: 'APPROVED',
    },
  });
  return k.id;
}

d('receipt token + PDF', () => {
  const app = buildApp();
  let s: SeedOut;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
  });

  it('roundtrips a valid token', () => {
    const t = makeReceiptToken('cuid_abc123');
    const v = verifyReceiptToken(t);
    expect(v?.kunjunganId).toBe('cuid_abc123');
  });

  it('rejects a tampered token', () => {
    const t = makeReceiptToken('cuid_abc');
    const bad = t.slice(0, -2) + (t.slice(-2) === 'AA' ? 'BB' : 'AA');
    expect(verifyReceiptToken(bad)).toBeNull();
  });

  it('serves a PDF for a real BAYAR kunjungan via token', async () => {
    const id = await makeBayarKunjungan(s, 100_000n);
    const tok = makeReceiptToken(id);
    const r = await request(app)
      .get(`/api/receipt/${tok}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/pdf/);
    const buf = r.body as Buffer;
    expect(buf.subarray(0, 4).toString('utf-8')).toBe('%PDF');
  });

  it('404 when kunjungan is not BAYAR', async () => {
    const n = await prisma.nasabah.findFirst({ where: { kode: 'N0001' } });
    const k = await prisma.kunjungan.create({
      data: {
        nasabahId: n!.id, petugasId: s.petugasAId, branchId: s.branchAId,
        hasil: 'JANJI', nominal: 0n, catatan: '', lokasi: '',
        jam: '09:00', tanggal: new Date(), reviewStatus: 'APPROVED',
      },
    });
    const tok = makeReceiptToken(k.id);
    const r = await request(app).get(`/api/receipt/${tok}/pdf`);
    expect(r.status).toBe(404);
  });

  it('resend endpoint requires supervisor scope', async () => {
    const id = await makeBayarKunjungan(s, 100_000n);
    const supBTok = await login(app, s.supervisorBUsername, s.password);
    // Supervisor B is from a different branch → out of scope.
    const r = await request(app)
      .post(`/api/receipt/${id}/resend`)
      .set('Authorization', `Bearer ${supBTok}`);
    expect(r.status).toBe(404);
  });
});
