# syntax=docker/dockerfile:1.7

# ---- deps: install all (incl dev) for the TS build ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ---- build: compile TS, generate Prisma client ----
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate \
  && npm run build

# ---- prod: prune dev deps, run as non-root ----
FROM node:22-alpine AS prod
ENV NODE_ENV=production
WORKDIR /app

# Tini reaps zombies and forwards SIGTERM cleanly.
RUN apk add --no-cache tini wget \
  && addgroup -S app && adduser -S -G app app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --no-audit --no-fund \
  && npx prisma generate \
  && npm cache clean --force

COPY --from=build /app/dist ./dist

# Ensure uploads dir exists and is writeable by the non-root user.
RUN mkdir -p /app/uploads && chown -R app:app /app

USER app
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health/ready || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/server.js"]
