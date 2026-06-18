-- Track row insertion separately from the visit date so the 30-min
-- edit/delete window stays accurate even when a petugas backdates `tanggal`.
ALTER TABLE "Kunjungan"
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill existing rows with `tanggal` so older laporan get a reasonable
-- non-null createdAt. New rows from here on get NOW() via the column default.
UPDATE "Kunjungan" SET "createdAt" = "tanggal" WHERE "createdAt" = CURRENT_TIMESTAMP;
