-- Long-lived API keys for machine-to-machine integration. Only the
-- SHA-256 hash is stored; the plain token is shown ONCE at create.
-- tokenPrefix lets the UI render a stable identifier without leaking
-- the secret. branchId optional — null means the key sees ADMIN scope
-- (all branches).

CREATE TABLE "ApiKey" (
  "id"          TEXT PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "tokenHash"   TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "branchId"    TEXT,
  "scope"       TEXT NOT NULL DEFAULT 'read',
  "expiresAt"   TIMESTAMP(3),
  "lastUsedAt"  TIMESTAMP(3),
  "revokedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiKey_tokenHash_key" UNIQUE ("tokenHash"),
  CONSTRAINT "ApiKey_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ApiKey_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ApiKey_createdById_idx" ON "ApiKey"("createdById");
CREATE INDEX "ApiKey_branchId_idx"    ON "ApiKey"("branchId");
CREATE INDEX "ApiKey_revokedAt_idx"   ON "ApiKey"("revokedAt");

-- Per-user saved filter / preset view for the screens that have
-- filter chrome. Free-form `screen` slug + JSON payload — the API
-- doesn't interpret the payload, just persists it.
CREATE TABLE "SavedFilter" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL,
  "screen"    TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "payload"   JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedFilter_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SavedFilter_userId_screen_idx" ON "SavedFilter"("userId", "screen");
