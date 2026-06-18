-- Webhook retry queue + dead-letter status.
ALTER TABLE "WebhookDelivery"
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3);

ALTER TABLE "WebhookDelivery"
  ALTER COLUMN "attempts" SET DEFAULT 0;

-- Composite index so the retry worker can cheaply find rows ready to fire.
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx"
  ON "WebhookDelivery" ("status", "nextAttemptAt");
