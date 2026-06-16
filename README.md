# BSN Lacak — Sistem Tracking Penagihan

Bank Syariah Nasional · field collection tracking system.

End-to-end stack untuk operasional penagihan lapangan: dashboard supervisor
multi-cabang + PWA petugas dengan GPS streaming, kamera bukti
ber-watermark, anti-fraud server-side, antrian offline, dan push notification.

## Fitur Utama

**Dashboard supervisor (web)**
- Multi-tenancy per cabang (ADMIN HQ lihat semua, SUPERVISOR dibatasi cabangnya)
- Tracking petugas live di MapTiler basemap + history rute hari ini
- Kolektabilitas posture + pergerakan angsuran timeseries
- Laporan kunjungan + review pipeline (Setujui / Tolak + catatan)
- **Performa petugas** — approval rate, flag rate, response time per petugas
- **Analytics & Closing** — tren penagihan bulanan, leaderboard, ekspor CSV bulanan
- Blast SMS/WA dengan cancel jadwal sebelum dikirim
- Distribusi nasabah + auto-balance assignment
- Audit log cursor-paginated untuk semua aksi sensitif

**Aplikasi petugas (PWA mobile)**
- Beranda: jadwal hari ini (sortir prioritas kol/dpd/dueIn), kartu pencapaian
- Rute: MapTiler basemap + nearest-neighbor routing dari posisi GPS hidup
- Lapor kunjungan: foto bukti **ber-watermark** (BSN Lacak + petugas + nasabah + jam + GPS), hasil, nominal, catatan
- Riwayat: foto bukti + badge status review (Pending / Disetujui / Ditolak) + "Lapor Ulang"
- Profil: capaian, toggle notifikasi push, antrian offline
- **PWA install** (Android Chrome banner; iOS guided modal via Share menu)
- **Antrian offline (IndexedDB)** — laporan tetap tersimpan saat tanpa sinyal, otomatis terkirim saat online
- **Persistensi tab-kill** — Android camera intent tidak menghilangkan form/foto

**Keamanan & anti-fraud**
- JWT short-lived access + httpOnly refresh cookie dengan rotation + reuse detection
- Row-level branch tenancy enforce di server (header `x-branch-id` untuk ADMIN switch)
- Anti-fraud server: GPS plausibility (> 200m), EXIF freshness (> 1 jam atau hilang), speed jump (> 150 km/h)
- Risk score + flag breakdown → supervisor badge "Perlu review"
- Server-side watermarking dengan sharp (foto langsung di-stamp sebelum simpan disk)
- Magic-byte check + multer file limit + rate limit per-user pada POST /kunjungan
- Web Push (VAPID) — fan-out ke supervisor saat laporan ter-flag, ke petugas saat di-review

**Operasional**
- Full CRUD: Branch, User, Petugas, Nasabah, Blast (semua dengan soft-delete via `active`)
- Bulk import CSV untuk migrasi dari sistem lama (max 2000 baris, RFC-4180 parser)
- PDF export laporan (embed foto + risk flag breakdown + status review)
- CSV export angsuran + closing bulanan
- Realtime SSE invalidation (no polling)
- Audit log dengan retention 365 hari + archive otomatis

## Struktur

```
BSN/
  web/                 — Vite + React + TS + PWA (dashboard supervisor + mobile petugas)
  api/                 — Node.js + Express + TS + Prisma + PostgreSQL
  deploy/
    nginx/             — reverse proxy + TLS + rate-limit
    backup/            — pg_dump script (cron container)
    prometheus/        — sample scrape config + alert rules
  .github/workflows/   — CI: typecheck, build, audit, docker build
  prototype/           — HTML/CSS/JS prototype (referensi)
  docker-compose.yml
  OPERATIONS.md        — runbook untuk on-call
```

## Prasyarat

**Untuk dev lokal (tanpa Docker):**
- Node.js ≥ 20, PostgreSQL ≥ 14
- MapTiler API key (free tier 100k requests/bulan cukup untuk demo)
- (Opsional) VAPID keys untuk Web Push — generate via `npx web-push generate-vapid-keys`

**Untuk produksi (Docker Compose):**
- Docker ≥ 24, Docker Compose v2
- Sertifikat TLS (Let's Encrypt / internal CA / mkcert untuk dev)
- (Opsional) Akun Twilio untuk SMS/WA blast

## Quick start — Docker Compose (rekomendasi)

```bash
cp .env.example .env
# Edit .env: isi POSTGRES_PASSWORD, JWT_SECRET (openssl rand -base64 48), WEB_ORIGIN

# Sertifikat TLS — taruh fullchain.pem & privkey.pem
mkdir -p deploy/nginx/certs
# DEV: pakai mkcert
#   mkcert -install
#   mkcert -cert-file deploy/nginx/certs/fullchain.pem -key-file deploy/nginx/certs/privkey.pem lacak.bsn.local localhost
# PROD: Let's Encrypt via certbot atau cert internal BSN

docker compose build
docker compose up -d

# Jalankan migrasi + seed (sekali saja, di container API yang sudah jalan)
docker compose exec api npx prisma migrate deploy
docker compose exec api npm run db:seed   # ⚠ catat password yang tercetak

# Lihat log
docker compose logs -f api nginx
```

Aplikasi akan tersedia di `https://lacak.bsn.local` (sesuai `WEB_ORIGIN` di `.env`).

### Manajemen runtime

```bash
docker compose ps                       # status semua service
docker compose restart api              # restart 1 service
docker compose logs -f --tail=100 api   # tail logs
docker compose exec db psql -U bsn      # akses Postgres
docker compose exec api sh              # shell ke container API
```

### Backup & restore database

Backup otomatis tiap 24 jam ke volume `db_backups` (retensi default 7 hari).

```bash
# Backup manual sekarang
docker compose exec backup /usr/local/bin/backup.sh

# Lihat daftar backup
docker compose exec backup ls -lh /backups

# Restore dari backup
docker compose exec -T db psql -U bsn -d bsn_lacak < \
  "$(docker compose exec backup ls /backups | tail -1)/bsn_lacak.sql.gz"
```

### Update aplikasi

```bash
git pull
docker compose build
docker compose up -d
docker compose exec api npx prisma migrate deploy   # kalau ada schema baru
```

---

## Setup — manual (tanpa Docker, untuk dev)

### 1. Backend (API)

```bash
cd api
cp .env.example .env
# Edit .env:
#   DATABASE_URL    = postgresql://user:pwd@localhost:5432/bsn_lacak?schema=public
#   JWT_SECRET      = openssl rand -base64 48   (min 16 char)
#   WEB_ORIGIN      = http://localhost:5173
#   UPLOAD_DIR      = ./uploads
#   COOKIE_SECURE   = false   (untuk dev HTTP; HARUS true di prod HTTPS)
#   VAPID_PUBLIC    = (dari `npx web-push generate-vapid-keys`)
#   VAPID_PRIVATE   = (jangan commit — dev-only acceptable di .env)
#   VAPID_CONTACT   = mailto:admin@bsn-lacak.local
npm install
npx prisma generate
npx prisma migrate deploy    # apply migration files yang di-commit di prisma/migrations/
npm run db:seed              # ⚠ catat password yang tercetak — sekali saja
npm run dev                  # API jalan di http://localhost:4000
```

Migration file awal (`prisma/migrations/20260612000000_init/migration.sql`) sudah
di-commit ke repo. `prisma migrate deploy` di production akan menerapkannya
langsung tanpa perlu DB shadow. Untuk menambah migration baru saat develop:

```bash
# Setelah edit schema.prisma:
npx prisma migrate dev --name nama_perubahan
# Commit file SQL yang dibuat di prisma/migrations/...
```

Seed mencetak password acak per user **sekali saja** ke stdout — catat saat itu juga.
Setiap user dipaksa ganti password di login pertama (`mustChangePassword=true`).

| Username     | Role       |
|--------------|------------|
| `supervisor` | SUPERVISOR |
| `p1` – `p6`  | PETUGAS    |

### 2. Frontend (Web/PWA)

```bash
cd web
cp .env.example .env
# Edit .env:
#   VITE_API_URL=/api                              (relatif untuk vite proxy)
#   VITE_MAPTILER_API_KEY=...                      (dapat di https://maptiler.com)
#   VITE_MAPTILER_STYLE=streets-v2                 (atau dataviz-light / basic-v2)
#   VITE_USE_MOCK=false                            (true = pakai data mock, false = API beneran)
npm install
npm run dev            # Web jalan di http://localhost:5173
```

### 3. Test

```bash
# API: unit tests selalu jalan; integration tests jalan kalau DATABASE_URL di-set
cd api && npm test
# Hanya unit:
cd api && npm run test:unit

# Web: vitest + jsdom + @testing-library
cd web && npm test
```

Integration tests butuh Postgres yang clean. Tip lokal:

```bash
docker run --rm -d --name bsn-test-db -p 5433:5432 \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=bsn_test postgres:16-alpine
DATABASE_URL=postgresql://postgres:test@localhost:5433/bsn_test?schema=public \
  npx prisma migrate deploy
DATABASE_URL=postgresql://postgres:test@localhost:5433/bsn_test?schema=public \
  npm test
docker stop bsn-test-db
```

CI workflow (`/.github/workflows/ci.yml`) menyiapkan Postgres service container
otomatis, jadi semua test (unit + integration) jalan di setiap PR.

### 4. Build produksi

```bash
cd web && npm run build      # → web/dist/   (static assets, siap di-deploy)
cd api && npm run build      # → api/dist/   (kompiled JS, jalankan via npm start)
```

## Konfigurasi penting (.env)

### Root `.env` (untuk Docker Compose)

Lihat `.env.example`. Variabel utama: `POSTGRES_PASSWORD`, `JWT_SECRET`,
`WEB_ORIGIN`, `COOKIE_SECURE`, `BLAST_PROVIDER`, kredensial Twilio (opsional).

### `api/.env` (mode manual non-Docker)

| Var                | Keterangan                                                    |
|--------------------|---------------------------------------------------------------|
| `DATABASE_URL`     | PostgreSQL connection string                                  |
| `JWT_SECRET`       | Rahasia JWT (min 16 char, **generate acak**)                  |
| `JWT_EXPIRES_IN`   | TTL access token (default `15m`)                              |
| `REFRESH_TTL_DAYS` | TTL refresh token (default `7`)                               |
| `WEB_ORIGIN`       | Origin frontend untuk CORS                                    |
| `COOKIE_SECURE`    | `true` di production (HTTPS); `false` lokal                   |
| `COOKIE_DOMAIN`    | Set kalau pakai sub-domain (mis. `.bsn.co.id`)                |
| `UPLOAD_DIR`       | Folder simpan foto laporan                                    |
| `BLAST_PROVIDER`   | `stub` (default) atau `twilio`                                |
| `TWILIO_*`         | SID, AUTH_TOKEN, FROM_SMS, WA_FROM bila pakai Twilio          |
| `VAPID_PUBLIC`     | Public key Web Push (generate via `web-push generate-vapid-keys`) |
| `VAPID_PRIVATE`    | Private key Web Push — **rahasia, jangan commit**             |
| `VAPID_CONTACT`    | URL/email kontak untuk push gateway (default `mailto:admin@example.com`) |

## Testing dari HP (dev)

Untuk uji PWA install, GPS streaming, dan kamera dari device asli:

**LAN (HTTP, terbatas):** Web di-bind ke `0.0.0.0` (`server.host: true` di `vite.config.ts`); HP & laptop di Wi-Fi yang sama buka `http://<lan-ip>:5173`. GPS + PWA install tidak akan jalan karena browser HP butuh secure context.

**Tunnel (HTTPS, full):**

```bash
# Install cloudflared (winget Cloudflare.cloudflared) lalu:
cloudflared tunnel --url http://localhost:5173
# → dapat URL random https://xxx-xxx.trycloudflare.com
```

Tambahkan host tunnel ke MapTiler allowed origins (`*.trycloudflare.com` wildcard), lalu buka URL dari HP. Semua fitur aktif: GPS, push notification, install banner.

### `web/.env`

| Var                          | Keterangan                                       |
|------------------------------|--------------------------------------------------|
| `VITE_API_URL`               | Base URL API                                     |
| `VITE_GOOGLE_MAPS_API_KEY`   | Google Maps JS API key                           |
| `VITE_USE_MOCK`              | `true` = pakai data mock di frontend (dev mode)  |

## Fitur

### Supervisor (web)
- Dashboard postur kolektabilitas (Col 1–5), pergerakan angsuran 14 hari, top petugas
- Tracking petugas — peta Google Maps + rute harian + posisi live
- Kolektabilitas — filter per akad syariah + komposisi pembiayaan
- Pergerakan angsuran — arus pembayaran, metode, ledger transaksi
- Blast SMS/WA — 3 segmen (H-3, hari ini, lewat), editor template + pratinjau
- Laporan kunjungan — foto bukti + validasi GPS
- Distribusi nasabah — beban kerja per petugas + auto-balance

### Petugas (PWA mobile)
- Beranda + target harian, ring progress
- Rute kunjungan optimal
- Lapor kunjungan + foto + GPS otomatis
- Riwayat laporan hari ini

## Endpoint API utama

```
POST   /api/auth/login                       login (set refresh cookie)
POST   /api/auth/refresh                      rotate refresh + new access token
POST   /api/auth/logout                       revoke refresh family
POST   /api/auth/change-password              ganti password (revoke semua sesi)
GET    /api/auth/me                          info user saat ini

GET    /api/petugas                          daftar petugas
POST   /api/petugas/:id/position             update posisi GPS petugas
GET    /api/petugas/:id/route?since=ISO      rute hari ini

GET    /api/nasabah?q=&kol=&petugasId=&akad= filter daftar nasabah
GET    /api/nasabah/postur                   agregasi kolektabilitas
PATCH  /api/nasabah/:id/petugas              realokasi (supervisor only)

GET    /api/kunjungan                        daftar laporan
POST   /api/kunjungan                        upload laporan (multipart, photos[])

GET    /api/angsuran                         ledger pembayaran
GET    /api/angsuran/payflow                 agregat 14 hari (untuk chart)

GET    /api/blast                            riwayat blast
POST   /api/blast                            kirim blast baru (supervisor only)

GET    /api/distribusi/workload              beban per petugas
POST   /api/distribusi/auto-balance          rebalance round-robin
```

## Hardening yang sudah dipasang

**Autentikasi & sesi**
- **Access token JWT pendek (15m)** + **refresh token panjang (7d)** rotasi setiap pakai
- **Refresh token disimpan sebagai hash SHA-256** di DB (plaintext hanya di cookie)
- **httpOnly Secure SameSite=Strict cookie** untuk refresh (XSS tidak bisa mencurinya)
- **Reuse detection** — refresh token bekas pakai → seluruh keluarga sesi dicabut
- **Access token disimpan di memori modul** frontend (bukan localStorage)
- **Auto-refresh saat 401** + bootstrap silent saat app start
- **Account lockout** — 5x salah password → kunci 15 menit
- **Rate limiting** — `/api/auth/login` 10/15m, `/api/*` 600/15m (per IP)

**Password**
- **Policy** — min 12 char, harus ada huruf besar/kecil/angka/simbol, tidak boleh kata umum
- **Endpoint** `POST /api/auth/change-password` (verifikasi current, rotasi, cabut semua refresh)
- **Force change first login** — `mustChangePassword=true` setelah seed
- **bcrypt cost 12** untuk hash password

**Authorization**
- **Role-based** — petugas hanya melihat nasabah/kunjungan miliknya, supervisor melihat semua
- **Anti-impersonation** — petugas tidak bisa file kunjungan atas nama petugas lain

**Audit & observability**
- **AuditLog** model — login (ok/fail/lockout/reuse), reassign, blast, auto-balance, kunjungan
- **Pino structured logging** + `x-request-id` per request
- **Production-safe error handler** — stack trace hanya di dev mode

**Network & headers**
- **Helmet** dengan CSP ketat (`default-src 'none'`), HSTS (production), Referrer-Policy
- **CSP frontend** via `<meta http-equiv>` di `index.html`
- **CORS terbatas** ke `WEB_ORIGIN`, methods minimum

**File upload**
- **Magic-byte check** (`file-type`), 8 MB/file, max 5 file, hanya JPEG/PNG/WebP/HEIC

**Lain-lain**
- **Graceful shutdown** (SIGINT/SIGTERM, 10s drain)
- **BigInt-safe JSON** untuk nominal rupiah
- **Input validation** dengan Zod di semua endpoint mutasi
- **`trust proxy 1`** — `req.ip` akurat di belakang reverse proxy

**Automated tests** (jalan di CI tiap PR)
- API unit: password policy, phone normalization
- API integration (Postgres real): auth flow lengkap (login/fail/lockout/refresh/reuse/logout/change-password) + role-based authorization (petugas scoping, supervisor-only mutations)
- Web unit: Login form validation/error states, ChangePassword policy indicators + forced-mode behavior
- Web E2E (Playwright + Chromium): login → dashboard → logout, sidebar navigation, skip-to-content link, ARIA attributes

**Observability tambahan**
- **PII masking** di pino logs — nama nasabah, alamat, HP, koordinat, dan password/token tidak pernah masuk log
- **Audit log retention** — worker harian arsip rows > `AUDIT_RETENTION_DAYS` (default 365) ke `audit-archive/*.jsonl.gz` dan hapus dari DB
- **Code splitting** — tiap layar di-lazy-load; initial bundle turun dari 316KB → 278KB (gzip 93KB) + chunk per layar
- **OpenAPI spec** di `/api/openapi.json` + Swagger UI di `/api/docs` (di-allow-list internal lewat nginx)

**Accessibility**
- Skip-to-content link, fokus trap di Modal, `aria-modal`/`aria-labelledby` di dialog
- Semantic `<nav>`/`<main>`/`<header>` + `aria-current="page"` di item nav aktif
- `aria-label` di icon-only buttons (bell, ekspor, logout, password show)
- Focus ring `:focus-visible` 2px accent
- ESLint `jsx-a11y` rules enforced di CI (lint dijalankan di pipeline)

## Yang belum (perlu integrasi/keputusan tambahan)

- **Aktifkan gateway SMS/WA di production**: set `BLAST_PROVIDER=twilio` dan isi
  kredensial Twilio. Worker `blastWorker.ts` otomatis memproses queue tiap 10 detik.
  Provider lain (Wavecell, WhatsApp Business Cloud) bisa ditambah dengan
  membuat class baru yang implement `BlastGateway` di `api/src/lib/gateway/`.
- **Operations runbook**: lihat `OPERATIONS.md` — prosedur insiden, rotasi
  credential, restore drill, dan eskalasi on-call.
- **Monitoring**: hubungkan Prometheus ke `/metrics` (sample config di
  `deploy/prometheus/`). Alert rules tersedia untuk error rate, latency,
  brute-force, queue backlog.
- **HTTPS reverse proxy** (nginx/Caddy/Cloudflare) di depan API + frontend.
  Setelah HTTPS aktif, set `COOKIE_SECURE=true` di `.env`.
- **Database backup** + monitoring + alerting (mis. pg_dump cron + Grafana).
- **Deployment**: setup belum dilakukan. Frontend = static (Netlify/Vercel/nginx);
  API = Node service (PM2/Docker/Cloud Run).
- **Security review eksternal** + penetration testing sebelum production.

## Akun & lisensi

Internal Bank Syariah Nasional.
