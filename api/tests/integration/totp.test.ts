import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import { buildApp, hasDb, prisma, resetDb } from '../helpers/app.js';
import { seedBasic, type SeedOut } from '../helpers/fixtures.js';

const d = hasDb ? describe : describe.skip;

async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return await request(app).post('/api/auth/login').send({ username: u, password: p });
}

function codeFor(base32: string): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(base32),
    algorithm: 'SHA1', digits: 6, period: 30,
  }).generate();
}

d('TOTP 2FA flow', () => {
  const app = buildApp();
  let s: SeedOut;

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await resetDb();
    s = await seedBasic(prisma);
  });

  it('login returns normal token when TOTP not enabled', async () => {
    const r = await login(app, s.supervisorAUsername, s.password);
    expect(r.status).toBe(200);
    expect(r.body.token).toMatch(/^ey/);
    expect(r.body.requireTotp).toBeUndefined();
  });

  it('setup → verify-setup → status flow enables 2FA', async () => {
    const loginRes = await login(app, s.supervisorAUsername, s.password);
    const tok = loginRes.body.token;
    const setup = await request(app).post('/api/auth/totp/setup')
      .set('Authorization', `Bearer ${tok}`).send();
    expect(setup.status).toBe(200);
    expect(setup.body.secret).toBeTruthy();
    expect(setup.body.otpauth).toMatch(/^otpauth:\/\/totp\//);

    const verify = await request(app).post('/api/auth/totp/verify-setup')
      .set('Authorization', `Bearer ${tok}`)
      .send({ code: codeFor(setup.body.secret) });
    expect(verify.status).toBe(200);

    const status = await request(app).get('/api/auth/totp/status')
      .set('Authorization', `Bearer ${tok}`);
    expect(status.body.enabled).toBe(true);
  });

  it('verify-setup rejects invalid code', async () => {
    const loginRes = await login(app, s.supervisorAUsername, s.password);
    const tok = loginRes.body.token;
    await request(app).post('/api/auth/totp/setup').set('Authorization', `Bearer ${tok}`).send();
    const r = await request(app).post('/api/auth/totp/verify-setup')
      .set('Authorization', `Bearer ${tok}`).send({ code: '000000' });
    expect(r.status).toBe(401);
  });

  it('login after enable returns totpChallenge instead of token', async () => {
    const loginRes = await login(app, s.supervisorAUsername, s.password);
    const tok = loginRes.body.token;
    const setup = await request(app).post('/api/auth/totp/setup').set('Authorization', `Bearer ${tok}`).send();
    await request(app).post('/api/auth/totp/verify-setup')
      .set('Authorization', `Bearer ${tok}`).send({ code: codeFor(setup.body.secret) });

    const r2 = await login(app, s.supervisorAUsername, s.password);
    expect(r2.status).toBe(200);
    expect(r2.body.requireTotp).toBe(true);
    expect(r2.body.totpChallenge).toMatch(/^ey/);
    expect(r2.body.token).toBeUndefined();
  });

  it('totp/login completes the session with the correct code', async () => {
    const loginRes = await login(app, s.supervisorAUsername, s.password);
    const tok = loginRes.body.token;
    const setup = await request(app).post('/api/auth/totp/setup').set('Authorization', `Bearer ${tok}`).send();
    await request(app).post('/api/auth/totp/verify-setup')
      .set('Authorization', `Bearer ${tok}`).send({ code: codeFor(setup.body.secret) });

    const r2 = await login(app, s.supervisorAUsername, s.password);
    const r3 = await request(app).post('/api/auth/totp/login')
      .send({ totpChallenge: r2.body.totpChallenge, code: codeFor(setup.body.secret) });
    expect(r3.status).toBe(200);
    expect(r3.body.token).toMatch(/^ey/);
  });

  it('totp/login rejects wrong code with 401', async () => {
    const loginRes = await login(app, s.supervisorAUsername, s.password);
    const tok = loginRes.body.token;
    const setup = await request(app).post('/api/auth/totp/setup').set('Authorization', `Bearer ${tok}`).send();
    await request(app).post('/api/auth/totp/verify-setup')
      .set('Authorization', `Bearer ${tok}`).send({ code: codeFor(setup.body.secret) });

    const r2 = await login(app, s.supervisorAUsername, s.password);
    const r3 = await request(app).post('/api/auth/totp/login')
      .send({ totpChallenge: r2.body.totpChallenge, code: '000000' });
    expect(r3.status).toBe(401);
  });

  it('disable requires both code AND password', async () => {
    const loginRes = await login(app, s.supervisorAUsername, s.password);
    const tok = loginRes.body.token;
    const setup = await request(app).post('/api/auth/totp/setup').set('Authorization', `Bearer ${tok}`).send();
    await request(app).post('/api/auth/totp/verify-setup')
      .set('Authorization', `Bearer ${tok}`).send({ code: codeFor(setup.body.secret) });

    const wrongPw = await request(app).post('/api/auth/totp/disable')
      .set('Authorization', `Bearer ${tok}`)
      .send({ code: codeFor(setup.body.secret), currentPassword: 'wrong-pw' });
    expect(wrongPw.status).toBe(401);

    const ok = await request(app).post('/api/auth/totp/disable')
      .set('Authorization', `Bearer ${tok}`)
      .send({ code: codeFor(setup.body.secret), currentPassword: s.password });
    expect(ok.status).toBe(200);
  });
});
