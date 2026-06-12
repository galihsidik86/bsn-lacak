export type KolKey = 1 | 2 | 3 | 4 | 5;

export type PetugasStatus = 'lapangan' | 'istirahat' | 'kantor';

export type Akad =
  | 'Murabahah'
  | 'Musyarakah'
  | 'Ijarah'
  | 'Musyarakah Mutanaqisah'
  | 'Istishna';

export type HasilKunjungan = 'bayar' | 'janji' | 'tidakada' | 'tolak';

export interface KolMeta {
  key: string;
  label: string;
  short: string;
  c: string;
  soft: string;
  ink: string;
}

export interface StatusMeta {
  label: string;
  c: string;
  soft: string;
}

export interface HasilMeta {
  label: string;
  c: string;
  soft: string;
}

export interface Petugas {
  id: string;
  nama: string;
  inisial: string;
  wilayah: string;
  status: PetugasStatus;
  hp: string;
  target: number;
  terkumpul: number;
  kunjungan: number;
  rencana: number;
  hue: number;
  posisi: { x: number; y: number };
  mulai: string;
  terakhir: string;
}

export interface Nasabah {
  id: string;
  nama: string;
  alamat: string;
  hp: string;
  petugas: string;
  kol: KolKey;
  akad: Akad;
  plafon: number;
  tenor: number;
  angsuran: number;
  sisa: number;
  dpd: number;
  dueIn: number;
  lastBayar: string;
}

export interface Kunjungan {
  id: string;
  petugas: string;
  nasabah: string;
  jam: string;
  hasil: HasilKunjungan;
  nominal: number;
  dpd: number;
  catatan: string;
  lokasi: string;
  foto: number;
  valid: boolean;
}

export interface PayflowPoint {
  hari: string;
  masuk: number;
  nominal: number;
  target: number;
}

export interface BlastEntry {
  id: string;
  judul: string;
  kanal: 'wa' | 'sms';
  target: number;
  terkirim: number;
  dibaca: number | null;
  tgl: string;
  status: 'selesai' | 'terjadwal';
}

export interface PosturItem {
  n: number;
  nom: number;
}
export type Postur = Record<KolKey, PosturItem>;
