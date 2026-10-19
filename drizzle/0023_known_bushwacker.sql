CREATE TABLE "avatar_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"image_url" text NOT NULL,
	"gender" text NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "avatar_frame_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"image_url" text NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_unlocked_avatar_frames" (
	"player_id" text NOT NULL,
	"avatar_frame_id" text NOT NULL,
	"source_item_id" text,
	"unlocked_at" text NOT NULL,
	CONSTRAINT "player_unlocked_avatar_frames_player_id_avatar_frame_id_pk" PRIMARY KEY("player_id","avatar_frame_id")
);
--> statement-breakpoint
CREATE TABLE "player_unlocked_avatars" (
	"player_id" text NOT NULL,
	"avatar_id" text NOT NULL,
	"source_item_id" text,
	"unlocked_at" text NOT NULL,
	CONSTRAINT "player_unlocked_avatars_player_id_avatar_id_pk" PRIMARY KEY("player_id","avatar_id")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "avatar_id" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "avatar_frame_id" text;--> statement-breakpoint
ALTER TABLE "player_unlocked_avatar_frames" ADD CONSTRAINT "player_unlocked_avatar_frames_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_unlocked_avatar_frames" ADD CONSTRAINT "player_unlocked_avatar_frames_avatar_frame_id_avatar_frame_assets_id_fk" FOREIGN KEY ("avatar_frame_id") REFERENCES "public"."avatar_frame_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_unlocked_avatar_frames" ADD CONSTRAINT "player_unlocked_avatar_frames_source_item_id_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_unlocked_avatars" ADD CONSTRAINT "player_unlocked_avatars_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_unlocked_avatars" ADD CONSTRAINT "player_unlocked_avatars_avatar_id_avatar_assets_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "public"."avatar_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_unlocked_avatars" ADD CONSTRAINT "player_unlocked_avatars_source_item_id_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avatar_assets_gender_idx" ON "avatar_assets" USING btree ("gender");--> statement-breakpoint
CREATE INDEX "avatar_assets_public_enabled_idx" ON "avatar_assets" USING btree ("is_public","enabled");--> statement-breakpoint
CREATE INDEX "avatar_assets_sort_order_idx" ON "avatar_assets" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "avatar_frame_assets_public_enabled_idx" ON "avatar_frame_assets" USING btree ("is_public","enabled");--> statement-breakpoint
CREATE INDEX "avatar_frame_assets_sort_order_idx" ON "avatar_frame_assets" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "player_unlocked_avatar_frames_player_idx" ON "player_unlocked_avatar_frames" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "player_unlocked_avatar_frames_frame_idx" ON "player_unlocked_avatar_frames" USING btree ("avatar_frame_id");--> statement-breakpoint
CREATE INDEX "player_unlocked_avatars_player_idx" ON "player_unlocked_avatars" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "player_unlocked_avatars_avatar_idx" ON "player_unlocked_avatars" USING btree ("avatar_id");--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_avatar_id_avatar_assets_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "public"."avatar_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_avatar_frame_id_avatar_frame_assets_id_fk" FOREIGN KEY ("avatar_frame_id") REFERENCES "public"."avatar_frame_assets"("id") ON DELETE no action ON UPDATE no action;