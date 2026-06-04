// apps/agent-api/src/db/schemaManager.ts

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import {
  AGENT_PRE_TABLE_SQL,
  AGENT_TABLES,
} from "./agentTableRegistry.js";
import {
  ensureSqlExecuted,
  tableExists,
  withAdvisoryLockClient,
} from "./agentDbUtils.js";
import { assertAgentSchemaDirReady } from "./agentSqlPaths.js";

declare global {
  // eslint-disable-next-line no-var
  var __VERA_AGENT_PRE_TABLES_DONE_BY_DB__: Set<string> | undefined;
}

if (!global.__VERA_AGENT_PRE_TABLES_DONE_BY_DB__) {
  global.__VERA_AGENT_PRE_TABLES_DONE_BY_DB__ = new Set<string>();
}

export class SchemaManager {
  private readonly pool: pg.Pool;
  private dbName: string | null = null;

  constructor(pool: pg.Pool) {
    if (!pool) {
      throw new Error("Postgres pool is required");
    }

    this.pool = pool;
  }

  async initializeAll({
    skipPreTables = false,
  }: {
    skipPreTables?: boolean;
  } = {}): Promise<void> {
    assertAgentSchemaDirReady();
    this.validateSchemaFiles();

    await withAdvisoryLockClient(
      this.pool,
      {
        ns: 44001,
        id: 1,
        name: "agent schema initialization",
      },
      async (client) => {
        await this.initPreTables(client, { skipPreTables });

        const executedSchemas = new Set<string>();

        for (const entry of Object.values(AGENT_TABLES)) {
          const qualifiedName = `${entry.pgSchema}.${entry.name}`;
          const schemaPath = path.resolve(entry.schema);

          if (!executedSchemas.has(schemaPath)) {
            console.info(`[agent-schema] ensuring table exists: ${qualifiedName}`);
            await ensureSqlExecuted(client, schemaPath);
            executedSchemas.add(schemaPath);
          }

          const exists = await tableExists(client, qualifiedName);

          if (!exists) {
            throw new Error(`Schema file did not create expected table: ${qualifiedName}`);
          }
        }

        console.info("[agent-schema] all required schema objects initialized");
      },
    );
  }

  async tableExists(tableName: string): Promise<boolean> {
    return tableExists(this.pool, tableName);
  }

  private async currentDbName(clientOrPool: pg.Pool | pg.PoolClient): Promise<string> {
    if (this.dbName !== null) {
      return this.dbName;
    }

    const result = await clientOrPool.query<{ db: string | null }>(
      "SELECT current_database() AS db",
    );

    const dbName = result.rows[0]?.db ?? "unknown";
    this.dbName = dbName;

    return dbName;
  }

  private async initPreTables(
    client: pg.PoolClient,
    {
      skipPreTables = false,
    }: {
      skipPreTables?: boolean;
    } = {},
  ): Promise<void> {
    if (skipPreTables) {
      return;
    }

    const dbName = await this.currentDbName(client);
    const doneSet = global.__VERA_AGENT_PRE_TABLES_DONE_BY_DB__;

    if (!doneSet) {
      throw new Error("Pre-table guard set not initialized");
    }

    if (doneSet.has(dbName)) {
      return;
    }

    const order = ["schema", "domains", "functions"] as const;

    for (const key of order) {
      const entry = AGENT_PRE_TABLE_SQL[key];
      const file = path.resolve(entry.schema);

      if (!fs.existsSync(file)) {
        throw new Error(`Pre-table file missing: ${entry.schema}`);
      }

      console.info(`[agent-schema] executing pre-table SQL: ${entry.name}`);
      await ensureSqlExecuted(client, file);
    }

    doneSet.add(dbName);
  }

  private validateSchemaFiles(): void {
    for (const entry of Object.values(AGENT_PRE_TABLE_SQL)) {
      const resolved = path.resolve(entry.schema);

      if (!fs.existsSync(resolved)) {
        throw new Error(`Pre-table schema file missing: ${entry.schema}`);
      }
    }

    for (const entry of Object.values(AGENT_TABLES)) {
      const resolved = path.resolve(entry.schema);

      if (!fs.existsSync(resolved)) {
        throw new Error(`Schema file missing: ${entry.schema}`);
      }
    }
  }
}