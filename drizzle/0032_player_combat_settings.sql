CREATE TABLE "player_combat_settings" (
	"player_id" text PRIMARY KEY NOT NULL,
	"skill_rotation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_combat_settings" ADD CONSTRAINT "player_combat_settings_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
