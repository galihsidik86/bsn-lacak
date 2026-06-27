import type { CapacitorConfig } from '@capacitor/cli';

// Server mode: APK = thin shell yang load SPA dari lacak.sosmartpro.com.
// Update fitur cukup deploy SPA, tidak perlu rilis APK baru tiap commit.
// webDir tetap diisi karena Capacitor butuh fallback bundle saat
// server unreachable (boot offline) — index.html minimal masih dipakai
// untuk halaman "no internet".
const config: CapacitorConfig = {
  appId: 'id.sosmartpro.bsnlacak',
  appName: 'BSN Lacak',
  webDir: 'dist',
  server: {
    url: 'https://lacak.sosmartpro.com',
    cleartext: false,
    // androidScheme https = origin yang dilihat WebView konsisten dengan
    // production, jadi service worker + Wake Lock + localStorage tetap
    // partition yang sama saat user buka via browser vs APK.
    androidScheme: 'https',
  },
  android: {
    // Tidak override useragent default — backend tidak butuh deteksi
    // native, dan keeping default supaya analytic Sentry akurat.
    allowMixedContent: false,
  },
  plugins: {
    BackgroundGeolocation: {
      // Plugin minta notifikasi foreground service supaya Android tidak
      // kill task. Teks dilihat petugas di status bar saat tracking aktif.
      notificationTitle: 'BSN Lacak — Tracking aktif',
      notificationText: 'GPS petugas dipantau supervisor. Tap untuk kembali.',
    },
  },
};

export default config;
