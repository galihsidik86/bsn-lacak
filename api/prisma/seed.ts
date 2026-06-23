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

const BRANCH_SEED = [
  { kode: 'BSN001', nama: 'BSN Pusat', alamat: 'Jl. Sudirman, Jakarta', kepalaCabang: 'Ir. H. Rahmat Hidayat' },
  { kode: 'BSN002', nama: 'BSN Cabang Depok', alamat: 'Jl. Margonda Raya, Depok', kepalaCabang: 'Drs. Bambang Sutrisno' },
  { kode: 'BSN003', nama: 'BSN Cabang Bogor', alamat: 'Jl. Pajajaran, Bogor', kepalaCabang: 'Hj. Siti Aminah, S.E.' },
];

// 6 petugas dibagi rata ke 3 cabang (2 per cabang).
const PETUGAS_SEED = [
  { kode: 'P1', nama: 'Andi Pratama', inisial: 'AP', wilayah: 'Cibinong – Bojonggede', hp: '0812-3344-1100', status: PetugasStatus.LAPANGAN, target: 42_000_000n, hue: 156, branchKode: 'BSN001' },
  { kode: 'P2', nama: 'Rizki Hidayat', inisial: 'RH', wilayah: 'Citayam – Depok', hp: '0813-9988-2200', status: PetugasStatus.LAPANGAN, target: 38_000_000n, hue: 245, branchKode: 'BSN002' },
  { kode: 'P3', nama: 'Sri Wahyuni', inisial: 'SW', wilayah: 'Sawangan – Pancoran Mas', hp: '0857-1122-3344', status: PetugasStatus.LAPANGAN, target: 35_000_000n, hue: 320, branchKode: 'BSN002' },
  { kode: 'P4', nama: 'Bayu Setiawan', inisial: 'BS', wilayah: 'Tapos – Cimanggis', hp: '0811-5566-7788', status: PetugasStatus.ISTIRAHAT, target: 40_000_000n, hue: 60, branchKode: 'BSN003' },
  { kode: 'P5', nama: 'Dewi Lestari', inisial: 'DL', wilayah: 'Beji – Kemiri Muka', hp: '0856-7788-9900', status: PetugasStatus.KANTOR, target: 33_000_000n, hue: 25, branchKode: 'BSN001' },
  { kode: 'P6', nama: 'Fajar Nugroho', inisial: 'FN', wilayah: 'Limo – Grogol', hp: '0852-3344-5566', status: PetugasStatus.LAPANGAN, target: 36_000_000n, hue: 200, branchKode: 'BSN003' },
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

  // Branches
  const branchMap = new Map<string, string>(); // kode -> id
  for (const b of BRANCH_SEED) {
    const upserted = await prisma.branch.upsert({
      where: { kode: b.kode },
      update: { nama: b.nama, alamat: b.alamat, kepalaCabang: b.kepalaCabang },
      create: b,
    });
    branchMap.set(b.kode, upserted.id);
  }
  console.log(`  ${branchMap.size} cabang`);

  // Petugas
  const petugasMap = new Map<string, string>(); // kode -> id
  const petugasBranchMap = new Map<string, string>(); // kode -> branchId
  for (const p of PETUGAS_SEED) {
    const branchId = branchMap.get(p.branchKode)!;
    const { branchKode, ...rest } = p;
    const upserted = await prisma.petugas.upsert({
      where: { kode: p.kode },
      update: { ...rest, branchId },
      create: { ...rest, branchId },
    });
    petugasMap.set(p.kode, upserted.id);
    petugasBranchMap.set(p.kode, branchId);
  }
  console.log(`  ${petugasMap.size} petugas (terdistribusi ke ${branchMap.size} cabang)`);

  // Users — generate random password per user, force change on first login.
  // Printed ONCE here; not stored in plaintext anywhere.
  const credentials: Array<{ username: string; password: string; role: Role }> = [];

  async function ensureUser(username: string, nama: string, role: Role, opts: { petugasId?: string; branchId?: string | null } = {}) {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return;
    const password = genPassword(16);
    await prisma.user.create({
      data: {
        username, nama, role,
        petugasId: opts.petugasId ?? null,
        branchId: opts.branchId === undefined ? null : opts.branchId,
        passwordHash: await bcrypt.hash(password, 12),
        mustChangePassword: true,
      },
    });
    credentials.push({ username, password, role });
  }

  // 1 HQ admin (cross-branch), 1 supervisor per cabang, 1 user per petugas.
  await ensureUser('admin', 'Admin HQ BSN', Role.ADMIN, { branchId: null });
  for (const b of BRANCH_SEED) {
    await ensureUser(
      `sup_${b.kode.toLowerCase()}`,
      `Supervisor ${b.nama}`,
      Role.SUPERVISOR,
      { branchId: branchMap.get(b.kode)! },
    );
  }
  for (const p of PETUGAS_SEED) {
    await ensureUser(p.kode.toLowerCase(), p.nama, Role.PETUGAS, {
      petugasId: petugasMap.get(p.kode),
      branchId: branchMap.get(p.branchKode)!,
    });
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

  // Per-petugas cluster centers in the Depok/Cibinong/Bogor metro. Nasabah
  // coords are seeded as deterministic offsets around their petugas cluster
  // so the route map shows realistic stops grouped by wilayah binaan.
  const PETUGAS_CLUSTER: Record<string, { lat: number; lng: number }> = {
    P1: { lat: -6.4825, lng: 106.8550 }, // Cibinong – Bojonggede
    P2: { lat: -6.4400, lng: 106.8200 }, // Citayam – Depok
    P3: { lat: -6.3950, lng: 106.7900 }, // Sawangan – Pancoran Mas
    P4: { lat: -6.3800, lng: 106.8500 }, // Tapos – Cimanggis
    P5: { lat: -6.4030, lng: 106.7850 }, // Beji – Kemiri Muka
    P6: { lat: -6.3700, lng: 106.7700 }, // Limo – Grogol
  };
  const nasabahCoords = (petugasKode: string, idx: number) => {
    const c = PETUGAS_CLUSTER[petugasKode] ?? { lat: -6.4025, lng: 106.7942 };
    // Spiral-ish distribution: radius 0.4–2 km, deterministic per nasabah index.
    const angle = (idx * 2.399963) % (Math.PI * 2);   // golden-angle for spread
    const radius = 0.0045 + ((idx * 7) % 20) * 0.0009;
    return {
      lat: c.lat + Math.sin(angle) * radius,
      lng: c.lng + Math.cos(angle) * radius,
    };
  };

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
    // Nasabah inherits branch from their assigned petugas.
    const branchId = petugasBranchMap.get(petugasKode)!;
    const coords = nasabahCoords(petugasKode, i);
    await prisma.nasabah.upsert({
      where: { kode },
      // Keep nasabah pinned to their seed petugas + branch even if a previous
      // run left them in BSN001 (the default backfill branch). Also backfill
      // coords for rows seeded before the lat/lng feature existed.
      update: { petugasId: petugasMap.get(petugasKode)!, branchId, lat: coords.lat, lng: coords.lng },
      create: {
        kode,
        nama: FIRST_N[i % FIRST_N.length] + (i >= FIRST_N.length ? ' ' + (Math.floor(i / FIRST_N.length) + 1) : ''),
        alamat: ADDR[i % ADDR.length] + ', ' + wilayah,
        hp: '08' + (10 + (i % 80)) + '-' + (1000 + i) + '-' + (2000 + (i * 7) % 8000),
        lat: coords.lat,
        lng: coords.lng,
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
        branchId,
      },
    });
  }
  console.log('  88 nasabah');

  // Sample kunjungan + pembayaran for today.
  // GPS coords = nasabah lat/lng + small jitter (≈10–30 m) to mimic the
  // petugas filing a report from "near" the nasabah's address, so the
  // Tracking screen's "jejak kunjungan" overlay renders a realistic
  // chronological trail.
  function jitter(v: number): number {
    // ±0.0002° ≈ ±22 m at Jabodetabek latitude — readable separation between
    // jejak marker and nasabah marker without misrepresenting location.
    return v + (Math.random() - 0.5) * 0.0004;
  }

  const sampleVisits = [
    { petugasKode: 'P1', nasabahKode: 'N1006', jam: '08:30', hasil: HasilKunjungan.BAYAR,    nominal: 2_100_000n, catatan: 'Bayar 2 bulan sekaligus.',         lokasi: 'Perum Griya Asri B2, Cibinong' },
    { petugasKode: 'P1', nasabahKode: 'N1012', jam: '10:15', hasil: HasilKunjungan.JANJI,    nominal: 0n,         catatan: 'Berjanji bayar tgl 15.',           lokasi: 'Jl. Pasar Lama, Cibinong' },
    { petugasKode: 'P1', nasabahKode: 'N1018', jam: '11:20', hasil: HasilKunjungan.TIDAKADA, nominal: 0n,         catatan: 'Rumah terkunci, kunjungan ulang.', lokasi: 'Jl. Anggrek No.7, Cibinong' },
    { petugasKode: 'P1', nasabahKode: 'N1031', jam: '13:40', hasil: HasilKunjungan.BAYAR,    nominal: 800_000n,   catatan: 'Bayar sebagian.',                  lokasi: 'Jl. Veteran No.45, Cibinong' },

    { petugasKode: 'P2', nasabahKode: 'N1003', jam: '09:48', hasil: HasilKunjungan.BAYAR,    nominal: 1_500_000n, catatan: 'Bayar tunai 1 bulan angsuran.',    lokasi: 'Jl. Mawar No.12, Citayam' },
    { petugasKode: 'P2', nasabahKode: 'N1021', jam: '10:32', hasil: HasilKunjungan.BAYAR,    nominal: 900_000n,   catatan: 'Setoran rutin.',                   lokasi: 'Gg. Kenanga 4, Citayam' },
    { petugasKode: 'P2', nasabahKode: 'N1009', jam: '13:05', hasil: HasilKunjungan.JANJI,    nominal: 0n,         catatan: 'Akan transfer sore ini.',          lokasi: 'Gg. Dahlia 2, Citayam' },

    { petugasKode: 'P3', nasabahKode: 'N1015', jam: '09:10', hasil: HasilKunjungan.BAYAR,    nominal: 600_000n,   catatan: 'Bayar tunai.',                     lokasi: 'Jl. Melati Raya, Sawangan' },
    { petugasKode: 'P3', nasabahKode: 'N1029', jam: '11:45', hasil: HasilKunjungan.TOLAK,    nominal: 0n,         catatan: 'Menolak ditemui, escalation.',     lokasi: 'Jl. Pahlawan No.9, Sawangan' },

    { petugasKode: 'P4', nasabahKode: 'N1037', jam: '10:00', hasil: HasilKunjungan.BAYAR,    nominal: 1_200_000n, catatan: 'Bayar penuh.',                     lokasi: 'Komplek Bumi Indah C8, Tapos' },
    { petugasKode: 'P4', nasabahKode: 'N1043', jam: '14:20', hasil: HasilKunjungan.JANJI,    nominal: 0n,         catatan: 'Janji minggu depan.',              lokasi: 'Jl. Mawar No.12, Tapos' },

    { petugasKode: 'P5', nasabahKode: 'N1052', jam: '09:30', hasil: HasilKunjungan.BAYAR,    nominal: 1_800_000n, catatan: 'Lunas bulan ini.',                 lokasi: 'Gg. Kenanga 4, Beji' },

    { petugasKode: 'P6', nasabahKode: 'N1024', jam: '10:50', hasil: HasilKunjungan.BAYAR,    nominal: 750_000n,   catatan: 'Bayar sebagian.',                  lokasi: 'Jl. Pahlawan No.9, Limo' },
    { petugasKode: 'P6', nasabahKode: 'N1058', jam: '13:15', hasil: HasilKunjungan.TIDAKADA, nominal: 0n,         catatan: 'Tetangga bilang ke luar kota.',    lokasi: 'Jl. Anggrek No.7, Limo' },
  ];

  let kunjunganGpsCount = 0;
  for (const v of sampleVisits) {
    const petugas = await prisma.petugas.findUnique({ where: { kode: v.petugasKode } });
    const nasabah = await prisma.nasabah.findUnique({ where: { kode: v.nasabahKode } });
    if (!petugas || !nasabah) continue;
    const lat = nasabah.lat ?? null;
    const lng = nasabah.lng ?? null;
    const hasGps = lat !== null && lng !== null;
    if (hasGps) kunjunganGpsCount++;
    await prisma.kunjungan.create({
      data: {
        petugasId: petugas.id, nasabahId: nasabah.id,
        branchId: petugas.branchId,
        jam: v.jam, hasil: v.hasil, nominal: v.nominal,
        catatan: v.catatan, lokasi: v.lokasi, valid: true,
        lat: hasGps ? jitter(lat as number) : null,
        lng: hasGps ? jitter(lng as number) : null,
      },
    });
    if (v.hasil === HasilKunjungan.BAYAR && v.nominal > 0n) {
      await prisma.pembayaran.create({
        data: {
          nasabahId: nasabah.id, branchId: petugas.branchId, nominal: v.nominal,
          metode: 'tunai', status: 'berhasil', jam: v.jam,
        },
      });
    }
  }
  console.log(`  ${sampleVisits.length} kunjungan + pembayaran sample (${kunjunganGpsCount} dengan GPS untuk jejak)`);

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
