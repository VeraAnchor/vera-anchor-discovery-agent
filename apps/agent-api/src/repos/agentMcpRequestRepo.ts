// apps/agent-api/src/repos/agentMcpRequestRepo.ts

import type pg from "pg";
import {
  AgentRepoBase,
  normalizeErrorCode,
  normalizeErrorMessage,
  normalizeJsonObject,
  normalizeOptionalHash,
  normalizeOptionalRef,
  normalizeOptionalString,
  normalizeOptionalUuid,
  normalizeUuid,
  randomUuid,
} from "./agentRepoUtils.js";

const MCP_REQUEST_STATUS = new Set([
  "received",
  "validated",
  "running",
  "completed",
  "failed",
  "rejected",
]);

export type AgentMcpRequestStatus =
  | "received"
  | "validated"
  | "running"
  | "completed"
  | "failed"
  | "rejected";

export type AgentMcpRequestRow = Readonly<{
  id: string;
  action_id: string | null;
  request_id: string | null;
  session_id: string | null;
  client_ref: string | null;
  tool_name: string;
  status: AgentMcpRequestStatus;
  input_hash: string | null;
  output_hash: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  latency_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  actor_ref: string | null;
  org_ref: string | null;
  created_at: Date;
  deleted_at: Date | null;
}>;

function normalizeStatus(
  value: unknown,
  fallback: AgentMcpRequestStatus,
): AgentMcpRequestStatus {
  const s = String(value ?? fallback).trim();

  if (!MCP_REQUEST_STATUS.has(s)) {
    throw new Error(`Invalid MCP request status: ${s}`);
  }

  return s as AgentMcpRequestStatus;
}

function normalizeToolName(value: unknown): string {
  const s = String(value ?? "").trim();

  if (!s) {
    throw new Error("toolName is required");
  }

  if (/[\u0000-\u001f\u007f]/.test(s)) {
    throw new Error("toolName contains control characters");
  }

  if (!/^[a-zA-Z][a-zA-Z0-9_.:-]{1,120}$/.test(s)) {
    throw new Error(`Invalid MCP tool name: ${s}`);
  }

  return s;
}

function normalizeLatencyMs(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  const n = Number(value);

  if (!Number.isInteger(n) || n < 0 || n > 3_600_000) {
    throw new Error("latencyMs must be an integer between 0 and 3600000");
  }

  return n;
}

function normalizeMcpRef(value: unknown, name: string): string | null {
  return normalizeOptionalString(value, name, 256);
}

export class AgentMcpRequestRepo extends AgentRepoBase {
  constructor({ pool }: { pool: pg.Pool }) {
    super({
      pool,
      tableName: "mcp_requests",
    });
  }

  async createReceived(
    input: {
      id?: string | null;
      actionId?: string | null;
      requestId?: string | null;
      sessionId?: string | null;
      clientRef?: string | null;
      toolName: string;
      inputHash?: string | null;
      metadata?: Record<string, unknown>;
      actorRef?: string | null;
      orgRef?: string | null;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentMcpRequestRow> {
    const id = input.id ? normalizeUuid(input.id, "id") : randomUuid();
    const actionId = normalizeOptionalUuid(input.actionId, "actionId");
    const requestId = normalizeMcpRef(input.requestId, "requestId");
    const sessionId = normalizeMcpRef(input.sessionId, "sessionId");
    const clientRef = normalizeMcpRef(input.clientRef, "clientRef");
    const toolName = normalizeToolName(input.toolName);
    const inputHash = normalizeOptionalHash(input.inputHash, "input_hash");
    const metadata = normalizeJsonObject(input.metadata, "metadata");
    const actorRef = normalizeOptionalRef(input.actorRef, "actorRef");
    const orgRef = normalizeOptionalRef(input.orgRef, "orgRef");

    const sql = `
      INSERT INTO agent.mcp_requests (
        id,
        action_id,
        request_id,
        session_id,
        client_ref,
        tool_name,
        status,
        input_hash,
        metadata,
        actor_ref,
        org_ref
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::text,
        $4::text,
        $5::text,
        $6::text,
        'received',
        $7::text,
        $8::jsonb,
        $9::text,
        $10::text
      )
      RETURNING *;
    `;

    const { rows } = await this.query<AgentMcpRequestRow>(
      client,
      sql,
      [
        id,
        actionId,
        requestId,
        sessionId,
        clientRef,
        toolName,
        inputHash,
        metadata,
        actorRef,
        orgRef,
      ],
    );

    return rows[0];
  }

  async getById(
    id: string,
    { client }: { client: pg.PoolClient },
  ): Promise<AgentMcpRequestRow | null> {
    const requestId = normalizeUuid(id, "id");

    const sql = `
      SELECT *
      FROM agent.mcp_requests
      WHERE id = $1::uuid
        AND deleted_at IS NULL
      LIMIT 1;
    `;

    const { rows } = await this.query<AgentMcpRequestRow>(client, sql, [requestId]);
    return rows[0] ?? null;
  }

  async markValidated(
    id: string,
    { client }: { client: pg.PoolClient },
  ): Promise<AgentMcpRequestRow | null> {
    return this.markStatus(
      {
        id,
        status: "validated",
      },
      { client },
    );
  }

  async markRunning(
    id: string,
    { client }: { client: pg.PoolClient },
  ): Promise<AgentMcpRequestRow | null> {
    const requestId = normalizeUuid(id, "id");

    const sql = `
      UPDATE agent.mcp_requests
      SET
        status = 'running',
        started_at = COALESCE(started_at, now())
      WHERE id = $1::uuid
        AND deleted_at IS NULL
      RETURNING *;
    `;

    const { rows } = await this.query<AgentMcpRequestRow>(client, sql, [requestId]);
    return rows[0] ?? null;
  }

  async markCompleted(
    input: {
      id: string;
      outputHash?: string | null;
      latencyMs?: number | null;
      metadata?: Record<string, unknown>;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentMcpRequestRow | null> {
    const id = normalizeUuid(input.id, "id");
    const outputHash = normalizeOptionalHash(input.outputHash, "output_hash");
    const latencyMs = normalizeLatencyMs(input.latencyMs);
    const metadata = normalizeJsonObject(input.metadata, "metadata");

    const sql = `
      UPDATE agent.mcp_requests
      SET
        status = 'completed',
        output_hash = COALESCE($2::text, output_hash),
        completed_at = now(),
        latency_ms = COALESCE($3::integer, latency_ms),
        error_code = NULL,
        error_message = NULL,
        metadata = metadata || $4::jsonb
      WHERE id = $1::uuid
        AND deleted_at IS NULL
      RETURNING *;
    `;

    const { rows } = await this.query<AgentMcpRequestRow>(
      client,
      sql,
      [id, outputHash, latencyMs, metadata],
    );

    return rows[0] ?? null;
  }

  async markFailed(
    input: {
      id: string;
      errorCode: string;
      errorMessage?: string | null;
      outputHash?: string | null;
      latencyMs?: number | null;
      metadata?: Record<string, unknown>;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentMcpRequestRow | null> {
    return this.markTerminalError(
      {
        ...input,
        status: "failed",
      },
      { client },
    );
  }

  async markRejected(
    input: {
      id: string;
      errorCode: string;
      errorMessage?: string | null;
      outputHash?: string | null;
      latencyMs?: number | null;
      metadata?: Record<string, unknown>;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentMcpRequestRow | null> {
    return this.markTerminalError(
      {
        ...input,
        status: "rejected",
      },
      { client },
    );
  }

  private async markTerminalError(
    input: {
      id: string;
      status: "failed" | "rejected";
      errorCode: string;
      errorMessage?: string | null;
      outputHash?: string | null;
      latencyMs?: number | null;
      metadata?: Record<string, unknown>;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentMcpRequestRow | null> {
    const id = normalizeUuid(input.id, "id");
    const status = normalizeStatus(input.status, "failed");
    const errorCode = normalizeErrorCode(input.errorCode);
    const errorMessage = normalizeErrorMessage(input.errorMessage);
    const outputHash = normalizeOptionalHash(input.outputHash, "output_hash");
    const latencyMs = normalizeLatencyMs(input.latencyMs);
    const metadata = normalizeJsonObject(input.metadata, "metadata");

    const sql = `
      UPDATE agent.mcp_requests
      SET
        status = $2::agent.mcp_request_status_domain,
        output_hash = COALESCE($3::text, output_hash),
        completed_at = now(),
        latency_ms = COALESCE($4::integer, latency_ms),
        error_code = $5::text,
        error_message = $6::text,
        metadata = metadata || $7::jsonb
      WHERE id = $1::uuid
        AND deleted_at IS NULL
      RETURNING *;
    `;

    const { rows } = await this.query<AgentMcpRequestRow>(
      client,
      sql,
      [
        id,
        status,
        outputHash,
        latencyMs,
        errorCode,
        errorMessage,
        metadata,
      ],
    );

    return rows[0] ?? null;
  }

  private async markStatus(
    input: {
      id: string;
      status: AgentMcpRequestStatus;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentMcpRequestRow | null> {
    const id = normalizeUuid(input.id, "id");
    const status = normalizeStatus(input.status, "received");

    const sql = `
      UPDATE agent.mcp_requests
      SET status = $2::agent.mcp_request_status_domain
      WHERE id = $1::uuid
        AND deleted_at IS NULL
      RETURNING *;
    `;

    const { rows } = await this.query<AgentMcpRequestRow>(client, sql, [
      id,
      status,
    ]);

    return rows[0] ?? null;
  }
}