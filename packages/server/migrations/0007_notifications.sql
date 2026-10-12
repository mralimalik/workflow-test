-- notifications (data model 12): one row per outbound message. Partitioned by month on
-- created_at (hand-written). Tenant rows via tenant_isolation; platform messages
-- (organization_id NULL) outside tenant context; delivery updates in platform scope.
CREATE TABLE notifications (
  id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid,
  location_id uuid,
  recipient_type text NOT NULL,
  recipient_id uuid,
  channel text NOT NULL,
  destination text NOT NULL,
  event_key text NOT NULL,
  template_id uuid,
  locale text NOT NULL,
  category text NOT NULL,
  related_type text,
  related_id uuid,
  rendered jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  suppression_reason text,
  scheduled_for timestamptz,
  provider text,
  provider_credential_id uuid,
  provider_message_id text,
  segments smallint,
  error_code text,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  dedupe_key text,
  CONSTRAINT notifications_pk PRIMARY KEY (id, created_at),
  CONSTRAINT notifications_dedupe_uq UNIQUE (dedupe_key, created_at),
  CONSTRAINT notifications_recipient_type_ck CHECK (recipient_type IN ('customer', 'user', 'address')),
  CONSTRAINT notifications_channel_ck CHECK (channel IN ('sms', 'email', 'whatsapp', 'push', 'in_app')),
  CONSTRAINT notifications_category_ck CHECK (category IN ('transactional', 'marketing', 'security', 'staff_alert')),
  CONSTRAINT notifications_status_ck CHECK (status IN ('queued', 'scheduled', 'sending', 'sent', 'delivered', 'read', 'failed', 'bounced', 'suppressed', 'canceled')),
  CONSTRAINT notifications_suppression_ck CHECK (suppression_reason IS NULL OR suppression_reason IN ('no_consent', 'opted_out', 'quiet_hours', 'invalid_destination', 'duplicate'))
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
CREATE TABLE notifications_default PARTITION OF notifications DEFAULT;
--> statement-breakpoint
REVOKE ALL ON TABLE notifications_default FROM attendra_app;
--> statement-breakpoint
CREATE INDEX notifications_org_related_idx ON notifications (organization_id, related_type, related_id);
--> statement-breakpoint
CREATE INDEX notifications_provider_message_idx ON notifications (provider, provider_message_id);
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON TABLE notifications FROM attendra_app;
--> statement-breakpoint
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON notifications AS PERMISSIVE FOR ALL TO public
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY global_rows ON notifications AS PERMISSIVE FOR ALL TO public
  USING (organization_id IS NULL AND nullif(current_setting('app.organization_id', true), '') IS NULL)
  WITH CHECK (organization_id IS NULL AND nullif(current_setting('app.organization_id', true), '') IS NULL);
--> statement-breakpoint
CREATE POLICY platform_scope ON notifications AS PERMISSIVE FOR ALL TO public
  USING (current_setting('app.scope', true) = 'platform')
  WITH CHECK (current_setting('app.scope', true) = 'platform');
--> statement-breakpoint
SELECT attendra_ensure_monthly_partitions('notifications', 2);
