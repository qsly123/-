ALTER TABLE "items" ADD COLUMN "created_at" text;--> statement-breakpoint
UPDATE "items" SET "created_at" = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "map_edges" ADD COLUMN "created_at" text;--> statement-breakpoint
UPDATE "map_edges" SET "created_at" = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "map_edges" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "maps" ADD COLUMN "created_at" text;--> statement-breakpoint
UPDATE "maps" SET "created_at" = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "maps" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "monsters" ADD COLUMN "created_at" text;--> statement-breakpoint
UPDATE "monsters" SET "created_at" = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "monsters" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "npcs" ADD COLUMN "created_at" text;--> statement-breakpoint
UPDATE "npcs" SET "created_at" = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "npcs" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "quests" ADD COLUMN "created_at" text;--> statement-breakpoint
UPDATE "quests" SET "created_at" = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "quests" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "random_events" ADD COLUMN "created_at" text;--> statement-breakpoint
UPDATE "random_events" SET "created_at" = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "random_events" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "skills" ADD COLUMN "created_at" text;--> statement-breakpoint
UPDATE "skills" SET "created_at" = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE "created_at" IS NULL;--> statement-breakpoint
ALTER TABLE "skills" ALTER COLUMN "created_at" SET NOT NULL;
