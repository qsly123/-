CREATE TABLE IF NOT EXISTS "world_map_instances" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "archetype" text NOT NULL,
  "seed" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "width" integer DEFAULT 128 NOT NULL,
  "height" integer DEFAULT 128 NOT NULL,
  "min_realm" integer DEFAULT 1 NOT NULL,
  "description" text,
  "background_image_url" text,
  "tiles_data" jsonb,
  "spawn_map_id" text,
  "spawn_position_x" integer DEFAULT 8 NOT NULL,
  "spawn_position_y" integer DEFAULT 8 NOT NULL,
  "frozen_at" text,
  "expires_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "world_map_portals" (
  "id" text PRIMARY KEY NOT NULL,
  "world_map_id" text NOT NULL REFERENCES "world_map_instances"("id"),
  "portal_name" text NOT NULL,
  "position_x" integer NOT NULL,
  "position_y" integer NOT NULL,
  "target_world_map_id" text NOT NULL REFERENCES "world_map_instances"("id"),
  "target_position_x" integer NOT NULL,
  "target_position_y" integer NOT NULL,
  "bidirectional_group_key" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "world_npc_profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "world_map_id" text NOT NULL REFERENCES "world_map_instances"("id"),
  "name" text NOT NULL,
  "gender" text,
  "origin_type" text,
  "profession" text,
  "faction" text,
  "realm_name" text DEFAULT '练气期一重' NOT NULL,
  "realm_major" integer DEFAULT 1 NOT NULL,
  "realm_minor" integer DEFAULT 1 NOT NULL,
  "personality_summary" text DEFAULT '' NOT NULL,
  "dna_seed" text NOT NULL,
  "trait_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "behavior_weights" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "stats_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "life_stage" text DEFAULT 'adult' NOT NULL,
  "reincarnation_count" integer DEFAULT 0 NOT NULL,
  "is_killable" boolean DEFAULT true NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "avatar_image_url" text,
  "portrait_image_url" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "world_npc_runtime" (
  "npc_id" text PRIMARY KEY NOT NULL REFERENCES "world_npc_profiles"("id"),
  "current_map_id" text NOT NULL REFERENCES "world_map_instances"("id"),
  "position_x" integer DEFAULT 0 NOT NULL,
  "position_y" integer DEFAULT 0 NOT NULL,
  "current_action" text DEFAULT 'idle' NOT NULL,
  "current_target_type" text,
  "current_target_id" text,
  "current_action_label" text,
  "is_activated" boolean DEFAULT false NOT NULL,
  "occupied_by_combat_id" text,
  "next_action_at" text,
  "last_action_at" text,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "world_npc_inventory" (
  "id" text PRIMARY KEY NOT NULL,
  "npc_id" text NOT NULL REFERENCES "world_npc_profiles"("id"),
  "item_id" text NOT NULL REFERENCES "items"("id"),
  "item_name_snapshot" text,
  "item_icon_url" text,
  "quantity" integer DEFAULT 1 NOT NULL,
  "is_equipped" boolean DEFAULT false NOT NULL,
  "is_lootable" boolean DEFAULT true NOT NULL,
  "slot_type" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "world_npc_life_logs" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY NOT NULL,
  "npc_id" text NOT NULL REFERENCES "world_npc_profiles"("id"),
  "log_type" text NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE IF NOT EXISTS "world_local_messages" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY NOT NULL,
  "map_id" text NOT NULL,
  "speaker_type" text DEFAULT 'player' NOT NULL,
  "speaker_player_id" text REFERENCES "players"("id"),
  "speaker_npc_id" text REFERENCES "world_npc_profiles"("id"),
  "speaker_name" text NOT NULL,
  "content" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "world_map_instances_status_idx" ON "world_map_instances" ("status");
CREATE INDEX IF NOT EXISTS "world_map_instances_expires_idx" ON "world_map_instances" ("expires_at");
CREATE INDEX IF NOT EXISTS "world_map_instances_archetype_idx" ON "world_map_instances" ("archetype");
CREATE INDEX IF NOT EXISTS "world_map_portals_map_idx" ON "world_map_portals" ("world_map_id");
CREATE INDEX IF NOT EXISTS "world_map_portals_target_idx" ON "world_map_portals" ("target_world_map_id");
CREATE INDEX IF NOT EXISTS "world_map_portals_group_idx" ON "world_map_portals" ("bidirectional_group_key");
CREATE INDEX IF NOT EXISTS "world_npc_profiles_world_map_idx" ON "world_npc_profiles" ("world_map_id");
CREATE INDEX IF NOT EXISTS "world_npc_profiles_status_idx" ON "world_npc_profiles" ("status");
CREATE INDEX IF NOT EXISTS "world_npc_profiles_realm_idx" ON "world_npc_profiles" ("realm_major", "realm_minor");
CREATE INDEX IF NOT EXISTS "world_npc_runtime_map_idx" ON "world_npc_runtime" ("current_map_id");
CREATE INDEX IF NOT EXISTS "world_npc_runtime_action_idx" ON "world_npc_runtime" ("current_action");
CREATE INDEX IF NOT EXISTS "world_npc_runtime_combat_idx" ON "world_npc_runtime" ("occupied_by_combat_id");
CREATE INDEX IF NOT EXISTS "world_npc_inventory_npc_idx" ON "world_npc_inventory" ("npc_id");
CREATE INDEX IF NOT EXISTS "world_npc_inventory_item_idx" ON "world_npc_inventory" ("item_id");
CREATE INDEX IF NOT EXISTS "world_npc_life_logs_npc_idx" ON "world_npc_life_logs" ("npc_id");
CREATE INDEX IF NOT EXISTS "world_npc_life_logs_type_idx" ON "world_npc_life_logs" ("log_type");
CREATE INDEX IF NOT EXISTS "world_npc_life_logs_created_idx" ON "world_npc_life_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "world_local_messages_map_id_idx" ON "world_local_messages" ("map_id", "id");
CREATE INDEX IF NOT EXISTS "world_local_messages_created_idx" ON "world_local_messages" ("created_at");
