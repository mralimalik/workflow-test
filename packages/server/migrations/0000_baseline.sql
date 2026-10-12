-- Baseline: extensions and runtime-role privileges (BACKEND.md §7, §13).
-- Runs as the owner role. The runtime role `attendra_app` (NOBYPASSRLS) is provisioned
-- outside migrations: infra/postgres/init locally, the platform's secret store elsewhere.

CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'attendra_app') THEN
    RAISE EXCEPTION 'Runtime role attendra_app does not exist. See README → Local development.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'attendra_app' AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION 'Runtime role attendra_app must not be superuser or BYPASSRLS.';
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO attendra_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO attendra_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO attendra_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO attendra_app;
