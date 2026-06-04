// apps/agent-api/src/db/db.ts

import pg from "pg";
import type { QueryResult, QueryResultRow } from "pg";
import { withAgentDbGate } from "./dbGate.js";

const { Pool } = pg;

const databaseUrl = process.env.AGENT_DATABASE_URL;
const migrationDatabaseUrl =
  process.env.AGENT_MIGRATION_DATABASE_URL || process.env.AGENT_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("AGENT_DATABASE_URL is required");
}

if (!migrationDatabaseUrl) {
  throw new Error("AGENT_MIGRATION_DATABASE_URL or AGENT_DATABASE_URL is required");
}

const sslEnabled = String(process.env.AGENT_DB_SSL || "false").toLowerCase() === "true";

function getStatementTimeoutMs(): number {
  const value = Number(process.env.AGENT_DB_STATEMENT_TIMEOUT_MS || 10000);

  if (!Number.isInteger(value) || value < 100 || value > 300000) {
    throw new Error("AGENT_DB_STATEMENT_TIMEOUT_MS must be between 100 and 300000");
  }

  return value;
}

export type AgentDbContext = {
  actorRef?: string | null;
  orgRef?: string | null;
  requestId?: string | null;
  systemScope?: boolean;
};

export const agentDbPool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.AGENT_DB_POOL_MAX || 8),
  idleTimeoutMillis: Number(process.env.AGENT_DB_IDLE_TIMEOUT_MS || 30000),
  statement_timeout: getStatementTimeoutMs(),
  ssl: sslEnabled ? { rejectUnauthorized: true } : false,
});

export const agentMigrationDbPool = new Pool({
  connectionString: migrationDatabaseUrl,
  max: Number(process.env.AGENT_MIGRATION_DB_POOL_MAX || 2),
  idleTimeoutMillis: Number(process.env.AGENT_DB_IDLE_TIMEOUT_MS || 30000),
  statement_timeout: getStatementTimeoutMs(),
  ssl: sslEnabled ? { rejectUnauthorized: true } : false,
});

agentDbPool.on("error", (err: Error) => {
  console.error("[agent-db] unexpected idle client error", err);
});

agentMigrationDbPool.on("error", (err: Error) => {
  console.error("[agent-migration-db] unexpected idle client error", err);
});
 
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return withAgentDbGate(() => agentDbPool.query<T>(text, params));
}

export async function setAgentDbContext(
  client: pg.PoolClient,
  context: AgentDbContext,
): Promise<void> {
  await client.query(
    "SELECT utils.set_agent_context($1, $2, $3)",
    [
      context.actorRef || null,
      context.orgRef || null,
      context.requestId || null,
    ],
  );

  if (context.systemScope) {
    await client.query("SELECT utils.set_agent_system_scope(true)");
  }
}

export async function withAgentTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withAgentDbGate(async () => {
    const client = await agentDbPool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        "SELECT set_config('statement_timeout', $1, true)",
        [String(getStatementTimeoutMs())],
      );

      const result = await fn(client);

      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("[agent-db] rollback failed", rollbackErr);
      }

      throw err;
    } finally {
      client.release();
    }
  });
}

export async function withAgentContextTransaction<T>(
  context: AgentDbContext,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withAgentTransaction(async (client) => {
    await setAgentDbContext(client, context);
    return fn(client);
  });
}

export async function closeAgentDb(): Promise<void> {
  await agentDbPool.end();
  await agentMigrationDbPool.end();
}