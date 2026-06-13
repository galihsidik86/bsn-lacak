# syntax=docker/dockerfile:1.7

# ---- build: produce static assets with Vite ----
FROM node:26-alpine AS build
WORKDIR /app

# Build-time env vars (must be present at build time for Vite to inline them).
ARG VITE_API_URL
ARG VITE_MAPTILER_API_KEY
ARG VITE_MAPTILER_STYLE=streets-v2
ARG VITE_USE_MOCK=false
ENV VITE_API_URL=$VITE_API_URL \
    VITE_MAPTILER_API_KEY=$VITE_MAPTILER_API_KEY \
    VITE_MAPTILER_STYLE=$VITE_MAPTILER_STYLE \
    VITE_USE_MOCK=$VITE_USE_MOCK

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

# ---- serve: tiny nginx that just hands out the static SPA ----
FROM nginx:1.31-alpine AS serve

# Internal-only nginx config — the outer nginx reverse-proxy does TLS + headers.
RUN rm /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# SPA fallback + service worker no-cache (PWA correctness).
RUN printf '%s\n' \
  'server {' \
  '  listen 80 default_server;' \
  '  server_name _;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  charset utf-8;' \
  '  add_header X-Content-Type-Options "nosniff" always;' \
  '  location = /sw.js { add_header Cache-Control "no-cache"; }' \
  '  location = /registerSW.js { add_header Cache-Control "no-cache"; }' \
  '  location = /manifest.webmanifest { add_header Cache-Control "no-cache"; }' \
  '  location /assets/ {' \
  '    expires 1y; access_log off; add_header Cache-Control "public, immutable";' \
  '  }' \
  '  location / { try_files $uri $uri/ /index.html; }' \
  '}' \
  > /etc/nginx/conf.d/spa.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
