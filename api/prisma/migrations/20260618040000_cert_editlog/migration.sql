-- AV: petugas certification tracker.
CREATE TABLE "PetugasCertification" (
  "id" TEXT NOT NULL,
  "petugasId" TEXT NOT NULL,
  "nama" TEXT NOT NULL,
  "penerbit" TEXT,
  "noSertifikat" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'aktif',
  "catatan" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PetugasCertification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PetugasCertification_petugasId_validUntil_idx"
  ON "PetugasCertification"("petugasId", "validUntil");
ALTER TABLE "PetugasCertification"
  ADD CONSTRAINT "PetugasCertification_petugasId_fkey"
  FOREIGN KEY ("petugasId") REFERENCES "Petugas"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PetugasCertification"
  ADD CONSTRAINT "PetugasCertification_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- BT: kunjungan edit log.
CREATE TABLE "KunjunganEditLog" (
  "id" TEXT NOT NULL,
  "kunjunganId" TEXT NOT NULL,
  "editorId" TEXT NOT NULL,
  "changes" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KunjunganEditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "KunjunganEditLog_kunjunganId_createdAt_idx"
  ON "KunjunganEditLog"("kunjunganId", "createdAt");
ALTER TABLE "KunjunganEditLog"
  ADD CONSTRAINT "KunjunganEditLog_kunjunganId_fkey"
  FOREIGN KEY ("kunjunganId") REFERENCES "Kunjungan"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KunjunganEditLog"
  ADD CONSTRAINT "KunjunganEditLog_editorId_fkey"
  FOREIGN KEY ("editorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
