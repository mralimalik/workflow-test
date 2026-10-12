CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"mfa_enforced" boolean DEFAULT true NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_role_ck" CHECK ("platform_admins"."role" in ('super_admin', 'support', 'billing', 'read_only')),
	CONSTRAINT "platform_admins_status_ck" CHECK ("platform_admins"."status" in ('active', 'disabled')),
	CONSTRAINT "platform_admins_mfa_ck" CHECK ("platform_admins"."mfa_enforced")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admins_email_uq" ON "platform_admins" USING btree ("email");