ALTER TABLE "items" ADD COLUMN "min_realm" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "max_realm" integer;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "min_realm" integer;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "max_realm" integer;--> statement-breakpoint
UPDATE "items" SET "min_realm" = "realm_required" WHERE "min_realm" IS NULL;--> statement-breakpoint
UPDATE "skills" SET "min_realm" = "realm_required" WHERE "min_realm" IS NULL;--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "realm_required";--> statement-breakpoint
ALTER TABLE "skills" DROP COLUMN "realm_required";
