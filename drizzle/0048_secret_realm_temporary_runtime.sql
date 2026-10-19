CREATE TABLE IF NOT EXISTS "temporary_maps" (
  "id" text PRIMARY KEY NOT NULL,
  "instance_id" text,
  "name" text NOT NULL,
  "description" text,
  "background_image_url" text,
  "width" integer DEFAULT 10 NOT NULL,
  "height" integer DEFAULT 10 NOT NULL,
  "min_realm" integer DEFAULT 1 NOT NULL,
  "map_type" text DEFAULT 'secret_realm_instance' NOT NULL,
  "tiles_data" jsonb,
  "expires_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "temporary_maps_instance_idx" ON "temporary_maps" ("instance_id");
CREATE INDEX IF NOT EXISTS "temporary_maps_expires_idx" ON "temporary_maps" ("expires_at");

CREATE TABLE IF NOT EXISTS "temporary_monsters" (
  "id" text PRIMARY KEY NOT NULL,
  "instance_id" text,
  "name" text NOT NULL,
  "icon_url" text,
  "description" text,
  "monster_type" text DEFAULT 'normal' NOT NULL,
  "level" integer DEFAULT 1 NOT NULL,
  "hp" integer DEFAULT 50 NOT NULL,
  "attack" integer DEFAULT 8 NOT NULL,
  "defense" integer DEFAULT 3 NOT NULL,
  "speed" integer DEFAULT 5 NOT NULL,
  "luck" integer DEFAULT 0 NOT NULL,
  "spiritual_sense" integer DEFAULT 0 NOT NULL,
  "armor_penetration" integer DEFAULT 0 NOT NULL,
  "block" integer DEFAULT 0 NOT NULL,
  "skill_damage_bonus" integer DEFAULT 0 NOT NULL,
  "skill_damage_reduction" integer DEFAULT 0 NOT NULL,
  "artifact_damage_bonus" integer DEFAULT 0 NOT NULL,
  "artifact_damage_reduction" integer DEFAULT 0 NOT NULL,
  "skills" jsonb,
  "drops" jsonb,
  "xp_reward" integer DEFAULT 10 NOT NULL,
  "gold_reward" integer DEFAULT 5 NOT NULL,
  "map_id" text NOT NULL,
  "position_x" integer DEFAULT 0 NOT NULL,
  "position_y" integer DEFAULT 0 NOT NULL,
  "current_position_x" integer,
  "current_position_y" integer,
  "next_ai_move_at" text,
  "position_updated_at" text,
  "ai_move_interval_min_seconds" integer,
  "ai_move_interval_max_seconds" integer,
  "ai_move_range" integer,
  "respawn_seconds" integer DEFAULT 60 NOT NULL,
  "expires_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE INDEX IF NOT EXISTS "temporary_monsters_instance_idx" ON "temporary_monsters" ("instance_id");
CREATE INDEX IF NOT EXISTS "temporary_monsters_map_idx" ON "temporary_monsters" ("map_id");
CREATE INDEX IF NOT EXISTS "temporary_monsters_type_idx" ON "temporary_monsters" ("monster_type");
CREATE INDEX IF NOT EXISTS "temporary_monsters_expires_idx" ON "temporary_monsters" ("expires_at");

ALTER TABLE "boss_instances" DROP CONSTRAINT IF EXISTS "boss_instances_monster_id_monsters_id_fk";
ALTER TABLE "boss_instances" DROP CONSTRAINT IF EXISTS "boss_instances_monster_id_fkey";
ALTER TABLE "map_instances" DROP CONSTRAINT IF EXISTS "map_instances_map_id_maps_id_fk";
ALTER TABLE "map_instances" DROP CONSTRAINT IF EXISTS "map_instances_map_id_fkey";
ALTER TABLE "map_instances" DROP CONSTRAINT IF EXISTS "map_instances_boss_monster_id_monsters_id_fk";
ALTER TABLE "map_instances" DROP CONSTRAINT IF EXISTS "map_instances_boss_monster_id_fkey";
ALTER TABLE "map_instance_monsters" DROP CONSTRAINT IF EXISTS "map_instance_monsters_monster_id_monsters_id_fk";
ALTER TABLE "map_instance_monsters" DROP CONSTRAINT IF EXISTS "map_instance_monsters_monster_id_fkey";
ALTER TABLE "party_encounters" DROP CONSTRAINT IF EXISTS "party_encounters_monster_id_monsters_id_fk";
ALTER TABLE "party_encounters" DROP CONSTRAINT IF EXISTS "party_encounters_monster_id_fkey";
