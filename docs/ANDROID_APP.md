# BSN Lacak — Aplikasi Android Petugas

Aplikasi native Android (APK) untuk petugas lapangan. Berbeda dengan PWA browser, APK punya **foreground service** yang menjaga GPS tetap aktif walau layar HP mati atau aplikasi di-recent-apps. Cakupan tracking naik dari ~70–85% (PWA) ke **~95–99%** (APK).

## Arsitektur

APK = **shell tipis** yang load SPA dari `https://lacak.sosmartpro.com`. Update fitur cukup deploy ulang web; APK tidak perlu rilis baru kecuali ada perubahan:

- Plugin native (background-geolocation, push notification, dll)
- Permission AndroidManifest
- Icon / nama aplikasi
- Konfigurasi `web/capacitor.config.ts`

## Build APK

### Lewat GitHub Actions (rekomendasi — tanpa Android Studio)

1. Buka tab **Actions** di repo GitHub
2. Pilih workflow `Android · build debug APK`
3. Klik **Run workflow** → pilih branch `main` → **Run**
4. Tunggu ±8 menit
5. Buka run yang selesai → scroll ke bawah → download artifact `bsn-lacak-debug-apk`
6. Unzip → dapat `app-debug.apk`

Trigger via tag: `git tag android-v1.0.1 && git push --tags`.

### Lewat Android Studio (lokal)

Prasyarat: Android Studio + Android SDK 35.

```bash
cd web
npm run build              # build SPA → web/dist/
npx cap sync android       # copy dist + plugin ke web/android/
npx cap open android       # buka di Android Studio → Run / Build APK
```

## Install di HP Petugas

1. Transfer file `app-debug.apk` ke HP (USB, kirim WA, atau download dari Drive)
2. Buka file manager → tap APK
3. Android akan minta izin **install dari sumber tidak dikenal** → izinkan
4. Tap **Install**
5. Buka aplikasi **BSN Lacak**
6. Saat prompt izin lokasi muncul:
   - Tap **Saat aplikasi digunakan** dulu (Android tidak izinkan langsung "selalu")
   - Setelah login & clock-in, sistem akan minta upgrade ke **Izinkan sepanjang waktu** → pilih ini
7. Saat prompt izin notifikasi (Android 13+) → **Izinkan**

## Cara Pakai

Petugas pakai sama persis dengan PWA:

1. Login dengan akun masing-masing
2. Tap **Clock-in** di tab Beranda → isi odometer awal
3. **Notifikasi "BSN Lacak — Tracking aktif"** akan muncul di status bar — biarkan, jangan tutup. Notifikasi ini bukti foreground service jalan.
4. Kerja seperti biasa (HP boleh di kantong, layar mati). Trail GPS tetap masuk ke server.
5. Selesai shift → tap **Clock-out** → isi odometer akhir + saldo kas → notifikasi hilang otomatis.

## Catatan Penting

- **Battery Optimization**: Beberapa vendor (Xiaomi, Oppo, Vivo) agresif kill foreground service. Petugas perlu masuk **Pengaturan → Aplikasi → BSN Lacak → Baterai → Tidak dibatasi**.
- **Auto-start** (Xiaomi/MIUI): wajib diaktifkan supaya APK bisa restart sendiri kalau Android force-kill.
- **Mode pesawat / matikan GPS**: tracking jelas berhenti. Sistem tidak bisa mengatasi ini — supervisor akan lihat status "GPS tidak aktif" di dashboard.
- **APK debug vs release**: workflow saat ini build debug (tidak ditandatangani untuk Play Store, ukuran APK lebih besar). Untuk distribusi resmi via Play Store nanti perlu signing config + upload ke Play Console.

## Troubleshooting

| Gejala | Sebab | Solusi |
|---|---|---|
| APK install gagal "App not installed" | Versi sebelumnya beda signature | Uninstall versi lama dulu |
| Tidak muncul notifikasi tracking saat clock-in | Izin lokasi cuma "saat digunakan" | Pengaturan → Izin → Lokasi → Izinkan sepanjang waktu |
| Trail terputus setelah HP idle 30 menit | Battery optimization aktif | Pengaturan → Baterai → BSN Lacak → Tidak dibatasi |
| App tidak buka apa-apa (blank) | Internet mati saat first boot | Pastikan koneksi → tutup paksa → buka lagi |
