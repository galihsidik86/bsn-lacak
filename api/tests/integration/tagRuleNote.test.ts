import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { runTagRuleSweep } from '../../src/workers/tagRuleWorker.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

async function makeTag(app: ReturnType<typeof buildApp>, tok: string, name: string) {
  return (await request(app).post('/api/tags').set('Authorization', `Bearer ${tok}`).send({ name })).body;
}

d('auto-tag rules (DH) + nasabah notes (DI)', () => {
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

  // --- DH ---------------------------------------------------------------

  it('DPD_ABOVE rule auto-applies tag; sweep removes when nasabah no longer matches', async () => {
    const tag = await makeTag(app, supATok, 'Bermasalah');
    const r = await request(app).post('/api/tags/rules').set('Authorization', `Bearer ${supATok}`)
      .send({ tagId: tag.id, name: 'DPD > 60', type: 'DPD_ABOVE', threshold: 60 });
    expect(r.status).toBe(201);

    // Make one nasabah in branch A overdue.
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    expect(target).toBeTruthy();
    await prisma.nasabah.update({ where: { id: target!.id }, data: { dpd: 90 } });

    const sweep = await runTagRuleSweep({ force: true });
    expect(sweep.ok).toBe(true);
    expect(sweep.applied).toBe(1);

    const after = await prisma.nasabahTag.findFirst({
      where: { nasabahId: target!.id, tagId: tag.id },
    });
    expect(after).toBeTruthy();
    expect(after!.ruleId).toBe(r.body.id);

    // Cure the nasabah → next sweep should remove the auto-applied tag.
    await prisma.nasabah.update({ where: { id: target!.id }, data: { dpd: 0 } });
    const sweep2 = await runTagRuleSweep({ force: true });
    expect(sweep2.removed).toBe(1);
    const gone = await prisma.nasabahTag.findFirst({
      where: { nasabahId: target!.id, tagId: tag.id },
    });
    expect(gone).toBeNull();
  });

  it('sweep is idempotent — second run does no extra work', async () => {
    const tag = await makeTag(app, supATok, 'Macet');
    await request(app).post('/api/tags/rules').set('Authorization', `Bearer ${supATok}`)
      .send({ tagId: tag.id, name: 'Kol macet', type: 'KOL_IN', kolValues: ['K5'] });
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    await prisma.nasabah.update({ where: { id: target!.id }, data: { kol: 'K5' } });
    const first = await runTagRuleSweep({ force: true });
    expect(first.applied).toBe(1);
    const second = await runTagRuleSweep({ force: true });
    expect(second.applied).toBe(0);
    expect(second.removed).toBe(0);
  });

  it('sweep never removes manually-applied tags', async () => {
    const tag = await makeTag(app, supATok, 'VIP');
    await request(app).post('/api/tags/rules').set('Authorization', `Bearer ${supATok}`)
      .send({ tagId: tag.id, name: 'Hi DPD', type: 'DPD_ABOVE', threshold: 60 });
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    // Manual assignment (ruleId stays null).
    await prisma.nasabahTag.create({ data: { nasabahId: target!.id, tagId: tag.id } });
    // Nasabah does NOT match the rule (DPD = 0).
    const sweep = await runTagRuleSweep({ force: true });
    expect(sweep.applied).toBe(0);
    expect(sweep.removed).toBe(0);
    const stillThere = await prisma.nasabahTag.findFirst({ where: { nasabahId: target!.id, tagId: tag.id } });
    expect(stillThere).toBeTruthy();
    expect(stillThere!.ruleId).toBeNull();
  });

  it('PETUGAS cannot create or delete rules', async () => {
    const tag = await makeTag(app, adminTok, 'X');
    const r = await request(app).post('/api/tags/rules').set('Authorization', `Bearer ${petTok}`)
      .send({ tagId: tag.id, name: 'X', type: 'DPD_ABOVE', threshold: 30 });
    expect(r.status).toBe(403);
  });

  it('rule with missing threshold rejected', async () => {
    const tag = await makeTag(app, supATok, 'Aging');
    const r = await request(app).post('/api/tags/rules').set('Authorization', `Bearer ${supATok}`)
      .send({ tagId: tag.id, name: 'no threshold', type: 'DPD_ABOVE' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('threshold_required');
  });

  // --- DI ---------------------------------------------------------------

  it('SUPERVISOR creates note, lists, deletes own; cross-author delete forbidden for non-admin', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const create = await request(app).post(`/api/nasabah/${target!.id}/notes`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ body: 'Janji datang minggu depan.' });
    expect(create.status).toBe(201);
    const noteId = create.body.id;

    const list = await request(app).get(`/api/nasabah/${target!.id}/notes`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);
    expect(list.body[0].author.role).toBe('SUPERVISOR');

    // PETUGAS not the author → forbidden.
    const forbidden = await request(app).delete(`/api/nasabah/${target!.id}/notes/${noteId}`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(forbidden.status).toBe(403);

    // Author can delete.
    const ok = await request(app).delete(`/api/nasabah/${target!.id}/notes/${noteId}`)
      .set('Authorization', `Bearer ${supATok}`);
    expect(ok.status).toBe(200);
  });

  it('ADMIN can delete anyone else note', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const supNote = await request(app).post(`/api/nasabah/${target!.id}/notes`)
      .set('Authorization', `Bearer ${supATok}`)
      .send({ body: 'sup note' });
    const adminDel = await request(app).delete(`/api/nasabah/${target!.id}/notes/${supNote.body.id}`)
      .set('Authorization', `Bearer ${adminTok}`);
    expect(adminDel.status).toBe(200);
  });

  it('empty / oversized body rejected', async () => {
    const target = await prisma.nasabah.findFirst({ where: { branchId: s.branchAId } });
    const empty = await request(app).post(`/api/nasabah/${target!.id}/notes`)
      .set('Authorization', `Bearer ${supATok}`).send({ body: '   ' });
    expect(empty.status).toBe(400);

    const big = 'x'.repeat(2001);
    const huge = await request(app).post(`/api/nasabah/${target!.id}/notes`)
      .set('Authorization', `Bearer ${supATok}`).send({ body: big });
    expect(huge.status).toBe(400);
  });

  it('PETUGAS cannot read notes for nasabah outside scope', async () => {
    const branchBNas = await prisma.nasabah.findFirst({ where: { branchId: s.branchBId } });
    const r = await request(app).get(`/api/nasabah/${branchBNas!.id}/notes`)
      .set('Authorization', `Bearer ${petTok}`);
    expect(r.status).toBe(404);
  });
});
