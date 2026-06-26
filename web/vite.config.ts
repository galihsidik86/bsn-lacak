import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt' instead of 'autoUpdate' so a fresh SW (HMR-regenerated in
      // dev) never auto-claims clients + reloads the page. The mobile camera
      // intent already kills the tab; an additional SW-driven reload would
      // pop the user back to Beranda mid-form. We swallow the update event
      // in main.tsx so dev sessions stay sticky.
      registerType: 'prompt',
      // injectManifest lets us own the SW so we can wire up Web Push +
      // notificationclick handlers alongside the precache.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      },
      includeAssets: ['favicon.svg', 'robots.txt'],
      manifest: {
        name: 'BSN Lacak — Sistem Tracking Penagihan',
        short_name: 'BSN Lacak',
        description: 'Sistem tracking penagihan petugas lapangan Bank Syariah Nasional',
        theme_color: '#1f8a5b',
        background_color: '#f6f8f7',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      // Enable SW in dev so Chrome's installability check passes and the
      // beforeinstallprompt event fires when previewing on localhost.
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
  server: {
    port: 5173,
    // Bind to all interfaces so a phone on the same Wi-Fi can hit the dev
    // server at http://<lan-ip>:5173. PWA install + geolocation still require
    // a secure context, so those features won't work over plain HTTP/LAN —
    // use a tunnel (cloudflared/ngrok) if you need to test them on device.
    host: true,
    // Accept arbitrary Host headers (cloudflared / ngrok forward the public
    // hostname). Dev-only — production never sees this.
    allowedHosts: true,
    proxy: {
      // The SPA itself sets VITE_API_URL='/api' so axios calls land on the
      // dev server, which forwards here. Keep the upstream target explicit so
      // it doesn't accidentally inherit the SPA value.
      '/api': {
        target: process.env.VITE_DEV_API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
      // Static photo uploads from the API server.
      '/uploads': {
        target: process.env.VITE_DEV_API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
