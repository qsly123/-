ALTER TABLE "monsters"
  ADD COLUMN IF NOT EXISTS "current_position_x" integer;

ALTER TABLE "monsters"
  ADD COLUMN IF NOT EXISTS "current_position_y" integer;

ALTER TABLE "monsters"
  ADD COLUMN IF NOT EXISTS "next_ai_move_at" text;

ALTER TABLE "monsters"
  ADD COLUMN IF NOT EXISTS "position_updated_at" text;

UPDATE "monsters"
SET
  "current_position_x" = COALESCE("current_position_x", "position_x"),
  "current_position_y" = COALESCE("current_position_y", "position_y")
WHERE "current_position_x" IS NULL
   OR "current_position_y" IS NULL;
