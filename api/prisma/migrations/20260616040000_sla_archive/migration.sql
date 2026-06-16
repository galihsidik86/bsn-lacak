-- SLA marker on Kunjungan. Set once the first time the SLA worker
-- notifies supervisors that a PENDING row has exceeded the threshold,
-- so we don't re-page on every poll cycle.

ALTER TABLE "Kunjungan" ADD COLUMN "slaAlertedAt" TIMESTAMP(3);
