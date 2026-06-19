-- DG — optional substitute petugas on PetugasLeave. Worker swaps the
-- nasabah of `petugasId` to `substitutePetugasId` on leave start, then
-- restores on leave end. `reassigned` is the idempotency flag.
ALTER TABLE "PetugasLeave"
  ADD COLUMN "substitutePetugasId" TEXT,
  ADD COLUMN "reassigned" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PetugasLeave"
  ADD CONSTRAINT "PetugasLeave_substitutePetugasId_fkey"
  FOREIGN KEY ("substitutePetugasId") REFERENCES "Petugas"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
