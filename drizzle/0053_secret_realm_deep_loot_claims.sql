ALTER TABLE "map_instance_monsters"
ADD COLUMN IF NOT EXISTS "loot_blueprint_json" jsonb;

ALTER TABLE "items"
ADD COLUMN IF NOT EXISTS "template_item_id" text;

ALTER TABLE "items"
ADD COLUMN IF NOT EXISTS "source_type" text;

ALTER TABLE "items"
ADD COLUMN IF NOT EXISTS "source_instance_id" text;

ALTER TABLE "items"
ADD COLUMN IF NOT EXISTS "source_monster_id" text;

ALTER TABLE "items"
ADD COLUMN IF NOT EXISTS "source_player_id" text;

ALTER TABLE "items"
ADD COLUMN IF NOT EXISTS "source_category" text;

ALTER TABLE "items"
ADD COLUMN IF NOT EXISTS "generated_seed" text;

ALTER TABLE "items"
ADD COLUMN IF NOT EXISTS "source_meta" jsonb;

CREATE INDEX IF NOT EXISTS "items_template_item_idx" ON "items" ("template_item_id");
CREATE INDEX IF NOT EXISTS "items_source_instance_idx" ON "items" ("source_instance_id");
CREATE INDEX IF NOT EXISTS "items_source_type_idx" ON "items" ("source_type");
CREATE INDEX IF NOT EXISTS "items_source_player_idx" ON "items" ("source_player_id");

CREATE TABLE IF NOT EXISTS "secret_realm_reward_claims" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text,
  "instance_id" text NOT NULL,
  "monster_id" text NOT NULL,
  "player_id" text NOT NULL,
  "role" text NOT NULL DEFAULT 'normal',
  "status" text NOT NULL DEFAULT 'claimed',
  "xp" integer NOT NULL DEFAULT 0,
  "gold" integer NOT NULL DEFAULT 0,
  "no_reward_reason" text,
  "reward_snapshot" jsonb NOT NULL DEFAULT '{"xp":0,"gold":0,"drops":[]}'::jsonb,
  "granted_item_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "claimed_at" text NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text,
  "created_at" text NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text,
  "updated_at" text NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'secret_realm_reward_claims'
      AND constraint_name = 'secret_realm_reward_claims_run_id_secret_realm_runs_id_fk'
  ) THEN
    ALTER TABLE "secret_realm_reward_claims"
    ADD CONSTRAINT "secret_realm_reward_claims_run_id_secret_realm_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."secret_realm_runs"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'secret_realm_reward_claims'
      AND constraint_name = 'secret_realm_reward_claims_instance_id_map_instances_id_fk'
  ) THEN
    ALTER TABLE "secret_realm_reward_claims"
    ADD CONSTRAINT "secret_realm_reward_claims_instance_id_map_instances_id_fk"
    FOREIGN KEY ("instance_id") REFERENCES "public"."map_instances"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'secret_realm_reward_claims'
      AND constraint_name = 'secret_realm_reward_claims_player_id_players_id_fk'
  ) THEN
    ALTER TABLE "secret_realm_reward_claims"
    ADD CONSTRAINT "secret_realm_reward_claims_player_id_players_id_fk"
    FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "secret_realm_reward_claims_instance_monster_player_unique"
ON "secret_realm_reward_claims" ("instance_id", "monster_id", "player_id");

CREATE INDEX IF NOT EXISTS "secret_realm_reward_claims_run_idx"
ON "secret_realm_reward_claims" ("run_id");

CREATE INDEX IF NOT EXISTS "secret_realm_reward_claims_player_idx"
ON "secret_realm_reward_claims" ("player_id");

CREATE INDEX IF NOT EXISTS "secret_realm_reward_claims_monster_idx"
ON "secret_realm_reward_claims" ("monster_id");
