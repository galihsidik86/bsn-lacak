-- DL: restructure / pelunasan dipercepat workflow.
CREATE TYPE "RestructureStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "NasabahRestructure" (
  "id"            TEXT NOT NULL,
  "nasabahId"     TEXT NOT NULL,
  "status"        "RestructureStatus" NOT NULL DEFAULT 'PENDING',
  "reason"        TEXT NOT NULL,
  "oldSisa"       BIGINT NOT NULL,
  "newSisa"       BIGINT NOT NULL,
  "oldAngsuran"   BIGINT NOT NULL,
  "newAngsuran"   BIGINT NOT NULL,
  "oldTenor"      INTEGER NOT NULL,
  "newTenor"      INTEGER NOT NULL,
  "proposedById"  TEXT NOT NULL,
  "decidedById"   TEXT,
  "decisionNote"  TEXT,
  "decidedAt"     TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NasabahRestructure_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NasabahRestructure_nasabahId_createdAt_idx" ON "NasabahRestructure"("nasabahId", "createdAt");
CREATE INDEX "NasabahRestructure_status_idx" ON "NasabahRestructure"("status");
ALTER TABLE "NasabahRestructure"
  ADD CONSTRAINT "NasabahRestructure_nasabahId_fkey"    FOREIGN KEY ("nasabahId")    REFERENCES "Nasabah"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "NasabahRestructure_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id")    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "NasabahRestructure_decidedById_fkey"  FOREIGN KEY ("decidedById")  REFERENCES "User"("id")    ON DELETE SET NULL ON UPDATE CASCADE;
