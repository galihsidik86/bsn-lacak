import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET harus minimal 16 karakter'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_DOMAIN: z.string().optional(),
  // `z.coerce.boolean()` would treat the string "false" as true (Boolean("false") === true),
  // so explicitly parse the string instead.
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().default('./uploads'),
  BLAST_PROVIDER: z.enum(['stub', 'twilio']).default('stub'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_SMS: z.string().optional(),
  TWILIO_WA_FROM: z.string().optional(),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  AUDIT_ARCHIVE_DIR: z.string().default('./audit-archive'),
  // Web Push (VAPID). All three optional in dev — push silently no-ops if
  // unset. In prod they must be present or push delivery is dropped.
  VAPID_PUBLIC: z.string().optional(),
  VAPID_PRIVATE: z.string().optional(),
  VAPID_CONTACT: z.string().default('mailto:admin@example.com'),
  // TOTP secret encryption key. Optional — falls back to JWT_SECRET-derived
  // key. In production, set this to a dedicated 32-byte key so rotating JWT
  // signing keys doesn't invalidate 2FA secrets.
  TOTP_ENCRYPTION_KEY: z.string().optional(),
  // SLA monitor — fire a supervisor alert for kunjungan that have been
  // PENDING longer than this. Default 24 hours so dailies stay caught up.
  SLA_PENDING_HOURS: z.coerce.number().int().positive().default(24),
  SLA_POLL_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  // pg_dump backup directory (mounted from the backup container's volume).
  // Empty / unmounted = backup UI shows "not configured".
  BACKUP_DIR: z.string().default('./backups'),
  // Sentry — set to enable error reporting. Absent = no-op.
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENV: z.string().default('development'),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  // Email provider — 'stub' (default) logs the message so dev runs work
  // without an SMTP. 'smtp' uses nodemailer with the SMTP_* settings.
  EMAIL_PROVIDER: z.enum(['stub', 'smtp']).default('stub'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  EMAIL_FROM: z.string().default('BSN Lacak <no-reply@bsn-lacak.local>'),
  // Monthly closing schedule. Runs once per day at the configured hour
  // (24h, server local time); fires the actual CSV only when today is
  // the configured day-of-month.
  CLOSING_EMAIL_DAY: z.coerce.number().int().min(1).max(28).default(1),
  CLOSING_EMAIL_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  // Morning push reminder to PETUGAS — fires once per weekday at the
  // configured local hour. Set MORNING_REMINDER_ENABLED=false to skip.
  MORNING_REMINDER_HOUR: z.coerce.number().int().min(0).max(23).default(7),
  MORNING_REMINDER_ENABLED: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
  // BY — APPROVED/REJECTED kunjungan beyond this age are stamped
  // `archivedAt` by the daily worker. They stay queryable for analytics
  // + audit but disappear from the default supervisor list.
  ARCHIVE_AFTER_DAYS: z.coerce.number().int().positive().default(90),
  ARCHIVE_POLL_MS: z.coerce.number().int().positive().default(6 * 60 * 60 * 1000),
  // CG — auto-followup nudge for JANJI kunjungan. Default 24h; worker
  // polls every 30m so a janji submitted at 09:00 surfaces by ~09:30 the
  // next day at the earliest.
  FOLLOWUP_DELAY_HOURS: z.coerce.number().int().positive().default(24),
  FOLLOWUP_POLL_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
  // CK — escalation sweep. Once every 6h is plenty since the trigger
  // (days without payment) moves slowly.
  ESCALATION_POLL_MS: z.coerce.number().int().positive().default(6 * 60 * 60 * 1000),
  // CN — petugas weekly digest. ISO week dedup + Mon-anchored default.
  WEEKLY_DIGEST_ENABLED: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
  WEEKLY_DIGEST_DAY_OF_WEEK: z.coerce.number().int().min(0).max(6).default(1),  // 0=Sun..6=Sat
  WEEKLY_DIGEST_HOUR: z.coerce.number().int().min(0).max(23).default(6),
  // CO — inactivity detector. Daily at the configured hour; threshold in days.
  INACTIVITY_DAYS: z.coerce.number().int().min(1).max(60).default(3),
  INACTIVITY_CHECK_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  // DG — leave auto-reassign sweep. Every 30 min covers same-day starts
  // without churning the DB.
  LEAVE_REASSIGN_POLL_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
  // DF — stale-nasabah alert. Threshold in days; daily check.
  STALE_NASABAH_DAYS: z.coerce.number().int().min(1).max(180).default(14),
  STALE_NASABAH_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  // Public-facing base URL used to compose share links (receipt PDF, feedback).
  // Defaults to WEB_ORIGIN; override in prod when behind a separate ingress.
  PUBLIC_BASE_URL: z.string().url().optional(),
  // Receipt link TTL — short enough that a leaked URL goes stale quickly,
  // long enough for a nasabah to download from a slow WA preview.
  RECEIPT_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
