-- DP: branch-level commission default.
ALTER TABLE "Branch" ADD COLUMN "defaultCommissionBps" INTEGER;

-- DQ: nasabah snooze.
ALTER TABLE "Nasabah"
  ADD COLUMN "snoozedUntil" TIMESTAMP(3),
  ADD COLUMN "snoozeReason" TEXT;
CREATE INDEX "Nasabah_snoozedUntil_idx" ON "Nasabah"("snoozedUntil");
