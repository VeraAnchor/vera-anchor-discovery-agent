-- apps/agent-api/src/db/schema/001_agent_schema.sql

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS agent;
CREATE SCHEMA IF NOT EXISTS utils;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_app') THEN
    GRANT USAGE ON SCHEMA agent TO vera_agent_app;
    GRANT USAGE ON SCHEMA utils TO vera_agent_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_admin') THEN
    GRANT USAGE ON SCHEMA agent TO vera_agent_admin;
    GRANT USAGE ON SCHEMA utils TO vera_agent_admin;
  END IF;
END $$;