-- DY: branch-level CSAT auto-send toggle.
ALTER TABLE "Branch" ADD COLUMN "csatEnabled" BOOLEAN NOT NULL DEFAULT false;
