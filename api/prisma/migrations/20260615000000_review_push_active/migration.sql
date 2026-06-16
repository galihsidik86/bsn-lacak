-- Review pipeline + anti-fraud + Web Push + soft-delete flags.
--
-- Captures every schema change since 20260614000000_user_active:
--   - Kunjungan gains riskScore/riskFlags (anti-fraud) + reviewStatus FK
--     to User (supervisor approval workflow).
--   - ReviewStatus enum (PENDING/APPROVED/REJECTED).
--   - PushSubscription table for Web Push delivery per device/endpoint.
--   - Petugas + Nasabah gain `active` for soft-delete.
--   - BlastStatus gains DIBATALKAN.

-- 1. New enum + Kunjungan columns ------------------------------------------
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Kunjungan"
  ADD COLUMN "riskScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "riskFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "reviewerId" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNote" TEXT;

CREATE INDEX "Kunjungan_reviewStatus_idx" ON "Kunjungan"("reviewStatus");

ALTER TABLE "Kunjungan"
  ADD CONSTRAINT "Kunjungan_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Web Push subscriptions ------------------------------------------------
CREATE TABLE "PushSubscription" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL,
  "endpoint"  TEXT NOT NULL,
  "p256dh"    TEXT NOT NULL,
  "authKey"   TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubscription_endpoint_key" UNIQUE ("endpoint"),
  CONSTRAINT "PushSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- 3. Soft-delete flags -----------------------------------------------------
ALTER TABLE "Petugas" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Nasabah" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "Nasabah_active_idx" ON "Nasabah"("active");

-- 4. BlastStatus.DIBATALKAN ------------------------------------------------
ALTER TYPE "BlastStatus" ADD VALUE 'DIBATALKAN';
