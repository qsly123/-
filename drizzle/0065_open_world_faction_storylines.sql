CREATE TABLE IF NOT EXISTS "world_factions" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "tone" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "surface_label" text,
  "ai_prompt_hint" text,
  "is_enabled" boolean NOT NULL DEFAULT true,
  "influence_rules_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "payload_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" text NOT NULL DEFAULT NOW()::text,
  "updated_at" text NOT NULL DEFAULT NOW()::text
);

CREATE INDEX IF NOT EXISTS "world_factions_category_idx"
  ON "world_factions" ("category");

CREATE INDEX IF NOT EXISTS "world_factions_enabled_idx"
  ON "world_factions" ("is_enabled");

CREATE TABLE IF NOT EXISTS "world_district_states" (
  "id" text PRIMARY KEY,
  "map_id" text NOT NULL REFERENCES "world_map_instances"("id") ON DELETE CASCADE,
  "district_name" text NOT NULL,
  "district_index" integer NOT NULL DEFAULT 0,
  "dominant_faction_id" text REFERENCES "world_factions"("id") ON DELETE SET NULL,
  "lawful_influence" integer NOT NULL DEFAULT 0,
  "gray_influence" integer NOT NULL DEFAULT 0,
  "demonic_influence" integer NOT NULL DEFAULT 0,
  "local_control" integer NOT NULL DEFAULT 0,
  "tension_level" integer NOT NULL DEFAULT 0,
  "tension_tag" text,
  "hotspot_summary" text,
  "active_hooks_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "payload_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" text NOT NULL DEFAULT NOW()::text,
  "updated_at" text NOT NULL DEFAULT NOW()::text
);

CREATE UNIQUE INDEX IF NOT EXISTS "world_district_states_map_district_unique_idx"
  ON "world_district_states" ("map_id", "district_name");

CREATE INDEX IF NOT EXISTS "world_district_states_map_idx"
  ON "world_district_states" ("map_id");

CREATE INDEX IF NOT EXISTS "world_district_states_dominant_idx"
  ON "world_district_states" ("dominant_faction_id");

CREATE TABLE IF NOT EXISTS "world_storylines" (
  "id" text PRIMARY KEY,
  "map_id" text NOT NULL REFERENCES "world_map_instances"("id") ON DELETE CASCADE,
  "district_state_id" text REFERENCES "world_district_states"("id") ON DELETE SET NULL,
  "district_name" text NOT NULL,
  "storyline_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "source_faction_id" text REFERENCES "world_factions"("id") ON DELETE SET NULL,
  "stage_index" integer NOT NULL DEFAULT 1,
  "stage_key" text NOT NULL,
  "stage_title" text NOT NULL,
  "summary" text NOT NULL DEFAULT '',
  "objective_point_id" text,
  "key_npc_ids_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "payload_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "completed_at" text,
  "created_at" text NOT NULL DEFAULT NOW()::text,
  "updated_at" text NOT NULL DEFAULT NOW()::text
);

CREATE INDEX IF NOT EXISTS "world_storylines_map_status_idx"
  ON "world_storylines" ("map_id", "status");

CREATE INDEX IF NOT EXISTS "world_storylines_type_idx"
  ON "world_storylines" ("storyline_type");

CREATE INDEX IF NOT EXISTS "world_storylines_faction_idx"
  ON "world_storylines" ("source_faction_id");

CREATE INDEX IF NOT EXISTS "world_storylines_district_idx"
  ON "world_storylines" ("district_name");

CREATE TABLE IF NOT EXISTS "world_storyline_participants" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "storyline_id" text NOT NULL REFERENCES "world_storylines"("id") ON DELETE CASCADE,
  "participant_type" text NOT NULL,
  "participant_id" text NOT NULL,
  "faction_id" text REFERENCES "world_factions"("id") ON DELETE SET NULL,
  "role_label" text,
  "status" text NOT NULL DEFAULT 'active',
  "meta_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" text NOT NULL DEFAULT NOW()::text,
  "updated_at" text NOT NULL DEFAULT NOW()::text
);

CREATE UNIQUE INDEX IF NOT EXISTS "world_storyline_participants_unique_idx"
  ON "world_storyline_participants" ("storyline_id", "participant_type", "participant_id");

CREATE INDEX IF NOT EXISTS "world_storyline_participants_storyline_idx"
  ON "world_storyline_participants" ("storyline_id");

CREATE INDEX IF NOT EXISTS "world_storyline_participants_faction_idx"
  ON "world_storyline_participants" ("faction_id");
