-- CU — realtime presence. Stamped via /api/users/heartbeat.
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
