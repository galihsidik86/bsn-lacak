# Spesifikasi Kebutuhan Infrastruktur

**Sistem Tracking Penagihan BSN Lacak**
Bank Syariah Nasional

---

## Ringkasan Eksekutif

Dokumen ini menetapkan spesifikasi minimum dan rekomendasi untuk tiga
komponen perangkat keras yang menopang operasional aplikasi **BSN Lacak** —
sistem tracking penagihan berbasis web + mobile PWA:

1. **Server backend** (host API + database + reverse proxy)
2. **Workstation supervisor/admin** (akses dashboard web)
3. **Device petugas lapangan** (kolektor + aplikator laporan kunjungan)

Spek dirancang untuk operasional 1 cabang dengan 1 supervisor dan
6 petugas lapangan, dengan jalur scaling jelas hingga skala enterprise
multi-cabang.

---

## 1. Arsitektur Sistem

```
        ┌─────────────────────────────────────────────────┐
        │              Internet (HTTPS / TLS)             │
        └─────────────────────────────────────────────────┘
              │                                  │
              ▼                                  ▼
  ┌───────────────────────┐         ┌──────────────────────┐
  │  Laptop / PC          │         │  HP Petugas (PWA)    │
  │  Supervisor & Admin   │         │  GPS + Kamera        │
  │  Browser modern       │         │  Online + offline    │
  └───────────────────────┘         └──────────────────────┘
              │                                  │
              └──────────────┬───────────────────┘
                             ▼
               ┌──────────────────────────────┐
               │       SERVER PRODUKSI        │
               │  ┌────────────────────────┐  │
               │  │ Caddy (Reverse Proxy)  │  │
               │  └────────────────────────┘  │
               │  ┌────────────────────────┐  │
               │  │ Node API + SSE worker  │  │
               │  └────────────────────────┘  │
               │  ┌────────────────────────┐  │
               │  │ PostgreSQL 16          │  │
               │  └────────────────────────┘  │
               │  ┌────────────────────────┐  │
               │  │ File storage (foto)    │  │
               │  └────────────────────────┘  │
               └──────────────────────────────┘
```

Komunikasi end-to-end melewati TLS (Let's Encrypt) — tidak ada port
non-HTTPS yang terbuka ke publik. PWA petugas dapat queue laporan saat
offline dan auto-sync ketika koneksi pulih.

---

## 2. Spesifikasi Server Backend

Pilih tier yang sesuai dengan skala operasional. Migrasi antar tier
non-disruptif (Postgres dump-restore + Docker compose redeploy).

### 2.1 Tier per skala

| Tier | RAM | vCPU | Disk | Bandwidth bulanan | Cocok untuk |
|---|---|---|---|---|---|
| **Demo / Pilot** | 2 GB | 1-2 core | 30 GB SSD | 1 TB | ≤ 10 petugas aktif, 1 cabang, < 500 nasabah. POC + uji coba. |
| **Operasional Kecil** | 4 GB | 2 core | 60 GB SSD | 2 TB | 10–50 petugas, 1–3 cabang, 500–2.000 nasabah. **Sweet spot** untuk satu kantor cabang. |
| **Skala Menengah** | 8 GB | 4 core | 120 GB SSD + storage terpisah | 5 TB | 50–200 petugas, multi-cabang, 5.000+ nasabah. Pertimbangkan DB pada instance terpisah. |
| **Enterprise** | 16+ GB | 8+ core | Database terpisah + S3-compatible storage untuk foto | Private link / unlimited | 200+ petugas. Database dan object storage harus terpisah dari API. |

### 2.2 Software prerequisites

| Komponen | Versi minimum | Catatan |
|---|---|---|
| OS Linux | Ubuntu 22.04 LTS / Debian 12 / RHEL 9 | Direkomendasikan Ubuntu 24.04 LTS |
| Docker Engine | 24.0 | Wajib untuk container runtime |
| Docker Compose | v2.20 | Plugin Docker resmi |
| Node.js | 20.0 LTS | Untuk build SPA + run API native |
| PostgreSQL | 16 | Database utama (container atau native) |
| Caddy | 2.7+ | Reverse proxy + TLS Let's Encrypt otomatis |
| Domain + DNS | A-record terpropagasi | DNS provider apapun |

### 2.3 Footprint riil (operasional kecil)

Pengukuran dari deployment aktual:

| Service | RAM idle | RAM peak | Catatan |
|---|---|---|---|
| API container (Node) | 80 MB | 250 MB | Scale linear ke concurrent request |
| PostgreSQL | 150 MB | 350 MB | Tergantung shared_buffers config |
| Caddy reverse proxy | 30 MB | 80 MB | Termasuk TLS termination |
| **Total baseline** | **±260 MB** | **±680 MB** | Per VPS |

**Storage growth proyeksi**:

| Komponen | Pertumbuhan harian | Per tahun |
|---|---|---|
| Database PostgreSQL | 5–20 MB | 2–7 GB |
| Foto kunjungan (rata 1.5 MB × 2 foto × 100 visit/hari) | ±300 MB | ±110 GB |
| Audit log | 5–10 MB | 2–4 GB |
| Backup harian | ±50 MB | 18 GB (retensi 30 hari) |

> Foto kunjungan adalah konsumsi disk terbesar. Sejak operasional 12
> bulan, alokasi storage minimum **150 GB**. Tier Skala Menengah dan
> Enterprise wajib pakai object storage terpisah (S3-compatible).

### 2.4 Rekomendasi vendor VPS

| Provider | Plan | Harga estimasi | Catatan |
|---|---|---|---|
| **Domainesia VPS Reguler** | 4 GB / 2 vCPU / 60 GB | ±Rp 250.000 / bulan | Cocok demo + 1 cabang. Lokasi data center Indonesia. |
| **Niagahoster Cloud VPS** | 4 GB / 2 vCPU / 80 GB | ±Rp 300.000 / bulan | Support 24/7 Indonesia |
| **DigitalOcean** | Basic Droplet 4 GB | $24 / bulan (±Rp 380.000) | Performa konsisten, region Singapore |
| **AWS EC2** | t3.medium (4 GB / 2 vCPU) | $30+ / bulan | Untuk skala menengah ke atas, terintegrasi dengan RDS Postgres + S3 |

---

## 3. Spesifikasi Workstation Supervisor & Admin

Dashboard web men-render data tabel, chart trend, dan peta MapTiler
dengan WebGL2. Browser modern adalah syarat utama; spek hardware moderat.

### 3.1 Hardware

| Komponen | Minimum | Direkomendasikan |
|---|---|---|
| **Prosesor** | Intel Core i3 generasi 6 / AMD Ryzen 3 / Apple M1 | Intel Core i5 generasi 10+ / AMD Ryzen 5 / Apple M2 |
| **RAM** | 4 GB | 8 GB |
| **Storage** | 128 GB SSD | 256 GB SSD |
| **Layar** | 13" 1366×768 | 14"+ 1920×1080 (tabel data lebih luas) |
| **Konektivitas** | Wi-Fi / Ethernet 100 Mbps | Wi-Fi 5 / Ethernet 1 Gbps |

### 3.2 Software

| Komponen | Minimum | Direkomendasikan |
|---|---|---|
| **OS** | Windows 10 / macOS 11 / Linux Ubuntu 22.04 | Windows 11 / macOS 13+ / Ubuntu 24.04 |
| **Browser** | Chrome 100 / Firefox 100 / Edge 100 / Safari 16 | Chrome / Edge versi terbaru |
| **Internet** | 5 Mbps stabil | 10+ Mbps |

### 3.3 Fitur browser yang dipakai aplikasi

- WebGL2 (rendering peta MapTiler)
- Service Worker + Push API (notifikasi review & escalation)
- localStorage + IndexedDB (preferensi UI + cache query)
- Server-Sent Events (realtime tracking petugas)
- Fetch + WebSocket (komunikasi API)

### 3.4 Browser yang TIDAK didukung

- Internet Explorer 11 (tidak ada WebGL2 + ES2020)
- Chrome / Firefox pre-2020 (kekurangan API kunci)
- Browser custom di mesin lawas

### 3.5 Rekomendasi laptop

| Kategori | Model contoh | Harga estimasi |
|---|---|---|
| **Entry** | Acer Aspire 3 (Ryzen 3, 8 GB) | Rp 6–8 juta |
| **Optimal** | Lenovo ThinkBook 14 (i5 / Ryzen 5, 8 GB) | Rp 8–10 juta |
| **Premium** | MacBook Air M2 (8 GB) | Rp 14–18 juta |

---

## 4. Spesifikasi Device Petugas Lapangan

Aplikasi mobile berjalan sebagai PWA (Progressive Web App) di browser.
GPS dan kamera adalah komponen kritis. Battery life menentukan jam
operasional.

### 4.1 Hardware

| Komponen | Minimum | Direkomendasikan |
|---|---|---|
| **Prosesor** | Snapdragon 4-series / Mediatek Helio G35 | Snapdragon 6-series / Helio G99 |
| **RAM** | 2 GB | 3+ GB |
| **Storage free** | 1 GB (untuk PWA cache + antrian offline) | 4+ GB |
| **Layar** | 5.0" HD 720×1280 | 5.5"+ Full HD 1080×1920 |
| **Kamera belakang** | 5 MP autofocus + flash | 8+ MP, autofocus, HDR |
| **GPS** | A-GPS aktif, support precise location | A-GPS + GLONASS + Galileo (akurasi < 10 m outdoor) |
| **Baterai** | 3.000 mAh + powerbank cadangan wajib | 4.500+ mAh |
| **Konektivitas** | 4G LTE Band 1/3/5/8 (operator Indonesia) | 4G LTE / 5G |

### 4.2 Software

| Komponen | Minimum | Direkomendasikan |
|---|---|---|
| **OS Android** | Android 8.0 (Oreo) | Android 13+ |
| **Chrome Android** | versi 90+ | versi terbaru |
| **OS iOS** | iOS 14 | iOS 16+ |
| **Safari iOS** | versi 14+ | versi terbaru |
| **Google Play Services** | terinstall + ter-update | (untuk push notification) |

### 4.3 Permission yang wajib di-grant

Sebelum hand-off device ke petugas, pastikan keenam izin berikut sudah
diaktifkan:

| Izin | Lokasi setting | Wajib |
|---|---|---|
| ☑ GPS / Location service device-level | Settings → Location → ON, mode "High accuracy" | ✓ |
| ☑ Browser allow precise location untuk domain aplikasi | Site settings → Location → Allow + **Precise** (Android 12+) | ✓ |
| ☑ Browser allow camera | Site settings → Camera → Allow | ✓ |
| ☑ Browser allow notifications | Site settings → Notifications → Allow | ✓ |
| ☑ PWA terinstall ke home screen | Browser menu → "Add to Home Screen" | Direkomendasikan |
| ☑ Battery saver tidak agresif | Settings → Battery → tidak hemat untuk browser | Direkomendasikan |

### 4.4 Rekomendasi HP

| Kategori | Model contoh | Harga estimasi | Catatan |
|---|---|---|---|
| **Entry layak** | Infinix Hot 50i / Realme C61 | Rp 1.5–1.8 juta | RAM 4 GB, Android 14 |
| **Optimal** | Samsung Galaxy A15 / Xiaomi Redmi 13C | Rp 2.0–2.5 juta | RAM 6 GB, kamera 50 MP, baterai 5000 mAh |
| **Premium** | Samsung Galaxy A55 5G | Rp 5–6 juta | Performa & build quality jangka panjang |

### 4.5 Aksesori wajib

| Item | Estimasi harga | Tujuan |
|---|---|---|
| **Powerbank** ≥ 10.000 mAh | Rp 200–350 rb | Shift penuh 8 jam dengan GPS aktif konsumsi tinggi |
| **Holder motor / mobil** | Rp 50–150 rb | Akses cepat saat di kendaraan, navigasi rute |
| **Charger mobil USB** | Rp 50–100 rb | Top-up baterai antar kunjungan |
| **Pelindung layar + casing tahan banting** | Rp 100–200 rb | HP lapangan sering jatuh, melindungi investasi |

### 4.6 Device yang TIDAK direkomendasikan

- HP dengan RAM 1 GB → PWA + MapLibre OOM crash sering
- HP Android < 8.0 → Chrome 90+ tidak tersedia
- HP tanpa Google Play Services (grey market China) → push notification gagal
- Feature phone / tablet kecil tanpa GPS chip native

---

## 5. Estimasi Biaya CapEx

### 5.1 Setup 1 cabang (1 supervisor + 6 petugas)

| Komponen | Jumlah | Harga satuan | Subtotal |
|---|---|---|---|
| Server VPS (4 GB) — biaya bulanan | 1 | Rp 300.000 / bln | Rp 3.600.000 / tahun (OpEx) |
| Laptop supervisor (Optimal tier) | 1 | Rp 9.000.000 | Rp 9.000.000 |
| HP petugas (Optimal tier) | 6 | Rp 2.200.000 | Rp 13.200.000 |
| Powerbank petugas | 6 | Rp 250.000 | Rp 1.500.000 |
| Holder motor + charger + casing | 6 set | Rp 250.000 | Rp 1.500.000 |
| **Total CapEx 1 cabang** | | | **±Rp 25.200.000** |
| OpEx server tahunan | | | **±Rp 3.600.000 / tahun** |

### 5.2 Skala 3 cabang (1 supervisor per cabang + total 18 petugas)

| Komponen | Jumlah | Subtotal |
|---|---|---|
| Server VPS (8 GB skala menengah) tahunan | 1 | Rp 6.000.000 |
| Laptop supervisor | 3 | Rp 27.000.000 |
| HP + aksesori petugas (18 set) | 18 | Rp 48.600.000 |
| **Total CapEx 3 cabang** | | **±Rp 75.600.000** |
| OpEx server tahunan | | **±Rp 6.000.000 / tahun** |

### 5.3 Catatan biaya

- **CapEx** (Capital Expenditure): biaya pembelian satu kali (laptop, HP, aksesori).
- **OpEx** (Operating Expenditure): biaya berulang (sewa server, MapTiler tier free 100k tile loads/bulan sudah cukup untuk demo; tier berbayar mulai $25/bulan kalau traffic peta intensif).
- Biaya pengembangan & integrasi software tidak masuk tabel — dijabarkan terpisah pada proposal teknis.
- Biaya pelatihan supervisor + petugas (onboarding + workshop) belum termasuk.

---

## 6. Pertimbangan Implementasi

### 6.1 Roll-out bertahap (direkomendasikan)

| Fase | Durasi | Lingkup | Tujuan |
|---|---|---|---|
| **Fase 1 — Pilot** | 2 minggu | 1 cabang × 2 petugas | Uji coba alur, identifikasi bug, training internal |
| **Fase 2 — Cabang penuh** | 1 bulan | 1 cabang × seluruh petugas | Validasi skala operasional, finalisasi SOP |
| **Fase 3 — Multi-cabang** | 2-3 bulan | Roll-out cabang per cabang | Replikasi sukses + iterasi training |

### 6.2 SLA & dukungan

- **Backup database**: harian otomatis, retensi 30 hari (sudah terkonfigurasi di systemd timer).
- **Monitoring uptime**: tools eksternal (UptimeRobot gratis) cek endpoint `/api/health/ready` setiap 5 menit.
- **Disaster recovery**: dokumentasi prosedur restore dari backup tersedia di `OPERATIONS.md` repo.
- **Update aplikasi**: deploy zero-downtime via Docker compose, auto-update service worker PWA.

### 6.3 Keamanan dasar (sudah terkonfigurasi)

- TLS 1.3 Let's Encrypt auto-renew
- JWT signed token dengan refresh rotation
- Bcrypt password hashing (cost 12)
- Audit log untuk semua mutasi data
- Rate limiting pada endpoint login + API
- CSP + HSTS + X-Frame-Options headers

---

## Lampiran A: Glosarium

| Istilah | Definisi |
|---|---|
| **PWA** | Progressive Web App — aplikasi web yang bisa di-install seperti aplikasi native ke home screen |
| **SSE** | Server-Sent Events — channel realtime satu arah dari server ke browser untuk update tracking petugas |
| **A-GPS** | Assisted GPS — GPS yang mempercepat first-fix dengan bantuan data jaringan seluler |
| **WebGL2** | Web Graphics Library 2 — API browser untuk render grafis akselerasi GPU, dipakai oleh peta MapLibre |
| **CapEx / OpEx** | Capital Expenditure (beli satu kali) vs Operating Expenditure (biaya berulang) |
| **TLS** | Transport Layer Security — enkripsi koneksi HTTPS |
| **Backend** | Sisi server yang menangani logika bisnis + database |
| **Frontend** | Sisi browser/aplikasi yang menampilkan UI ke pengguna |

## Lampiran B: Referensi dokumen lain

- `README.md` — overview proyek dan quick start
- `DEPLOYMENT.md` — runbook deploy production lengkap
- `OPERATIONS.md` — manual operasional on-call & SLA
- `MANUAL_PENGGUNAAN.md` — panduan pengguna supervisor/admin
- `deploy/domainesia-vps/DEPLOY-domainesia-vps.md` — runbook spesifik Domainesia VPS

---

*Dokumen ini di-generate dari sumber Markdown dan dapat diregenerasi
kapan saja. Versi PDF & HTML otomatis ter-update saat ada perubahan
spesifikasi.*
