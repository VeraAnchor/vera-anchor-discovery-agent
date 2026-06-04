-- apps/agent-api/src/db/schema/002_agent_domains.sql

CREATE SCHEMA IF NOT EXISTS agent;

DO $$
BEGIN
  CREATE DOMAIN agent.action_status_domain AS TEXT
    CHECK (VALUE IN (
      'created',
      'quoted',
      'payment_pending',
      'payment_verified',
      'running',
      'completed',
      'failed',
      'cancelled',
      'expired'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE DOMAIN agent.action_type_domain AS TEXT
    CHECK (
      VALUE ~ '^[a-z][a-z0-9_:-]{1,79}$'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE DOMAIN agent.quote_status_domain AS TEXT
    CHECK (VALUE IN (
      'created',
      'active',
      'accepted',
      'expired',
      'cancelled',
      'failed'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE DOMAIN agent.payment_status_domain AS TEXT
    CHECK (VALUE IN (
      'created',
      'pending',
      'submitted',
      'verified',
      'failed',
      'expired',
      'cancelled'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE DOMAIN agent.receipt_type_domain AS TEXT
    CHECK (VALUE IN (
      'quote',
      'payment',
      'proof_export',
      'anchor',
      'verification',
      'mcp_result',
      'error'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE DOMAIN agent.mcp_request_status_domain AS TEXT
    CHECK (VALUE IN (
      'received',
      'validated',
      'running',
      'completed',
      'failed',
      'rejected'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE DOMAIN agent.cache_status_domain AS TEXT
    CHECK (VALUE IN (
      'fresh',
      'stale',
      'invalid',
      'error'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE DOMAIN agent.audit_action_domain AS TEXT
    CHECK (VALUE IN (
      'INSERT',
      'UPDATE',
      'DELETE'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;