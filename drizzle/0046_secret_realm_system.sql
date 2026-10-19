ALTER TABLE "players"
ADD COLUMN IF NOT EXISTS "current_map_instance_id" text;

ALTER TABLE "players"
ADD COLUMN IF NOT EXISTS "secret_realm_pity_counter" integer DEFAULT 0 NOT NULL;

ALTER TABLE "players"
ADD COLUMN IF NOT EXISTS "secret_realm_last_personal_spawn_at" text;

CREATE TABLE IF NOT EXISTS "secret_realm_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "source_type" text DEFAULT 'fallback' NOT NULL,
  "status" text DEFAULT 'ready' NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "announcement" text DEFAULT '' NOT NULL,
  "theme" text DEFAULT '幽谷古境' NOT NULL,
  "boss_background" text DEFAULT '' NOT NULL,
  "size_tier" text DEFAULT 'small' NOT NULL,
  "rarity" text DEFAULT 'common' NOT NULL,
  "recommended_realm" integer DEFAULT 1 NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "reward_budget" integer DEFAULT 100 NOT NULL,
  "snapshot_json" jsonb NOT NULL,
  "boss_pool" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "validation_report" jsonb,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "secret_realm_templates_status_idx" ON "secret_realm_templates" ("status");
CREATE INDEX IF NOT EXISTS "secret_realm_templates_realm_size_idx" ON "secret_realm_templates" ("recommended_realm", "size_tier");
CREATE INDEX IF NOT EXISTS "secret_realm_templates_rarity_idx" ON "secret_realm_templates" ("rarity");

CREATE TABLE IF NOT EXISTS "secret_realm_spawns" (
  "id" text PRIMARY KEY NOT NULL,
  "template_id" text NOT NULL REFERENCES "secret_realm_templates"("id"),
  "map_id" text NOT NULL REFERENCES "maps"("id"),
  "instance_id" text,
  "spawn_type" text DEFAULT 'global' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "owner_player_id" text REFERENCES "players"("id"),
  "visible_player_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "position_x" integer NOT NULL,
  "position_y" integer NOT NULL,
  "spawned_at" text NOT NULL,
  "expires_at" text NOT NULL,
  "entered_at" text,
  "completed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "secret_realm_spawns_map_status_idx" ON "secret_realm_spawns" ("map_id", "status");
CREATE INDEX IF NOT EXISTS "secret_realm_spawns_owner_status_idx" ON "secret_realm_spawns" ("owner_player_id", "status");
CREATE INDEX IF NOT EXISTS "secret_realm_spawns_expires_idx" ON "secret_realm_spawns" ("expires_at");

CREATE TABLE IF NOT EXISTS "map_instances" (
  "id" text PRIMARY KEY NOT NULL,
  "map_id" text NOT NULL REFERENCES "maps"("id"),
  "source_spawn_id" text REFERENCES "secret_realm_spawns"("id"),
  "template_id" text REFERENCES "secret_realm_templates"("id"),
  "instance_type" text DEFAULT 'secret_realm' NOT NULL,
  "access_type" text DEFAULT 'global' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "owner_player_id" text REFERENCES "players"("id"),
  "source_map_id" text REFERENCES "maps"("id"),
  "source_map_name" text,
  "source_position_x" integer DEFAULT 0 NOT NULL,
  "source_position_y" integer DEFAULT 0 NOT NULL,
  "return_portal_x" integer DEFAULT 0 NOT NULL,
  "return_portal_y" integer DEFAULT 0 NOT NULL,
  "boss_monster_id" text REFERENCES "monsters"("id"),
  "rarity" text DEFAULT 'common' NOT NULL,
  "recommended_realm" integer DEFAULT 1 NOT NULL,
  "expires_at" text NOT NULL,
  "settled_at" text,
  "completed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "map_instances_map_status_idx" ON "map_instances" ("map_id", "status");
CREATE INDEX IF NOT EXISTS "map_instances_source_spawn_idx" ON "map_instances" ("source_spawn_id");
CREATE INDEX IF NOT EXISTS "map_instances_owner_status_idx" ON "map_instances" ("owner_player_id", "status");
CREATE INDEX IF NOT EXISTS "map_instances_expires_idx" ON "map_instances" ("expires_at");

CREATE TABLE IF NOT EXISTS "map_instance_members" (
  "instance_id" text NOT NULL REFERENCES "map_instances"("id"),
  "player_id" text NOT NULL REFERENCES "players"("id"),
  "status" text DEFAULT 'active' NOT NULL,
  "role" text DEFAULT 'member' NOT NULL,
  "return_map_id" text REFERENCES "maps"("id"),
  "return_map_name" text,
  "return_position_x" integer DEFAULT 0 NOT NULL,
  "return_position_y" integer DEFAULT 0 NOT NULL,
  "joined_at" text NOT NULL,
  "left_at" text,
  "last_seen_at" text NOT NULL,
  PRIMARY KEY ("instance_id", "player_id")
);

CREATE INDEX IF NOT EXISTS "map_instance_members_player_status_idx" ON "map_instance_members" ("player_id", "status");

CREATE TABLE IF NOT EXISTS "map_instance_monsters" (
  "id" text PRIMARY KEY NOT NULL,
  "instance_id" text NOT NULL REFERENCES "map_instances"("id"),
  "monster_id" text NOT NULL REFERENCES "monsters"("id"),
  "role" text DEFAULT 'normal' NOT NULL,
  "rarity" text DEFAULT 'common' NOT NULL,
  "spawn_x" integer DEFAULT 0 NOT NULL,
  "spawn_y" integer DEFAULT 0 NOT NULL,
  "reward_plan" jsonb,
  "status" text DEFAULT 'alive' NOT NULL,
  "defeated_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "map_instance_monsters_instance_role_idx" ON "map_instance_monsters" ("instance_id", "role");
CREATE INDEX IF NOT EXISTS "map_instance_monsters_monster_idx" ON "map_instance_monsters" ("monster_id");

CREATE TABLE IF NOT EXISTS "secret_realm_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "instance_id" text NOT NULL REFERENCES "map_instances"("id"),
  "template_id" text REFERENCES "secret_realm_templates"("id"),
  "spawn_type" text DEFAULT 'global' NOT NULL,
  "owner_player_id" text REFERENCES "players"("id"),
  "status" text DEFAULT 'ongoing' NOT NULL,
  "summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "finished_at" text
);

CREATE INDEX IF NOT EXISTS "secret_realm_runs_instance_status_idx" ON "secret_realm_runs" ("instance_id", "status");
CREATE INDEX IF NOT EXISTS "secret_realm_runs_owner_status_idx" ON "secret_realm_runs" ("owner_player_id", "status");
