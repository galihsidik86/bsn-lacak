# BSN Lacak — Deployment Runbook

End-to-end guide untuk deploy ke produksi, mengelola secret rotation, dan
recovery dari kondisi bermasalah. Audiens: ops / infra team yang bertanggung
jawab atas runtime production. Pasangan dari `OPERATIONS.md` (yang fokus ke
on-call runbook harian).

## Daftar Isi

1. [Arsitektur runtime](#arsitektur-runtime)
2. [Pre-deploy checklist](#pre-deploy-checklist)
3. [Production .env](#production-env)
4. [Secrets — generation & rotation](#secrets--generation--rotation)
5. [Deploy pertama kali](#deploy-pertama-kali)
6. [Update / rolling restart](#update--rolling-restart)
7. [Database migration di production](#database-migration-di-production)
8. [Backup & restore](#backup--restore)
9. [Disaster recovery](#disaster-recovery)
10. [Health & observability](#health--observability)

---

## Arsitektur runtime

```
[ HP petugas ]        [ Browser supervisor ]
       │                       │
       │ HTTPS (PWA)           │ HTTPS
       ▼                       ▼
            ┌─────────────┐
            │   nginx     │   TLS termination + reverse proxy + rate-limit
            └──────┬──────┘
                   │
       ┌───────────┼───────────┐
       ▼                       ▼
  ┌─────────┐            ┌──────────┐
  │   web   │            │   api    │  Express + Prisma + workers
  │  (Vite) │            │  (Node)  │  (blast worker, audit retention)
  └─────────┘            └────┬─────┘
                              │
                       ┌──────▼──────┐
                       │  PostgreSQL │
                       └──────┬──────┘
                              │ pg_dump nightly
                       ┌──────▼──────┐
                       │   backup    │   volume `db_backups` (7-day retention)
                       └─────────────┘
```

Semua service di-container-kan (`docker-compose.yml`). Single-host adalah
target default; multi-host pakai eksternal Postgres dan load-balanced API
(stateless).

---

## Pre-deploy checklist

Sebelum `docker compose up -d` pertama kali:

- [ ] DNS sudah arah ke server. `lacak.bsn.co.id` (atau apapun WEB_ORIGIN-nya) resolve ke IP host.
- [ ] Sertifikat TLS valid di `deploy/nginx/certs/{fullchain.pem,privkey.pem}`.
      Untuk Let's Encrypt: certbot manual atau pakai container `certbot`.
- [ ] PostgreSQL backup volume sudah dimount ke disk yang **berbeda** dari data volume.
- [ ] Audit log archive directory writable (`./audit-archive` di host).
- [ ] Upload directory writable (`./uploads`) atau di-mount dari object storage gateway.
- [ ] Semua secret di `.env` (root + `api/.env`) sudah di-generate ulang — TIDAK pakai default.
- [ ] Twilio (atau SMS provider lain) sudah dikonfigurasi kalau mau aktifkan SMS notifications + customer feedback.
- [ ] VAPID keys sudah di-generate untuk Web Push.
- [ ] `WEB_ORIGIN` sesuai dengan URL public yang user pakai.
- [ ] Firewall: izinkan port 443 (HTTPS) saja dari publik; 22 (SSH) dari IP admin saja.
- [ ] Postgres dan Redis (kalau dipakai) **tidak terbuka** ke publik.

---

## Production `.env`

Dua file:

### Root `.env` (untuk Docker Compose)

```bash
# Database
POSTGRES_USER=bsn
POSTGRES_PASSWORD=         # openssl rand -base64 24
POSTGRES_DB=bsn_lacak

# Web origin (TANPA trailing slash)
WEB_ORIGIN=https://lacak.bsn.co.id

# Cookies — WAJIB true di production HTTPS
COOKIE_SECURE=true
# Set kalau pakai sub-domain (mis. dashboard.bsn.co.id + api.bsn.co.id)
# COOKIE_DOMAIN=.bsn.co.id

# JWT — generate sekali, jangan rotate tanpa rencana
JWT_SECRET=                # openssl rand -base64 48
JWT_EXPIRES_IN=15m
REFRESH_TTL_DAYS=7

# Upload + audit
UPLOAD_DIR=/data/uploads
AUDIT_ARCHIVE_DIR=/data/audit-archive
AUDIT_RETENTION_DAYS=365

# Blast SMS/WA (opsional — default stub)
BLAST_PROVIDER=twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_SMS=+62...
TWILIO_WA_FROM=whatsapp:+62...

# Web Push (VAPID)
VAPID_PUBLIC=
VAPID_PRIVATE=
VAPID_CONTACT=mailto:admin@bsn.co.id

# TOTP encryption — SEPARATE key, supaya rotating JWT_SECRET tidak invalidate 2FA
TOTP_ENCRYPTION_KEY=       # openssl rand -base64 32
```

### Web `.env` (build-time)

Variabel `VITE_*` di-bake ke bundle saat build. Set sebelum `npm run build`
atau `docker compose build web`:

```bash
VITE_API_URL=/api
VITE_MAPTILER_API_KEY=...    # MapTiler dashboard → API keys
VITE_MAPTILER_STYLE=streets-v2
VITE_USE_MOCK=false
```

> Note: `VITE_*` keys **publik** (bundle-exposed). Jangan pakai untuk secret.

---

## Secrets — generation & rotation

### Generation (sekali saat setup)

```bash
# JWT signing
openssl rand -base64 48 > .secrets/jwt_secret

# Postgres
openssl rand -base64 24 > .secrets/postgres_password

# TOTP envelope encryption
openssl rand -base64 32 > .secrets/totp_key

# VAPID (untuk Web Push)
docker compose exec api npx web-push generate-vapid-keys
# → catat publicKey + privateKey
```

Setelah generate, set ke `.env` dan **delete plain text** dari disk (atau
pindah ke vault).

### Rotation procedures

#### A. `JWT_SECRET` — rotate setiap 6 bulan

**Impact**: semua sesi (access + refresh token) dipaksa logout.

```bash
# 1. Generate baru
openssl rand -base64 48
# 2. Update .env
# 3. Rolling restart api
docker compose restart api
# 4. Komunikasikan: semua user butuh login ulang
```

#### B. `TOTP_ENCRYPTION_KEY` — rotate setiap 12 bulan

**Impact**: semua secret TOTP di DB butuh re-encrypt. Kalau salah, semua
user 2FA harus setup ulang.

```bash
# 1. Backup DB dulu
docker compose exec backup /usr/local/bin/backup.sh
# 2. Sebelum rotation, baca semua totpSecret + decrypt dengan key lama
# 3. Update env dengan key baru
# 4. Re-encrypt + write back, semua dalam satu transaksi
# 5. Restart api
```

Helper script tersedia (TBD) di `api/scripts/rotate-totp-key.ts`. Sampai
dibuat, lakukan manual via `prisma studio`.

#### C. `VAPID_PRIVATE` — rotate kalau bocor saja

**Impact**: semua subscription Web Push di-invalidate. Petugas perlu
re-subscribe lewat tombol toggle di Profil.

```bash
# 1. Generate sepasang baru
docker compose exec api npx web-push generate-vapid-keys
# 2. Update .env (VAPID_PUBLIC + VAPID_PRIVATE)
# 3. Restart api
# 4. Clear PushSubscription table (basi semua endpoint lama)
docker compose exec db psql -U bsn -d bsn_lacak -c 'DELETE FROM "PushSubscription";'
```

#### D. `POSTGRES_PASSWORD` — rotate kalau ada indikasi kompromi

Tidak boleh sembarangan rotate karena perlu downtime singkat.

```bash
# 1. Backup
docker compose exec backup /usr/local/bin/backup.sh
# 2. Stop api supaya tidak ada koneksi aktif
docker compose stop api
# 3. ALTER USER
docker compose exec db psql -U bsn -c "ALTER USER bsn WITH PASSWORD '<baru>';"
# 4. Update .env (POSTGRES_PASSWORD + DATABASE_URL kalau hardcoded di api/.env)
# 5. Restart
docker compose up -d
```

---

## Deploy pertama kali

```bash
# 1. Clone + masuk
git clone https://github.com/galihsidik86/bsn-lacak.git
cd bsn-lacak

# 2. Salin + isi .env
cp .env.example .env
$EDITOR .env

# 3. TLS cert (Let's Encrypt contoh)
sudo certbot certonly --standalone -d lacak.bsn.co.id
sudo cp /etc/letsencrypt/live/lacak.bsn.co.id/fullchain.pem deploy/nginx/certs/
sudo cp /etc/letsencrypt/live/lacak.bsn.co.id/privkey.pem deploy/nginx/certs/
sudo chown $USER deploy/nginx/certs/*

# 4. Build + boot
docker compose build
docker compose up -d

# 5. Cek logs — pastikan API + nginx sehat
docker compose logs -f --tail=50 api nginx

# 6. Apply migration + seed initial
docker compose exec api npx prisma migrate deploy
docker compose exec api npm run db:seed   # ⚠ catat password yang tercetak

# 7. Smoke test
curl -sk https://lacak.bsn.co.id/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<dari seed>"}'
# Should return { token: "ey..." }
```

---

## Update / rolling restart

```bash
# 1. Pull
git pull origin main

# 2. Backup sebelum mungkin schema berubah
docker compose exec backup /usr/local/bin/backup.sh

# 3. Build image baru
docker compose build

# 4. Apply migration (idempotent — aman kalau tidak ada perubahan)
docker compose exec api npx prisma migrate deploy

# 5. Rolling restart
docker compose up -d
docker compose logs -f --tail=20 api

# 6. Smoke test login
```

> Untuk multi-host: build + push image ke registry, lalu `docker stack deploy`
> per node. Wajib drain connection sebelum stop kontainer lama.

---

## Database migration di production

Migration file ada di `api/prisma/migrations/`. Selalu pakai
`migrate deploy` (bukan `migrate dev`) di production.

### Adding a new migration

```bash
# Di dev workstation:
cd api
$EDITOR prisma/schema.prisma   # edit schema
npx prisma migrate dev --name <nama_perubahan>
# Commit semua file di prisma/migrations/<timestamp>_<nama>/

# Di production:
git pull
docker compose exec api npx prisma migrate deploy
```

### Manual rollback

`migrate deploy` tidak punya rollback bawaan. Cara aman:

1. Restore backup PostgreSQL terakhir sebelum migration (lihat [Backup & restore](#backup--restore)).
2. Reset `git checkout <commit-sebelum-migration>`.
3. Restart stack.

Untuk migration breaking (drop column, dll), tambah migration kompensasi
forward, **jangan** rollback DB.

---

## Backup & restore

Service `backup` (lihat `docker-compose.yml`) jalan `pg_dump` setiap 24
jam ke volume `db_backups`. Retensi default **7 hari**.

### Backup manual

```bash
docker compose exec backup /usr/local/bin/backup.sh
docker compose exec backup ls -lh /backups
```

### Restore dari backup

```bash
# 1. Stop API supaya tidak ada koneksi aktif
docker compose stop api

# 2. Cari file backup
docker compose exec backup ls /backups
# misalnya: bsn_lacak_20260616_030000.sql.gz

# 3. Restore (HATI-HATI: ini overwrite DB!)
docker compose exec -T db psql -U bsn -d postgres -c 'DROP DATABASE bsn_lacak;'
docker compose exec -T db psql -U bsn -d postgres -c 'CREATE DATABASE bsn_lacak;'
docker compose exec -T backup gunzip -c /backups/bsn_lacak_20260616_030000.sql.gz \
  | docker compose exec -T db psql -U bsn -d bsn_lacak

# 4. Restart API
docker compose start api
```

### Restore ke environment staging

Untuk verifikasi backup tanpa risiko ke prod:

```bash
# Spin up staging compose dengan port mapping berbeda
docker compose -p bsn-staging -f docker-compose.staging.yml up -d
# Restore backup ke staging DB
# (sama seperti di atas tapi target staging container)
```

---

## Disaster recovery

### Skenario: host mati total

1. Spin up host baru, install Docker.
2. Restore `.env` dari secrets vault.
3. Restore TLS cert (kalau cert manager, biarkan auto-renew).
4. Restore PostgreSQL volume dari off-site backup (atau pg_dump).
5. `docker compose up -d`.
6. Tes: login `admin` + cek `/api/auth/me`.

### Skenario: secret bocor (mis. JWT_SECRET)

1. **Rotate immediately** — lihat [Rotation procedures](#secrets--generation--rotation).
2. Audit `auth.login.ok` di AuditLog selama 24 jam terakhir. Cari pola
   tidak biasa (login dari IP asing, akses ke endpoint sensitif).
3. Komunikasi ke user: semua butuh login ulang + ganti password
   (kalau dicurigai juga bocor).

### Skenario: DB corruption

1. Stop API.
2. Restore backup terakhir yang sehat.
3. Cek consistency: `SELECT count(*) FROM "Kunjungan" WHERE "branchId" NOT IN (SELECT id FROM "Branch");` (harus 0).
4. Restart.

---

## Health & observability

### Endpoints

- `GET /api/metrics` — Prometheus scrape (login fails, lockouts, request duration histogram).
- `GET /api/events` (SSE) — realtime topic stream (audit trail dari supervisor view).
- `GET /api/docs` — Swagger UI (dev-only by default).

### Recommended monitoring

- **Prometheus** scrape `/api/metrics` tiap 15s.
- **Grafana** dashboard untuk: 5xx rate, login failure rate, blast queue depth, audit retention archive size.
- **Alertmanager** rules: 5xx > 1% selama 5min, login_lockouts > 10 per 5min, disk usage > 80% di volume uploads.

Sample alert rules ada di `deploy/prometheus/alerts.yml`.

### Log aggregation

Default: stdout dari setiap container. Untuk produksi serius:

- Dorong ke Loki / ELK via docker driver: `--log-driver loki ...`.
- Filter `level=warn|error` saja kalau volume besar; sisanya retain 7 hari.

---

## Kontak

- On-call rotation: lihat OPERATIONS.md
- Infra escalation: ops@bsn.co.id
- Security incident: security@bsn.co.id
