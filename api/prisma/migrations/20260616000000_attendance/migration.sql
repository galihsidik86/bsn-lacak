-- Clock-in/out tracking for petugas. One open session at a time per
-- petugas is enforced at the route layer (not DB-level partial index)
-- so a future need to log multi-shift days doesn't require migration.

CREATE TABLE "Attendance" (
  "id"           TEXT PRIMARY KEY,
  "petugasId"    TEXT NOT NULL,
  "branchId"     TEXT NOT NULL,
  "clockInAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clockInLat"   DOUBLE PRECISION,
  "clockInLng"   DOUBLE PRECISION,
  "clockOutAt"   TIMESTAMP(3),
  "clockOutLat"  DOUBLE PRECISION,
  "clockOutLng"  DOUBLE PRECISION,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Attendance_petugasId_fkey"
    FOREIGN KEY ("petugasId") REFERENCES "Petugas"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Attendance_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Attendance_petugasId_clockInAt_idx"
  ON "Attendance"("petugasId", "clockInAt");

CREATE INDEX "Attendance_branchId_clockInAt_idx"
  ON "Attendance"("branchId", "clockInAt");

CREATE INDEX "Attendance_petugasId_clockOutAt_idx"
  ON "Attendance"("petugasId", "clockOutAt");
