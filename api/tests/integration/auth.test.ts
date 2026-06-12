import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

// Skip the whole suite if no DB URL configured.
const d = hasDb ? describe : describe.skip;

d('auth flow', () => {
  const app = buildApp();
  let s: SeedOut;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
  });

  // ---- login ----

  it('issues a token + sets refresh cookie on valid credentials', async () => {
    const r = await request(app).post('/api/auth/login')
      .send({ username: s.supervisorUsername, password: s.password });
    expect(r.status).toBe(200);
    expect(r.body.token).toMatch(/^ey/);
    expect(r.body.role).toBe('SUPERVISOR');
    expect(r.headers['set-cookie']?.join(';')).toMatch(/bsn_rt=/);
  });

  it('rejects unknown username with 401', async () => {
    const r = await request(app).post('/api/auth/login')
      .send({ username: 'nobody', password: 'whatever' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('invalid_credentials');
  });

  it('rejects wrong password with 401', async () => {
    const r = await request(app).post('/api/auth/login')
      .send({ username: s.supervisorUsername, password: 'WrongPass1!' });
    expect(r.status).toBe(401);
  });

  it('locks account after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login')
        .send({ username: s.supervisorUsername, password: 'Wrong!Pwd1234' });
    }
    const r = await request(app).post('/api/auth/login')
      .send({ username: s.supervisorUsername, password: s.password });
    expect(r.status).toBe(423);
    expect(r.body.error).toBe('account_locked');
  });

  // ---- refresh ----

  it('rotates refresh token on /refresh', async () => {
    const login = await request(app).post('/api/auth/login')
      .send({ username: s.supervisorUsername, password: s.password });
    const cookie = login.headers['set-cookie'];

    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(200);
    expect(refresh.body.token).toMatch(/^ey/);

    // The new cookie must differ from the old one (rotation).
    const oldRt = String(cookie[0]).split(';')[0];
    const newRt = String(refresh.headers['set-cookie'][0]).split(';')[0];
    expect(newRt).not.toBe(oldRt);
  });

  it('detects refresh-token reuse and revokes the family', async () => {
    const login = await request(app).post('/api/auth/login')
      .send({ username: s.supervisorUsername, password: s.password });
    const cookie = login.headers['set-cookie'];

    // First refresh — succeeds and rotates.
    const r1 = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(r1.status).toBe(200);
    // The new cookie is now the live token.
    const liveCookie = r1.headers['set-cookie'];

    // Replay the *original* cookie — must blow up the family.
    const reuse = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error).toBe('token_reuse_detected');

    // And the live cookie should now also be revoked.
    const dead = await request(app).post('/api/auth/refresh').set('Cookie', liveCookie);
    expect(dead.status).toBe(401);
  });

  // ---- logout ----

  it('revokes refresh family on logout', async () => {
    const login = await request(app).post('/api/auth/login')
      .send({ username: s.supervisorUsername, password: s.password });
    const cookie = login.headers['set-cookie'];
    const token = login.body.token;

    const logout = await request(app).post('/api/auth/logout')
      .set('Cookie', cookie).set('Authorization', `Bearer ${token}`);
    expect(logout.status).toBe(200);

    const after = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });

  // ---- change-password ----

  it('rejects change-password when current is wrong', async () => {
    const login = await request(app).post('/api/auth/login')
      .send({ username: s.supervisorUsername, password: s.password });
    const r = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ currentPassword: 'NopeNope1!Nope', newPassword: 'Newp4ss!StrongOne' });
    expect(r.status).toBe(401);
  });

  it('rejects change-password when new password is weak', async () => {
    const login = await request(app).post('/api/auth/login')
      .send({ username: s.supervisorUsername, password: s.password });
    const r = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ currentPassword: s.password, newPassword: 'short' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('weak_password');
    expect(Array.isArray(r.body.reasons)).toBe(true);
  });

  it('rejects change-password when current === new', async () => {
    const login = await request(app).post('/api/auth/login')
      .send({ username: s.supervisorUsername, password: s.password });
    const r = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ currentPassword: s.password, newPassword: s.password });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('same_password');
  });

  it('changes password and revokes all refresh tokens', async () => {
    const login = await request(app).post('/api/auth/login')
      .send({ username: s.supervisorUsername, password: s.password });
    const cookie = login.headers['set-cookie'];

    const newPw = 'BrandN3w!Secure22';
    const change = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ currentPassword: s.password, newPassword: newPw });
    expect(change.status).toBe(200);

    // Old cookie no longer usable.
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(refresh.status).toBe(401);

    // Old password no longer logs in.
    const oldLogin = await request(app).post('/api/auth/login')
      .send({ username: s.supervisorUsername, password: s.password });
    expect(oldLogin.status).toBe(401);

    // New password works.
    const newLogin = await request(app).post('/api/auth/login')
      .send({ username: s.supervisorUsername, password: newPw });
    expect(newLogin.status).toBe(200);
  });

  // ---- audit ----

  it('writes an audit row for failed logins', async () => {
    await request(app).post('/api/auth/login')
      .send({ username: s.supervisorUsername, password: 'Wrong!Pwd1234' });
    const row = await prisma.auditLog.findFirst({
      where: { action: 'auth.login.fail' }, orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect(row?.actor).toBe(s.supervisorUsername);
  });
});
