-- CD — commission rate per petugas, stored as basis points (1 bps = 0.01%).
-- Existing rows default to 150 bps = 1.5%.
ALTER TABLE "Petugas"
  ADD COLUMN "commissionBps" INTEGER NOT NULL DEFAULT 150;
