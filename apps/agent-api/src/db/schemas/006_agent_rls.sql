-- ============================================================================
-- 002_agent_rls.sql
-- Version: 1.0
-- Purpose:
--   Row-level security for Vera Anchor MCP / discovery agent tables.
--
-- Security model:
--   - Vera Core remains source of truth for users/orgs/auth/billing.
--   - Agent DB stores actor_ref/org_ref references only.
--   - app role access is scoped by session context:
--       agent.actor_ref
--       agent.org_ref
--       agent.request_id
--       agent.system_scope
--   - admin role has explicit bypass.
--   - audit_events is append-oriented for app role.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS agent;
CREATE SCHEMA IF NOT EXISTS utils;

-- ============================================================================
-- 1. RLS helper functions
-- ============================================================================

CREATE OR REPLACE FUNCTION utils.current_agent_system_scope()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('agent.system_scope', true), ''), 'false') = 'true';
$$;

CREATE OR REPLACE FUNCTION utils.agent_context_present()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    utils.current_actor_ref() IS NOT NULL
    OR utils.current_org_ref() IS NOT NULL
    OR utils.current_agent_system_scope();
$$;

CREATE OR REPLACE FUNCTION utils.agent_row_visible(
  p_actor_ref text,
  p_org_ref text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    utils.current_agent_system_scope()
    OR (
      utils.current_actor_ref() IS NOT NULL
      AND p_actor_ref IS NOT NULL
      AND p_actor_ref = utils.current_actor_ref()
    )
    OR (
      utils.current_org_ref() IS NOT NULL
      AND p_org_ref IS NOT NULL
      AND p_org_ref = utils.current_org_ref()
    );
$$;

CREATE OR REPLACE FUNCTION utils.agent_row_write_allowed(
  p_actor_ref text,
  p_org_ref text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    utils.current_agent_system_scope()
    OR (
      utils.current_actor_ref() IS NOT NULL
      AND (
        p_actor_ref IS NULL
        OR p_actor_ref = utils.current_actor_ref()
      )
      AND (
        p_org_ref IS NULL
        OR utils.current_org_ref() IS NULL
        OR p_org_ref = utils.current_org_ref()
      )
    )
    OR (
      utils.current_org_ref() IS NOT NULL
      AND p_org_ref IS NOT NULL
      AND p_org_ref = utils.current_org_ref()
    );
$$;

REVOKE ALL ON FUNCTION utils.current_agent_system_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION utils.agent_context_present() FROM PUBLIC;
REVOKE ALL ON FUNCTION utils.agent_row_visible(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION utils.agent_row_write_allowed(text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_app') THEN
    GRANT EXECUTE ON FUNCTION utils.current_agent_system_scope() TO vera_agent_app;
    GRANT EXECUTE ON FUNCTION utils.agent_context_present() TO vera_agent_app;
    GRANT EXECUTE ON FUNCTION utils.agent_row_visible(text, text) TO vera_agent_app;
    GRANT EXECUTE ON FUNCTION utils.agent_row_write_allowed(text, text) TO vera_agent_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_admin') THEN
    GRANT EXECUTE ON FUNCTION utils.current_agent_system_scope() TO vera_agent_admin;
    GRANT EXECUTE ON FUNCTION utils.agent_context_present() TO vera_agent_admin;
    GRANT EXECUTE ON FUNCTION utils.agent_row_visible(text, text) TO vera_agent_admin;
    GRANT EXECUTE ON FUNCTION utils.agent_row_write_allowed(text, text) TO vera_agent_admin;
  END IF;
END $$;


-- ============================================================================
-- 2. Enable RLS
-- ============================================================================

ALTER TABLE agent.actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent.mcp_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent.evidence_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent.audit_events ENABLE ROW LEVEL SECURITY;

ALTER TABLE agent.actions FORCE ROW LEVEL SECURITY;
ALTER TABLE agent.quotes FORCE ROW LEVEL SECURITY;
ALTER TABLE agent.payment_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE agent.receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE agent.mcp_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE agent.evidence_cache FORCE ROW LEVEL SECURITY;
ALTER TABLE agent.audit_events FORCE ROW LEVEL SECURITY;


-- ============================================================================
-- 3. Drop existing policies
-- ============================================================================

DROP POLICY IF EXISTS agent_actions_admin_all ON agent.actions;
DROP POLICY IF EXISTS agent_actions_app_select ON agent.actions;
DROP POLICY IF EXISTS agent_actions_app_insert ON agent.actions;
DROP POLICY IF EXISTS agent_actions_app_update ON agent.actions;

DROP POLICY IF EXISTS agent_quotes_admin_all ON agent.quotes;
DROP POLICY IF EXISTS agent_quotes_app_select ON agent.quotes;
DROP POLICY IF EXISTS agent_quotes_app_insert ON agent.quotes;
DROP POLICY IF EXISTS agent_quotes_app_update ON agent.quotes;

DROP POLICY IF EXISTS agent_payment_admin_all ON agent.payment_transactions;
DROP POLICY IF EXISTS agent_payment_app_select ON agent.payment_transactions;
DROP POLICY IF EXISTS agent_payment_app_insert ON agent.payment_transactions;
DROP POLICY IF EXISTS agent_payment_app_update ON agent.payment_transactions;

DROP POLICY IF EXISTS agent_receipts_admin_all ON agent.receipts;
DROP POLICY IF EXISTS agent_receipts_app_select ON agent.receipts;
DROP POLICY IF EXISTS agent_receipts_app_insert ON agent.receipts;
DROP POLICY IF EXISTS agent_receipts_app_update ON agent.receipts;

DROP POLICY IF EXISTS agent_mcp_admin_all ON agent.mcp_requests;
DROP POLICY IF EXISTS agent_mcp_app_select ON agent.mcp_requests;
DROP POLICY IF EXISTS agent_mcp_app_insert ON agent.mcp_requests;
DROP POLICY IF EXISTS agent_mcp_app_update ON agent.mcp_requests;

DROP POLICY IF EXISTS agent_evidence_admin_all ON agent.evidence_cache;
DROP POLICY IF EXISTS agent_evidence_app_select ON agent.evidence_cache;
DROP POLICY IF EXISTS agent_evidence_app_insert ON agent.evidence_cache;
DROP POLICY IF EXISTS agent_evidence_app_update ON agent.evidence_cache;

DROP POLICY IF EXISTS agent_audit_admin_all ON agent.audit_events;
DROP POLICY IF EXISTS agent_audit_app_select ON agent.audit_events;
DROP POLICY IF EXISTS agent_audit_app_insert ON agent.audit_events;


-- ============================================================================
-- 4. Admin bypass policies
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_admin') THEN
    EXECUTE $pol$
      CREATE POLICY agent_actions_admin_all ON agent.actions
        FOR ALL TO vera_agent_admin
        USING (true)
        WITH CHECK (true)
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_quotes_admin_all ON agent.quotes
        FOR ALL TO vera_agent_admin
        USING (true)
        WITH CHECK (true)
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_payment_admin_all ON agent.payment_transactions
        FOR ALL TO vera_agent_admin
        USING (true)
        WITH CHECK (true)
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_receipts_admin_all ON agent.receipts
        FOR ALL TO vera_agent_admin
        USING (true)
        WITH CHECK (true)
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_mcp_admin_all ON agent.mcp_requests
        FOR ALL TO vera_agent_admin
        USING (true)
        WITH CHECK (true)
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_evidence_admin_all ON agent.evidence_cache
        FOR ALL TO vera_agent_admin
        USING (true)
        WITH CHECK (true)
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_audit_admin_all ON agent.audit_events
        FOR ALL TO vera_agent_admin
        USING (true)
        WITH CHECK (true)
    $pol$;
  END IF;
END $$;


-- ============================================================================
-- 5. App policies: actions
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_app') THEN
    EXECUTE $pol$
      CREATE POLICY agent_actions_app_select ON agent.actions
        FOR SELECT TO vera_agent_app
        USING (
          deleted_at IS NULL
          AND utils.agent_row_visible(actor_ref, org_ref)
        )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_actions_app_insert ON agent.actions
        FOR INSERT TO vera_agent_app
        WITH CHECK (
          deleted_at IS NULL
          AND utils.agent_row_write_allowed(actor_ref, org_ref)
        )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_actions_app_update ON agent.actions
        FOR UPDATE TO vera_agent_app
        USING (
          deleted_at IS NULL
          AND utils.agent_row_visible(actor_ref, org_ref)
        )
        WITH CHECK (
          deleted_at IS NULL
          AND utils.agent_row_write_allowed(actor_ref, org_ref)
        )
    $pol$;
  END IF;
END $$;


-- ============================================================================
-- 6. App policies: quotes
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_app') THEN
    EXECUTE $pol$
      CREATE POLICY agent_quotes_app_select ON agent.quotes
        FOR SELECT TO vera_agent_app
        USING (
          deleted_at IS NULL
          AND utils.agent_row_visible(actor_ref, org_ref)
        )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_quotes_app_insert ON agent.quotes
        FOR INSERT TO vera_agent_app
        WITH CHECK (
          deleted_at IS NULL
          AND utils.agent_row_write_allowed(actor_ref, org_ref)
        )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_quotes_app_update ON agent.quotes
        FOR UPDATE TO vera_agent_app
        USING (
          deleted_at IS NULL
          AND utils.agent_row_visible(actor_ref, org_ref)
        )
        WITH CHECK (
          deleted_at IS NULL
          AND utils.agent_row_write_allowed(actor_ref, org_ref)
        )
    $pol$;
  END IF;
END $$;


-- ============================================================================
-- 7. App policies: payment_transactions
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_app') THEN
    EXECUTE $pol$
      CREATE POLICY agent_payment_app_select ON agent.payment_transactions
        FOR SELECT TO vera_agent_app
        USING (
          deleted_at IS NULL
          AND utils.agent_row_visible(actor_ref, org_ref)
        )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_payment_app_insert ON agent.payment_transactions
        FOR INSERT TO vera_agent_app
        WITH CHECK (
          deleted_at IS NULL
          AND utils.agent_row_write_allowed(actor_ref, org_ref)
        )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_payment_app_update ON agent.payment_transactions
        FOR UPDATE TO vera_agent_app
        USING (
          deleted_at IS NULL
          AND utils.agent_row_visible(actor_ref, org_ref)
        )
        WITH CHECK (
          deleted_at IS NULL
          AND utils.agent_row_write_allowed(actor_ref, org_ref)
        )
    $pol$;
  END IF;
END $$;


-- ============================================================================
-- 8. App policies: receipts
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_app') THEN
    EXECUTE $pol$
      CREATE POLICY agent_receipts_app_select ON agent.receipts
        FOR SELECT TO vera_agent_app
        USING (
          deleted_at IS NULL
          AND utils.agent_row_visible(actor_ref, org_ref)
        )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_receipts_app_insert ON agent.receipts
        FOR INSERT TO vera_agent_app
        WITH CHECK (
          deleted_at IS NULL
          AND utils.agent_row_write_allowed(actor_ref, org_ref)
        )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_receipts_app_update ON agent.receipts
        FOR UPDATE TO vera_agent_app
        USING (
          deleted_at IS NULL
          AND utils.agent_row_visible(actor_ref, org_ref)
        )
        WITH CHECK (
          deleted_at IS NULL
          AND utils.agent_row_write_allowed(actor_ref, org_ref)
        )
    $pol$;
  END IF;
END $$;


-- ============================================================================
-- 9. App policies: mcp_requests
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_app') THEN
    EXECUTE $pol$
      CREATE POLICY agent_mcp_app_select ON agent.mcp_requests
        FOR SELECT TO vera_agent_app
        USING (
          deleted_at IS NULL
          AND utils.agent_row_visible(actor_ref, org_ref)
        )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_mcp_app_insert ON agent.mcp_requests
        FOR INSERT TO vera_agent_app
        WITH CHECK (
          deleted_at IS NULL
          AND utils.agent_row_write_allowed(actor_ref, org_ref)
        )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_mcp_app_update ON agent.mcp_requests
        FOR UPDATE TO vera_agent_app
        USING (
          deleted_at IS NULL
          AND utils.agent_row_visible(actor_ref, org_ref)
        )
        WITH CHECK (
          deleted_at IS NULL
          AND utils.agent_row_write_allowed(actor_ref, org_ref)
        )
    $pol$;
  END IF;
END $$;


-- ============================================================================
-- 10. App policies: evidence_cache
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_app') THEN
    EXECUTE $pol$
      CREATE POLICY agent_evidence_app_select ON agent.evidence_cache
        FOR SELECT TO vera_agent_app
        USING (
          deleted_at IS NULL
        )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_evidence_app_insert ON agent.evidence_cache
        FOR INSERT TO vera_agent_app
        WITH CHECK (
          deleted_at IS NULL
        )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY agent_evidence_app_update ON agent.evidence_cache
        FOR UPDATE TO vera_agent_app
        USING (
          deleted_at IS NULL
        )
        WITH CHECK (
          deleted_at IS NULL
        )
    $pol$;
  END IF;
END $$;


-- ============================================================================
-- 11. App policies: audit_events
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_app') THEN
    EXECUTE $pol$
      CREATE POLICY agent_audit_app_select ON agent.audit_events
        FOR SELECT TO vera_agent_app
        USING (
          utils.current_agent_system_scope()
          OR (
            utils.current_actor_ref() IS NOT NULL
            AND actor_ref IS NOT NULL
            AND actor_ref = utils.current_actor_ref()
          )
          OR (
            utils.current_org_ref() IS NOT NULL
            AND org_ref IS NOT NULL
            AND org_ref = utils.current_org_ref()
          )
          OR (
            utils.current_request_id() IS NOT NULL
            AND request_id IS NOT NULL
            AND request_id = utils.current_request_id()
          )
        )
    $pol$;
  END IF;
END $$;


-- ============================================================================
-- 12. Defensive grants after RLS
-- ============================================================================

REVOKE ALL ON ALL TABLES IN SCHEMA agent FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA agent FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_app') THEN
    GRANT SELECT, INSERT, UPDATE ON agent.actions TO vera_agent_app;
    GRANT SELECT, INSERT, UPDATE ON agent.quotes TO vera_agent_app;
    GRANT SELECT, INSERT, UPDATE ON agent.payment_transactions TO vera_agent_app;
    GRANT SELECT, INSERT, UPDATE ON agent.receipts TO vera_agent_app;
    GRANT SELECT, INSERT, UPDATE ON agent.mcp_requests TO vera_agent_app;
    GRANT SELECT, INSERT, UPDATE ON agent.evidence_cache TO vera_agent_app;

    -- Audit is trigger-written. App role may read scoped audit rows, but not forge audit rows.
    GRANT SELECT ON agent.audit_events TO vera_agent_app;

    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA agent TO vera_agent_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vera_agent_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agent TO vera_agent_admin;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA agent TO vera_agent_admin;
  END IF;
END $$;