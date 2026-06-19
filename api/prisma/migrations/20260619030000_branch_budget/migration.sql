-- CV — monthly budget pots per branch.
ALTER TABLE "Branch"
  ADD COLUMN "budgetOperational" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "budgetCommission"  BIGINT NOT NULL DEFAULT 0;
