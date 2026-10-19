CREATE TABLE "plugin_packages" (
	"id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY NOT NULL,
	"plugin_id" text NOT NULL,
	"version" text NOT NULL,
	"source_type" text DEFAULT 'upload' NOT NULL,
	"builtin_key" text,
	"file_path" text,
	"extract_path" text,
	"server_entry" text DEFAULT 'dist/server.js' NOT NULL,
	"sha256" text,
	"manifest" jsonb NOT NULL,
	"uploaded_by" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_installs" (
	"plugin_id" text PRIMARY KEY NOT NULL,
	"package_id" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb,
	"installed_by" text,
	"installed_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_operation_logs" (
	"id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY NOT NULL,
	"plugin_id" text NOT NULL,
	"operation" text NOT NULL,
	"status" text NOT NULL,
	"message" text,
	"detail" jsonb,
	"operator_account_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plugin_packages" ADD CONSTRAINT "plugin_packages_uploaded_by_accounts_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plugin_installs" ADD CONSTRAINT "plugin_installs_package_id_plugin_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."plugin_packages"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plugin_installs" ADD CONSTRAINT "plugin_installs_installed_by_accounts_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plugin_operation_logs" ADD CONSTRAINT "plugin_operation_logs_operator_account_id_accounts_id_fk" FOREIGN KEY ("operator_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_packages_plugin_id_version_unique" ON "plugin_packages" USING btree ("plugin_id","version");
--> statement-breakpoint
CREATE INDEX "plugin_packages_plugin_id_idx" ON "plugin_packages" USING btree ("plugin_id");
--> statement-breakpoint
CREATE INDEX "plugin_packages_source_type_idx" ON "plugin_packages" USING btree ("source_type");
--> statement-breakpoint
CREATE INDEX "plugin_installs_enabled_idx" ON "plugin_installs" USING btree ("enabled");
--> statement-breakpoint
CREATE INDEX "plugin_installs_package_id_idx" ON "plugin_installs" USING btree ("package_id");
--> statement-breakpoint
CREATE INDEX "plugin_operation_logs_plugin_id_idx" ON "plugin_operation_logs" USING btree ("plugin_id");
--> statement-breakpoint
CREATE INDEX "plugin_operation_logs_created_at_idx" ON "plugin_operation_logs" USING btree ("created_at");
