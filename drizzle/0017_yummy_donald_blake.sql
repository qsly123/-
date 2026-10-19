CREATE TABLE "fortunes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_starter" boolean DEFAULT false NOT NULL,
	"starter_weight" real DEFAULT 0 NOT NULL,
	"grade" text DEFAULT 'white' NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"attr_effects" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"event_effects" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"special_effects" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "fortunes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "player_double_cultivation_requests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_double_cultivation_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_a_id" text NOT NULL,
	"player_b_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"responded_at" text,
	CONSTRAINT "player_double_cultivation_requests_pair_unique" UNIQUE("player_a_id","player_b_id")
);
--> statement-breakpoint
CREATE TABLE "player_fortune_attr_ledger" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_fortune_attr_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"player_fortune_id" integer NOT NULL,
	"trigger_type" text NOT NULL,
	"delta_hp" integer DEFAULT 0 NOT NULL,
	"delta_max_hp" integer DEFAULT 0 NOT NULL,
	"delta_mp" integer DEFAULT 0 NOT NULL,
	"delta_max_mp" integer DEFAULT 0 NOT NULL,
	"delta_attack" integer DEFAULT 0 NOT NULL,
	"delta_defense" integer DEFAULT 0 NOT NULL,
	"delta_speed" integer DEFAULT 0 NOT NULL,
	"delta_luck" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_fortunes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_fortunes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"fortune_id" text NOT NULL,
	"source_type" text DEFAULT 'system' NOT NULL,
	"source_ref" text,
	"status" text DEFAULT 'active' NOT NULL,
	"acquired_at" text NOT NULL,
	"expires_at" text,
	"ended_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_double_cultivation_daily" ADD COLUMN "used_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_double_cultivation_daily" ADD COLUMN "updated_at" text;--> statement-breakpoint
UPDATE "player_double_cultivation_daily" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "player_double_cultivation_daily" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "player_double_cultivation_logs" ADD COLUMN "request_id" integer;--> statement-breakpoint
ALTER TABLE "player_double_cultivation_logs" ADD COLUMN "target_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_double_cultivation_requests" ADD CONSTRAINT "player_double_cultivation_requests_player_a_id_players_id_fk" FOREIGN KEY ("player_a_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_double_cultivation_requests" ADD CONSTRAINT "player_double_cultivation_requests_player_b_id_players_id_fk" FOREIGN KEY ("player_b_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_double_cultivation_requests" ADD CONSTRAINT "player_double_cultivation_requests_requested_by_players_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_fortune_attr_ledger" ADD CONSTRAINT "player_fortune_attr_ledger_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_fortune_attr_ledger" ADD CONSTRAINT "player_fortune_attr_ledger_player_fortune_id_player_fortunes_id_fk" FOREIGN KEY ("player_fortune_id") REFERENCES "public"."player_fortunes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_fortunes" ADD CONSTRAINT "player_fortunes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_fortunes" ADD CONSTRAINT "player_fortunes_fortune_id_fortunes_id_fk" FOREIGN KEY ("fortune_id") REFERENCES "public"."fortunes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fortunes_enabled_idx" ON "fortunes" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "fortunes_starter_idx" ON "fortunes" USING btree ("is_starter","enabled");--> statement-breakpoint
CREATE INDEX "fortunes_grade_idx" ON "fortunes" USING btree ("grade");--> statement-breakpoint
CREATE INDEX "player_double_cultivation_requests_status_idx" ON "player_double_cultivation_requests" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "player_double_cultivation_requests_player_a_idx" ON "player_double_cultivation_requests" USING btree ("player_a_id");--> statement-breakpoint
CREATE INDEX "player_double_cultivation_requests_player_b_idx" ON "player_double_cultivation_requests" USING btree ("player_b_id");--> statement-breakpoint
CREATE INDEX "player_double_cultivation_requests_requested_by_idx" ON "player_double_cultivation_requests" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "player_fortune_attr_ledger_player_idx" ON "player_fortune_attr_ledger" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "player_fortune_attr_ledger_player_fortune_idx" ON "player_fortune_attr_ledger" USING btree ("player_fortune_id");--> statement-breakpoint
CREATE INDEX "player_fortune_attr_ledger_created_at_idx" ON "player_fortune_attr_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "player_fortunes_player_status_idx" ON "player_fortunes" USING btree ("player_id","status");--> statement-breakpoint
CREATE INDEX "player_fortunes_fortune_status_idx" ON "player_fortunes" USING btree ("fortune_id","status");--> statement-breakpoint
CREATE INDEX "player_fortunes_expires_at_idx" ON "player_fortunes" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "player_double_cultivation_logs" ADD CONSTRAINT "player_double_cultivation_logs_request_id_player_double_cultivation_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."player_double_cultivation_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_reward_rules" DROP COLUMN "fortune_extra_reward";--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN "fortune_expires_at";
