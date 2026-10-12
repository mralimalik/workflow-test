CREATE TABLE "feature_flag_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"feature_flag_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"set_by_platform_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flag_overrides_scope_ck" CHECK ("feature_flag_overrides"."scope_type" in ('plan', 'organization', 'location', 'user'))
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	"type" text DEFAULT 'boolean' NOT NULL,
	"default_value" jsonb NOT NULL,
	"rollout_percent" smallint DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_type_ck" CHECK ("feature_flags"."type" in ('boolean', 'string', 'number', 'json')),
	CONSTRAINT "feature_flags_rollout_ck" CHECK ("feature_flags"."rollout_percent" between 0 and 100),
	CONSTRAINT "feature_flags_key_ck" CHECK ("feature_flags"."key" ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$')
);
--> statement-breakpoint
ALTER TABLE "feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_feature_flag_id_feature_flags_id_fk" FOREIGN KEY ("feature_flag_id") REFERENCES "public"."feature_flags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flag_overrides_flag_scope_uq" ON "feature_flag_overrides" USING btree ("feature_flag_id","scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_key_uq" ON "feature_flags" USING btree ("key");