CREATE TABLE "dm_conversation_reads" (
	"conversation_id" text NOT NULL,
	"player_id" text NOT NULL,
	"last_read_message_id" integer,
	"updated_at" text NOT NULL,
	CONSTRAINT "dm_conversation_reads_conversation_id_player_id_pk" PRIMARY KEY("conversation_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "dm_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"player_a_id" text NOT NULL,
	"player_b_id" text NOT NULL,
	"last_message_at" text NOT NULL,
	"last_message_preview" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "dm_conversations_pair_unique" UNIQUE("player_a_id","player_b_id")
);
--> statement-breakpoint
CREATE TABLE "dm_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dm_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"conversation_id" text NOT NULL,
	"sender_player_id" text NOT NULL,
	"content" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_friendships" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_friendships_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_a_id" text NOT NULL,
	"player_b_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"responded_at" text,
	CONSTRAINT "player_friendships_pair_unique" UNIQUE("player_a_id","player_b_id")
);
--> statement-breakpoint
CREATE TABLE "player_intimacy_relations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "player_intimacy_relations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_a_id" text NOT NULL,
	"player_b_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"relation_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"responded_at" text,
	CONSTRAINT "player_intimacy_relations_pair_unique" UNIQUE("player_a_id","player_b_id")
);
--> statement-breakpoint
CREATE TABLE "player_social_settings" (
	"player_id" text PRIMARY KEY NOT NULL,
	"dm_permission" text DEFAULT 'friends' NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dm_conversation_reads" ADD CONSTRAINT "dm_conversation_reads_conversation_id_dm_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."dm_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_conversation_reads" ADD CONSTRAINT "dm_conversation_reads_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_conversations" ADD CONSTRAINT "dm_conversations_player_a_id_players_id_fk" FOREIGN KEY ("player_a_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_conversations" ADD CONSTRAINT "dm_conversations_player_b_id_players_id_fk" FOREIGN KEY ("player_b_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_conversation_id_dm_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."dm_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_sender_player_id_players_id_fk" FOREIGN KEY ("sender_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_friendships" ADD CONSTRAINT "player_friendships_player_a_id_players_id_fk" FOREIGN KEY ("player_a_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_friendships" ADD CONSTRAINT "player_friendships_player_b_id_players_id_fk" FOREIGN KEY ("player_b_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_friendships" ADD CONSTRAINT "player_friendships_requested_by_players_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_intimacy_relations" ADD CONSTRAINT "player_intimacy_relations_player_a_id_players_id_fk" FOREIGN KEY ("player_a_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_intimacy_relations" ADD CONSTRAINT "player_intimacy_relations_player_b_id_players_id_fk" FOREIGN KEY ("player_b_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_intimacy_relations" ADD CONSTRAINT "player_intimacy_relations_requested_by_players_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_social_settings" ADD CONSTRAINT "player_social_settings_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dm_conversation_reads_player_id_idx" ON "dm_conversation_reads" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "dm_conversations_last_message_at_idx" ON "dm_conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "dm_conversations_player_a_updated_at_idx" ON "dm_conversations" USING btree ("player_a_id","updated_at");--> statement-breakpoint
CREATE INDEX "dm_conversations_player_b_updated_at_idx" ON "dm_conversations" USING btree ("player_b_id","updated_at");--> statement-breakpoint
CREATE INDEX "dm_messages_conversation_id_id_idx" ON "dm_messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "dm_messages_created_at_idx" ON "dm_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "player_friendships_status_updated_at_idx" ON "player_friendships" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "player_friendships_player_a_id_idx" ON "player_friendships" USING btree ("player_a_id");--> statement-breakpoint
CREATE INDEX "player_friendships_player_b_id_idx" ON "player_friendships" USING btree ("player_b_id");--> statement-breakpoint
CREATE INDEX "player_friendships_requested_by_idx" ON "player_friendships" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "player_intimacy_relations_status_type_idx" ON "player_intimacy_relations" USING btree ("status","relation_type");--> statement-breakpoint
CREATE INDEX "player_intimacy_relations_player_a_id_idx" ON "player_intimacy_relations" USING btree ("player_a_id");--> statement-breakpoint
CREATE INDEX "player_intimacy_relations_player_b_id_idx" ON "player_intimacy_relations" USING btree ("player_b_id");--> statement-breakpoint
CREATE INDEX "player_intimacy_relations_requested_by_idx" ON "player_intimacy_relations" USING btree ("requested_by");