-- Optional email column on User — required for ADMIN recipients of the
-- monthly closing CSV. Other roles may leave it null.
ALTER TABLE "User" ADD COLUMN "email" TEXT;
