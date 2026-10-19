ALTER TABLE "random_events"
ADD COLUMN IF NOT EXISTS "map_types" jsonb;

UPDATE "random_events"
SET "map_types" = CASE
  WHEN "map_type" IS NULL OR btrim("map_type") = '' THEN NULL
  ELSE jsonb_build_array("map_type")
END
WHERE "map_types" IS NULL;

CREATE INDEX IF NOT EXISTS "random_events_map_types_gin_idx"
ON "random_events"
USING gin ("map_types");
