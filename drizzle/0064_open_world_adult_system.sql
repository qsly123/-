CREATE TABLE IF NOT EXISTS "player_adult_profiles" (
  "player_id" text PRIMARY KEY REFERENCES "players"("id") ON DELETE CASCADE,
  "corruption_value" integer NOT NULL DEFAULT 0,
  "allure_value" integer NOT NULL DEFAULT 0,
  "shame_value" integer NOT NULL DEFAULT 100,
  "adult_preference_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "meta_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_adult_action_at" text,
  "created_at" text NOT NULL DEFAULT NOW()::text,
  "updated_at" text NOT NULL DEFAULT NOW()::text
);

CREATE TABLE IF NOT EXISTS "world_npc_adult_profiles" (
  "npc_id" text PRIMARY KEY REFERENCES "world_npc_profiles"("id") ON DELETE CASCADE,
  "desire_value" integer NOT NULL DEFAULT 0,
  "corruption_value" integer NOT NULL DEFAULT 0,
  "caution_value" integer NOT NULL DEFAULT 0,
  "adult_role_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "adult_preference_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "meta_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_invite_at" text,
  "created_at" text NOT NULL DEFAULT NOW()::text,
  "updated_at" text NOT NULL DEFAULT NOW()::text
);

CREATE TABLE IF NOT EXISTS "world_adult_event_logs" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "player_id" text NOT NULL REFERENCES "players"("id") ON DELETE CASCADE,
  "world_npc_id" text NOT NULL REFERENCES "world_npc_profiles"("id") ON DELETE CASCADE,
  "map_id" text,
  "district_name" text,
  "event_type" text NOT NULL,
  "action_type" text NOT NULL,
  "initiated_by" text NOT NULL DEFAULT 'player',
  "negotiation_outcome" text,
  "resolution_decision" text,
  "status" text NOT NULL DEFAULT 'pending',
  "accepted" boolean NOT NULL DEFAULT false,
  "summary" text NOT NULL DEFAULT '',
  "atmosphere_summary" text,
  "result_summary" text,
  "stat_changes_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "payload_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "expires_at" text,
  "responded_at" text,
  "created_at" text NOT NULL DEFAULT NOW()::text,
  "updated_at" text NOT NULL DEFAULT NOW()::text
);

CREATE INDEX IF NOT EXISTS "player_adult_profiles_corruption_idx"
  ON "player_adult_profiles" ("corruption_value");

CREATE INDEX IF NOT EXISTS "player_adult_profiles_allure_idx"
  ON "player_adult_profiles" ("allure_value");

CREATE INDEX IF NOT EXISTS "world_npc_adult_profiles_corruption_idx"
  ON "world_npc_adult_profiles" ("corruption_value");

CREATE INDEX IF NOT EXISTS "world_npc_adult_profiles_desire_idx"
  ON "world_npc_adult_profiles" ("desire_value");

CREATE INDEX IF NOT EXISTS "world_adult_event_logs_player_status_idx"
  ON "world_adult_event_logs" ("player_id", "status");

CREATE INDEX IF NOT EXISTS "world_adult_event_logs_npc_created_idx"
  ON "world_adult_event_logs" ("world_npc_id", "created_at");

CREATE INDEX IF NOT EXISTS "world_adult_event_logs_map_created_idx"
  ON "world_adult_event_logs" ("map_id", "created_at");
