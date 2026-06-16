import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { requireAuth, requireRole } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import { env } from '../env.js';

const router = Router();
router.use(requireAuth);
router.use(requireRole('ADMIN'));

// pg_dump filename pattern: bsn_lacak_YYYYMMDD_HHMMSS.sql(.gz)
function isSafeBackupName(n: string): boolean {
  return /^[a-zA-Z0-9_-]+\.sql(\.gz)?$/.test(n);
}

router.get('/', async (_req, res) => {
  const dir = path.resolve(env.BACKUP_DIR);
  if (!fs.existsSync(dir)) {
    return res.json({ dir, configured: false, files: [] });
  }
  const entries = await fs.promises.readdir(dir);
  const files = await Promise.all(
    entries.filter(isSafeBackupName).map(async (name) => {
      const st = await fs.promises.stat(path.join(dir, name)).catch(() => null);
      return st ? { name, size: st.size, mtime: st.mtime } : null;
    }),
  );
  res.json({
    dir, configured: true,
    files: files
      .filter((f): f is { name: string; size: number; mtime: Date } => f !== null)
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()),
  });
});

// Verification = light "is this a valid pg_dump archive?" probe. We
// don't actually restore — that would need a shadow DB and is best done
// via the docker compose runbook. We DO verify gzip integrity (if .gz)
// and that the first ~500 bytes look like a pg_dump preamble.
router.post('/:name/verify', async (req, res) => {
  const name = String(req.params.name);
  if (!isSafeBackupName(name)) return res.status(400).json({ error: 'bad_name' });
  const file = path.join(path.resolve(env.BACKUP_DIR), name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not_found' });

  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const fh = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(2048);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    let preview = buf.subarray(0, bytesRead);

    // 1. gzip integrity (if applicable).
    if (name.endsWith('.gz')) {
      try {
        const sliced = preview;
        preview = zlib.gunzipSync(await fs.promises.readFile(file)).subarray(0, 2048);
        checks.push({ name: 'gzip_integrity', ok: true, detail: `unpacked ${sliced.length} → ${preview.length} bytes head` });
      } catch (e) {
        return res.json({
          ok: false,
          checks: [...checks, { name: 'gzip_integrity', ok: false, detail: String(e).slice(0, 200) }],
        });
      }
    }

    // 2. Looks like a SQL dump preamble.
    const head = preview.toString('utf-8').slice(0, 500).toLowerCase();
    const isSqlDump = head.includes('postgresql database dump') || head.includes('create table') || head.startsWith('--');
    checks.push({ name: 'sql_dump_preamble', ok: isSqlDump, detail: isSqlDump ? 'looks like pg_dump' : 'no SQL markers in first 500 bytes' });

    // 3. Size sanity (anything under 1 KB is almost certainly a failed dump).
    const stat = await fh.stat();
    checks.push({ name: 'size_sanity', ok: stat.size > 1024, detail: `${(stat.size / 1024).toFixed(1)} KB` });

    const ok = checks.every(c => c.ok);
    await audit({
      action: 'backup.verify', target: name, ...fromReq(req),
      meta: { ok, checks: checks.map(c => ({ name: c.name, ok: c.ok })) },
    });
    res.json({ ok, checks });
  } finally {
    await fh.close();
  }
});

export default router;
