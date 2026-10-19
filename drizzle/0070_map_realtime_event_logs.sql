CREATE TABLE IF NOT EXISTS "map_realtime_event_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "idempotency_key" text NOT NULL,
  "room_id" text NOT NULL,
  "player_id" text NOT NULL,
  "map_id" text,
  "target_map_id" text,
  "entity_id" text,
  "action_id" text NOT NULL,
  "input_type" text NOT NULL,
  "status" text DEFAULT 'accepted' NOT NULL,
  "reason" text,
  "payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "map_realtime_event_logs_player_id_players_id_fk"
    FOREIGN KEY ("player_id") REFERENCES "players"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "map_realtime_event_logs_idempotency_unique"
  ON "map_realtime_event_logs" ("idempotency_key");

CREATE INDEX IF NOT EXISTS "map_realtime_event_logs_player_created_idx"
  ON "map_realtime_event_logs" ("player_id", "created_at");

CREATE INDEX IF NOT EXISTS "map_realtime_event_logs_room_created_idx"
  ON "map_realtime_event_logs" ("room_id", "created_at");

CREATE INDEX IF NOT EXISTS "map_realtime_event_logs_map_created_idx"
  ON "map_realtime_event_logs" ("map_id", "created_at");
