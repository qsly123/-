ALTER TABLE IF EXISTS "world_map_instances"
  ADD COLUMN IF NOT EXISTS "meta_json" jsonb DEFAULT '{}'::jsonb NOT NULL;
