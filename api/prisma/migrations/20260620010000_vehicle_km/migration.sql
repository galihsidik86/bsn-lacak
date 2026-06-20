-- DR: kendaraan dinas + odometer logbook.
ALTER TABLE "Petugas"
  ADD COLUMN "kendaraanPlat"  TEXT,
  ADD COLUMN "kendaraanModel" TEXT;

ALTER TABLE "Attendance"
  ADD COLUMN "kmStart" INTEGER,
  ADD COLUMN "kmEnd"   INTEGER;
