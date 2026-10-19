ALTER TABLE "players"
ADD COLUMN IF NOT EXISTS "wild_wolf_valley_mob_bottle_pity_counter" integer;

UPDATE "players"
SET "wild_wolf_valley_mob_bottle_pity_counter" = 0
WHERE "wild_wolf_valley_mob_bottle_pity_counter" IS NULL;

ALTER TABLE "players"
ALTER COLUMN "wild_wolf_valley_mob_bottle_pity_counter" SET DEFAULT 0;

ALTER TABLE "players"
ALTER COLUMN "wild_wolf_valley_mob_bottle_pity_counter" SET NOT NULL;

ALTER TABLE "players"
ADD COLUMN IF NOT EXISTS "wild_wolf_valley_boss_bottle_pity_counter" integer;

UPDATE "players"
SET "wild_wolf_valley_boss_bottle_pity_counter" = 0
WHERE "wild_wolf_valley_boss_bottle_pity_counter" IS NULL;

ALTER TABLE "players"
ALTER COLUMN "wild_wolf_valley_boss_bottle_pity_counter" SET DEFAULT 0;

ALTER TABLE "players"
ALTER COLUMN "wild_wolf_valley_boss_bottle_pity_counter" SET NOT NULL;
