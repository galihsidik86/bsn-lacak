// Test bootstrap — load .env.test if present, fall back to .env so local devs
// don't need a second file. Integration tests skip themselves when no
// DATABASE_URL is set (e.g. unit-only CI step).
import { config } from 'dotenv';
import { existsSync } from 'node:fs';

if (existsSync('.env.test')) config({ path: '.env.test' });
else config();

// Snapshot whether a real DB is reachable *before* we apply fallbacks. Integration
// tests use this gate to skip themselves; otherwise env.ts validation would
// crash the process simply because routes get imported.
if (process.env.DATABASE_URL) process.env.BSN_TEST_HAS_DB = '1';

// Defaults so env.ts validation passes even in unit-only runs.
process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-secret-min-16-chars-asdfghjkl';
process.env.JWT_EXPIRES_IN ??= '15m';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';
process.env.UPLOAD_DIR ??= './uploads-test';
process.env.BLAST_PROVIDER ??= 'stub';
process.env.DATABASE_URL ??= 'postgresql://noop:noop@127.0.0.1:1/noop';
