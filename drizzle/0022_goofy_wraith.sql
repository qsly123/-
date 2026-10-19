ALTER TABLE "players" ADD COLUMN "stamina" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "stamina_updated_at" text;--> statement-breakpoint
UPDATE "players"
SET "stamina_updated_at" = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE "stamina_updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "stamina_updated_at" SET NOT NULL;
