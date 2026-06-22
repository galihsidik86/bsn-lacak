# Deploy BSN Lacak ke Domainesia VPS (slim demo)

Target: **lacak.sosmartpro.com** · Domainesia VPS Lite 2 GB · jadi tetangga
**siakad** (Docker) + **religio** (native + Caddy + MariaDB).

Mode: **backend nyata + seed** — Postgres + Node API di Docker, SPA static
di-serve langsung oleh Caddy yang sudah ada.

Footprint tambahan: ±**200 MB RAM**, ±**1.5 GB disk**.

Panduan ini sudah disesuaikan dengan kondisi VPS aktif (Caddy pegang 80/443,
siakad Docker di port 8080, religio Node di 3000, MariaDB native di 3306).
Ikuti urutan persis.

---

## 0 — Prasyarat

Verifikasi di VPS:

```bash
docker --version          # harus ada
docker compose version    # plugin v2; kalau v1 → upgrade
node --version            # ≥ 20 untuk build SPA di host
caddy version             # untuk reload nanti
free -h                   # pastikan available ≥ 600 MB sebelum mulai
df -h /                   # pastikan free ≥ 3 GB
```

Set DNS A-record (di panel Domainesia DNS):

```
lacak.sosmartpro.com.    A    202.134.242.202
```

Tunggu propagasi, cek:

```bash
nslookup lacak.sosmartpro.com 8.8.8.8
```

---

## 1 — Clone repo

```bash
sudo mkdir -p /srv/bsn-lacak
sudo chown $USER:$USER /srv/bsn-lacak
git clone https://github.com/galihsidik86/bsn-lacak.git /srv/bsn-lacak
cd /srv/bsn-lacak
```

> Path `/srv/bsn-lacak` di-hardcode di blok Caddy. Kalau pakai path lain,
> sesuaikan `root *` di `Caddyfile.bsn`.

---

## 2 — Generate secrets + isi `.env`

```bash
cd /srv/bsn-lacak/deploy/domainesia-vps
cp .env.example .env

# Generate dua secret.
# Penting: POSTGRES_PASSWORD pakai hex, bukan base64. base64 bisa
# berisi "/" atau "+" yang mengacak Prisma DATABASE_URL parser
# ("Invalid url" → api crash-loop).
PGPW=$(openssl rand -hex 24)
JWTS=$(openssl rand -base64 48)

# Patch ke file
sed -i "s|ganti-dengan-openssl-rand-hex-24|$PGPW|" .env
sed -i "s|ganti-dengan-openssl-rand-base64-48|$JWTS|" .env
chmod 600 .env
```

Quick sanity check:

```bash
grep -E '^(POSTGRES_PASSWORD|JWT_SECRET|WEB_ORIGIN)=' .env
```

Ketiganya tidak boleh kosong dan tidak boleh lagi mengandung kata "ganti".

---

## 3 — Build + start container

```bash
cd /srv/bsn-lacak/deploy/domainesia-vps
docker compose -f docker-compose.slim.yml --env-file .env up -d --build
```

Build api butuh 2–4 menit pertama kali (TypeScript + Prisma generate).
Pantau:

```bash
docker compose -f docker-compose.slim.yml logs -f --tail=80 api
```

Tunggu sampai muncul `[server] listening on :4000`. Tekan Ctrl+C untuk
keluar dari follow.

Verifikasi sehat:

```bash
docker compose -f docker-compose.slim.yml ps
# STATUS dua-duanya harus "Up ... (healthy)"

curl -s http://127.0.0.1:4001/health/ready
# {"status":"ready",...}
```

---

## 4 — Migrate + seed Postgres

```bash
cd /srv/bsn-lacak/deploy/domainesia-vps
docker compose -f docker-compose.slim.yml exec api npx prisma migrate deploy
docker compose -f docker-compose.slim.yml exec api npm run db:seed
```

**CATAT** password admin yang tercetak oleh seed — itu satu-satunya cara
login pertama.

---

## 5 — Build SPA di host

```bash
cd /srv/bsn-lacak/web

# Pastikan dependency di-install (sekali saja)
npm ci

# Build production — set ENV inline supaya `.env` SPA tidak perlu dibuat.
VITE_API_URL=/api \
VITE_USE_MOCK=false \
VITE_MAPTILER_API_KEY= \
npm run build

ls dist/index.html && echo "✓ SPA siap"
```

> Ukuran build ±5 MB. Kalau MapTiler API key dimiliki, isi `VITE_MAPTILER_API_KEY`
> sebelum build supaya peta tracking pakai tile asli (bukan SVG fallback).

Cek permission supaya Caddy (`caddy:caddy`) bisa baca:

```bash
sudo chmod -R a+rX /srv/bsn-lacak/web/dist
```

---

## 6 — Pasang blok Caddy

Salin snippet:

```bash
sudo cp /srv/bsn-lacak/deploy/domainesia-vps/Caddyfile.bsn \
        /etc/caddy/sites/bsn-lacak.caddy
```

Pastikan `/etc/caddy/Caddyfile` punya direktif `import sites/*.caddy` di
bagian atas. Kalau belum:

```bash
sudo sed -i '1i import sites/*.caddy\n' /etc/caddy/Caddyfile
sudo mkdir -p /etc/caddy/sites
sudo mv /etc/caddy/Caddyfile.bsn /etc/caddy/sites/bsn-lacak.caddy 2>/dev/null || true
```

Validasi + reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy auto-issue Let's Encrypt cert untuk `lacak.sosmartpro.com` di
request pertama (pastikan DNS sudah propagasi — step 0).

Pantau log saat hit pertama:

```bash
sudo journalctl -u caddy -f --since "1 minute ago"
```

Cari baris `obtained certificate` untuk konfirmasi TLS aktif.

---

## 7 — Smoke test

```bash
# Reachability
curl -I https://lacak.sosmartpro.com

# SPA loaded
curl -s https://lacak.sosmartpro.com | grep -q '<div id="root"' && echo "✓ SPA"

# API up
curl -s https://lacak.sosmartpro.com/api/health/ready

# Login (pakai password seed dari step 4)
curl -s -X POST https://lacak.sosmartpro.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<password-dari-seed>"}'
```

Buka di browser → halaman login BSN Lacak muncul. Login pakai akun admin
hasil seed.

---

## 8 — Verifikasi konsumsi RAM

```bash
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'
free -h
```

Yang diharapkan:
- `bsn-lacak-db-1`     : 100–150 MB
- `bsn-lacak-api-1`    : 60–100 MB
- `free -h` "available" : tetap ≥ 500 MB

Kalau `available` turun di bawah 300 MB, swap usage akan meroket. Stop
dulu, tinjau apakah ada container lain yang baru bangkit (vacuum stmik,
backup religio).

---

## Update di kemudian hari

Saat ada perubahan kode:

```bash
cd /srv/bsn-lacak
git pull

# Rebuild image api (kalau api/ berubah)
cd deploy/domainesia-vps
docker compose -f docker-compose.slim.yml --env-file .env build api
docker compose -f docker-compose.slim.yml --env-file .env up -d api

# Migrasi DB (idempotent)
docker compose -f docker-compose.slim.yml exec api npx prisma migrate deploy

# Rebuild SPA
cd /srv/bsn-lacak/web
VITE_API_URL=/api VITE_USE_MOCK=false npm run build
sudo chmod -R a+rX dist

# Caddy tidak perlu reload — file_server otomatis baca dist/ terbaru.
```

---

## Backup harian (opsional tapi disarankan)

Tambah systemd timer di host (bukan container loop seperti compose.yml
utama — lebih hemat ±30 MB).

```bash
# /etc/systemd/system/bsn-lacak-backup.service
sudo tee /etc/systemd/system/bsn-lacak-backup.service > /dev/null <<'EOF'
[Unit]
Description=BSN Lacak nightly Postgres dump
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker compose -f /srv/bsn-lacak/deploy/domainesia-vps/docker-compose.slim.yml --env-file /srv/bsn-lacak/deploy/domainesia-vps/.env exec -T db pg_dump -U bsn bsn_lacak
StandardOutput=file:/var/backups/bsn-lacak-nightly.sql
StandardError=journal
EOF

# /etc/systemd/system/bsn-lacak-backup.timer
sudo tee /etc/systemd/system/bsn-lacak-backup.timer > /dev/null <<'EOF'
[Unit]
Description=Run BSN Lacak nightly dump at 03:15

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo mkdir -p /var/backups
sudo systemctl daemon-reload
sudo systemctl enable --now bsn-lacak-backup.timer
systemctl list-timers bsn-lacak-backup.timer
```

Rotasi manual: tambah cron `find /var/backups -mtime +7 -delete` di
`/etc/cron.daily/`.

---

## Troubleshooting

### api crash-loop dengan `Invalid environment configuration: { DATABASE_URL: ['Invalid url'] }`

Password Postgres berisi karakter URL-reserved (`/`, `+`, `=`). Regenerate
hex-only lalu rebuild dengan volume dibersihkan:

```bash
docker compose -f docker-compose.slim.yml down -v
PGPW=$(openssl rand -hex 24)
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PGPW|" .env
docker compose -f docker-compose.slim.yml --env-file .env up -d --build
```

`down -v` wajib — kalau hanya `restart`, Postgres tetap pakai password
lama yang sudah di-bake ke data volume saat init pertama.

### `port is already allocated` saat `docker compose up`

Ada layanan lain pegang 4001 di host:

```bash
ss -ltnp | grep 4001
```

Hentikan / pindahkan, atau ganti port di compose + Caddyfile.bsn (cari
`4001`, ganti konsisten).

### Caddy log: `connect: connection refused` ke 127.0.0.1:4001

Container api belum healthy. Cek:

```bash
docker compose -f docker-compose.slim.yml ps
docker compose -f docker-compose.slim.yml logs api | tail -50
```

Biasanya: DATABASE_URL salah, JWT_SECRET kosong, atau Prisma client belum
ke-generate (rebuild image dengan `--no-cache`).

### Login error: `Invalid CSRF token` / cookie tidak ter-set

`WEB_ORIGIN` di `.env` harus persis match scheme + host dipakai user
(`https://lacak.sosmartpro.com`, tanpa trailing slash). Cek lagi, lalu
`docker compose restart api`.

### Postgres OOM-killed

Container `db` hit `mem_limit` 220 MB. Naikkan ke 280 MB di compose, atau
turunkan `shared_buffers` ke 48 MB. Untuk demo workload tidak akan terjadi.

### SPA 404 di route refresh (mis. `/dashboard`)

`try_files {path} /index.html` di Caddy block belum aktif. Pastikan
`/etc/caddy/sites/bsn-lacak.caddy` sama persis dengan `Caddyfile.bsn` di
repo, lalu `sudo systemctl reload caddy`.

### Browser blank, console: `Mixed Content` / `WebSocket` block

`VITE_API_URL=/api` di build SPA sudah benar (relative). Kalau pernah
build dengan absolute `http://...`, rebuild SPA dan hard-refresh browser
(`Ctrl+Shift+R`).

### Cara teardown total (bersih dari VPS)

```bash
cd /srv/bsn-lacak/deploy/domainesia-vps
docker compose -f docker-compose.slim.yml down -v
sudo rm /etc/caddy/sites/bsn-lacak.caddy
sudo systemctl reload caddy
sudo rm -rf /srv/bsn-lacak
```

DNS A-record bisa dibiarkan atau dihapus dari panel Domainesia.
