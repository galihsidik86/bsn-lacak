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
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
