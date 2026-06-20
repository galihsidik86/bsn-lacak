-- DT: petugas-to-petugas nasabah swap proposal.
CREATE TYPE "PetugasSwapStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "PetugasSwapRequest" (
  "id"                   TEXT NOT NULL,
  "proposerId"           TEXT NOT NULL,
  "counterpartId"        TEXT NOT NULL,
  "proposerNasabahId"    TEXT NOT NULL,
  "counterpartNasabahId" TEXT NOT NULL,
  "status"               "PetugasSwapStatus" NOT NULL DEFAULT 'PENDING',
  "reason"               TEXT NOT NULL,
  "decidedById"          TEXT,
  "decisionNote"         TEXT,
  "decidedAt"            TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PetugasSwapRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PetugasSwapRequest_proposerId_status_idx"    ON "PetugasSwapRequest"("proposerId", "status");
CREATE INDEX "PetugasSwapRequest_counterpartId_status_idx" ON "PetugasSwapRequest"("counterpartId", "status");
CREATE INDEX "PetugasSwapRequest_status_idx"               ON "PetugasSwapRequest"("status");
ALTER TABLE "PetugasSwapRequest"
  ADD CONSTRAINT "PetugasSwapRequest_proposerId_fkey"           FOREIGN KEY ("proposerId")           REFERENCES "Petugas"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PetugasSwapRequest_counterpartId_fkey"        FOREIGN KEY ("counterpartId")        REFERENCES "Petugas"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PetugasSwapRequest_proposerNasabahId_fkey"    FOREIGN KEY ("proposerNasabahId")    REFERENCES "Nasabah"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PetugasSwapRequest_counterpartNasabahId_fkey" FOREIGN KEY ("counterpartNasabahId") REFERENCES "Nasabah"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PetugasSwapRequest_decidedById_fkey"          FOREIGN KEY ("decidedById")          REFERENCES "User"("id")    ON DELETE SET NULL ON UPDATE CASCADE;
