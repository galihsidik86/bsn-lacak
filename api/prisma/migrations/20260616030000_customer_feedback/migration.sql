-- Customer feedback: independent third-party signal per kunjungan. Token
-- on a public link the nasabah opens (no login). One row per kunjungan
-- (uniqueness enforced).

CREATE TABLE "CustomerFeedback" (
  "id"          TEXT PRIMARY KEY,
  "token"       TEXT NOT NULL,
  "kunjunganId" TEXT NOT NULL,
  "nasabahId"   TEXT NOT NULL,
  "petugasId"   TEXT NOT NULL,
  "branchId"    TEXT NOT NULL,
  "sentAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rating"      INTEGER,
  "comment"     TEXT,
  "repliedAt"   TIMESTAMP(3),
  CONSTRAINT "CustomerFeedback_token_key" UNIQUE ("token"),
  CONSTRAINT "CustomerFeedback_kunjunganId_key" UNIQUE ("kunjunganId"),
  CONSTRAINT "CustomerFeedback_kunjunganId_fkey"
    FOREIGN KEY ("kunjunganId") REFERENCES "Kunjungan"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerFeedback_nasabahId_fkey"
    FOREIGN KEY ("nasabahId") REFERENCES "Nasabah"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CustomerFeedback_petugasId_fkey"
    FOREIGN KEY ("petugasId") REFERENCES "Petugas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CustomerFeedback_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CustomerFeedback_petugasId_repliedAt_idx"
  ON "CustomerFeedback"("petugasId", "repliedAt");

CREATE INDEX "CustomerFeedback_branchId_sentAt_idx"
  ON "CustomerFeedback"("branchId", "sentAt");
