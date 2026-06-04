-- apps/agent-api/src/db/schema/003_agent_functions.sql

CREATE SCHEMA IF NOT EXISTS agent;
CREATE SCHEMA IF NOT EXISTS utils;

CREATE OR REPLACE FUNCTION utils.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION utils.safe_uuid(v text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF v IS NULL OR btrim(v) = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN v::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION utils.current_actor_ref()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('agent.actor_ref', true), '');
$$;

CREATE OR REPLACE FUNCTION utils.current_org_ref()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('agent.org_ref', true), '');
$$;

CREATE OR REPLACE FUNCTION utils.current_request_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('agent.request_id', true), '');
$$;

CREATE OR REPLACE FUNCTION utils.is_agent_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_user = 'vera_agent_admin';
$$;

CREATE OR REPLACE FUNCTION utils.audit_agent_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = agent, utils, pg_temp
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_record_id uuid;
BEGIN
  IF to_regclass('agent.audit_events') IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := NULL;
  ELSE
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
  END IF;

  v_key := COALESCE(
    COALESCE(v_new, '{}'::jsonb)->>'id',
    COALESCE(v_old, '{}'::jsonb)->>'id',
    COALESCE(v_new, '{}'::jsonb)->>'request_id',
    COALESCE(v_old, '{}'::jsonb)->>'request_id',
    COALESCE(v_new, '{}'::jsonb)->>'idempotency_key',
    COALESCE(v_old, '{}'::jsonb)->>'idempotency_key'
  );

  v_record_id := utils.safe_uuid(v_key);

  INSERT INTO agent.audit_events (
    table_name,
    record_id,
    record_key,
    action,
    old_data,
    new_data,
    actor_ref,
    org_ref,
    request_id,
    actor_db_role
  )
  VALUES (
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    v_record_id,
    v_key,
    TG_OP,
    v_old,
    v_new,
    utils.current_actor_ref(),
    utils.current_org_ref(),
    utils.current_request_id(),
    current_user
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION utils.audit_agent_trigger() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_admin') THEN
    ALTER FUNCTION utils.audit_agent_trigger() OWNER TO vera_agent_admin;
    GRANT EXECUTE ON FUNCTION utils.audit_agent_trigger() TO vera_agent_admin;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_app') THEN
    GRANT EXECUTE ON FUNCTION utils.audit_agent_trigger() TO vera_agent_app;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION utils.set_agent_context(
  p_actor_ref text DEFAULT NULL,
  p_org_ref text DEFAULT NULL,
  p_request_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('agent.actor_ref', COALESCE(NULLIF(btrim(p_actor_ref), ''), ''), true);
  PERFORM set_config('agent.org_ref', COALESCE(NULLIF(btrim(p_org_ref), ''), ''), true);
  PERFORM set_config('agent.request_id', COALESCE(NULLIF(btrim(p_request_id), ''), ''), true);

  -- Default is safe user/request-scoped behavior.
  -- Background workers may explicitly enable system scope with utils.set_agent_system_scope(true).
  PERFORM set_config('agent.system_scope', 'false', true);
END;
$$;

CREATE OR REPLACE FUNCTION utils.set_agent_system_scope(
  p_enabled boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('agent.system_scope', CASE WHEN p_enabled THEN 'true' ELSE 'false' END, true);
END;
$$;

REVOKE ALL ON FUNCTION utils.set_agent_context(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION utils.set_agent_system_scope(boolean) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_app') THEN
    GRANT EXECUTE ON FUNCTION utils.set_agent_context(text, text, text) TO vera_agent_app;
    GRANT EXECUTE ON FUNCTION utils.set_agent_system_scope(boolean) TO vera_agent_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_admin') THEN
    GRANT EXECUTE ON FUNCTION utils.set_agent_context(text, text, text) TO vera_agent_admin;
    GRANT EXECUTE ON FUNCTION utils.set_agent_system_scope(boolean) TO vera_agent_admin;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_app') THEN
    REVOKE ALL ON FUNCTION utils.safe_uuid(text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION utils.current_actor_ref() FROM PUBLIC;
    REVOKE ALL ON FUNCTION utils.current_org_ref() FROM PUBLIC;
    REVOKE ALL ON FUNCTION utils.current_request_id() FROM PUBLIC;
    REVOKE ALL ON FUNCTION utils.is_agent_admin() FROM PUBLIC;
    REVOKE ALL ON FUNCTION utils.audit_agent_trigger() FROM PUBLIC;

    GRANT EXECUTE ON FUNCTION utils.safe_uuid(text) TO vera_agent_app;
    GRANT EXECUTE ON FUNCTION utils.current_actor_ref() TO vera_agent_app;
    GRANT EXECUTE ON FUNCTION utils.current_org_ref() TO vera_agent_app;
    GRANT EXECUTE ON FUNCTION utils.current_request_id() TO vera_agent_app;
    GRANT EXECUTE ON FUNCTION utils.is_agent_admin() TO vera_agent_app;
    GRANT EXECUTE ON FUNCTION utils.audit_agent_trigger() TO vera_agent_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_admin') THEN
    GRANT EXECUTE ON FUNCTION utils.safe_uuid(text) TO vera_agent_admin;
    GRANT EXECUTE ON FUNCTION utils.current_actor_ref() TO vera_agent_admin;
    GRANT EXECUTE ON FUNCTION utils.current_org_ref() TO vera_agent_admin;
    GRANT EXECUTE ON FUNCTION utils.current_request_id() TO vera_agent_admin;
    GRANT EXECUTE ON FUNCTION utils.is_agent_admin() TO vera_agent_admin;
    GRANT EXECUTE ON FUNCTION utils.audit_agent_trigger() TO vera_agent_admin;
  END IF;
END $$;