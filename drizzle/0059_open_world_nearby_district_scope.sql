ALTER TABLE IF EXISTS "world_local_messages"
ADD COLUMN IF NOT EXISTS "district_name" text;

CREATE INDEX IF NOT EXISTS "world_local_messages_map_district_id_idx"
ON "world_local_messages" ("map_id", "district_name", "id");
