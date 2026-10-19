ALTER TABLE "market_listings"
  ADD COLUMN IF NOT EXISTS "visible_at" text;

ALTER TABLE "market_listings"
  ADD COLUMN IF NOT EXISTS "expires_at" text;

UPDATE "market_listings"
SET "visible_at" = COALESCE("visible_at", "created_at")
WHERE "visible_at" IS NULL;

UPDATE "market_listings"
SET "expires_at" = COALESCE(
  "expires_at",
  to_char(
    timezone('UTC', ("created_at")::timestamptz + interval '24 hour'),
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
)
WHERE "expires_at" IS NULL;

ALTER TABLE "market_listings"
  ALTER COLUMN "visible_at" SET NOT NULL;

ALTER TABLE "market_listings"
  ALTER COLUMN "expires_at" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "market_listings_status_visible_expires_idx"
  ON "market_listings" ("status", "visible_at", "expires_at");
