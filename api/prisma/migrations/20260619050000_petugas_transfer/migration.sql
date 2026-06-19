-- CC — petugas branch-transfer history.
CREATE TABLE "PetugasTransfer" (
  "id" TEXT NOT NULL,
  "petugasId" TEXT NOT NULL,
  "fromBranchId" TEXT NOT NULL,
  "toBranchId" TEXT NOT NULL,
  "reason" TEXT,
  "movedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PetugasTransfer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PetugasTransfer_petugasId_createdAt_idx"
  ON "PetugasTransfer"("petugasId", "createdAt");
CREATE INDEX "PetugasTransfer_fromBranchId_createdAt_idx"
  ON "PetugasTransfer"("fromBranchId", "createdAt");
CREATE INDEX "PetugasTransfer_toBranchId_createdAt_idx"
  ON "PetugasTransfer"("toBranchId", "createdAt");
ALTER TABLE "PetugasTransfer"
  ADD CONSTRAINT "PetugasTransfer_petugasId_fkey"
  FOREIGN KEY ("petugasId") REFERENCES "Petugas"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PetugasTransfer"
  ADD CONSTRAINT "PetugasTransfer_fromBranchId_fkey"
  FOREIGN KEY ("fromBranchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PetugasTransfer"
  ADD CONSTRAINT "PetugasTransfer_toBranchId_fkey"
  FOREIGN KEY ("toBranchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PetugasTransfer"
  ADD CONSTRAINT "PetugasTransfer_movedById_fkey"
  FOREIGN KEY ("movedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
