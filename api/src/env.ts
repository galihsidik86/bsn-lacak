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
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
