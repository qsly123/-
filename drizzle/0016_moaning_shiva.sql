CREATE TABLE "player_double_cultivation_daily" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_double_cultivation_daily_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"date_key" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "player_double_cultivation_daily_player_date_unique" UNIQUE("player_id","date_key")
);
--> statement-breakpoint
CREATE TABLE "player_double_cultivation_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_double_cultivation_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"initiator_player_id" text NOT NULL,
	"target_player_id" text NOT NULL,
	"percent" integer NOT NULL,
	"initiator_xp_gain" integer NOT NULL,
	"target_xp_gain" integer NOT NULL,
	"narrative" text NOT NULL,
	"prompt_snapshot" text NOT NULL,
	"date_key" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_double_cultivation_daily" ADD CONSTRAINT "player_double_cultivation_daily_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_double_cultivation_logs" ADD CONSTRAINT "player_double_cultivation_logs_initiator_player_id_players_id_fk" FOREIGN KEY ("initiator_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_double_cultivation_logs" ADD CONSTRAINT "player_double_cultivation_logs_target_player_id_players_id_fk" FOREIGN KEY ("target_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_double_cultivation_daily_player_id_idx" ON "player_double_cultivation_daily" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "player_double_cultivation_daily_date_key_idx" ON "player_double_cultivation_daily" USING btree ("date_key");--> statement-breakpoint
CREATE INDEX "player_double_cultivation_logs_initiator_idx" ON "player_double_cultivation_logs" USING btree ("initiator_player_id");--> statement-breakpoint
CREATE INDEX "player_double_cultivation_logs_target_idx" ON "player_double_cultivation_logs" USING btree ("target_player_id");--> statement-breakpoint
CREATE INDEX "player_double_cultivation_logs_created_at_idx" ON "player_double_cultivation_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "player_double_cultivation_logs_date_key_idx" ON "player_double_cultivation_logs" USING btree ("date_key");