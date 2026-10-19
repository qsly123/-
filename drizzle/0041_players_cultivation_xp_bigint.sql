ALTER TABLE "players"
  ALTER COLUMN "cultivation_xp" TYPE bigint
  USING "cultivation_xp"::bigint;
