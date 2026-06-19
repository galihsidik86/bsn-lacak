-- CS — petugas leave/cuti tracker.
CREATE TABLE "PetugasLeave" (
  "id" TEXT NOT NULL,
  "petugasId" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reason" TEXT,
  "approvedById" TEXT,
  "decisionAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PetugasLeave_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PetugasLeave_petugasId_status_startDate_idx"
  ON "PetugasLeave"("petugasId", "status", "startDate");
CREATE INDEX "PetugasLeave_status_endDate_idx"
  ON "PetugasLeave"("status", "endDate");
ALTER TABLE "PetugasLeave"
  ADD CONSTRAINT "PetugasLeave_petugasId_fkey"
  FOREIGN KEY ("petugasId") REFERENCES "Petugas"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PetugasLeave"
  ADD CONSTRAINT "PetugasLeave_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
