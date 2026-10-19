CREATE TABLE "player_npc_bounty_daily" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_npc_bounty_daily_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"npc_id" text NOT NULL,
	"date_key" text NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "player_npc_bounty_daily_player_npc_date_unique" UNIQUE("player_id","npc_id","date_key")
);
--> statement-breakpoint
ALTER TABLE "npcs" ADD COLUMN "bounty_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "npcs" ADD COLUMN "bounty_daily_limit" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "max_realm" integer;--> statement-breakpoint
ALTER TABLE "player_npc_bounty_daily" ADD CONSTRAINT "player_npc_bounty_daily_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_npc_bounty_daily_player_idx" ON "player_npc_bounty_daily" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "player_npc_bounty_daily_npc_date_idx" ON "player_npc_bounty_daily" USING btree ("npc_id","date_key");