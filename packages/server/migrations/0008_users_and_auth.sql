CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"purpose" text NOT NULL,
	"realm" text NOT NULL,
	"subject_id" uuid,
	"channel" text NOT NULL,
	"destination" text NOT NULL,
	"secret_hash" "bytea" NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"context_organization_id" uuid,
	"ip" "inet",
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_challenges_kind_ck" CHECK ("auth_challenges"."kind" in ('otp', 'link')),
	CONSTRAINT "auth_challenges_purpose_ck" CHECK ("auth_challenges"."purpose" in ('login', 'verify_phone', 'verify_email', 'password_reset', 'change_email', 'change_phone', 'widget_identify', 'mfa_recovery')),
	CONSTRAINT "auth_challenges_realm_ck" CHECK ("auth_challenges"."realm" in ('user', 'customer', 'platform_admin')),
	CONSTRAINT "auth_challenges_channel_ck" CHECK ("auth_challenges"."channel" in ('sms', 'whatsapp', 'email', 'voice')),
	CONSTRAINT "auth_challenges_attempts_ck" CHECK ("auth_challenges"."attempts" >= 0 and "auth_challenges"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "mfa_factors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"type" text NOT NULL,
	"secret_ciphertext" "bytea" NOT NULL,
	"label" text,
	"verified_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_used_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_factors_subject_type_ck" CHECK ("mfa_factors"."subject_type" in ('platform_admin', 'user')),
	CONSTRAINT "mfa_factors_type_ck" CHECK ("mfa_factors"."type" in ('totp', 'recovery_codes'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"client_type" text NOT NULL,
	"auth_method" text NOT NULL,
	"mfa_verified_at" timestamp with time zone,
	"csrf_secret" "bytea",
	"subject_version" integer NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"device_label" text,
	"impersonation_session_id" uuid,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_subject_type_ck" CHECK ("sessions"."subject_type" in ('user', 'customer', 'platform_admin')),
	CONSTRAINT "sessions_client_type_ck" CHECK ("sessions"."client_type" in ('web', 'mobile', 'cli')),
	CONSTRAINT "sessions_auth_method_ck" CHECK ("sessions"."auth_method" in ('password', 'otp_sms', 'otp_email', 'otp_whatsapp', 'magic_link', 'oauth_google', 'refresh')),
	CONSTRAINT "sessions_revoke_reason_ck" CHECK ("sessions"."revoke_reason" is null or "sessions"."revoke_reason" in ('logout', 'logout_all', 'password_changed', 'banned', 'admin', 'expired', 'reuse_detected')),
	CONSTRAINT "sessions_revoked_ck" CHECK (("sessions"."revoked_at" is null) = ("sessions"."revoke_reason" is null)),
	CONSTRAINT "sessions_expiry_ck" CHECK ("sessions"."idle_expires_at" <= "sessions"."absolute_expires_at")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone_e164" text,
	"password_hash" text,
	"first_name" text NOT NULL,
	"last_name" text,
	"avatar_file_id" uuid,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"banned_at" timestamp with time zone,
	"ban_reason" text,
	"session_version" integer DEFAULT 1 NOT NULL,
	"last_login_at" timestamp with time zone,
	"mfa_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_status_ck" CHECK ("users"."status" in ('active', 'disabled', 'banned')),
	CONSTRAINT "users_phone_ck" CHECK ("users"."phone_e164" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "users_session_version_ck" CHECK ("users"."session_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_file_id_files_id_fk" FOREIGN KEY ("avatar_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_challenges_secret_hash_uq" ON "auth_challenges" USING btree ("secret_hash") WHERE "auth_challenges"."kind" = 'link';--> statement-breakpoint
CREATE INDEX "auth_challenges_destination_idx" ON "auth_challenges" USING btree ("destination","purpose","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "auth_challenges_subject_idx" ON "auth_challenges" USING btree ("realm","subject_id","purpose");--> statement-breakpoint
CREATE INDEX "auth_challenges_expires_idx" ON "auth_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_factors_active_uq" ON "mfa_factors" USING btree ("subject_type","subject_id","type") WHERE "mfa_factors"."verified_at" is not null;--> statement-breakpoint
CREATE INDEX "mfa_factors_subject_idx" ON "mfa_factors" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_subject_active_idx" ON "sessions" USING btree ("subject_type","subject_id") WHERE "sessions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "sessions_absolute_expires_idx" ON "sessions" USING btree ("absolute_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");