CREATE TABLE "market_listings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "market_listings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"seller_player_id" text NOT NULL,
	"item_id" text NOT NULL,
	"unit_price" integer NOT NULL,
	"quantity_total" integer NOT NULL,
	"quantity_remaining" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "is_bound" boolean DEFAULT false NOT NULL;--> statement-breakpoint
INSERT INTO "system_configs" (
	"key",
	"value",
	"group",
	"is_secret",
	"description",
	"created_at",
	"updated_at"
)
VALUES (
	'MARKET_FEE_PERCENT',
	'5',
	'game',
	false,
	'交易市场手续费百分比(0-100)',
	to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_seller_player_id_players_id_fk" FOREIGN KEY ("seller_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_listings_status_created_at_idx" ON "market_listings" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "market_listings_seller_status_idx" ON "market_listings" USING btree ("seller_player_id","status");--> statement-breakpoint
CREATE INDEX "market_listings_item_status_idx" ON "market_listings" USING btree ("item_id","status");
