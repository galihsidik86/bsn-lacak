-- DN: nasabah document attachments.
CREATE TYPE "NasabahDocumentKind" AS ENUM ('KTP', 'KONTRAK', 'AGUNAN', 'SLIP_GAJI', 'LAIN');

CREATE TABLE "NasabahDocument" (
  "id"           TEXT NOT NULL,
  "nasabahId"    TEXT NOT NULL,
  "kind"         "NasabahDocumentKind" NOT NULL,
  "fileName"     TEXT NOT NULL,
  "filePath"     TEXT NOT NULL,
  "mimeType"     TEXT NOT NULL,
  "sizeBytes"    INTEGER NOT NULL,
  "notes"        TEXT,
  "uploadedById" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NasabahDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NasabahDocument_nasabahId_createdAt_idx" ON "NasabahDocument"("nasabahId", "createdAt");
ALTER TABLE "NasabahDocument"
  ADD CONSTRAINT "NasabahDocument_nasabahId_fkey"    FOREIGN KEY ("nasabahId")    REFERENCES "Nasabah"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "NasabahDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id")    ON DELETE SET NULL ON UPDATE CASCADE;

-- DO: attendance dispute workflow.
CREATE TYPE "AttendanceDisputeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "AttendanceDispute" (
  "id"               TEXT NOT NULL,
  "attendanceId"     TEXT NOT NULL,
  "petugasId"        TEXT NOT NULL,
  "status"           "AttendanceDisputeStatus" NOT NULL DEFAULT 'PENDING',
  "reason"           TEXT NOT NULL,
  "proposedClockIn"  TIMESTAMP(3),
  "proposedClockOut" TIMESTAMP(3),
  "decidedById"      TEXT,
  "decisionNote"     TEXT,
  "decidedAt"        TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttendanceDispute_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AttendanceDispute_attendanceId_idx" ON "AttendanceDispute"("attendanceId");
CREATE INDEX "AttendanceDispute_status_idx"       ON "AttendanceDispute"("status");
CREATE INDEX "AttendanceDispute_petugasId_createdAt_idx" ON "AttendanceDispute"("petugasId", "createdAt");
ALTER TABLE "AttendanceDispute"
  ADD CONSTRAINT "AttendanceDispute_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AttendanceDispute_petugasId_fkey"    FOREIGN KEY ("petugasId")    REFERENCES "Petugas"("id")    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AttendanceDispute_decidedById_fkey"  FOREIGN KEY ("decidedById")  REFERENCES "User"("id")       ON DELETE SET NULL ON UPDATE CASCADE;
