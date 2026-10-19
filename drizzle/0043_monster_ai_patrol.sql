ALTER TABLE "monsters"
  ADD COLUMN IF NOT EXISTS "ai_move_interval_min_seconds" integer;

ALTER TABLE "monsters"
  ADD COLUMN IF NOT EXISTS "ai_move_interval_max_seconds" integer;

ALTER TABLE "monsters"
  ADD COLUMN IF NOT EXISTS "ai_move_range" integer;
