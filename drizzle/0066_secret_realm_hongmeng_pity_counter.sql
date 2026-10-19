ALTER TABLE "players"
ADD COLUMN IF NOT EXISTS "secret_realm_hongmeng_pity_counter" integer NOT NULL DEFAULT 0;
