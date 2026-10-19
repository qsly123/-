CREATE TABLE IF NOT EXISTS "player_hidden_combat_stats" (
  "player_id" text PRIMARY KEY NOT NULL REFERENCES "players"("id"),
  "wild_defeat_count" integer NOT NULL DEFAULT 0,
  "created_at" text NOT NULL DEFAULT NOW()::text,
  "updated_at" text NOT NULL DEFAULT NOW()::text
);
