-- Schedule next visit per nasabah (BN). Computed from kol + hasil on
-- kunjungan submit, or set manually by a supervisor.
ALTER TABLE "Nasabah"
  ADD COLUMN "nextVisitAt" TIMESTAMP(3);

CREATE INDEX "Nasabah_nextVisitAt_idx" ON "Nasabah"("nextVisitAt");
