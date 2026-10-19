ALTER TABLE "realm_stages" ADD COLUMN "name" text;
--> statement-breakpoint
UPDATE "realm_stages"
SET "name" = CASE "minor"
  WHEN 1 THEN '一重'
  WHEN 2 THEN '二重'
  WHEN 3 THEN '三重'
  WHEN 4 THEN '四重'
  WHEN 5 THEN '五重'
  WHEN 6 THEN '六重'
  WHEN 7 THEN '七重'
  WHEN 8 THEN '八重'
  WHEN 9 THEN '九重'
  ELSE CONCAT("minor"::text, '重')
END
WHERE "name" IS NULL;
--> statement-breakpoint
ALTER TABLE "realm_stages" ALTER COLUMN "name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "realm_stages" ALTER COLUMN "name" SET DEFAULT '一重';
--> statement-breakpoint
ALTER TABLE "realm_majors" DROP COLUMN "enabled";
--> statement-breakpoint
CREATE UNIQUE INDEX "realm_majors_order_unique" ON "realm_majors" USING btree ("order");
