-- CK — escalation ticket model. One auto-opened per nasabah whose payment
-- gap matches the kol-tiered cadence; supervisors close them with notes.
CREATE TABLE "EscalationTicket" (
  "id" TEXT NOT NULL,
  "nasabahId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "note" TEXT,
  "assignedToId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),

  CONSTRAINT "EscalationTicket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EscalationTicket_branchId_status_createdAt_idx"
  ON "EscalationTicket" ("branchId", "status", "createdAt");
CREATE INDEX "EscalationTicket_nasabahId_status_idx"
  ON "EscalationTicket" ("nasabahId", "status");
ALTER TABLE "EscalationTicket"
  ADD CONSTRAINT "EscalationTicket_nasabahId_fkey"
  FOREIGN KEY ("nasabahId") REFERENCES "Nasabah"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EscalationTicket"
  ADD CONSTRAINT "EscalationTicket_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EscalationTicket"
  ADD CONSTRAINT "EscalationTicket_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
