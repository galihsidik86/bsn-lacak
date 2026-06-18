-- Branch-level monthly KPI targets for the Scorecard screen.
ALTER TABLE "Branch"
  ADD COLUMN "targetCollection"   BIGINT  NOT NULL DEFAULT 0,
  ADD COLUMN "targetVisits"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "targetApprovalRate" INTEGER NOT NULL DEFAULT 85;
