-- Geofence polygons per cabang ("Wilayah"). One polygon stored as GeoJSON
-- in a Json column; point-in-polygon evaluation is done in app code via
-- turf, so no PostGIS dependency. Petugas optionally point at one zone
-- via wilayahZoneId; nullable so legacy rows stay valid.

CREATE TABLE "Wilayah" (
  "id"        TEXT PRIMARY KEY,
  "branchId"  TEXT NOT NULL,
  "nama"      TEXT NOT NULL,
  "polygon"   JSONB NOT NULL,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Wilayah_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Wilayah_branchId_idx" ON "Wilayah"("branchId");
CREATE INDEX "Wilayah_active_idx" ON "Wilayah"("active");

ALTER TABLE "Petugas"
  ADD COLUMN "wilayahZoneId" TEXT,
  ADD CONSTRAINT "Petugas_wilayahZoneId_fkey"
    FOREIGN KEY ("wilayahZoneId") REFERENCES "Wilayah"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Petugas_wilayahZoneId_idx" ON "Petugas"("wilayahZoneId");
