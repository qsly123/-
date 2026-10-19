CREATE TABLE "map_opportunity_spawns" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"map_id" text NOT NULL,
	"position_x" integer NOT NULL,
	"position_y" integer NOT NULL,
	"spawned_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"claimed_by_player_id" text,
	"claimed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "random_events" ADD COLUMN "spawn_interval_seconds" integer;--> statement-breakpoint
ALTER TABLE "random_events" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "map_opportunity_spawns" ADD CONSTRAINT "map_opportunity_spawns_event_id_random_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."random_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_opportunity_spawns" ADD CONSTRAINT "map_opportunity_spawns_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_opportunity_spawns" ADD CONSTRAINT "map_opportunity_spawns_claimed_by_player_id_players_id_fk" FOREIGN KEY ("claimed_by_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_opportunity_spawns_map_expires_claimed_idx" ON "map_opportunity_spawns" USING btree ("map_id","expires_at","claimed_at");--> statement-breakpoint
CREATE INDEX "map_opportunity_spawns_event_spawned_idx" ON "map_opportunity_spawns" USING btree ("event_id","spawned_at");--> statement-breakpoint
CREATE INDEX "map_opportunity_spawns_claimed_by_player_idx" ON "map_opportunity_spawns" USING btree ("claimed_by_player_id");