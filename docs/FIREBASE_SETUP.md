# BSN Lacak — Setup Firebase Cloud Messaging (FCM)

Notifikasi push di APK Capacitor butuh Firebase. PWA browser tetap pakai Web Push (VAPID) — Firebase hanya untuk jalur APK native.

## Yang dibutuhkan dari Firebase

1. **`google-services.json`** — taruh di `web/android/app/`. Disediakan saat tambah app Android di Firebase.
2. **Service account key (JSON)** — dipakai backend untuk kirim ke FCM. Dari Project Settings → Service Accounts.

---

## Step 1 — Buat project Firebase

1. Buka [console.firebase.google.com](https://console.firebase.google.com)
2. Klik **Add project** → nama: `BSN Lacak` → next → boleh skip Google Analytics → **Create project**

---

## Step 2 — Tambah Android app

1. Di project home → klik ikon **Android**
2. **Android package name**: `id.sosmartpro.bsnlacak` (harus persis sama dengan `appId` di `web/capacitor.config.ts`)
3. **App nickname**: BSN Lacak Petugas (bebas)
4. SHA-1: kosongkan (debug APK tidak butuh; release APK butuh untuk Sign-In yang tidak kita pakai)
5. **Register app** → download **`google-services.json`**
6. Skip step "Add Firebase SDK" — Capacitor plugin sudah handle

**Taruh `google-services.json` di:**
```
web/android/app/google-services.json
```

> File ini ada di `.gitignore` Capacitor default — **JANGAN commit**. Untuk CI (GitHub Actions), simpan isi file sebagai secret.

---

## Step 3 — Service account key untuk backend

1. Project Firebase → ikon ⚙ gear → **Project settings**
2. Tab **Service accounts** → **Generate new private key** → **Generate key**
3. Download file JSON (mirip: `bsn-lacak-firebase-adminsdk-xxxxx.json`)
4. Buka file JSON, ambil 3 field:
   - `project_id`
   - `client_email`
   - `private_key` (panjang, multi-baris)

5. Tambahkan ke `.env` backend (di VPS):

```bash
FIREBASE_PROJECT_ID=bsn-lacak-xxxxx
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@bsn-lacak-xxxxx.iam.gserviceaccount.com
# private_key WAJIB di-quote + escape \n jadi literal \\n supaya .env parser
# tidak salah parse. Contoh: ganti newline asli dengan \n:
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQ..."
```

Atau lebih aman, mount file JSON langsung lalu set:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/srv/bsn-lacak/api/firebase-admin.json
```

(Tapi kode saat ini baca dari 3 env var, bukan GAC. Pakai opsi pertama.)

---

## Step 4 — Rebuild APK

Trigger GitHub Actions workflow `Android · build debug APK`. Workflow harus tahu cara dapatkan `google-services.json` saat build. Tambahkan secret:

1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
2. Name: `GOOGLE_SERVICES_JSON`
3. Value: paste seluruh isi file `google-services.json`

Workflow akan inject ini sebelum `cap sync android`. (Pembaruan workflow ada di commit terpisah.)

Build → download APK → install ulang di HP petugas (uninstall versi lama dulu).

---

## Step 5 — Restart backend

```bash
ssh root@VPS "cd /srv/bsn-lacak/deploy/domainesia-vps && docker compose -f docker-compose.slim.yml --env-file .env up -d --build api"
```

Backend akan auto-detect 3 env Firebase ada → init firebase-admin → siap kirim FCM.

---

## Step 6 — Test end-to-end

1. Buka APK petugas → Profil → toggle **Notifikasi Push** → ON
2. Android prompt izin notifikasi → **Allow**
3. Status berubah ke "Aktif — alert OS aktif"
4. Dari dashboard supervisor → kirim pesan chat ke petugas
5. **Tutup APK** (force-stop)
6. Tunggu 1-2 detik → notifikasi muncul di status bar
7. Tap notifikasi → APK terbuka → langsung ke thread chat

Kalau gagal, cek log backend:
```bash
docker compose -f docker-compose.slim.yml logs --tail=50 api | grep -i fcm
```

---

## Troubleshooting

| Gejala | Sebab | Solusi |
|---|---|---|
| Toggle gagal ON, error "permission" | Android tolak izin notifikasi | Setelan → Aplikasi → BSN Lacak → Notifikasi → Izinkan |
| `fcm_init_failed` di log | env Firebase salah / private key tidak escape | Pastikan FIREBASE_PRIVATE_KEY ada `\n` literal (bukan newline) |
| `messaging/registration-token-not-registered` | Token expired (uninstall+install) | Backend auto-prune, petugas toggle ulang Profil |
| APK build gagal "google-services.json missing" | Secret belum di-set di GitHub | Settings → Secrets → tambah `GOOGLE_SERVICES_JSON` |
| Web Push (browser) ikut mati setelah pasang FCM | Tidak ada — kedua jalur paralel | Cek `kind` column di tabel PushSubscription |
