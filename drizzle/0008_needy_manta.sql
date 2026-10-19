CREATE TABLE "checkin_reward_rules" (
	"day_index" integer PRIMARY KEY NOT NULL,
	"reward" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_checkin_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_checkin_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"checkin_date" text NOT NULL,
	"day_index" integer NOT NULL,
	"reward_snapshot" jsonb NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "player_checkin_logs_player_id_checkin_date_unique" UNIQUE("player_id","checkin_date")
);
--> statement-breakpoint
ALTER TABLE "player_checkin_logs" ADD CONSTRAINT "player_checkin_logs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_checkin_logs_player_id_idx" ON "player_checkin_logs" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "player_checkin_logs_checkin_date_idx" ON "player_checkin_logs" USING btree ("checkin_date");--> statement-breakpoint
INSERT INTO "checkin_reward_rules" ("day_index", "reward", "enabled", "created_at", "updated_at")
VALUES
	(1, '{"gold":100}'::jsonb, true, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
	(2, '{"xp":80}'::jsonb, true, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
	(3, '{"gold":120}'::jsonb, true, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
	(4, '{"xp":100}'::jsonb, true, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
	(5, '{"gold":150}'::jsonb, true, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
	(6, '{"xp":120}'::jsonb, true, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
	(7, '{"gold":200,"xp":80}'::jsonb, true, to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
