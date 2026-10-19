CREATE TABLE IF NOT EXISTS "party_groups" (
  "id" text PRIMARY KEY NOT NULL,
  "leader_player_id" text NOT NULL REFERENCES "players"("id"),
  "status" text NOT NULL DEFAULT 'active',
  "active_encounter_id" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "party_groups_leader_player_id_idx" ON "party_groups" ("leader_player_id");
CREATE INDEX IF NOT EXISTS "party_groups_status_updated_at_idx" ON "party_groups" ("status", "updated_at");

CREATE TABLE IF NOT EXISTS "party_group_members" (
  "party_id" text NOT NULL REFERENCES "party_groups"("id"),
  "player_id" text NOT NULL REFERENCES "players"("id"),
  "slot_order" integer NOT NULL DEFAULT 0,
  "joined_at" text NOT NULL,
  PRIMARY KEY("party_id", "player_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "party_group_members_player_unique" ON "party_group_members" ("player_id");
CREATE INDEX IF NOT EXISTS "party_group_members_party_slot_idx" ON "party_group_members" ("party_id", "slot_order");

CREATE TABLE IF NOT EXISTS "party_invites" (
  "id" text PRIMARY KEY NOT NULL,
  "inviter_id" text NOT NULL REFERENCES "players"("id"),
  "target_player_id" text NOT NULL REFERENCES "players"("id"),
  "party_id" text REFERENCES "party_groups"("id"),
  "status" text NOT NULL DEFAULT 'pending',
  "expires_at" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "responded_at" text
);

CREATE INDEX IF NOT EXISTS "party_invites_target_status_idx" ON "party_invites" ("target_player_id", "status");
CREATE INDEX IF NOT EXISTS "party_invites_inviter_status_idx" ON "party_invites" ("inviter_id", "status");
CREATE INDEX IF NOT EXISTS "party_invites_party_status_idx" ON "party_invites" ("party_id", "status");

CREATE TABLE IF NOT EXISTS "party_encounters" (
  "id" text PRIMARY KEY NOT NULL,
  "party_id" text NOT NULL REFERENCES "party_groups"("id"),
  "encounter_type" text NOT NULL,
  "monster_id" text NOT NULL REFERENCES "monsters"("id"),
  "status" text NOT NULL DEFAULT 'ongoing',
  "state_json" jsonb,
  "scene_snapshot_json" jsonb,
  "turn_state_json" jsonb,
  "eligible_member_ids_json" jsonb,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "resolved_at" text
);

CREATE INDEX IF NOT EXISTS "party_encounters_party_status_idx" ON "party_encounters" ("party_id", "status");
CREATE INDEX IF NOT EXISTS "party_encounters_monster_status_idx" ON "party_encounters" ("monster_id", "status");
CREATE INDEX IF NOT EXISTS "party_encounters_type_status_idx" ON "party_encounters" ("encounter_type", "status");
