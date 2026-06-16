-- Supervisor photo annotations stored as a JSON array of shapes on each
-- Foto. Defaults to '[]' so existing rows keep working.
ALTER TABLE "Foto" ADD COLUMN "annotations" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Webhook subscriptions + delivery log for external integrations.
CREATE TABLE "WebhookSubscription" (
  "id"              TEXT PRIMARY KEY,
  "name"            TEXT NOT NULL,
  "url"             TEXT NOT NULL,
  "secret"          TEXT NOT NULL,
  "events"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "branchId"        TEXT,
  "active"          BOOLEAN NOT NULL DEFAULT true,
  "createdById"     TEXT NOT NULL,
  "lastDeliveryAt"  TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookSubscription_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WebhookSubscription_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "WebhookSubscription_active_idx" ON "WebhookSubscription"("active");
CREATE INDEX "WebhookSubscription_branchId_idx" ON "WebhookSubscription"("branchId");

CREATE TABLE "WebhookDelivery" (
  "id"             TEXT PRIMARY KEY,
  "webhookId"      TEXT NOT NULL,
  "event"          TEXT NOT NULL,
  "payload"        JSONB NOT NULL,
  "status"         TEXT NOT NULL,
  "responseStatus" INTEGER,
  "attempts"       INTEGER NOT NULL DEFAULT 1,
  "error"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookDelivery_webhookId_fkey"
    FOREIGN KEY ("webhookId") REFERENCES "WebhookSubscription"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WebhookDelivery_webhookId_createdAt_idx"
  ON "WebhookDelivery"("webhookId", "createdAt");
CREATE INDEX "WebhookDelivery_status_createdAt_idx"
  ON "WebhookDelivery"("status", "createdAt");
