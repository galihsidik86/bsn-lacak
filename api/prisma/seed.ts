import 'dotenv/config';
import { PrismaClient, Akad, KolKey, PetugasStatus, Role, HasilKunjungan } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

function genPassword(len = 16) {
  // base64url-ish, with at least one of each class so policy passes.
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const num = '23456789';
  const sym = '!@#$%^&*-_=+';
  const all = lower + upper + num + sym;
  const bytes = randomBytes(len);
  const chars: string[] = [];
  chars.push(lower[bytes[0] % lower.length]);
  chars.push(upper[bytes[1] % upper.length]);
  chars.push(num[bytes[2] % num.length]);
  chars.push(sym[bytes[3] % sym.length]);
  for (let i = 4; i < len; i++) chars.push(all[bytes[i] % all.length]);
  // shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const prisma = new PrismaClient();

const PETUGAS_SEED = [
  { kode: 'P1', nama: 'Andi Pratama', inisial: 'AP', wilayah: 'Cibinong – Bojonggede', hp: '0812-3344-1100', status: PetugasStatus.LAPANGAN, target: 42_000_000n, hue: 156 },
  { kode: 'P2', nama: 'Rizki Hidayat', inisial: 'RH', wilayah: 'Citayam – Depok', hp: '0813-9988-2200', status: PetugasStatus.LAPANGAN, target: 38_000_000n, hue: 245 },
  { kode: 'P3', nama: 'Sri Wahyuni', inisial: 'SW', wilayah: 'Sawangan – Pancoran Mas', hp: '0857-1122-3344', status: PetugasStatus.LAPANGAN, target: 35_000_000n, hue: 320 },
  { kode: 'P4', nama: 'Bayu Setiawan', inisial: 'BS', wilayah: 'Tapos – Cimanggis', hp: '0811-5566-7788', status: PetugasStatus.ISTIRAHAT, target: 40_000_000n, hue: 60 },
  { kode: 'P5', nama: 'Dewi Lestari', inisial: 'DL', wilayah: 'Beji – Kemiri Muka', hp: '0856-7788-9900', status: PetugasStatus.KANTOR, target: 33_000_000n, hue: 25 },
  { kode: 'P6', nama: 'Fajar Nugroho', inisial: 'FN', wilayah: 'Limo – Grogol', hp: '0852-3344-5566', status: PetugasStatus.LAPANGAN, target: 36_000_000n, hue: 200 },
];

const AKAD_CYCLE: Akad[] = [Akad.MURABAHAH, Akad.MUSYARAKAH, Akad.IJARAH, Akad.MUSYARAKAH_MUTANAQISAH, Akad.ISTISHNA, Akad.MURABAHAH];

const FIRST_N = [
  'Warung Bu Tini', 'Toko Berkah Jaya', 'H. Sulaiman', 'Ibu Komariah', 'Bengkel Motor Pak Dadang',
  'Salon Cantik Ayu', 'Toko Kelontong Madura', 'CV Maju Bersama', 'Warteg Pak Karyo', 'Konveksi Sejahtera',
  'Counter HP Rezeki', 'Toko Bangunan Sentosa', 'Laundry Kilat', 'Ibu Nani Catering', 'Pak Hendra Las',
  'Toko Sayur Segar', 'Warnet Gamer', 'Ternak Ayam Pak Joko', 'Toko Emas Murni', 'Apotek Sehat',
];
const ADDR = [
  'Jl. Mawar No.12', 'Jl. Melati Raya', 'Gg. Kenanga 4', 'Jl. Anggrek No.7', 'Perum Griya Asri B2',
  'Jl. Pasar Lama', 'Jl. Veteran No.45', 'Gg. Dahlia 2', 'Jl. Pahlawan No.9', 'Komplek Bumi Indah C8',
];

const kolFromIdx = (i: number): KolKey => {
  const list: KolKey[] = [];
  const counts: Array<[KolKey, number]> = [
    [KolKey.K1, 70], [KolKey.K2, 12], [KolKey.K3, 3], [KolKey.K4, 1], [KolKey.K5, 2],
  ];
  counts.forEach(([k, c]) => { for (let j = 0; j < c; j++) list.push(k); });
  return list[(i * 37) % list.length];
};

async function main() {
  console.log('Seeding…');

  // Petugas
  const petugasMap = new Map<string, string>(); // kode -> id
  for (const p of PETUGAS_SEED) {
    const upserted = await prisma.petugas.upsert({
      where: { kode: p.kode },
      update: p,
      create: p,
    });
    petugasMap.set(p.kode, upserted.id);
  }
  console.log(`  ${petugasMap.size} petugas`);

  // Users — generate random password per user, force change on first login.
  // Printed ONCE here; not stored in plaintext anywhere.
  const credentials: Array<{ username: string; password: string; role: Role }> = [];

  async function ensureUser(username: string, nama: string, role: Role, petugasId?: string) {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return;
    const password = genPassword(16);
    await prisma.user.create({
      data: {
        username, nama, role, petugasId: petugasId ?? null,
        passwordHash: await bcrypt.hash(password, 12),
        mustChangePassword: true,
      },
    });
    credentials.push({ username, password, role });
  }

  await ensureUser('supervisor', 'Supervisor BSN', Role.SUPERVISOR);
  for (const p of PETUGAS_SEED) {
    await ensureUser(p.kode.toLowerCase(), p.nama, Role.PETUGAS, petugasMap.get(p.kode));
  }

  if (credentials.length > 0) {
    console.log('');
    console.log('  ─── Generated credentials (SHOWN ONCE) ────────────────────────');
    for (const c of credentials) {
      console.log(`    ${c.username.padEnd(12)}  ${c.password}    (${c.role})`);
    }
    console.log('  ───────────────────────────────────────────────────────────────');
    console.log('  ⚠  Catat sekarang. Setiap user wajib ganti password di login pertama.');
    console.log('');
  } else {
    console.log('  users (existing — no new credentials generated)');
  }

  // Nasabah
  for (let i = 0; i < 88; i++) {
    const kol = kolFromIdx(i);
    const petugasKode = PETUGAS_SEED[i % PETUGAS_SEED.length].kode;
    const wilayah = PETUGAS_SEED[i % PETUGAS_SEED.length].wilayah.split(' – ')[0];
    const plafonNum = (5 + Math.floor((i * 13) % 45)) * 1_000_000;
    const tenor = [12, 18, 24, 36][i % 4];
    const angsuranNum = Math.round(plafonNum / tenor / 50_000) * 50_000;
    const sisaFracBase = ((i * 17) % 100) / 100;
    const isNpl = kol === KolKey.K3 || kol === KolKey.K4 || kol === KolKey.K5;
    const sisaFrac = isNpl ? 0.15 + sisaFracBase * 0.35 : 0.25 + sisaFracBase * 0.65;
    const sisaNum = Math.round(plafonNum * sisaFrac);
    const dpd = kol === KolKey.K1 ? 0 :
      kol === KolKey.K2 ? 15 + (i % 70) :
      kol === KolKey.K3 ? 95 + (i % 50) :
      kol === KolKey.K4 ? 150 + (i % 30) :
      200 + (i % 60);
    const dueIn = kol === KolKey.K1 ? [0, 1, 2, 3, 5, 7, 10][i % 7] : -dpd;

    const kode = 'N' + (1000 + i);
    await prisma.nasabah.upsert({
      where: { kode },
      update: {},
      create: {
        kode,
        nama: FIRST_N[i % FIRST_N.length] + (i >= FIRST_N.length ? ' ' + (Math.floor(i / FIRST_N.length) + 1) : ''),
        alamat: ADDR[i % ADDR.length] + ', ' + wilayah,
        hp: '08' + (10 + (i % 80)) + '-' + (1000 + i) + '-' + (2000 + (i * 7) % 8000),
        kol,
        akad: AKAD_CYCLE[i % AKAD_CYCLE.length],
        plafon: BigInt(plafonNum),
        tenor,
        angsuran: BigInt(angsuranNum),
        sisa: BigInt(sisaNum),
        dpd,
        dueIn,
        lastBayar: ['3 hari lalu', 'Kemarin', '1 minggu lalu', '2 minggu lalu', 'Hari ini', '1 bulan lalu'][i % 6],
        petugasId: petugasMap.get(petugasKode)!,
      },
    });
  }
  console.log('  88 nasabah');

  // Sample kunjungan + pembayaran for today
  const sampleVisits = [
    { petugasKode: 'P2', nasabahKode: 'N1003', jam: '09:48', hasil: HasilKunjungan.BAYAR, nominal: 1_500_000n, catatan: 'Bayar tunai 1 bulan angsuran.', lokasi: 'Jl. Mawar No.12, Citayam' },
    { petugasKode: 'P1', nasabahKode: 'N1012', jam: '10:15', hasil: HasilKunjungan.JANJI, nominal: 0n, catatan: 'Berjanji bayar tgl 15.', lokasi: 'Jl. Pasar Lama, Cibinong' },
    { petugasKode: 'P2', nasabahKode: 'N1021', jam: '10:32', hasil: HasilKunjungan.BAYAR, nominal: 900_000n, catatan: 'Setoran rutin.', lokasi: 'Gg. Kenanga 4, Citayam' },
    { petugasKode: 'P1', nasabahKode: 'N1006', jam: '11:05', hasil: HasilKunjungan.BAYAR, nominal: 2_100_000n, catatan: 'Bayar 2 bulan sekaligus.', lokasi: 'Perum Griya Asri B2, Cibinong' },
    { petugasKode: 'P6', nasabahKode: 'N1024', jam: '10:50', hasil: HasilKunjungan.BAYAR, nominal: 750_000n, catatan: 'Bayar sebagian.', lokasi: 'Jl. Pahlawan No.9, Limo' },
  ];

  for (const v of sampleVisits) {
    const petugas = await prisma.petugas.findUnique({ where: { kode: v.petugasKode } });
    const nasabah = await prisma.nasabah.findUnique({ where: { kode: v.nasabahKode } });
    if (!petugas || !nasabah) continue;
    await prisma.kunjungan.create({
      data: {
        petugasId: petugas.id, nasabahId: nasabah.id,
        jam: v.jam, hasil: v.hasil, nominal: v.nominal,
        catatan: v.catatan, lokasi: v.lokasi, valid: true,
      },
    });
    if (v.hasil === HasilKunjungan.BAYAR && v.nominal > 0n) {
      await prisma.pembayaran.create({
        data: {
          nasabahId: nasabah.id, nominal: v.nominal,
          metode: 'tunai', status: 'berhasil', jam: v.jam,
        },
      });
    }
  }
  console.log(`  ${sampleVisits.length} kunjungan + pembayaran sample`);

  // Sample PetugasPosition rows so dashboard "mulai"/"terakhir" + Tracking
  // marker have something realistic to render even before petugas mobile
  // pings start arriving. Idempotent: skip if today already has positions.
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const existingToday = await prisma.petugasPosition.count({ where: { recordedAt: { gte: todayStart } } });
  if (existingToday > 0) {
    console.log(`  ${existingToday} petugas position rows already exist today — skipping`);
    console.log('Done.');
    return;
  }

  const HUB = { lat: -6.4025, lng: 106.7942 };
  let positionsCreated = 0;
  for (const p of PETUGAS_SEED) {
    const petugas = await prisma.petugas.findUnique({ where: { kode: p.kode } });
    if (!petugas) continue;

    const startHour = 7 + (positionsCreated % 2);     // 07:xx or 08:xx
    const startMin = (positionsCreated * 13) % 60;
    const startAt = new Date();
    startAt.setHours(startHour, startMin, 0, 0);

    // Spread the rest of the day's pings — one every ~45 min, slight geo drift.
    const pings = 6;
    for (let i = 0; i < pings; i++) {
      const recordedAt = new Date(startAt.getTime() + i * 45 * 60 * 1000);
      if (recordedAt > new Date()) break;            // don't seed into the future
      const drift = (positionsCreated + i) * 0.0035;
      await prisma.petugasPosition.create({
        data: {
          petugasId: petugas.id,
          lat: HUB.lat + Math.sin(drift) * 0.025,
          lng: HUB.lng + Math.cos(drift) * 0.04,
          accuracy: 8 + (i % 6),
          recordedAt,
        },
      });
      positionsCreated++;
    }
  }
  console.log(`  ${positionsCreated} petugas position pings`);

  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
