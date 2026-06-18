import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';
import { isWorkingDay, getHolidayOn, listHolidaysForYear } from '../../src/lib/holidays.js';
import { runMorningReminderSweep } from '../../src/workers/morningReminderWorker.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;
}

describe('holiday calendar lib', () => {
  it('returns 17 Aug as nasional holiday', () => {
    const h = getHolidayOn(new Date(2026, 7, 17));
    expect(h?.name).toMatch(/Kemerdekaan/);
    expect(h?.type).toBe('nasional');
  });

  it('isWorkingDay false on weekend', () => {
    // Pick a known Saturday in 2026: 2026-08-15
    expect(isWorkingDay(new Date(2026, 7, 15))).toBe(false);
  });

  it('isWorkingDay false on national holiday weekday', () => {
    // 2026-08-17 is Monday and a national holiday.
    expect(isWorkingDay(new Date(2026, 7, 17))).toBe(false);
  });

  it('isWorkingDay true on a regular Tuesday', () => {
    // 2026-08-18 (Tuesday after independence day).
    expect(isWorkingDay(new Date(2026, 7, 18))).toBe(true);
  });

  it('2026 calendar has at least one entry per major holiday', () => {
    const list = listHolidaysForYear(2026);
    expect(list.length).toBeGreaterThanOrEqual(15);
    const names = list.map(h => h.name).join('|');
    expect(names).toMatch(/Idul Fitri/);
    expect(names).toMatch(/Natal/);
  });
});

d('holidays API + morning reminder skip', () => {
  const app = buildApp();
  let s: SeedOut;
  let adminTok: string;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
    adminTok = await login(app, s.adminUsername, s.password);
  });

  it('GET /api/holidays returns the current year by default', async () => {
    const r = await request(app).get('/api/holidays')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(r.body.holidays.length).toBeGreaterThan(0);
  });

  it('GET /api/holidays?year=2026 returns 2026 list', async () => {
    const r = await request(app).get('/api/holidays?year=2026')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.body.year).toBe(2026);
    expect(r.body.holidays.find((h: any) => h.date === '2026-08-17')).toBeTruthy();
  });

  it('GET /api/holidays/today reports holiday + isWorkingDay', async () => {
    const r = await request(app).get('/api/holidays/today')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(r.status).toBe(200);
    expect(typeof r.body.isWorkingDay).toBe('boolean');
  });

  it('morning reminder skips Independence Day', async () => {
    // 2026-08-17 at 07:00 — should NOT fire even on a weekday.
    const indepDay = new Date(2026, 7, 17, 7, 0, 0);
    const out = await runMorningReminderSweep({ now: indepDay });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('holiday');
  });
});
