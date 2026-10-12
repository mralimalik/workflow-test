-- inbound_webhook_events (data model 14): every provider webhook, stored before processing.
-- Partitioned by month on received_at (hand-written; Drizzle cannot declare partitions).
-- Duplicates are rejected in Redis (7 days) before insert; the unique key includes the
-- partition column as Postgres requires.
CREATE TABLE inbound_webhook_events (
  id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  organization_id uuid,
  payload jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  status text NOT NULL DEFAULT 'received',
  attempts smallint NOT NULL DEFAULT 0,
  processed_at timestamptz,
  error text,
  CONSTRAINT inbound_webhook_events_pk PRIMARY KEY (id, received_at),
  CONSTRAINT inbound_webhook_events_provider_event_uq UNIQUE (provider, provider_event_id, received_at),
  CONSTRAINT inbound_webhook_events_provider_ck CHECK (provider IN ('stripe', 'stripe_connect', 'twilio', 'google', 'microsoft', 'meta')),
  CONSTRAINT inbound_webhook_events_status_ck CHECK (status IN ('received', 'processing', 'processed', 'failed', 'ignored', 'rejected'))
) PARTITION BY RANGE (received_at);
--> statement-breakpoint
CREATE TABLE inbound_webhook_events_default PARTITION OF inbound_webhook_events DEFAULT;
--> statement-breakpoint
REVOKE ALL ON TABLE inbound_webhook_events_default FROM attendra_app;
--> statement-breakpoint
CREATE INDEX inbound_webhook_events_status_idx ON inbound_webhook_events (status, received_at) WHERE status IN ('received', 'failed');
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON TABLE inbound_webhook_events FROM attendra_app;
--> statement-breakpoint
ALTER TABLE inbound_webhook_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE inbound_webhook_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON inbound_webhook_events AS PERMISSIVE FOR SELECT TO public
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY global_insert ON inbound_webhook_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (organization_id IS NULL);
--> statement-breakpoint
CREATE POLICY platform_scope ON inbound_webhook_events AS PERMISSIVE FOR ALL TO public
  USING (current_setting('app.scope', true) = 'platform')
  WITH CHECK (current_setting('app.scope', true) = 'platform');
--> statement-breakpoint
SELECT attendra_ensure_monthly_partitions('inbound_webhook_events', 2);
