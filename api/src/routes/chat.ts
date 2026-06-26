import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../auth.js';
import { audit, fromReq } from '../lib/audit.js';
import { bus } from '../lib/events.js';
import { enqueueNotification } from './notifications.js';
import { pushToUsers } from '../lib/webPush.js';

// Direct messaging — petugas <-> supervisor (atau admin). Branch
// isolation di check waktu send: sender + recipient harus same branch
// (atau salah satu ADMIN cross-branch). MVP text-only.

const router = Router();
router.use(requireAuth);

const sendSchema = z.object({
  toId: z.string().min(1).max(64),
  body: z.string().min(1).max(2000),
});

// Verify dua user diizinkan berkomunikasi. Aturan: same branch atau
// ADMIN involved. PETUGAS hanya boleh chat dengan supervisor/admin
// cabangnya (tidak antar sesama petugas — prevent off-topic).
async function canCommunicate(meId: string, otherId: string): Promise<boolean> {
  const [me, other] = await Promise.all([
    prisma.user.findUnique({ where: { id: meId }, select: { role: true, branchId: true } }),
    prisma.user.findUnique({ where: { id: otherId }, select: { role: true, branchId: true, active: true } }),
  ]);
  if (!me || !other || !other.active) return false;
  if (me.role === 'ADMIN' || other.role === 'ADMIN') return true;
  // SUPERVISOR <-> PETUGAS (atau SUPERVISOR <-> SUPERVISOR) dalam branch sama
  if (me.branchId && me.branchId === other.branchId) {
    // Block PETUGAS <-> PETUGAS supaya tidak buat group chat informal
    if (me.role === 'PETUGAS' && other.role === 'PETUGAS') return false;
    return true;
  }
  return false;
}

// List conversation summaries — group by lawan bicara, ambil pesan
// terakhir + unread count. Dipakai untuk inbox supervisor & list lawan
// di petugas (umumnya 1: supervisornya).
router.get('/conversations', async (req, res) => {
  const meId = req.user!.sub;
  // Ambil semua message yang melibatkan me, lalu group di app code.
  // Cap 500 supaya tidak overload untuk power user.
  const rows = await prisma.chatMessage.findMany({
    where: { OR: [{ fromId: meId }, { toId: meId }] },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true, fromId: true, toId: true, body: true, readAt: true, createdAt: true,
      from: { select: { id: true, nama: true, username: true, role: true } },
      to:   { select: { id: true, nama: true, username: true, role: true } },
    },
  });
  type Convo = {
    otherId: string;
    other: { id: string; nama: string; username: string; role: string };
    lastBody: string;
    lastAt: Date;
    unread: number;
  };
  const map = new Map<string, Convo>();
  for (const m of rows) {
    const otherIsTo = m.fromId === meId;
    const otherId = otherIsTo ? m.toId : m.fromId;
    const other = otherIsTo ? m.to : m.from;
    let c = map.get(otherId);
    if (!c) {
      c = { otherId, other, lastBody: m.body, lastAt: m.createdAt, unread: 0 };
      map.set(otherId, c);
    }
    if (!otherIsTo && !m.readAt) c.unread++;
  }
  res.json({ conversations: [...map.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime()) });
});

// Daftar user yang boleh saya chat-i — dipakai untuk picker "Mulai chat".
// Aturan sama dengan canCommunicate(): petugas tidak boleh chat ke
// petugas lain; sisanya bebas same-branch (admin cross-branch).
router.get('/recipients', async (req, res) => {
  const meId = req.user!.sub;
  const me = await prisma.user.findUnique({
    where: { id: meId }, select: { role: true, branchId: true },
  });
  if (!me) return res.status(404).json({ error: 'not_found' });

  // ADMIN bisa chat siapa saja (any branch, any role).
  // Lainnya: same branch + filter petugas-petugas combo.
  const where: any = { active: true, id: { not: meId } };
  if (me.role !== 'ADMIN') {
    where.branchId = me.branchId;
    if (me.role === 'PETUGAS') {
      // PETUGAS hanya boleh chat SUPERVISOR/ADMIN — bukan sesama petugas.
      where.role = { in: ['SUPERVISOR', 'ADMIN'] };
    }
  }
  const users = await prisma.user.findMany({
    where,
    select: { id: true, username: true, nama: true, role: true,
      branch: { select: { kode: true, nama: true } } },
    orderBy: [{ role: 'asc' }, { nama: 'asc' }],
    take: 200,
  });
  res.json({ users });
});

// Total unread count — badge di nav.
router.get('/unread-count', async (req, res) => {
  const meId = req.user!.sub;
  const n = await prisma.chatMessage.count({
    where: { toId: meId, readAt: null },
  });
  res.json({ unread: n });
});

// Daftar pesan dengan partner tertentu — most recent dulu kalau pakai
// take + skip; di sini ASC supaya UI render chat bawah.
router.get('/with/:userId', async (req, res) => {
  const meId = req.user!.sub;
  const otherId = String(req.params.userId);
  if (!await canCommunicate(meId, otherId)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const messages = await prisma.chatMessage.findMany({
    where: {
      OR: [
        { fromId: meId, toId: otherId },
        { fromId: otherId, toId: meId },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 200, // last 200 di view; UI bisa scroll-back nanti
    select: { id: true, fromId: true, toId: true, body: true, readAt: true, createdAt: true },
  });
  // Mark sebagai read kalau dari mereka ke kita.
  await prisma.chatMessage.updateMany({
    where: { fromId: otherId, toId: meId, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ messages });
});

router.post('/messages', async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'bad_request' });
  const meId = req.user!.sub;
  if (parsed.data.toId === meId) return res.status(400).json({ error: 'cannot_send_to_self' });
  if (!await canCommunicate(meId, parsed.data.toId)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const msg = await prisma.chatMessage.create({
    data: {
      fromId: meId,
      toId: parsed.data.toId,
      body: parsed.data.body,
    },
    select: {
      id: true, fromId: true, toId: true, body: true, createdAt: true,
      from: { select: { nama: true } },
    },
  });
  // Realtime push ke recipient via SSE.
  bus.publish('chat.message', {
    id: msg.id, fromId: msg.fromId, toId: msg.toId,
    body: msg.body, createdAt: msg.createdAt,
  });
  // Persisted notif + web push supaya kalau tab tutup masih kena ping.
  await enqueueNotification({
    userIds: [parsed.data.toId],
    type: 'chat.message',
    title: `Pesan dari ${msg.from.nama}`,
    body: msg.body.slice(0, 120),
    severity: 'INFO',
    link: 'chat',
  }).catch(() => undefined);
  void pushToUsers([parsed.data.toId], {
    title: `Pesan dari ${msg.from.nama}`,
    body: msg.body.slice(0, 120),
    link: '/#chat',
    tag: `chat-${meId}`,
  });
  await audit({ action: 'chat.send', target: msg.id, ...fromReq(req) });
  res.status(201).json(msg);
});

export default router;
