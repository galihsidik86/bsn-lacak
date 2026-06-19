-- CX: nasabah segmentation labels.
CREATE TABLE "Tag" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "color"       TEXT NOT NULL DEFAULT '#64748b',
  "branchId"    TEXT,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tag_branchId_name_key" ON "Tag"("branchId", "name");
CREATE INDEX "Tag_branchId_idx" ON "Tag"("branchId");
ALTER TABLE "Tag"
  ADD CONSTRAINT "Tag_branchId_fkey"    FOREIGN KEY ("branchId")    REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Tag_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id")   ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "NasabahTag" (
  "nasabahId" TEXT NOT NULL,
  "tagId"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NasabahTag_pkey" PRIMARY KEY ("nasabahId", "tagId")
);
CREATE INDEX "NasabahTag_tagId_idx" ON "NasabahTag"("tagId");
ALTER TABLE "NasabahTag"
  ADD CONSTRAINT "NasabahTag_nasabahId_fkey" FOREIGN KEY ("nasabahId") REFERENCES "Nasabah"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "NasabahTag_tagId_fkey"     FOREIGN KEY ("tagId")     REFERENCES "Tag"("id")     ON DELETE CASCADE ON UPDATE CASCADE;
