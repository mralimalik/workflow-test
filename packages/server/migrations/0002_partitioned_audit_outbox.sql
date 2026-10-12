-- Partitioned platform tables (data model 14): audit_logs, outbox_events.
-- Hand-written: Drizzle cannot declare partitioning. Query definitions live in
-- modules/*/infrastructure/*.partitioned.ts (outside drizzle-kit's schema glob).

-- Monthly partitions -------------------------------------------------------------------
-- Creates monthly partitions of `parent` from the current month to `months_ahead` months
-- ahead (idempotent). Partitions do not inherit RLS, so the runtime role gets no direct
-- access to them: all reads/writes go through the RLS-protected parent.
CREATE OR REPLACE FUNCTION attendra_ensure_monthly_partitions(parent regclass, months_ahead integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  start_month date := date_trunc('month', now())::date;
  from_date date;
  to_date date;
  part_name text;
BEGIN
  FOR i IN 0..months_ahead LOOP
    from_date := (start_month + make_interval(months => i))::date;
    to_date := (from_date + interval '1 month')::date;
    part_name := format('%s_y%sm%s', parent::text, to_char(from_date, 'YYYY'), to_char(from_date, 'MM'));
    IF to_regclass(part_name) IS NULL THEN
      EXECUTE format('CREATE TABLE %I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)', part_name, parent, from_date, to_date);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM attendra_app', part_name);
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION attendra_ensure_monthly_partitions(regclass, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION attendra_ensure_monthly_partitions(regclass, integer) TO attendra_app;
--> statement-breakpoint
-- Drops monthly partitions whose whole range ended more than `keep` ago and that hold no
-- rows matching `still_needed` (e.g. unpublished outbox events). Returns dropped names.
CREATE OR REPLACE FUNCTION attendra_drop_old_partitions(parent regclass, keep interval, still_needed text DEFAULT NULL)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  part record;
  upper_bound timestamptz;
  pending boolean;
BEGIN
  FOR part IN
    SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) AS bound
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = parent AND pg_get_expr(c.relpartbound, c.oid) <> 'DEFAULT'
  LOOP
    upper_bound := substring(part.bound FROM 'TO \(''([^'']+)''\)')::timestamptz;
    IF upper_bound < now() - keep THEN
      pending := false;
      IF still_needed IS NOT NULL THEN
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE %s)', part.relname, still_needed) INTO pending;
      END IF;
      IF NOT pending THEN
        EXECUTE format('DROP TABLE %I', part.relname);
        RETURN NEXT part.relname;
      END IF;
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION attendra_drop_old_partitions(regclass, interval, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION attendra_drop_old_partitions(regclass, interval, text) TO attendra_app;
--> statement-breakpoint

-- audit_logs ---------------------------------------------------------------------------
-- Append-only (app role: INSERT + SELECT). Tenant rows via tenant_isolation; platform-level
-- rows (organization_id NULL) are written outside tenant context and read in platform scope.
CREATE TABLE audit_logs (
  id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid,
  location_id uuid,
  actor_type text NOT NULL,
  actor_id uuid,
  impersonation_session_id uuid,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  changes jsonb NOT NULL DEFAULT '{}',
  context jsonb NOT NULL DEFAULT '{}',
  request_id text,
  ip inet,
  user_agent text,
  CONSTRAINT audit_logs_pk PRIMARY KEY (id, occurred_at),
  CONSTRAINT audit_logs_actor_type_ck CHECK (actor_type IN ('user', 'customer', 'platform_admin', 'agent', 'system', 'api_key')),
  CONSTRAINT audit_logs_action_ck CHECK (action ~ '^[a-z_]+\.[a-z_]+$')
) PARTITION BY RANGE (occurred_at);
--> statement-breakpoint
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;
--> statement-breakpoint
REVOKE ALL ON TABLE audit_logs_default FROM attendra_app;
--> statement-breakpoint
CREATE INDEX audit_logs_org_occurred_idx ON audit_logs (organization_id, occurred_at DESC);
--> statement-breakpoint
CREATE INDEX audit_logs_org_target_idx ON audit_logs (organization_id, target_type, target_id, occurred_at DESC);
--> statement-breakpoint
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_type, actor_id, occurred_at DESC);
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_logs FROM attendra_app;
--> statement-breakpoint
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON audit_logs AS PERMISSIVE FOR ALL TO public
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY platform_scope ON audit_logs AS PERMISSIVE FOR ALL TO public
  USING (current_setting('app.scope', true) = 'platform')
  WITH CHECK (current_setting('app.scope', true) = 'platform');
--> statement-breakpoint
CREATE POLICY global_insert ON audit_logs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (organization_id IS NULL);
--> statement-breakpoint
SELECT attendra_ensure_monthly_partitions('audit_logs', 2);
--> statement-breakpoint

-- outbox_events -------------------------------------------------------------------------
-- Written in the producer's transaction (tenant or global), read/updated only by the relay
-- in platform scope. Published partitions are dropped after 14 days.
CREATE TABLE outbox_events (
  id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  organization_id uuid,
  location_id uuid,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  event_version smallint NOT NULL DEFAULT 1,
  payload jsonb NOT NULL,
  trace_context jsonb NOT NULL DEFAULT '{}',
  published_at timestamptz,
  attempts smallint NOT NULL DEFAULT 0,
  last_error text,
  CONSTRAINT outbox_events_pk PRIMARY KEY (id, created_at),
  CONSTRAINT outbox_events_type_ck CHECK (event_type ~ '^[a-z_]+\.[a-z_]+$')
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
CREATE TABLE outbox_events_default PARTITION OF outbox_events DEFAULT;
--> statement-breakpoint
REVOKE ALL ON TABLE outbox_events_default FROM attendra_app;
--> statement-breakpoint
CREATE INDEX outbox_events_unpublished_idx ON outbox_events (created_at, id) WHERE published_at IS NULL;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON TABLE outbox_events FROM attendra_app;
--> statement-breakpoint
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON outbox_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY global_insert ON outbox_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (organization_id IS NULL);
--> statement-breakpoint
CREATE POLICY platform_scope ON outbox_events AS PERMISSIVE FOR ALL TO public
  USING (current_setting('app.scope', true) = 'platform')
  WITH CHECK (current_setting('app.scope', true) = 'platform');
--> statement-breakpoint
SELECT attendra_ensure_monthly_partitions('outbox_events', 2);
