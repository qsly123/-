CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "accounts_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "ai_generation_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_payload" jsonb,
	"progress_payload" jsonb,
	"result_payload" jsonb,
	"error_message" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"started_at" text,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "ai_memories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_memories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"npc_id" text NOT NULL,
	"player_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"summary" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boss_instances" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "boss_instances_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"monster_id" text NOT NULL,
	"current_hp" integer NOT NULL,
	"max_hp" integer NOT NULL,
	"last_hit_player_id" text,
	"status" text DEFAULT 'alive' NOT NULL,
	"damage_map" jsonb,
	"spawned_at" text NOT NULL,
	"killed_at" text,
	"next_spawn_at" text
);
--> statement-breakpoint
CREATE TABLE "cdk_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cdk_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"reward" jsonb NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "cdk_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "cdk_redeem_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cdk_redeem_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"cdk_id" integer NOT NULL,
	"player_id" text NOT NULL,
	"reward_snapshot" jsonb NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "cdk_redeem_logs_cdk_id_player_id_unique" UNIQUE("cdk_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "combat_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "combat_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"player_id" text NOT NULL,
	"opponent_type" text,
	"opponent_id" text,
	"result" text,
	"details" jsonb,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"item_type" text DEFAULT 'consumable' NOT NULL,
	"rarity" text DEFAULT 'common' NOT NULL,
	"effects" jsonb,
	"price" integer DEFAULT 0 NOT NULL,
	"stackable" boolean DEFAULT true NOT NULL,
	"realm_required" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "map_edges" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "map_edges_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"map_a_id" text NOT NULL,
	"map_b_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maps" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"width" integer DEFAULT 10 NOT NULL,
	"height" integer DEFAULT 10 NOT NULL,
	"min_realm" integer DEFAULT 1 NOT NULL,
	"map_type" text DEFAULT 'field' NOT NULL,
	"tiles_data" jsonb
);
--> statement-breakpoint
CREATE TABLE "monsters" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"monster_type" text DEFAULT 'normal' NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"hp" integer DEFAULT 50 NOT NULL,
	"attack" integer DEFAULT 8 NOT NULL,
	"defense" integer DEFAULT 3 NOT NULL,
	"speed" integer DEFAULT 5 NOT NULL,
	"skills" jsonb,
	"drops" jsonb,
	"xp_reward" integer DEFAULT 10 NOT NULL,
	"gold_reward" integer DEFAULT 5 NOT NULL,
	"map_id" text NOT NULL,
	"position_x" integer DEFAULT 0 NOT NULL,
	"position_y" integer DEFAULT 0 NOT NULL,
	"respawn_seconds" integer DEFAULT 60 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "npcs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"description" text,
	"map_id" text NOT NULL,
	"position_x" integer DEFAULT 0 NOT NULL,
	"position_y" integer DEFAULT 0 NOT NULL,
	"personality" text NOT NULL,
	"is_shop" boolean DEFAULT false NOT NULL,
	"shop_items" jsonb
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "oauth_accounts_provider_provider_user_id_unique" UNIQUE("provider","provider_user_id")
);
--> statement-breakpoint
CREATE TABLE "player_inventory" (
	"player_id" text NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"equipped" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_quests" (
	"player_id" text NOT NULL,
	"quest_id" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"progress" jsonb,
	"accepted_at" text,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "player_skills" (
	"player_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"gender" text,
	"spiritual_root" jsonb,
	"realm" integer DEFAULT 1 NOT NULL,
	"realm_major" integer DEFAULT 1 NOT NULL,
	"realm_minor" integer DEFAULT 1 NOT NULL,
	"realm_name" text DEFAULT '练气期一重' NOT NULL,
	"cultivation_xp" integer DEFAULT 0 NOT NULL,
	"hp" integer DEFAULT 100 NOT NULL,
	"max_hp" integer DEFAULT 100 NOT NULL,
	"mp" integer DEFAULT 50 NOT NULL,
	"max_mp" integer DEFAULT 50 NOT NULL,
	"attack" integer DEFAULT 10 NOT NULL,
	"defense" integer DEFAULT 5 NOT NULL,
	"speed" integer DEFAULT 5 NOT NULL,
	"luck" integer DEFAULT 5 NOT NULL,
	"gold" integer DEFAULT 0 NOT NULL,
	"current_main_quest_id" text,
	"current_map_id" text,
	"position_x" integer DEFAULT 0 NOT NULL,
	"position_y" integer DEFAULT 0 NOT NULL,
	"is_alive" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "players_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "quests" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"quest_category" text DEFAULT 'side' NOT NULL,
	"quest_type" text DEFAULT 'kill' NOT NULL,
	"accept_npc_id" text NOT NULL,
	"complete_npc_id" text NOT NULL,
	"accept_story" text,
	"complete_story" text,
	"requirements" jsonb,
	"rewards" jsonb,
	"prerequisites" jsonb,
	"min_realm" integer DEFAULT 1 NOT NULL,
	"repeatable" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "random_events" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"event_type" text DEFAULT 'encounter' NOT NULL,
	"probability" real DEFAULT 0.1 NOT NULL,
	"min_realm" integer DEFAULT 1 NOT NULL,
	"max_realm" integer,
	"map_type" text,
	"rewards" jsonb,
	"ai_prompt" text
);
--> statement-breakpoint
CREATE TABLE "realm_majors" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "realm_majors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"order" integer NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"base_hp" integer DEFAULT 100 NOT NULL,
	"base_mp" integer DEFAULT 50 NOT NULL,
	"base_atk" integer DEFAULT 10 NOT NULL,
	"base_def" integer DEFAULT 5 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "realm_stages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "realm_stages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"major_id" integer NOT NULL,
	"minor" integer NOT NULL,
	"required_xp" bigint DEFAULT 100 NOT NULL,
	"success_rate" real DEFAULT 0.9 NOT NULL,
	"fail_xp_loss_rate" real DEFAULT 0.2 NOT NULL,
	"reward_rules" jsonb,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"skill_type" text DEFAULT 'attack' NOT NULL,
	"element" text,
	"damage_base" integer DEFAULT 0 NOT NULL,
	"damage_multiplier" real DEFAULT 1 NOT NULL,
	"mp_cost" integer DEFAULT 10 NOT NULL,
	"cooldown" integer DEFAULT 0 NOT NULL,
	"effects" jsonb,
	"realm_required" integer DEFAULT 1 NOT NULL,
	"target" text DEFAULT 'enemy' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_progress" (
	"player_id" text NOT NULL,
	"story_id" text NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"chapter" integer DEFAULT 1 NOT NULL,
	"choices" jsonb
);
--> statement-breakpoint
CREATE TABLE "system_configs" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"group" text NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"description" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_generation_jobs" ADD CONSTRAINT "ai_generation_jobs_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_memories" ADD CONSTRAINT "ai_memories_npc_id_npcs_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."npcs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_memories" ADD CONSTRAINT "ai_memories_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boss_instances" ADD CONSTRAINT "boss_instances_monster_id_monsters_id_fk" FOREIGN KEY ("monster_id") REFERENCES "public"."monsters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cdk_codes" ADD CONSTRAINT "cdk_codes_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cdk_redeem_logs" ADD CONSTRAINT "cdk_redeem_logs_cdk_id_cdk_codes_id_fk" FOREIGN KEY ("cdk_id") REFERENCES "public"."cdk_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cdk_redeem_logs" ADD CONSTRAINT "cdk_redeem_logs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combat_logs" ADD CONSTRAINT "combat_logs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_edges" ADD CONSTRAINT "map_edges_map_a_id_maps_id_fk" FOREIGN KEY ("map_a_id") REFERENCES "public"."maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_edges" ADD CONSTRAINT "map_edges_map_b_id_maps_id_fk" FOREIGN KEY ("map_b_id") REFERENCES "public"."maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monsters" ADD CONSTRAINT "monsters_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npcs" ADD CONSTRAINT "npcs_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_inventory" ADD CONSTRAINT "player_inventory_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_inventory" ADD CONSTRAINT "player_inventory_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_quests" ADD CONSTRAINT "player_quests_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_quests" ADD CONSTRAINT "player_quests_quest_id_quests_id_fk" FOREIGN KEY ("quest_id") REFERENCES "public"."quests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_skills" ADD CONSTRAINT "player_skills_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_skills" ADD CONSTRAINT "player_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_accept_npc_id_npcs_id_fk" FOREIGN KEY ("accept_npc_id") REFERENCES "public"."npcs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_complete_npc_id_npcs_id_fk" FOREIGN KEY ("complete_npc_id") REFERENCES "public"."npcs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realm_stages" ADD CONSTRAINT "realm_stages_major_id_realm_majors_id_fk" FOREIGN KEY ("major_id") REFERENCES "public"."realm_majors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_progress" ADD CONSTRAINT "story_progress_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cdk_codes_created_by_idx" ON "cdk_codes" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "cdk_codes_enabled_idx" ON "cdk_codes" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "cdk_redeem_logs_cdk_id_idx" ON "cdk_redeem_logs" USING btree ("cdk_id");--> statement-breakpoint
CREATE INDEX "cdk_redeem_logs_player_id_idx" ON "cdk_redeem_logs" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "oauth_accounts_account_id_idx" ON "oauth_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "players_account_id_idx" ON "players" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "system_configs_group_idx" ON "system_configs" USING btree ("group");