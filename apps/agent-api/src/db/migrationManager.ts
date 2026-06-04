// apps/agent-api/src/db/MigrationManager.ts

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { AGENT_MIGRATIONS } from "./agentMigrationRegistry.js";
import { runSqlFile, withAdvisoryLockClient } from "./agentDbUtils.js";
import { SchemaManager } from "./schemaManager.js";

export class MigrationManager {
  private readonly pool: pg.Pool;
  private readonly enableChecksum: boolean;

  constructor(pool: pg.Pool) {
    if (!pool) {
      throw new Error("Postgres pool is required");
    }

    this.pool = pool;
    this.enableChecksum =
      String(process.env.AGENT_MIGRATION_CHECKSUM || "true").toLowerCase() === "true";
  }

  async ensureMigrationTable(): Promise<void> {
    const schemaManager = new SchemaManager(this.pool);
    await schemaManager.initializeAll();
  }

  async applyAll({
    executedBy = "system",
  }: {
    executedBy?: string;
  } = {}): Promise<void> {
    await this.ensureMigrationTable();
    this.validateMigrationRegistry();

    await withAdvisoryLockClient(
      this.pool,
      {
        ns: 44001,
        id: 2,
        name: "agent migration application",
      },
      async (client) => {
        const appliedMap = await this.getAppliedMigrationMap(client);

        const sortedMigrations = [...AGENT_MIGRATIONS].sort((a, b) => a.id - b.id);

        for (const migration of sortedMigrations) {
          const resolved = path.resolve(migration.file);

          if (!fs.existsSync(resolved)) {
            throw new Error(`Migration file not found: ${migration.file} (ID: ${migration.id})`);
          }
        }

        for (const migration of sortedMigrations) {
          const migrationPath = path.resolve(migration.file);
          const sql = await fs.promises.readFile(migrationPath, "utf8");
          const currentChecksum = this.enableChecksum ? computeSha3_512(sql) : null;
          const appliedChecksum = appliedMap.get(migration.id);

          if (appliedChecksum !== undefined) {
            if (
              this.enableChecksum &&
              appliedChecksum &&
              currentChecksum &&
              appliedChecksum !== currentChecksum
            ) {
              throw new Error(
                [
                  `Migration ${migration.id} checksum mismatch:`,
                  `  DB: ${appliedChecksum}`,
                  `  File: ${currentChecksum}`,
                  `  Path: ${migration.file}`,
                ].join("\n"),
              );
            }

            console.info(
              `[agent-migrations] skipping applied migration ${migration.id}: ${path.basename(migration.file)}`,
            );
            continue;
          }

          console.info(
            `[agent-migrations] applying migration ${migration.id}: ${path.basename(migration.file)}`,
          );

          await runSqlFile(client, migrationPath);

          await client.query(
            `
              INSERT INTO agent.migrations (
                id,
                name,
                description,
                checksum,
                executed_by
              )
              VALUES ($1, $2, $3, $4, $5)
            `,
            [
              migration.id,
              migration.file,
              migration.description,
              currentChecksum,
              executedBy,
            ],
          );

          console.info(`[agent-migrations] recorded migration ${migration.id}`);
        }

        console.info("[agent-migrations] all pending migrations applied successfully");
      },
    );
  }

  async listAppliedMigrations(): Promise<
    Array<{
      id: number;
      name: string;
      description: string | null;
      checksum: string | null;
      executed_by: string;
      applied_at: Date;
    }>
  > {
    await this.ensureMigrationTable();

    const result = await this.pool.query(
      `
        SELECT id, name, description, checksum, executed_by, applied_at
        FROM agent.migrations
        ORDER BY id ASC
      `,
    );

    return result.rows;
  }

  async getAppliedMigrationIds(): Promise<number[]> {
    const rows = await this.listAppliedMigrations();
    return rows.map((row) => row.id);
  }

  async rollback(id: number): Promise<void> {
    const migration = AGENT_MIGRATIONS.find((item) => item.id === id);

    if (!migration?.downFile) {
      throw new Error(`No down script registered for agent migration ${id}`);
    }

    const downPath = path.resolve(migration.downFile);

    if (!fs.existsSync(downPath)) {
      throw new Error(`Down migration file not found: ${downPath}`);
    }

    await withAdvisoryLockClient(
      this.pool,
      {
        ns: 44001,
        id: 3,
        name: "agent migration rollback",
      },
      async (client) => {
        console.info(`[agent-migrations] rolling back migration ${id}`);

        await runSqlFile(client, downPath);

        await client.query(
          "DELETE FROM agent.migrations WHERE id = $1",
          [id],
        );

        console.info(`[agent-migrations] rollback successful: ${id}`);
      },
    );
  }

  private async getAppliedMigrationMap(
    client: pg.PoolClient,
  ): Promise<Map<number, string | null>> {
    const result = await client.query<{
      id: number | string;
      checksum: string | null;
    }>(
      `
        SELECT id, checksum
        FROM agent.migrations
        ORDER BY id ASC
      `,
    );

    return new Map(result.rows.map((row) => [Number(row.id), row.checksum ?? null]));
  }

  private validateMigrationRegistry(): void {
    const seen = new Set<number>();

    for (const migration of AGENT_MIGRATIONS) {
      if (!Number.isInteger(migration.id) || migration.id <= 0) {
        throw new Error(`Invalid agent migration id: ${migration.id}`);
      }

      if (seen.has(migration.id)) {
        throw new Error(`Duplicate agent migration id: ${migration.id}`);
      }

      if (!migration.description.trim()) {
        throw new Error(`Agent migration ${migration.id} is missing a description`);
      }

      seen.add(migration.id);
    }
  }
}

function computeSha3_512(input: string): string {
  return crypto.createHash("sha3-512").update(input).digest("hex");
}