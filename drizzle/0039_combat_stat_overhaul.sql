ALTER TABLE "players"
  ADD COLUMN IF NOT EXISTS "spiritual_sense" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "armor_penetration" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "block" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "skill_damage_bonus" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "skill_damage_reduction" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "artifact_damage_bonus" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "artifact_damage_reduction" integer NOT NULL DEFAULT 0;

ALTER TABLE "monsters"
  ADD COLUMN IF NOT EXISTS "luck" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "spiritual_sense" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "armor_penetration" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "block" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "skill_damage_bonus" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "skill_damage_reduction" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "artifact_damage_bonus" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "artifact_damage_reduction" integer NOT NULL DEFAULT 0;

ALTER TABLE "player_fortune_attr_ledger"
  ADD COLUMN IF NOT EXISTS "delta_spiritual_sense" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "delta_armor_penetration" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "delta_block" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "delta_skill_damage_bonus" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "delta_skill_damage_reduction" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "delta_artifact_damage_bonus" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "delta_artifact_damage_reduction" integer NOT NULL DEFAULT 0;
