-- Multi-branch tenancy migration.
-- Backward-compatible with existing data: creates a default "BSN Pusat" branch,
-- adds nullable branchId columns, backfills every existing row, then enforces
-- NOT NULL + foreign keys. Safe to rerun on a fresh DB (no rows to backfill).

-- ---- 1. Branch table ----
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "alamat" TEXT,
    "kepalaCabang" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Branch_kode_key" ON "Branch"("kode");

-- ---- 2. Seed default branch so backfill has something to point at ----
INSERT INTO "Branch" ("id", "kode", "nama", "active", "createdAt", "updatedAt")
VALUES ('br_default_bsn_pusat', 'BSN001', 'BSN Pusat', true, NOW(), NOW())
ON CONFLICT ("kode") DO NOTHING;

-- ---- 3. User.branchId — nullable for ADMINs ----
ALTER TABLE "User" ADD COLUMN "branchId" TEXT;
CREATE INDEX "User_branchId_idx" ON "User"("branchId");
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Existing SUPERVISOR/PETUGAS users get tied to BSN Pusat; ADMINs stay NULL.
UPDATE "User" SET "branchId" = 'br_default_bsn_pusat' WHERE "role" IN ('SUPERVISOR', 'PETUGAS');

-- ---- 4. Petugas.branchId ----
ALTER TABLE "Petugas" ADD COLUMN "branchId" TEXT;
UPDATE "Petugas" SET "branchId" = 'br_default_bsn_pusat';
ALTER TABLE "Petugas" ALTER COLUMN "branchId" SET NOT NULL;
CREATE INDEX "Petugas_branchId_idx" ON "Petugas"("branchId");
ALTER TABLE "Petugas" ADD CONSTRAINT "Petugas_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- 5. Nasabah.branchId ----
ALTER TABLE "Nasabah" ADD COLUMN "branchId" TEXT;
UPDATE "Nasabah" SET "branchId" = 'br_default_bsn_pusat';
ALTER TABLE "Nasabah" ALTER COLUMN "branchId" SET NOT NULL;
CREATE INDEX "Nasabah_branchId_idx" ON "Nasabah"("branchId");
ALTER TABLE "Nasabah" ADD CONSTRAINT "Nasabah_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- 6. Kunjungan.branchId ----
ALTER TABLE "Kunjungan" ADD COLUMN "branchId" TEXT;
UPDATE "Kunjungan" SET "branchId" = 'br_default_bsn_pusat';
ALTER TABLE "Kunjungan" ALTER COLUMN "branchId" SET NOT NULL;
CREATE INDEX "Kunjungan_branchId_tanggal_idx" ON "Kunjungan"("branchId", "tanggal");
ALTER TABLE "Kunjungan" ADD CONSTRAINT "Kunjungan_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- 7. Pembayaran.branchId ----
ALTER TABLE "Pembayaran" ADD COLUMN "branchId" TEXT;
UPDATE "Pembayaran" SET "branchId" = 'br_default_bsn_pusat';
ALTER TABLE "Pembayaran" ALTER COLUMN "branchId" SET NOT NULL;
CREATE INDEX "Pembayaran_branchId_tanggal_idx" ON "Pembayaran"("branchId", "tanggal");
ALTER TABLE "Pembayaran" ADD CONSTRAINT "Pembayaran_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- 8. Blast.branchId ----
ALTER TABLE "Blast" ADD COLUMN "branchId" TEXT;
UPDATE "Blast" SET "branchId" = 'br_default_bsn_pusat';
ALTER TABLE "Blast" ALTER COLUMN "branchId" SET NOT NULL;
CREATE INDEX "Blast_branchId_createdAt_idx" ON "Blast"("branchId", "createdAt");
ALTER TABLE "Blast" ADD CONSTRAINT "Blast_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
