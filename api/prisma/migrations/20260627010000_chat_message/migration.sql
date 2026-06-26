-- ChatMessage — 1:1 direct messaging antara user.
CREATE TABLE "ChatMessage" (
  "id"        TEXT NOT NULL,
  "fromId"    TEXT NOT NULL,
  "toId"      TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "readAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatMessage_fromId_toId_createdAt_idx"
  ON "ChatMessage" ("fromId", "toId", "createdAt");
CREATE INDEX "ChatMessage_toId_readAt_idx"
  ON "ChatMessage" ("toId", "readAt");

ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_fromId_fkey"
  FOREIGN KEY ("fromId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatMessage"
  ADD CONSTRAINT "ChatMessage_toId_fkey"
  FOREIGN KEY ("toId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
