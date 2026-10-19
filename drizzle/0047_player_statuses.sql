CREATE TABLE IF NOT EXISTS "player_statuses" (
  "id" text PRIMARY KEY NOT NULL,
  "player_id" text NOT NULL REFERENCES "players"("id"),
  "status_key" text NOT NULL,
  "title" text NOT NULL,
  "stage_key" text NOT NULL,
  "stage_index" integer DEFAULT 1 NOT NULL,
  "icon_image_url" text,
  "source_type" text,
  "source_plugin_id" text,
  "source_ref" text,
  "started_at" text NOT NULL,
  "next_stage_at" text,
  "expires_at" text,
  "attr_effects" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "flow_effects" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "player_statuses_player_status_idx" ON "player_statuses" ("player_id", "status_key");
CREATE INDEX IF NOT EXISTS "player_statuses_player_expires_idx" ON "player_statuses" ("player_id", "expires_at");
CREATE INDEX IF NOT EXISTS "player_statuses_next_stage_idx" ON "player_statuses" ("next_stage_at");
