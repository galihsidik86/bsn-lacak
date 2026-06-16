import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { compare, hash, sign, requireAuth, signTotpChallenge, verifyTotpChallenge } from '../auth.js';
import { decryptSecret, encryptSecret, generateSecret, verifyCode } from '../lib/totp.js';
import { audit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { loginFails, loginLockouts } from '../lib/metrics.js';
import { checkPasswordPolicy } from '../lib/password.js';
import {
  REFRESH_COOKIE, clearRefreshCookie, issueRefreshToken,
  revokeFamily, rotateRefreshToken, setRefreshCookie,
} from '../lib/tokens.js';

const router = Router();

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });

  const ip = req.ip ?? null;
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 256);
  const user = await prisma.user.findUnique({ where: { username: parsed.data.username } });

  if (!user) {
    loginFails.inc({ reason: 'unknown_user' });
    await audit({ action: 'auth.login.fail', actor: parsed.data.username, ip, userAgent: ua, meta: { reason: 'unknown_user' } });
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await audit({ action: 'auth.login.locked', actorId: user.id, actor: user.username, ip, userAgent: ua });
    return res.status(423).json({ error: 'account_locked', until: user.lockedUntil });
  }

  const ok = await compare(parsed.data.password, user.passwordHash);
  if (!ok) {
    const attempts = user.failedAttempts + 1;
    const shouldLock = attempts >= LOCKOUT_THRESHOLD;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MS) : null,
      },
    });
    loginFails.inc({ reason: 'wrong_password' });
    if (shouldLock) loginLockouts.inc();
    await audit({
      action: shouldLock ? 'auth.login.lockout' : 'auth.login.fail',
      actorId: user.id, actor: user.username, ip, userAgent: ua,
      meta: { attempts },
    });
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  // Credentials OK — if the user has 2FA enabled we stop here and hand
  // back a short-lived challenge token. Real session is only created
  // after POST /auth/totp/login completes successfully.
  if (user.totpEnabledAt) {
    await audit({ action: 'auth.login.totp_required', actorId: user.id, actor: user.username, ip, userAgent: ua });
    return res.json({ requireTotp: true, totpChallenge: signTotpChallenge(user.id) });
  }

  return finalizeLogin(user, req, res, ip, ua);
});

// Promote a successful credential check into a real session. Used both by
// the no-2FA login path and the TOTP-verified path below.
async function finalizeLogin(
  user: { id: string; username: string; role: any; petugasId: string | null; branchId: string | null; nama: string; mustChangePassword: boolean },
  req: any, res: any, ip: string | null, ua: string,
) {
  await prisma.user.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const access = sign({ sub: user.id, role: user.role, petugasId: user.petugasId, branchId: user.branchId });
  const { raw } = await issueRefreshToken({ userId: user.id, req });
  setRefreshCookie(res, raw);

  await audit({ action: 'auth.login.ok', actorId: user.id, actor: user.username, ip, userAgent: ua });
  logger.info({ userId: user.id, role: user.role, branchId: user.branchId }, 'login_ok');

  let branchName: string | null = null;
  if (user.branchId) {
    const b = await prisma.branch.findUnique({ where: { id: user.branchId }, select: { nama: true } });
    branchName = b?.nama ?? null;
  }

  res.json({
    token: access,
    role: user.role,
    nama: user.nama,
    petugasId: user.petugasId,
    branchId: user.branchId,
    branchName,
    mustChangePassword: user.mustChangePassword,
  });
}

const totpLoginSchema = z.object({
  totpChallenge: z.string().min(1).max(2000),
  code: z.string().regex(/^\d{6}$/),
});

router.post('/totp/login', async (req, res) => {
  const parsed = totpLoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });

  let userId: string;
  try { userId = verifyTotpChallenge(parsed.data.totpChallenge).sub; }
  catch { return res.status(401).json({ error: 'challenge_invalid' }); }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active || !user.totpEnabledAt || !user.totpSecret) {
    return res.status(401).json({ error: 'challenge_invalid' });
  }
  let secret: string;
  try { secret = decryptSecret(user.totpSecret); }
  catch { return res.status(500).json({ error: 'totp_secret_corrupt' }); }
  if (!verifyCode(secret, parsed.data.code)) {
    await audit({ action: 'auth.totp.fail', actorId: user.id, actor: user.username, ip: req.ip ?? null });
    return res.status(401).json({ error: 'invalid_code' });
  }

  const ip = req.ip ?? null;
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 256);
  return finalizeLogin(user, req, res, ip, ua);
});

router.post('/refresh', async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw || typeof raw !== 'string') return res.status(401).json({ error: 'no_refresh_token' });

  const out = await rotateRefreshToken(raw, req);
  if (out.kind === 'reuse') {
    await audit({ action: 'auth.refresh.reuse_detected', actorId: out.userId, ip: req.ip ?? null, meta: { family: out.family } });
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'token_reuse_detected' });
  }
  if (out.kind !== 'ok') {
    clearRefreshCookie(res);
    return res.status(401).json({ error: out.kind });
  }

  const access = sign({
    sub: out.user.id, role: out.user.role,
    petugasId: out.user.petugasId, branchId: out.user.branchId,
  });
  setRefreshCookie(res, out.refresh.raw);
  res.json({
    token: access, role: out.user.role, nama: out.user.nama,
    branchId: out.user.branchId,
  });
});

router.post('/logout', requireAuth, async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (typeof raw === 'string') await revokeFamily(raw);
  clearRefreshCookie(res);
  await audit({ action: 'auth.logout', actorId: req.user!.sub, ip: req.ip ?? null });
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const u = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    include: { branch: { select: { id: true, kode: true, nama: true } } },
  });
  if (!u) return res.status(404).json({ error: 'not_found' });
  res.json({
    id: u.id, username: u.username, nama: u.nama, role: u.role,
    petugasId: u.petugasId,
    branchId: u.branchId,
    branch: u.branch ?? null,
    mustChangePassword: u.mustChangePassword,
  });
});

const changeSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});
router.post('/change-password', requireAuth, async (req, res) => {
  const parsed = changeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });

  const u = await prisma.user.findUnique({ where: { id: req.user!.sub } });
  if (!u) return res.status(404).json({ error: 'not_found' });

  const ok = await compare(parsed.data.currentPassword, u.passwordHash);
  if (!ok) {
    await audit({ action: 'auth.change_password.fail', actorId: u.id, actor: u.username, ip: req.ip ?? null });
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const policy = checkPasswordPolicy(parsed.data.newPassword);
  if (!policy.ok) return res.status(400).json({ error: 'weak_password', reasons: policy.reasons });

  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return res.status(400).json({ error: 'same_password' });
  }

  await prisma.user.update({
    where: { id: u.id },
    data: {
      passwordHash: await hash(parsed.data.newPassword),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
    },
  });

  // Revoke all refresh tokens for this user → force re-login everywhere.
  await prisma.refreshToken.updateMany({
    where: { userId: u.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  clearRefreshCookie(res);

  await audit({ action: 'auth.change_password.ok', actorId: u.id, actor: u.username, ip: req.ip ?? null });
  res.json({ ok: true });
});

// ---- TOTP self-service for authenticated users ---------------------------

router.get('/totp/status', requireAuth, async (req, res) => {
  const u = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { totpEnabledAt: true, totpSecret: true },
  });
  if (!u) return res.status(404).json({ error: 'not_found' });
  res.json({
    enabled: !!u.totpEnabledAt,
    pending: !!u.totpSecret && !u.totpEnabledAt,
    enabledAt: u.totpEnabledAt,
  });
});

// Begin setup: generate a fresh secret, store as PENDING, return the
// otpauth URI for the client to render as a QR. Replaces any prior
// pending secret so a user who abandoned setup can restart cleanly.
router.post('/totp/setup', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (user.totpEnabledAt) return res.status(409).json({ error: 'already_enabled' });

  const { base32, otpauth } = generateSecret();
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: encryptSecret(base32), totpEnabledAt: null },
  });
  await audit({ action: 'auth.totp.setup_start', actorId: user.id, actor: user.username, ip: req.ip ?? null });
  res.json({
    secret: base32,
    otpauth: otpauth(`BSN Lacak (${user.username})`, 'BSN Lacak'),
  });
});

const verifySetupSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

router.post('/totp/verify-setup', requireAuth, async (req, res) => {
  const parsed = verifySetupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });

  const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
  if (!user || !user.totpSecret) return res.status(409).json({ error: 'no_pending_setup' });
  if (user.totpEnabledAt) return res.status(409).json({ error: 'already_enabled' });

  const secret = decryptSecret(user.totpSecret);
  if (!verifyCode(secret, parsed.data.code)) {
    return res.status(401).json({ error: 'invalid_code' });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { totpEnabledAt: new Date() },
  });
  await audit({ action: 'auth.totp.enabled', actorId: user.id, actor: user.username, ip: req.ip ?? null });
  res.json({ ok: true, enabledAt: new Date() });
});

const disableSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  currentPassword: z.string().min(1).max(256),
});

// Require both a fresh TOTP code AND the password — same reason banks ask
// for re-auth before security changes: a borrowed-phone attack shouldn't
// flip 2FA off.
router.post('/totp/disable', requireAuth, async (req, res) => {
  const parsed = disableSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });

  const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
  if (!user || !user.totpEnabledAt || !user.totpSecret) {
    return res.status(409).json({ error: 'not_enabled' });
  }
  const passOk = await compare(parsed.data.currentPassword, user.passwordHash);
  if (!passOk) return res.status(401).json({ error: 'invalid_password' });

  const secret = decryptSecret(user.totpSecret);
  if (!verifyCode(secret, parsed.data.code)) {
    return res.status(401).json({ error: 'invalid_code' });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: null, totpEnabledAt: null },
  });
  await audit({ action: 'auth.totp.disabled', actorId: user.id, actor: user.username, ip: req.ip ?? null });
  res.json({ ok: true });
});

export default router;
