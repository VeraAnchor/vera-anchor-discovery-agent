-- apps/agent-api/src/db/schema/004_agent_migrations.sql

CREATE SCHEMA IF NOT EXISTS agent;

CREATE TABLE IF NOT EXISTS agent.migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  checksum TEXT,
  executed_by TEXT NOT NULL DEFAULT current_user,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_migrations_name_nonempty_chk CHECK (length(name) > 0)
);

CREATE INDEX IF NOT EXISTS agent_migrations_applied_at_idx
  ON agent.migrations (applied_at DESC);

REVOKE ALL ON agent.migrations FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_app') THEN
    GRANT SELECT, INSERT, UPDATE ON agent.migrations TO vera_agent_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON agent.migrations TO vera_agent_admin;
  END IF;
END $$;