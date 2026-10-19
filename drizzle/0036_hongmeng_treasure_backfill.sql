CREATE TABLE IF NOT EXISTS "hongmeng_treasure_configs" (
  "item_id" text PRIMARY KEY NOT NULL REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action,
  "enabled" boolean DEFAULT true NOT NULL,
  "max_star" integer DEFAULT 5 NOT NULL,
  "star_configs" jsonb,
  "upgrade_costs" jsonb,
  "spiritual_field_energy_cost" integer DEFAULT 60 NOT NULL,
  "spiritual_field_reduce_seconds" integer DEFAULT 3600 NOT NULL,
  "created_at" text DEFAULT now() NOT NULL,
  "updated_at" text DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "hongmeng_treasure_configs_enabled_idx"
  ON "hongmeng_treasure_configs" USING btree ("enabled");

CREATE TABLE IF NOT EXISTS "player_hongmeng_treasures" (
  "player_id" text NOT NULL REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action,
  "item_id" text NOT NULL REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action,
  "star" integer DEFAULT 0 NOT NULL,
  "energy" integer DEFAULT 0 NOT NULL,
  "energy_updated_at" text DEFAULT now() NOT NULL,
  "created_at" text DEFAULT now() NOT NULL,
  "updated_at" text DEFAULT now() NOT NULL,
  CONSTRAINT "player_hongmeng_treasures_player_id_item_id_pk" PRIMARY KEY("player_id","item_id")
);

CREATE INDEX IF NOT EXISTS "player_hongmeng_treasures_player_idx"
  ON "player_hongmeng_treasures" USING btree ("player_id");

INSERT INTO "items" (
  "id",
  "name",
  "icon_url",
  "description",
  "item_type",
  "rarity",
  "effects",
  "price",
  "stackable",
  "is_bound",
  "min_realm",
  "max_realm",
  "created_at"
) VALUES (
  'item_hongmeng_zhangtian_bottle',
  '掌天瓶',
  NULL,
  '鸿蒙至宝，蕴藏灵液，可浇灌灵田催熟灵植。',
  'material',
  'hongmeng',
  NULL,
  0,
  false,
  true,
  NULL,
  NULL,
  now()::text
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "hongmeng_treasure_configs" (
  "item_id",
  "enabled",
  "max_star",
  "star_configs",
  "upgrade_costs",
  "spiritual_field_energy_cost",
  "spiritual_field_reduce_seconds",
  "created_at",
  "updated_at"
) VALUES (
  'item_hongmeng_zhangtian_bottle',
  true,
  5,
  '[
    {"star":0,"energyCap":200,"regenSecondsPerEnergy":480},
    {"star":1,"energyCap":250,"regenSecondsPerEnergy":450},
    {"star":2,"energyCap":300,"regenSecondsPerEnergy":420},
    {"star":3,"energyCap":350,"regenSecondsPerEnergy":360},
    {"star":4,"energyCap":450,"regenSecondsPerEnergy":300},
    {"star":5,"energyCap":500,"regenSecondsPerEnergy":180}
  ]'::jsonb,
  '[]'::jsonb,
  60,
  3600,
  now()::text,
  now()::text
) ON CONFLICT ("item_id") DO NOTHING;
