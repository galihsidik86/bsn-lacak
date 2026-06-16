-- Per-user notification preferences. Map of notification type → boolean.
-- Defaulting to NULL keeps existing users opted in across the board;
-- the app treats absent keys as true so the column is purely additive.

ALTER TABLE "User" ADD COLUMN "notifPrefs" JSONB;
