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
