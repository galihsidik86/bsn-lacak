import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

d('nasabah documents (DN) + attendance dispute (DO)', () => {
  const app = buildApp();
  let s: SeedOut;
  let adminTok: string;
  let supATok: string;
  let petTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    adminTok = await login(app, s.adminUsername, s.password);
    supATok = await login(app, s.supervisorAUsername, s.password);
    petTok = await login(app, s.petugasAUsername, s.password);
  });

  // --- DN ---------------------------------------------------------------

  it('SUPERVISOR uploads a PDF doc; list returns it; delete removes', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const pdfBuf = Buffer.from('%PDF-1.4\n%fake');
    const upload = await request(app).post(`/api/nasabah-docs/${target!.id}`)
      .set('Authorization', `Bearer ${supATok}`)
      .field('kind', 'KTP')
      .field('notes', 'scan KTP terbaru')
      .attach('file', pdfBuf, { filename: 'ktp.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    expect(upload.body.kind).toBe('KTP');
    expect(upload.body.fileName).toBe('ktp.pdf');
    expect(upload.body.notes).toBe('scan KTP terbaru');
    expect(fs.existsSync(path.resolve(upload.body.filePath))).toBe(true);

    const list = await request(app).get(`/api/nasabah-docs/${target!.id}`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);

    const rm = await request(app).delete(`/api/nasabah-docs/${target!.id}/${upload.body.id}`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(rm.status).toBe(200);

    const after = await request(app).get(`/api/nasabah-docs/${target!.id}`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(after.body.length).toBe(0);
    expect(fs.existsSync(path.resolve(upload.body.filePath))).toBe(false);
  });

  it('PETUGAS forbidden to upload', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const r = await request(app).post(`/api/nasabah-docs/${target!.id}`)
      .set('Authorization', `Bearer ${petTok}`)
      .field('kind', 'KTP')
      .attach('file', Buffer.from('x'), { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(403);
  });

  it('bad MIME type rejected', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const r = await request(app).post(`/api/nasabah-docs/${target!.id}`)
      .set('Authorization', `Bearer ${supATok}`)
      .field('kind', 'LAIN')
      .attach('file', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' });
    // multer fileFilter drops the file, so req.file is undefined → 400.
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('no_file');
  });

  // --- DO ---------------------------------------------------------------

  it('PETUGAS opens dispute on own attendance; SUPERVISOR approves; clockOut patched', async () => {
    // Seed an attendance row owned by petugasA, with clockOut still null.
    const clockInAt = new Date(Date.now() - 8 * 60 * 60_000);
    const att = await prisma.attendance.create({
      data: {
        petugasId: s.petugasAId, branchId: s.branchAId, clockInAt,
        clockInLat: -6.2, clockInLng: 106.8,
      },
    });
    const proposedClockOut = new Date();

    const open = await request(app).post('/api/attendance-disputes')
      .set('Authorization', `Bearer ${petTok}`)
      .send({
        attendanceId: att.id,
        reason: 'lupa clock-out, sudah pulang jam 5',
        proposedClockOut: proposedClockOut.toISOString(),
      });
    expect(open.status).toBe(201);

    const decide = await request(app).patch(`/api/attendance-disputes/${open.body.id}/decision`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ decision: 'APPROVED', note: 'ok' });
    expect(decide.status).toBe(200);

    const after = await prisma.attendance.findUnique({ where: { id: att.id } });
    expect(after!.clockOutAt?.getTime()).toBe(proposedClockOut.getTime());
  });

  it('PETUGAS cannot dispute someone else attendance', async () => {
    const att = await prisma.attendance.create({
      data: { petugasId: s.otherPetugasAId, branchId: s.branchAId, clockInAt: new Date() },
    });
    const r = await request(app).post('/api/attendance-disputes')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ attendanceId: att.id, reason: 'r', proposedClockOut: new Date().toISOString() });
    expect(r.status).toBe(403);
  });

  it('dispute without any proposed time → 400', async () => {
    const att = await prisma.attendance.create({
      data: { petugasId: s.petugasAId, branchId: s.branchAId, clockInAt: new Date() },
    });
    const r = await request(app).post('/api/attendance-disputes')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ attendanceId: att.id, reason: 'r' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('no_proposed_time');
  });

  it('REJECTED dispute leaves attendance untouched', async () => {
    const clockInAt = new Date(Date.now() - 60_000);
    const att = await prisma.attendance.create({
      data: { petugasId: s.petugasAId, branchId: s.branchAId, clockInAt },
    });
    const open = await request(app).post('/api/attendance-disputes')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ attendanceId: att.id, reason: 'r', proposedClockOut: new Date().toISOString() });
    await request(app).patch(`/api/attendance-disputes/${open.body.id}/decision`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ decision: 'REJECTED', note: 'tidak valid' });

    const after = await prisma.attendance.findUnique({ where: { id: att.id } });
    expect(after!.clockOutAt).toBeNull();
  });

  it('duplicate PENDING blocked with 409', async () => {
    const att = await prisma.attendance.create({
      data: { petugasId: s.petugasAId, branchId: s.branchAId, clockInAt: new Date() },
    });
    await request(app).post('/api/attendance-disputes')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ attendanceId: att.id, reason: 'r', proposedClockOut: new Date().toISOString() });
    const dup = await request(app).post('/api/attendance-disputes')
      .set('Authorization', `Bearer ${petTok}`)
      .send({ attendanceId: att.id, reason: 'r2', proposedClockOut: new Date().toISOString() });
    expect(dup.status).toBe(409);
  });

  it('cross-branch SUPERVISOR cannot see dispute on other branch', async () => {
    const att = await prisma.attendance.create({
      data: { petugasId: s.petugasBId, branchId: s.branchBId, clockInAt: new Date() },
    });
    // Admin proposes on branch B.
    const open = await request(app).post('/api/attendance-disputes')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ attendanceId: att.id, reason: 'r', proposedClockOut: new Date().toISOString() });
    expect(open.status).toBe(201);

    // Sup A's listing should not show it.
    const list = await request(app).get('/api/attendance-disputes')
      .set('Authorization', `Bearer ${supATok}`);
    expect(list.body.find((d: any) => d.id === open.body.id)).toBeUndefined();
  });
});
