CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"location_id" uuid,
	"event_key" text NOT NULL,
	"channel" text NOT NULL,
	"locale" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"html_body" text,
	"provider_template_ref" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_templates_scope_uq" UNIQUE NULLS NOT DISTINCT("organization_id","location_id","event_key","channel","locale"),
	CONSTRAINT "notification_templates_channel_ck" CHECK ("notification_templates"."channel" in ('sms', 'email', 'whatsapp', 'push', 'in_app')),
	CONSTRAINT "notification_templates_location_ck" CHECK ("notification_templates"."location_id" is null or "notification_templates"."organization_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "notification_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notification_templates" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "platform_defaults_read" ON "notification_templates" AS PERMISSIVE FOR SELECT TO public USING (organization_id is null);--> statement-breakpoint
CREATE POLICY "platform_scope" ON "notification_templates" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.scope', true) = 'platform') WITH CHECK (current_setting('app.scope', true) = 'platform');
--> statement-breakpoint
ALTER TABLE "notification_templates" FORCE ROW LEVEL SECURITY;
