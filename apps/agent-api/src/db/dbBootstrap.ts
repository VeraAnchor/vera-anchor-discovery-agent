// apps/agent-api/src/db/dbBootstrap.ts

import { agentMigrationDbPool, query } from "./db.js";
import { SchemaManager } from "./schemaManager.js";
import { MigrationManager } from "./migrationManager.js";

function envFlag(name: string, defaultValue = false): boolean {
  const value = process.env[name];

  if (value === undefined || value === null || value.trim() === "") {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * Runtime API startup check.
 *
 * Default behavior:
 *   - verifies the runtime app DB connection
 *   - does not run DDL
 *
 * DDL/migrations should normally be run by agent_init through migrateAgentDb().
 *
 * Emergency/local override:
 *   AGENT_DB_BOOTSTRAP_ON_START=true
 */
export async function bootstrapAgentDb(): Promise<void> {
  // Runtime DB check. This should use vera_agent_app.
  await query("SELECT 1");

  if (!envFlag("AGENT_DB_BOOTSTRAP_ON_START", false)) {
    return;
  }

  await migrateAgentDb({
    executedBy: "agent-api",
  });
}

/**
 * Controlled schema/migration path.
 *
 * This should be run by agent_init using AGENT_MIGRATION_DATABASE_URL,
 * which should point to vera_agent_admin.
 */
export async function migrateAgentDb({
  executedBy = "agent-init",
}: {
  executedBy?: string;
} = {}): Promise<void> {
  // Schema and migrations must use vera_agent_admin.
  await agentMigrationDbPool.query("SELECT 1");

  const schemaManager = new SchemaManager(agentMigrationDbPool);
  await schemaManager.initializeAll();

  const migrationManager = new MigrationManager(agentMigrationDbPool);
  await migrationManager.applyAll({
    executedBy,
  });
}

export async function checkAgentDbReady(): Promise<{
  ok: boolean;
  latencyMs: number;
  migrationsApplied: number;
}> {
  const started = Date.now();

  await query("SELECT 1");

  const migrationManager = new MigrationManager(agentMigrationDbPool);
  const migrations = await migrationManager.listAppliedMigrations();

  return {
    ok: true,
    latencyMs: Date.now() - started,
    migrationsApplied: migrations.length,
  };
}