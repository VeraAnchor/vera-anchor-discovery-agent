// apps/agent-api/src/db/agentDbUtils.ts

import fs from "node:fs/promises";
import pg from "pg";

type Queryable = pg.Pool | pg.PoolClient;

function getStatementTimeoutMs(): number {
  const value = Number(process.env.AGENT_DB_STATEMENT_TIMEOUT_MS || 10000);

  if (!Number.isInteger(value) || value < 100 || value > 300000) {
    throw new Error("AGENT_DB_STATEMENT_TIMEOUT_MS must be between 100 and 300000");
  }

  return value;
}

export async function runSqlFile(
  clientOrPool: Queryable,
  filePath: string,
): Promise<void> {
  const sql = await fs.readFile(filePath, "utf8");

  if (!sql.trim()) {
    throw new Error(`SQL file is empty: ${filePath}`);
  }

  await clientOrPool.query(sql);
}

export async function tableExists(
  clientOrPool: Queryable,
  qualifiedTableName: string,
): Promise<boolean> {
  const [schemaName, tableName] = splitQualifiedName(qualifiedTableName);

  const result = await clientOrPool.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name = $2
      ) AS exists
    `,
    [schemaName, tableName],
  );

  return Boolean(result.rows[0]?.exists);
}

export async function ensureSqlExecuted(
  clientOrPool: Queryable,
  filePath: string,
): Promise<void> {
  await runSqlFile(clientOrPool, filePath);
}

export async function runInTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

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
}

export async function withAdvisoryLockClient<T>(
  pool: pg.Pool,
  lock: {
    ns: number;
    id: number;
    name: string;
  },
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      "SELECT set_config('statement_timeout', $1, true)",
      [String(getStatementTimeoutMs())],
    );

    await client.query(
      "SELECT pg_advisory_xact_lock($1, $2)",
      [lock.ns, lock.id],
    );

    const result = await fn(client);

    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error(`[agent-db] rollback failed after advisory lock: ${lock.name}`, rollbackErr);
    }

    throw err;
  } finally {
    client.release();
  }
}

function splitQualifiedName(qualifiedTableName: string): [string, string] {
  const parts = qualifiedTableName.split(".");
  const schemaName = parts[0];
  const tableName = parts[1];
  const extra = parts[2];

  if (!schemaName || !tableName || extra !== undefined) {
    throw new Error(`Expected qualified table name like schema.table, got: ${qualifiedTableName}`);
  }

  return [schemaName, tableName];
}