# BSN Lacak — Operations Runbook

Prosedur konkret untuk on-call & administrator. Diasumsikan deployment via
`docker-compose.yml` di root repo.

## TL;DR — perintah yang paling sering dipakai

```bash
docker compose ps                                 # status semua service
docker compose logs -f --tail=200 api             # tail log API
docker compose logs -f --tail=200 nginx           # tail log nginx
docker compose exec api npx prisma migrate deploy # apply migrasi pending
docker compose exec db psql -U bsn bsn_lacak      # akses DB
docker compose exec backup /usr/local/bin/backup.sh  # backup manual
docker compose restart api                        # restart 1 service
docker compose up -d --build                      # rebuild + redeploy
```

## Health & probe

| Endpoint              | Tujuan                                                 | Konsumen           |
|-----------------------|--------------------------------------------------------|--------------------|
| `GET /health`         | Liveness — selalu 200 kalau proses hidup               | k8s `livenessProbe`|
| `GET /health/ready`   | Readiness — 503 kalau DB tidak ter-ping                | nginx, compose     |
| `GET /metrics`        | Prometheus scrape (dibatasi IP internal di nginx)      | Prometheus         |

```bash
# Cek dari host
curl -s http://localhost:4000/health/ready | jq
curl -s http://localhost:4000/metrics | head -20
```

## Insiden umum & cara triage

### 1. "Site tidak bisa dibuka" / nginx 502/504

```bash
docker compose ps                          # service mana yang nge-down?
docker compose logs --tail=200 nginx
docker compose logs --tail=200 api
curl -sf http://localhost:4000/health/ready    # API hidup?
docker compose exec db pg_isready              # DB hidup?
```

Penyebab tipikal:
- API crash loop → cek log untuk error startup (env var hilang, migrasi belum dijalankan).
- DB tidak siap → tunggu healthcheck atau cek volume `db_data`.
- nginx cert expired → lihat `deploy/nginx/certs/fullchain.pem` (tanggal).

### 2. "Login tidak bisa" / 423 account_locked

User mengetik salah password ≥ 5x → terkunci 15 menit.

```bash
# Cek audit log siapa saja yang gagal login terakhir
docker compose exec db psql -U bsn bsn_lacak -c \
  "SELECT \"createdAt\", actor, action, ip FROM \"AuditLog\"
   WHERE action LIKE 'auth.login.%'
   ORDER BY \"createdAt\" DESC LIMIT 20;"

# Buka kunci akun manual (jangan lakukan untuk akun yang dicurigai)
docker compose exec db psql -U bsn bsn_lacak -c \
  "UPDATE \"User\" SET \"failedAttempts\"=0, \"lockedUntil\"=NULL
   WHERE username='nama_user';"
```

### 3. "Blast tidak terkirim"

```bash
# Cek status blast & rekap penerima
docker compose exec db psql -U bsn bsn_lacak -c \
  "SELECT id, judul, status, target, terkirim FROM \"Blast\"
   ORDER BY \"createdAt\" DESC LIMIT 10;"

# Cek worker log
docker compose logs --tail=200 api | grep blast

# Cek queue depth dari metrics
curl -s http://localhost:4000/metrics | grep blast_queue_pending
```

Penyebab tipikal:
- `BLAST_PROVIDER=stub` — set ke `twilio` di `.env`, restart API.
- Twilio kredensial salah / saldo habis → `twilio_send_failed` di log.
- Nomor HP tidak valid → recipient `status=gagal`.

### 4. "Foto laporan hilang"

Foto di volume `api_uploads`. Kalau volume terhapus → tidak bisa pulih.

```bash
docker compose exec api ls -lh /app/uploads | head -20
docker volume inspect bsn_api_uploads   # cek mount path host
```

Pastikan `api_uploads` masuk skema backup (saat ini hanya `db_backups`).
Pertimbangkan rsync periodik dari volume ke storage tahan banting (NFS/S3).

## Rotasi credential

### Rotasi `JWT_SECRET`

Setelah ganti, **semua access token jadi invalid**. Refresh token tidak terpengaruh
karena hash di DB. Tapi karena verifikasi access token gagal, user akan otomatis
diminta refresh → access token baru terbit dengan secret baru. Jadi tanpa
downtime selama refresh cookie masih valid.

```bash
NEW=$(openssl rand -base64 48)
# Edit .env: JWT_SECRET=$NEW
docker compose up -d api      # restart hanya API
```

Lebih agresif (cabut semua sesi):

```bash
docker compose exec db psql -U bsn bsn_lacak -c \
  "UPDATE \"RefreshToken\" SET \"revokedAt\"=NOW() WHERE \"revokedAt\" IS NULL;"
```

### Rotasi password Postgres

```bash
# Edit .env: POSTGRES_PASSWORD=baru
docker compose exec db psql -U bsn -c "ALTER USER bsn WITH PASSWORD 'baru';"
docker compose up -d api      # API restart dengan DATABASE_URL baru
```

### Force password change untuk satu user

```bash
docker compose exec db psql -U bsn bsn_lacak -c \
  "UPDATE \"User\" SET \"mustChangePassword\"=true WHERE username='nama_user';"
```

Login berikutnya, frontend menampilkan flow ganti password (`/api/auth/change-password`).

## Backup & restore drill

**Wajib uji restore minimal sekali per kuartal.** Backup yang tidak pernah dites
sama saja dengan tidak punya backup.

### Restore drill ke DB sementara

```bash
# 1. Bikin DB sementara
docker compose exec db createdb -U bsn bsn_lacak_restore

# 2. Pilih backup
BACKUP=$(docker compose exec backup ls /backups | tail -1)
echo "Restoring from: $BACKUP"

# 3. Restore
docker compose exec backup sh -c \
  "gunzip -c /backups/$BACKUP/bsn_lacak.sql.gz | psql -d bsn_lacak_restore"

# 4. Smoke test isi
docker compose exec db psql -U bsn bsn_lacak_restore -c \
  "SELECT COUNT(*) FROM \"Nasabah\";
   SELECT COUNT(*) FROM \"Kunjungan\";
   SELECT MAX(\"createdAt\") FROM \"AuditLog\";"

# 5. Bersihkan
docker compose exec db dropdb -U bsn bsn_lacak_restore
```

### Restore production (skenario disaster)

> ⚠ **Stop API dulu** supaya tidak ada write yang hilang.

```bash
docker compose stop api
docker compose exec backup sh -c \
  "gunzip -c /backups/SELECTED_BACKUP/bsn_lacak.sql.gz \
   | psql -U bsn -d bsn_lacak"
docker compose start api
```

## Observability

Metrik kunci untuk dashboard Grafana:

| Metric                                             | Use case                          |
|----------------------------------------------------|-----------------------------------|
| `up{job="bsn-api"}`                                | API liveness                      |
| `db_up`                                            | DB connectivity                   |
| `histogram_quantile(0.95, http_request_duration_seconds_bucket)` | p95 latency      |
| `rate(http_request_duration_seconds_count{status=~"5.."}[5m])`   | 5xx error rate   |
| `rate(auth_login_failed_total[5m])`                | Brute-force / cred-stuffing       |
| `auth_lockouts_total`                              | Lockout spike                     |
| `blast_queue_pending`                              | Queue backlog                     |
| `rate(blast_messages_failed_total[10m])`           | Gateway failures                  |

Alert rules siap pakai di `deploy/prometheus/alerts.yml`.

## Update / deploy

```bash
git pull
docker compose build
docker compose up -d
docker compose exec api npx prisma migrate deploy   # kalau ada migration baru
```

Rollback ke versi sebelumnya:

```bash
git checkout <previous-sha>
docker compose build
docker compose up -d
# Catatan: migrasi DB tidak otomatis di-rollback — siapkan down migration kalau
# breaking schema change ter-deploy.
```

## On-call escalation

1. **Severity 1** (site down, data loss risk): page DBA + lead engineer dalam 5 menit.
2. **Severity 2** (degraded, blast queue backlog, latency tinggi): tangani dalam 30 menit.
3. **Severity 3** (UI quirk, satu user terkunci): tiket biasa.

Bukti yang harus dilampirkan ke ticket:
- `x-request-id` dari user, atau timestamp + endpoint
- Output `docker compose ps` + log relevan terakhir 200 baris
- Grafana snapshot bila visualisasi membantu
