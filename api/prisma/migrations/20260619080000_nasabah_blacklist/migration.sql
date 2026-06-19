-- DK: nasabah blacklist flag.
ALTER TABLE "Nasabah"
  ADD COLUMN "blacklisted"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "blacklistReason" TEXT,
  ADD COLUMN "blacklistedAt"   TIMESTAMP(3);

CREATE INDEX "Nasabah_blacklisted_idx" ON "Nasabah"("blacklisted");
