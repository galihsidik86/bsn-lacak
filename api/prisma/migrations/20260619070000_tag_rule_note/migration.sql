-- DH: auto-tagging rule + NasabahTag.ruleId.
CREATE TYPE "TagRuleType" AS ENUM ('DPD_ABOVE', 'DAYS_SINCE_PAYMENT_ABOVE', 'KOL_IN');

ALTER TABLE "NasabahTag" ADD COLUMN "ruleId" TEXT;
CREATE INDEX "NasabahTag_ruleId_idx" ON "NasabahTag"("ruleId");

CREATE TABLE "TagRule" (
  "id"          TEXT NOT NULL,
  "tagId"       TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "type"        "TagRuleType" NOT NULL,
  "threshold"   INTEGER,
  "kolValues"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TagRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TagRule_tagId_idx"  ON "TagRule"("tagId");
CREATE INDEX "TagRule_active_idx" ON "TagRule"("active");
ALTER TABLE "TagRule"
  ADD CONSTRAINT "TagRule_tagId_fkey"       FOREIGN KEY ("tagId")       REFERENCES "Tag"("id")  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TagRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DI: nasabah note timeline.
CREATE TABLE "NasabahNote" (
  "id"        TEXT NOT NULL,
  "nasabahId" TEXT NOT NULL,
  "authorId"  TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NasabahNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NasabahNote_nasabahId_createdAt_idx" ON "NasabahNote"("nasabahId", "createdAt");
ALTER TABLE "NasabahNote"
  ADD CONSTRAINT "NasabahNote_nasabahId_fkey" FOREIGN KEY ("nasabahId") REFERENCES "Nasabah"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "NasabahNote_authorId_fkey"  FOREIGN KEY ("authorId")  REFERENCES "User"("id")    ON DELETE CASCADE ON UPDATE CASCADE;
