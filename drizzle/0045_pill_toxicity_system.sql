ALTER TABLE "players"
  ADD COLUMN IF NOT EXISTS "pill_toxicity" integer NOT NULL DEFAULT 0;

ALTER TABLE "players"
  ADD COLUMN IF NOT EXISTS "pill_toxicity_updated_at" text NOT NULL DEFAULT NOW()::text;

UPDATE "players"
SET
  "pill_toxicity" = COALESCE("pill_toxicity", 0),
  "pill_toxicity_updated_at" = COALESCE(NULLIF("pill_toxicity_updated_at", ''), NOW()::text);

ALTER TABLE "items"
  ADD COLUMN IF NOT EXISTS "pill_toxicity" integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "pill_toxicity_configs" (
  "key" text PRIMARY KEY NOT NULL,
  "max_toxicity" integer NOT NULL DEFAULT 20,
  "recover_interval_minutes" integer NOT NULL DEFAULT 8,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

INSERT INTO "pill_toxicity_configs" (
  "key",
  "max_toxicity",
  "recover_interval_minutes",
  "created_at",
  "updated_at"
)
VALUES (
  'default',
  20,
  8,
  NOW()::text,
  NOW()::text
)
ON CONFLICT ("key") DO NOTHING;
