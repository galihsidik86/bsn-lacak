import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';

// DH — auto-tagging rule sweep. Daily at TAG_RULE_HOUR. For each active
// rule, find matching nasabah and ensure NasabahTag(ruleId=rule) is
// applied. Auto-applied rows whose nasabah no longer match are removed.
// Manual rows (ruleId null) are never touched, even when the same tag is
// also driven by a rule — the rule and the manual assignment coexist as
// separate NasabahTag rows are impossible due to (nasabahId, tagId) being
// the PK, so we treat any row with the matching tagId as auto-managed
// only when ruleId is set.

let timer: NodeJS.Timeout | null = null;

const ACTION = 'tag.rule_swept';

async function nasabahIdsMatchingRule(rule: {
  type: 'DPD_ABOVE' | 'DAYS_SINCE_PAYMENT_ABOVE' | 'KOL_IN';
  threshold: number | null;
  kolValues: string[];
  tag: { branchId: string | null };
}, now: Date): Promise<string[]> {
  const branchClause = rule.tag.branchId ? { branchId: rule.tag.branchId } : {};
  if (rule.type === 'DPD_ABOVE') {
    if (rule.threshold == null) return [];
    const rows = await prisma.nasabah.findMany({
      where: { ...branchClause, active: true, dpd: { gt: rule.threshold } },
      select: { id: true },
    });
    return rows.map(r => r.id);
  }
  if (rule.type === 'KOL_IN') {
    if (rule.kolValues.length === 0) return [];
    const rows = await prisma.nasabah.findMany({
      where: { ...branchClause, active: true, kol: { in: rule.kolValues as any } },
      select: { id: true },
    });
    return rows.map(r => r.id);
  }
  // DAYS_SINCE_PAYMENT_ABOVE — last successful payment older than threshold,
  // or no successful payment ever.
  if (rule.threshold == null) return [];
  const cutoff = new Date(now.getTime() - rule.threshold * 86400_000);
  const rows = await prisma.nasabah.findMany({
    where: { ...branchClause, active: true },
    select: {
      id: true,
      pembayaran: {
        where: { status: 'berhasil' },
        orderBy: { tanggal: 'desc' },
        take: 1,
        select: { tanggal: true },
      },
    },
  });
  return rows.filter(r => {
    const latest = r.pembayaran[0]?.tanggal;
    return !latest || latest < cutoff;
  }).map(r => r.id);
}

export async function runTagRuleSweep(opts?: { now?: Date; force?: boolean }):
  Promise<{ ok: boolean; reason?: string; applied?: number; removed?: number; rules?: number }>
{
  const now = opts?.now ?? new Date();
  const force = opts?.force ?? false;
  if (!force && now.getHours() !== env.TAG_RULE_HOUR) {
    return { ok: false, reason: 'not_hour' };
  }

  const rules = await prisma.tagRule.findMany({
    where: { active: true },
    include: { tag: { select: { id: true, branchId: true } } },
  });
  if (rules.length === 0) return { ok: true, applied: 0, removed: 0, rules: 0 };

  let applied = 0;
  let removed = 0;
  for (const rule of rules) {
    const target = new Set(await nasabahIdsMatchingRule(rule, now));
    const current = await prisma.nasabahTag.findMany({
      where: { tagId: rule.tagId, ruleId: rule.id },
      select: { nasabahId: true },
    });
    const currentSet = new Set(current.map(c => c.nasabahId));

    // Add: matching but not yet auto-applied.
    const toAdd: string[] = [];
    for (const id of target) {
      if (!currentSet.has(id)) toAdd.push(id);
    }
    if (toAdd.length > 0) {
      // Skip nasabah that already have this tag manually assigned (ruleId null).
      const conflicting = await prisma.nasabahTag.findMany({
        where: { tagId: rule.tagId, nasabahId: { in: toAdd }, ruleId: null },
        select: { nasabahId: true },
      });
      const conflictSet = new Set(conflicting.map(c => c.nasabahId));
      const safeToAdd = toAdd.filter(id => !conflictSet.has(id));
      if (safeToAdd.length > 0) {
        await prisma.nasabahTag.createMany({
          data: safeToAdd.map(id => ({ nasabahId: id, tagId: rule.tagId, ruleId: rule.id })),
          skipDuplicates: true,
        });
        applied += safeToAdd.length;
      }
    }

    // Remove: auto-applied but no longer matching.
    const toRemove: string[] = [];
    for (const id of currentSet) {
      if (!target.has(id)) toRemove.push(id);
    }
    if (toRemove.length > 0) {
      const del = await prisma.nasabahTag.deleteMany({
        where: { tagId: rule.tagId, ruleId: rule.id, nasabahId: { in: toRemove } },
      });
      removed += del.count;
    }
  }

  if (applied > 0 || removed > 0) {
    await audit({ action: ACTION, meta: { applied, removed, rules: rules.length } });
    logger.info({ applied, removed, rules: rules.length }, 'tag_rule_sweep_completed');
  }
  return { ok: true, applied, removed, rules: rules.length };
}

export function startTagRuleWorker(): void {
  if (env.NODE_ENV === 'test') return;
  if (timer) return;
  logger.info({ hour: env.TAG_RULE_HOUR }, 'tag_rule_worker_started');
  timer = setTimeout(function loop() {
    runTagRuleSweep().catch(e =>
      logger.warn({ err: String(e) }, 'tag_rule_sweep_failed'));
    timer = setTimeout(loop, 60 * 60 * 1000);
  }, 90 * 1000);
}

export function stopTagRuleWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
