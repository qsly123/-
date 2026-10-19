CREATE TABLE IF NOT EXISTS "player_temporary_cosmetic_grants" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "player_id" text NOT NULL REFERENCES "players" ("id"),
  "avatar_id" text REFERENCES "avatar_assets" ("id"),
  "avatar_frame_id" text REFERENCES "avatar_frame_assets" ("id"),
  "source_item_id" text REFERENCES "items" ("id"),
  "inserted_avatar_unlock" boolean NOT NULL DEFAULT false,
  "inserted_avatar_frame_unlock" boolean NOT NULL DEFAULT false,
  "granted_at" text NOT NULL,
  "expires_at" text NOT NULL,
  "revoked_at" text
);

CREATE INDEX IF NOT EXISTS "player_temp_cosmetic_grants_player_idx"
  ON "player_temporary_cosmetic_grants" ("player_id");

CREATE INDEX IF NOT EXISTS "player_temp_cosmetic_grants_avatar_idx"
  ON "player_temporary_cosmetic_grants" ("avatar_id");

CREATE INDEX IF NOT EXISTS "player_temp_cosmetic_grants_frame_idx"
  ON "player_temporary_cosmetic_grants" ("avatar_frame_id");

CREATE INDEX IF NOT EXISTS "player_temp_cosmetic_grants_expires_idx"
  ON "player_temporary_cosmetic_grants" ("expires_at");
