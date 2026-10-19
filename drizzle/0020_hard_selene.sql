CREATE TABLE "market_trade_records" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "market_trade_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"listing_id" integer NOT NULL,
	"seller_player_id" text NOT NULL,
	"buyer_player_id" text NOT NULL,
	"item_id" text NOT NULL,
	"unit_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"gross" integer NOT NULL,
	"fee" integer NOT NULL,
	"seller_net" integer NOT NULL,
	"seller_read_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_trade_records" ADD CONSTRAINT "market_trade_records_listing_id_market_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."market_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_trade_records" ADD CONSTRAINT "market_trade_records_seller_player_id_players_id_fk" FOREIGN KEY ("seller_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_trade_records" ADD CONSTRAINT "market_trade_records_buyer_player_id_players_id_fk" FOREIGN KEY ("buyer_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_trade_records" ADD CONSTRAINT "market_trade_records_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_trade_records_seller_read_idx" ON "market_trade_records" USING btree ("seller_player_id","seller_read_at");--> statement-breakpoint
CREATE INDEX "market_trade_records_seller_created_idx" ON "market_trade_records" USING btree ("seller_player_id","created_at");--> statement-breakpoint
CREATE INDEX "market_trade_records_buyer_created_idx" ON "market_trade_records" USING btree ("buyer_player_id","created_at");--> statement-breakpoint
CREATE INDEX "market_trade_records_item_created_idx" ON "market_trade_records" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "market_trade_records_listing_idx" ON "market_trade_records" USING btree ("listing_id");