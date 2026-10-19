CREATE TABLE "recharge_orders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recharge_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"out_trade_no" text NOT NULL,
	"trade_no" text,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notify_payload" jsonb,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"paid_at" text,
	CONSTRAINT "recharge_orders_out_trade_no_unique" UNIQUE("out_trade_no")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "ling_yu" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recharge_orders" ADD CONSTRAINT "recharge_orders_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recharge_orders_player_id_idx" ON "recharge_orders" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "recharge_orders_status_idx" ON "recharge_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "recharge_orders_created_at_idx" ON "recharge_orders" USING btree ("created_at");