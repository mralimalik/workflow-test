CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid,
	"owner_type" text NOT NULL,
	"owner_id" uuid,
	"purpose" text NOT NULL,
	"storage_provider" text NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_sha256" "bytea",
	"original_name" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retention_until" timestamp with time zone,
	"uploaded_by_type" text NOT NULL,
	"uploaded_by_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_owner_type_ck" CHECK ("files"."owner_type" in ('organization', 'customer', 'user', 'platform')),
	CONSTRAINT "files_purpose_ck" CHECK ("files"."purpose" in ('logo', 'avatar', 'service_image', 'product_image', 'recording', 'knowledge_document', 'export', 'attachment')),
	CONSTRAINT "files_storage_provider_ck" CHECK ("files"."storage_provider" in ('s3', 'azure_blob', 'local')),
	CONSTRAINT "files_visibility_ck" CHECK ("files"."visibility" in ('private', 'public')),
	CONSTRAINT "files_status_ck" CHECK ("files"."status" in ('pending', 'ready', 'quarantined', 'deleted')),
	CONSTRAINT "files_size_ck" CHECK ("files"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "files_bucket_object_key_uq" ON "files" USING btree ("bucket","object_key");--> statement-breakpoint
CREATE INDEX "files_org_owner_idx" ON "files" USING btree ("organization_id","owner_type","owner_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "files" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "global_rows" ON "files" AS PERMISSIVE FOR ALL TO public USING (organization_id is null and nullif(current_setting('app.organization_id', true), '')::uuid is null) WITH CHECK (organization_id is null and nullif(current_setting('app.organization_id', true), '')::uuid is null);
--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;
