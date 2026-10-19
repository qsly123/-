ALTER TABLE "random_events"
  ADD COLUMN IF NOT EXISTS "encounter_mode" text NOT NULL DEFAULT 'single';

ALTER TABLE "random_events"
  ADD COLUMN IF NOT EXISTS "encounter_stage_count" integer NOT NULL DEFAULT 3;

ALTER TABLE "random_events"
  ADD COLUMN IF NOT EXISTS "encounter_choice_count" integer NOT NULL DEFAULT 2;

CREATE TABLE IF NOT EXISTS "map_daily_rumors" (
  "id" text PRIMARY KEY NOT NULL,
  "map_id" text NOT NULL REFERENCES "maps"("id"),
  "date_key" text NOT NULL,
  "summary_version" text NOT NULL,
  "payload_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "map_daily_rumors_map_date_unique"
  ON "map_daily_rumors" ("map_id", "date_key");

CREATE INDEX IF NOT EXISTS "map_daily_rumors_map_date_idx"
  ON "map_daily_rumors" ("map_id", "date_key");

CREATE INDEX IF NOT EXISTS "map_daily_rumors_date_idx"
  ON "map_daily_rumors" ("date_key");

CREATE TABLE IF NOT EXISTS "player_map_event_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "player_id" text NOT NULL REFERENCES "players"("id"),
  "event_id" text NOT NULL REFERENCES "random_events"("id"),
  "status" text NOT NULL DEFAULT 'active',
  "current_stage_index" integer NOT NULL DEFAULT 0,
  "session_payload_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "selected_path_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "expires_at" text NOT NULL,
  "reward_applied_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "player_map_event_sessions_player_status_idx"
  ON "player_map_event_sessions" ("player_id", "status");

CREATE INDEX IF NOT EXISTS "player_map_event_sessions_player_expires_idx"
  ON "player_map_event_sessions" ("player_id", "expires_at");

CREATE INDEX IF NOT EXISTS "player_map_event_sessions_event_status_idx"
  ON "player_map_event_sessions" ("event_id", "status");
