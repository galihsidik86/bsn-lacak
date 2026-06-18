-- Auto-archive worker (BY) — flag set on resolved kunjungan older than the
-- configured retention window so the default list endpoint can skip them.
ALTER TABLE "Kunjungan"
  ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Kunjungan_archivedAt_idx" ON "Kunjungan"("archivedAt");
