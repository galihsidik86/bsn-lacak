-- Soft-deactivation flag on User. Defaults true so all existing rows stay
-- active; deactivating sets to false. Avoids deleting users so AuditLog,
-- Notification, RefreshToken, and Petugas relations stay intact for history.

ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
