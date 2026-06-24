import type {
  Akad,
  BlastEntry,
  HasilKunjungan,
  HasilMeta,
  KolKey,
  KolMeta,
  Kunjungan,
  Nasabah,
  PayflowPoint,
  Petugas,
  PetugasStatus,
  Postur,
  StatusMeta,
} from '../types';

export const RP = (n: number) => 'Rp' + n.toLocaleString('id-ID');
export const RPjt = (n: number) =>
  'Rp' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt';

export const KOL: Record<KolKey, KolMeta> = {
  1: { key: 'lancar', label: 'Lancar', short: 'Col 1', c: 'var(--col-lancar)', soft: 'var(--col-lancar-soft)', ink: 'var(--col-lancar)' },
  2: { key: 'dpk', label: 'DPK', short: 'Col 2', c: 'var(--col-dpk)', soft: 'var(--col-dpk-soft)', ink: 'var(--col-kl)' },
  3: { key: 'kl', label: 'Kurang Lancar', short: 'Col 3', c: 'var(--col-kl)', soft: 'var(--col-kl-soft)', ink: 'var(--col-kl)' },
  4: { key: 'dr', label: 'Diragukan', short: 'Col 4', c: 'var(--col-dr)', soft: 'var(--col-dr-soft)', ink: 'var(--col-dr)' },
  5: { key: 'macet', label: 'Macet', short: 'Col 5', c: 'var(--col-macet)', soft: 'var(--col-macet-soft)', ink: 'var(--col-macet)' },
};

export const PETUGAS: Petugas[] = [
  { id: 'P1', nama: 'Andi Pratama', inisial: 'AP', wilayah: 'Cibinong – Bojonggede', status: 'lapangan',
    hp: '0812-3344-1100', target: 42_000_000, terkumpul: 28_400_000, kunjungan: 9, rencana: 14, hue: 156,
    posisi: { x: 0.42, y: 0.38 }, mulai: '07:42', terakhir: '10 menit lalu' },
  { id: 'P2', nama: 'Rizki Hidayat', inisial: 'RH', wilayah: 'Citayam – Depok', status: 'lapangan',
    hp: '0813-9988-2200', target: 38_000_000, terkumpul: 31_200_000, kunjungan: 11, rencana: 13, hue: 245,
    posisi: { x: 0.66, y: 0.55 }, mulai: '07:20', terakhir: '3 menit lalu' },
  { id: 'P3', nama: 'Sri Wahyuni', inisial: 'SW', wilayah: 'Sawangan – Pancoran Mas', status: 'lapangan',
    hp: '0857-1122-3344', target: 35_000_000, terkumpul: 18_600_000, kunjungan: 6, rencana: 12, hue: 320,
    posisi: { x: 0.28, y: 0.62 }, mulai: '08:05', terakhir: '27 menit lalu' },
  { id: 'P4', nama: 'Bayu Setiawan', inisial: 'BS', wilayah: 'Tapos – Cimanggis', status: 'istirahat',
    hp: '0811-5566-7788', target: 40_000_000, terkumpul: 24_900_000, kunjungan: 8, rencana: 15, hue: 60,
    posisi: { x: 0.78, y: 0.30 }, mulai: '07:55', terakhir: '5 menit lalu' },
  { id: 'P5', nama: 'Dewi Lestari', inisial: 'DL', wilayah: 'Beji – Kemiri Muka', status: 'kantor',
    hp: '0856-7788-9900', target: 33_000_000, terkumpul: 33_000_000, kunjungan: 12, rencana: 12, hue: 25,
    posisi: { x: 0.52, y: 0.20 }, mulai: '07:30', terakhir: 'selesai 16:10' },
  { id: 'P6', nama: 'Fajar Nugroho', inisial: 'FN', wilayah: 'Limo – Grogol', status: 'lapangan',
    hp: '0852-3344-5566', target: 36_000_000, terkumpul: 14_200_000, kunjungan: 4, rencana: 11, hue: 200,
    posisi: { x: 0.18, y: 0.34 }, mulai: '08:40', terakhir: '1 menit lalu' },
];

export const STATUS_PETUGAS: Record<PetugasStatus, StatusMeta> = {
  lapangan: { label: 'Di Lapangan', c: 'var(--accent)', soft: 'var(--accent-soft)' },
  istirahat: { label: 'Istirahat', c: 'var(--col-dpk)', soft: 'var(--col-dpk-soft)' },
  kantor: { label: 'Di Kantor', c: 'var(--ink-3)', soft: 'var(--surface-2)' },
};

const AKAD_CYCLE: Akad[] = ['Murabahah', 'Musyarakah', 'Ijarah', 'Musyarakah Mutanaqisah', 'Istishna', 'Murabahah'];

const _firstN = [
  'Warung Bu Tini', 'Toko Berkah Jaya', 'H. Sulaiman', 'Ibu Komariah', 'Bengkel Motor Pak Dadang',
  'Salon Cantik Ayu', 'Toko Kelontong Madura', 'CV Maju Bersama', 'Warteg Pak Karyo', 'Konveksi Sejahtera',
  'Counter HP Rezeki', 'Toko Bangunan Sentosa', 'Laundry Kilat', 'Ibu Nani Catering', 'Pak Hendra Las',
  'Toko Sayur Segar', 'Warnet Gamer', 'Ternak Ayam Pak Joko', 'Toko Emas Murni', 'Apotek Sehat',
];
const _addr = [
  'Jl. Mawar No.12', 'Jl. Melati Raya', 'Gg. Kenanga 4', 'Jl. Anggrek No.7', 'Perum Griya Asri B2',
  'Jl. Pasar Lama', 'Jl. Veteran No.45', 'Gg. Dahlia 2', 'Jl. Pahlawan No.9', 'Komplek Bumi Indah C8',
];

function buildNasabah(): Nasabah[] {
  const arr: Nasabah[] = [];
  const kolList: KolKey[] = [];
  const kolCounts: Record<KolKey, number> = { 1: 70, 2: 12, 3: 3, 4: 1, 5: 2 };
  (Object.entries(kolCounts) as [string, number][]).forEach(([k, c]) => {
    for (let j = 0; j < c; j++) kolList.push(+k as KolKey);
  });
  const kolDist: KolKey[] = [];
  for (let i = 0; i < 88; i++) kolDist.push(kolList[(i * 37) % kolList.length]);
  for (let i = 0; i < 88; i++) {
    const kol = kolDist[i % kolDist.length];
    const pet = PETUGAS[i % PETUGAS.length];
    const plafon = (5 + Math.floor(((i * 13) % 45))) * 1_000_000;
    const tenor = [12, 18, 24, 36][i % 4];
    const angsuran = Math.round(plafon / tenor / 50_000) * 50_000;
    // deterministic 'random' so SSR/SPA results stay stable
    const sisaFracBase = ((i * 17) % 100) / 100;
    const sisaFrac = kol >= 3 ? 0.15 + sisaFracBase * 0.35 : 0.25 + sisaFracBase * 0.65;
    const sisa = Math.round(plafon * sisaFrac);
    const dpd =
      kol === 1 ? 0 :
      kol === 2 ? 15 + (i % 70) :
      kol === 3 ? 95 + (i % 50) :
      kol === 4 ? 150 + (i % 30) :
      200 + (i % 60);
    const dueIn = kol === 1 ? [0, 1, 2, 3, 5, 7, 10][i % 7] : -dpd;
    arr.push({
      id: 'N' + (1000 + i),
      nama: _firstN[i % _firstN.length] + (i >= _firstN.length ? ' ' + (Math.floor(i / _firstN.length) + 1) : ''),
      alamat: _addr[i % _addr.length] + ', ' + pet.wilayah.split(' – ')[0],
      hp: '08' + (10 + (i % 80)) + '-' + (1000 + i) + '-' + (2000 + (i * 7) % 8000),
      petugas: pet.id,
      kol,
      akad: AKAD_CYCLE[i % AKAD_CYCLE.length],
      plafon, tenor, angsuran, sisa,
      dpd,
      dueIn,
      lastBayar: ['3 hari lalu', 'Kemarin', '1 minggu lalu', '2 minggu lalu', 'Hari ini', '1 bulan lalu'][i % 6],
    });
  }
  return arr;
}

export const NASABAH = buildNasabah();

function kolPostur(): Postur {
  const out: Postur = { 1: { n: 0, nom: 0 }, 2: { n: 0, nom: 0 }, 3: { n: 0, nom: 0 }, 4: { n: 0, nom: 0 }, 5: { n: 0, nom: 0 } };
  NASABAH.forEach(n => { out[n.kol].n++; out[n.kol].nom += n.sisa; });
  return out;
}

export const POSTUR = kolPostur();
export const TOTAL_OUTSTANDING = NASABAH.reduce((s, n) => s + n.sisa, 0);
export const NPL = ((POSTUR[3].nom + POSTUR[4].nom + POSTUR[5].nom) / TOTAL_OUTSTANDING) * 100;

export const PAYFLOW: PayflowPoint[] = (() => {
  const days = ['29', '30', '31', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
  return days.map((d, i) => ({
    hari: d,
    masuk: Math.round(18 + Math.sin(i / 2) * 6 + ((i * 11) % 7)),
    nominal: Math.round((42 + Math.sin(i / 2) * 14 + ((i * 17) % 20)) * 1_000_000),
    target: 60_000_000,
  }));
})();

export const HASIL_KUNJUNGAN: Record<HasilKunjungan, HasilMeta> = {
  bayar: { label: 'Bayar Lunas/Sebagian', c: 'var(--accent)', soft: 'var(--accent-soft)' },
  janji: { label: 'Janji Bayar', c: 'var(--col-dpk)', soft: 'var(--col-dpk-soft)' },
  tidakada: { label: 'Tidak di Tempat', c: 'var(--ink-3)', soft: 'var(--surface-2)' },
  tolak: { label: 'Menolak/Kabur', c: 'var(--col-macet)', soft: 'var(--col-macet-soft)' },
};

// GPS koordinat clustering per petugas — selaras dengan seed prod, supaya
// jejak kunjungan di overlay Tracking konsisten antara mock dev/capture
// dan VPS riil.
export const KUNJUNGAN: Kunjungan[] = [
  { id: 'K1', petugas: 'P2', nasabah: 'N1003', jam: '09:48', hasil: 'bayar', nominal: 1_500_000, dpd: 18,
    catatan: 'Nasabah bayar tunai 1 bulan angsuran. Usaha warung lancar, omzet stabil.',
    lokasi: 'Jl. Mawar No.12, Citayam', foto: 2, valid: true, lat: -6.4395, lng: 106.8205 },
  { id: 'K2', petugas: 'P1', nasabah: 'N1012', jam: '10:15', hasil: 'janji', nominal: 0, dpd: 95,
    catatan: 'Berjanji melunasi tunggakan tgl 15. Sedang menunggu pembayaran dari pelanggan besar.',
    lokasi: 'Jl. Pasar Lama, Cibinong', foto: 1, valid: true, lat: -6.4828, lng: 106.8555 },
  { id: 'K3', petugas: 'P2', nasabah: 'N1021', jam: '10:32', hasil: 'bayar', nominal: 900_000, dpd: 0,
    catatan: 'Setoran rutin lewat petugas. Minta reminder H-3 via WhatsApp.',
    lokasi: 'Gg. Kenanga 4, Citayam', foto: 2, valid: true, lat: -6.4408, lng: 106.8190 },
  { id: 'K4', petugas: 'P3', nasabah: 'N1018', jam: '09:20', hasil: 'tidakada', nominal: 0, dpd: 150,
    catatan: 'Rumah terkunci, tetangga bilang sedang ke luar kota. Akan dikunjungi ulang besok.',
    lokasi: 'Jl. Anggrek No.7, Sawangan', foto: 1, valid: true, lat: -6.3955, lng: 106.7908 },
  { id: 'K5', petugas: 'P1', nasabah: 'N1006', jam: '11:05', hasil: 'bayar', nominal: 2_100_000, dpd: 0,
    catatan: 'Bayar 2 bulan sekaligus. Nasabah ingin top-up plafon, diteruskan ke AO.',
    lokasi: 'Perum Griya Asri B2, Cibinong', foto: 3, valid: true, lat: -6.4820, lng: 106.8540 },
  { id: 'K6', petugas: 'P4', nasabah: 'N1031', jam: '08:55', hasil: 'tolak', nominal: 0, dpd: 210,
    catatan: 'Nasabah menolak ditemui, usaha tutup. Indikasi pindah alamat. Eskalasi ke remedial.',
    lokasi: 'Jl. Veteran No.45, Tapos', foto: 1, valid: false, lat: -6.3805, lng: 106.8508 },
  { id: 'K7', petugas: 'P3', nasabah: 'N1009', jam: '11:40', hasil: 'janji', nominal: 0, dpd: 30,
    catatan: 'Akan transfer sore ini. Minta nomor rekening virtual account.',
    lokasi: 'Gg. Dahlia 2, Sawangan', foto: 1, valid: true, lat: -6.3947, lng: 106.7895 },
  { id: 'K8', petugas: 'P6', nasabah: 'N1024', jam: '10:50', hasil: 'bayar', nominal: 750_000, dpd: 16,
    catatan: 'Bayar sebagian, sisa minggu depan. Kondisi usaha konveksi cukup ramai pesanan.',
    lokasi: 'Jl. Pahlawan No.9, Limo', foto: 2, valid: true, lat: -6.3705, lng: 106.7708 },
];

export const BLAST_HISTORY: BlastEntry[] = [
  { id: 'B1', judul: 'Reminder H-3 Jatuh Tempo', kanal: 'wa', target: 142, terkirim: 138, dibaca: 121, tgl: '10 Jun, 08:00', status: 'selesai' },
  { id: 'B2', judul: 'Pengingat Jatuh Tempo Hari Ini', kanal: 'wa', target: 64, terkirim: 64, dibaca: 51, tgl: '11 Jun, 07:30', status: 'selesai' },
  { id: 'B3', judul: 'Tagihan Lewat Jatuh Tempo (DPK)', kanal: 'sms', target: 38, terkirim: 36, dibaca: null, tgl: '9 Jun, 09:00', status: 'selesai' },
  { id: 'B4', judul: 'Promo Pelunasan Dipercepat', kanal: 'wa', target: 210, terkirim: 0, dibaca: 0, tgl: 'Dijadwalkan 12 Jun', status: 'terjadwal' },
];

export const SEGMEN = (() => ({
  h3: NASABAH.filter(n => n.kol === 1 && n.dueIn >= 1 && n.dueIn <= 3),
  hari_ini: NASABAH.filter(n => n.dueIn === 0),
  lewat: NASABAH.filter(n => n.dueIn < 0),
}))();

export const TEMPLATES = {
  belum: "Assalamu'alaikum Wr. Wb. Yth. {nama}, kami ingatkan angsuran pembiayaan Anda sebesar {angsuran} akan jatuh tempo pada {tgl}. Mohon disiapkan. Jazakumullah khairan. — Bank Syariah Nasional",
  hari_ini: "Assalamu'alaikum Wr. Wb. Yth. {nama}, angsuran pembiayaan Anda {angsuran} jatuh tempo HARI INI. Silakan tunaikan via petugas/transfer. Abaikan bila sudah membayar. — Bank Syariah Nasional",
  lewat: "Assalamu'alaikum Wr. Wb. Yth. {nama}, angsuran pembiayaan Anda {angsuran} telah melewati jatuh tempo {dpd} hari. Mohon segera diselesaikan agar amanah terjaga. — Bank Syariah Nasional",
};

export const petugasById = (id: string) => PETUGAS.find(p => p.id === id)!;
export const nasabahById = (id: string) => NASABAH.find(n => n.id === id)!;
