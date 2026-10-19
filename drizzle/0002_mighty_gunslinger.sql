CREATE TABLE "player_mails" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_mails_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"reward" jsonb,
	"claimed_at" text,
	"sent_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_mails" ADD CONSTRAINT "player_mails_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_mails" ADD CONSTRAINT "player_mails_sent_by_accounts_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_mails_player_id_idx" ON "player_mails" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "player_mails_claimed_at_idx" ON "player_mails" USING btree ("claimed_at");--> statement-breakpoint
CREATE INDEX "player_mails_created_at_idx" ON "player_mails" USING btree ("created_at");