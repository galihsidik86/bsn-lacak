// Background worker that drains queued blast recipients.
// Runs in the API process for simplicity; promote to its own process when load
// justifies it (split via `npm run worker` + a separate Dockerfile target).

import { prisma } from '../db.js';
import { bus } from '../lib/events.js';
import { gateway } from '../lib/gateway/index.js';
import { logger } from '../lib/logger.js';
import { blastFailed, blastSent } from '../lib/metrics.js';
import { enqueueNotification } from '../routes/notifications.js';

const POLL_MS = 10_000;
const BATCH_SIZE = 25;

function renderTemplate(tpl: string, nasabah: { nama: string; angsuran: bigint; dpd: number; dueIn: number }) {
  return tpl
    .replaceAll('{nama}', nasabah.nama)
    .replaceAll('{angsuran}', 'Rp' + Number(nasabah.angsuran).toLocaleString('id-ID'))
    .replaceAll('{tgl}', nasabah.dueIn > 0 ? `${nasabah.dueIn} hari lagi` : 'hari ini')
    .replaceAll('{dpd}', String(nasabah.dpd));
}

async function tick() {
  // Find blasts that should be sending right now.
  const blasts = await prisma.blast.findMany({
    where: {
      OR: [
        { status: 'BERJALAN' },
        { status: 'TERJADWAL', scheduledAt: { lte: new Date() } },
      ],
    },
    take: 5,
  });
  if (blasts.length === 0) return;

  for (const b of blasts) {
    if (b.status === 'TERJADWAL') {
      await prisma.blast.update({ where: { id: b.id }, data: { status: 'BERJALAN' } });
    }

    const pending = await prisma.blastRecipient.findMany({
      where: { blastId: b.id, status: 'pending' },
      include: { nasabah: { select: { nama: true, angsuran: true, dpd: true, dueIn: true } } },
      take: BATCH_SIZE,
    });

    if (pending.length === 0) {
      const remaining = await prisma.blastRecipient.count({ where: { blastId: b.id, status: 'pending' } });
      if (remaining === 0) {
        const after = await prisma.blast.update({ where: { id: b.id }, data: { status: 'SELESAI' } });
        const gagal = await prisma.blastRecipient.count({ where: { blastId: b.id, status: 'gagal' } });
        logger.info({ blastId: b.id, terkirim: after.terkirim, gagal }, 'blast_completed');
        bus.publish('blast.completed', { blastId: b.id, terkirim: after.terkirim, gagal });
        // Notify supervisors that the blast wrapped up.
        const supervisors = await prisma.user.findMany({
          where: { role: { in: ['SUPERVISOR', 'ADMIN'] } }, select: { id: true },
        });
        if (supervisors.length > 0) {
          await enqueueNotification({
            userIds: supervisors.map(s => s.id),
            type: 'blast.completed',
            title: `Blast "${after.judul}" selesai`,
            body: `${after.terkirim} terkirim, ${gagal} gagal dari total ${after.target} penerima.`,
            severity: gagal > 0 ? 'WARN' : 'INFO',
            link: 'blast',
          }).catch(() => undefined);
        }
      }
      continue;
    }

    for (const r of pending) {
      const body = renderTemplate(b.template, r.nasabah);
      const out = await gateway.send({ channel: b.kanal, to: r.hp, body });
      if (out.ok) {
        await prisma.blastRecipient.update({
          where: { id: r.id }, data: { status: 'terkirim', sentAt: new Date() },
        });
        await prisma.blast.update({ where: { id: b.id }, data: { terkirim: { increment: 1 } } });
        blastSent.inc({ channel: b.kanal });
      } else {
        await prisma.blastRecipient.update({ where: { id: r.id }, data: { status: 'gagal' } });
        logger.warn({ blastId: b.id, recipientId: r.id, err: out.error }, 'blast_send_failed');
        blastFailed.inc({ channel: b.kanal });
      }
    }
  }
}

export function startBlastWorker() {
  let stopped = false;
  const loop = async () => {
    if (stopped) return;
    try { await tick(); } catch (err) { logger.error({ err }, 'blast_worker_tick_failed'); }
    if (!stopped) setTimeout(loop, POLL_MS);
  };
  setTimeout(loop, POLL_MS);
  logger.info({ pollMs: POLL_MS }, 'blast_worker_started');
  return () => { stopped = true; };
}
