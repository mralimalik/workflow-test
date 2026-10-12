-- Runs once when the local Docker volume is first created.
-- Migrations also declare these (CREATE EXTENSION IF NOT EXISTS) so native installs work.
CREATE EXTENSION IF NOT EXISTS vector;      -- knowledge base embeddings
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- exclusion constraints for double-booking protection
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive emails

-- Separate role for the application at runtime: row-level security applies to it.
-- The owner role (attendra) runs migrations and bypasses RLS. See BACKEND.md §7.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'attendra_app') THEN
    CREATE ROLE attendra_app LOGIN PASSWORD 'attendra_app' NOBYPASSRLS;
  END IF;
END
$$;
GRANT CONNECT ON DATABASE attendra TO attendra_app;
