import type pg from "pg";
import {
  AgentRepoBase,
  normalizeActionType,
  normalizeDateOrNull,
  normalizeErrorCode,
  normalizeErrorMessage,
  normalizeJsonObject,
  normalizeLimit,
  normalizeOffset,
  normalizeOptionalHash,
  normalizeOptionalRef,
  normalizeOptionalString,
  normalizeUuid,
  randomUuid,
} from "./agentRepoUtils.js";

const ACTION_STATUS = new Set([
  "created",
  "quoted",
  "payment_pending",
  "payment_verified",
  "running",
  "completed",
  "failed",
  "cancelled",
  "expired",
]);

export type AgentActionStatus =
  | "created"
  | "quoted"
  | "payment_pending"
  | "payment_verified"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export type AgentActionRow = Readonly<{
  id: string;
  action_type: string;
  status: AgentActionStatus;
  actor_ref: string | null;
  org_ref: string | null;
  request_id: string | null;
  idempotency_key: string | null;
  quote_id: string | null;
  payment_id: string | null;
  receipt_id: string | null;
  input_hash: string | null;
  params_hash: string | null;
  output_hash: string | null;
  core_reference_id: string | null;
  core_reference_type: string | null;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  expires_at: Date | null;
  deleted_at: Date | null;
}>;

function normalizeStatus(value: unknown, fallback: AgentActionStatus): AgentActionStatus {
  const s = String(value ?? fallback).trim();

  if (!ACTION_STATUS.has(s)) {
    throw new Error(`Invalid action status: ${s}`);
  }

  return s as AgentActionStatus;
}

export class AgentActionRepo extends AgentRepoBase {
  constructor({ pool }: { pool: pg.Pool }) {
    super({
      pool,
      tableName: "actions",
    });
  }

  async createAction(
    input: {
      id?: string | null;
      actionType: string;
      status?: AgentActionStatus;
      actorRef?: string | null;
      orgRef?: string | null;
      requestId?: string | null;
      idempotencyKey?: string | null;
      inputHash?: string | null;
      paramsHash?: string | null;
      coreReferenceId?: string | null;
      coreReferenceType?: string | null;
      maxAttempts?: number;
      metadata?: Record<string, unknown>;
      expiresAt?: string | Date | null;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentActionRow> {
    const id = input.id ? normalizeUuid(input.id, "id") : randomUuid();
    const actionType = normalizeActionType(input.actionType);
    const status = normalizeStatus(input.status, "created");
    const actorRef = normalizeOptionalRef(input.actorRef, "actorRef");
    const orgRef = normalizeOptionalRef(input.orgRef, "orgRef");
    const requestId = normalizeOptionalRef(input.requestId, "requestId");
    const idempotencyKey = normalizeOptionalString(input.idempotencyKey, "idempotencyKey", 256);
    const inputHash = normalizeOptionalHash(input.inputHash, "input_hash");
    const paramsHash = normalizeOptionalHash(input.paramsHash, "params_hash");
    const coreReferenceId = normalizeOptionalString(input.coreReferenceId, "coreReferenceId", 256);
    const coreReferenceType = normalizeOptionalString(input.coreReferenceType, "coreReferenceType", 128);
    const maxAttempts = normalizeMaxAttempts(input.maxAttempts);
    const metadata = normalizeJsonObject(input.metadata, "metadata");
    const expiresAt = normalizeDateOrNull(input.expiresAt, "expiresAt");

    const sql = `
      INSERT INTO agent.actions (
        id,
        action_type,
        status,
        actor_ref,
        org_ref,
        request_id,
        idempotency_key,
        input_hash,
        params_hash,
        core_reference_id,
        core_reference_type,
        max_attempts,
        metadata,
        expires_at
      )
      VALUES (
        $1::uuid,
        $2::agent.action_type_domain,
        $3::agent.action_status_domain,
        $4::text,
        $5::text,
        $6::text,
        $7::text,
        $8::text,
        $9::text,
        $10::text,
        $11::text,
        $12::integer,
        $13::jsonb,
        $14::timestamptz
      )
      RETURNING *;
    `;

    try {
      const { rows } = await this.query<AgentActionRow>(
        client,
        sql,
        [
          id,
          actionType,
          status,
          actorRef,
          orgRef,
          requestId,
          idempotencyKey,
          inputHash,
          paramsHash,
          coreReferenceId,
          coreReferenceType,
          maxAttempts,
          metadata,
          expiresAt,
        ],
      );

      return rows[0];
    } catch (err) {
      this.mapUniqueViolation(err, "AGENT_ACTION_CONFLICT");
    }
  }

  async getById(
    id: string,
    { client, includeDeleted = false }: { client: pg.PoolClient; includeDeleted?: boolean },
  ): Promise<AgentActionRow | null> {
    const actionId = normalizeUuid(id, "id");

    const sql = `
      SELECT *
      FROM agent.actions
      WHERE id = $1::uuid
        AND ($2::boolean OR deleted_at IS NULL)
      LIMIT 1;
    `;

    const { rows } = await this.query<AgentActionRow>(client, sql, [
      actionId,
      Boolean(includeDeleted),
    ]);

    return rows[0] ?? null;
  }

  async getByIdForUpdate(
    id: string,
    { client }: { client: pg.PoolClient },
  ): Promise<AgentActionRow | null> {
    const actionId = normalizeUuid(id, "id");

    const sql = `
      SELECT *
      FROM agent.actions
      WHERE id = $1::uuid
        AND deleted_at IS NULL
      FOR UPDATE
      LIMIT 1;
    `;

    const { rows } = await this.query<AgentActionRow>(client, sql, [actionId]);
    return rows[0] ?? null;
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
    { client }: { client: pg.PoolClient },
  ): Promise<AgentActionRow | null> {
    const key = normalizeOptionalString(idempotencyKey, "idempotencyKey", 256);

    if (!key) return null;

    const sql = `
      SELECT *
      FROM agent.actions
      WHERE idempotency_key = $1::text
        AND deleted_at IS NULL
      LIMIT 1;
    `;

    const { rows } = await this.query<AgentActionRow>(client, sql, [key]);
    return rows[0] ?? null;
  }

  async listRecent(
    input: {
      status?: AgentActionStatus | null;
      actorRef?: string | null;
      orgRef?: string | null;
      limit?: number;
      offset?: number;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentActionRow[]> {
    const status = input.status ? normalizeStatus(input.status, "created") : null;
    const actorRef = normalizeOptionalRef(input.actorRef, "actorRef");
    const orgRef = normalizeOptionalRef(input.orgRef, "orgRef");
    const limit = normalizeLimit(input.limit);
    const offset = normalizeOffset(input.offset);

    const sql = `
      SELECT *
      FROM agent.actions
      WHERE deleted_at IS NULL
        AND ($1::agent.action_status_domain IS NULL OR status = $1::agent.action_status_domain)
        AND ($2::text IS NULL OR actor_ref = $2::text)
        AND ($3::text IS NULL OR org_ref = $3::text)
      ORDER BY created_at DESC, id DESC
      LIMIT $4::integer
      OFFSET $5::integer;
    `;

    const { rows } = await this.query<AgentActionRow>(client, sql, [
      status,
      actorRef,
      orgRef,
      limit,
      offset,
    ]);

    return rows;
  }

  async markStatus(
    input: {
      id: string;
      status: AgentActionStatus;
      outputHash?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentActionRow | null> {
    const id = normalizeUuid(input.id, "id");
    const status = normalizeStatus(input.status, "created");
    const outputHash = normalizeOptionalHash(input.outputHash, "output_hash");
    const errorCode = normalizeErrorCode(input.errorCode);
    const errorMessage = normalizeErrorMessage(input.errorMessage);

    const sql = `
      UPDATE agent.actions
      SET
        status = $2::agent.action_status_domain,
        output_hash = COALESCE($3::text, output_hash),
        error_code = $4::text,
        error_message = $5::text,
        started_at = CASE
          WHEN $2::text = 'running' AND started_at IS NULL THEN now()
          ELSE started_at
        END,
        completed_at = CASE
          WHEN $2::text IN ('completed', 'failed', 'cancelled', 'expired') THEN now()
          ELSE completed_at
        END
      WHERE id = $1::uuid
        AND deleted_at IS NULL
      RETURNING *;
    `;

    const { rows } = await this.query<AgentActionRow>(client, sql, [
      id,
      status,
      outputHash,
      errorCode,
      errorMessage,
    ]);

    return rows[0] ?? null;
  }

  async attachQuote(
    input: { actionId: string; quoteId: string },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentActionRow | null> {
    return this.attachUuid("quote_id", input.actionId, input.quoteId, client);
  }

  async attachPayment(
    input: { actionId: string; paymentId: string },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentActionRow | null> {
    return this.attachUuid("payment_id", input.actionId, input.paymentId, client);
  }

  async attachReceipt(
    input: { actionId: string; receiptId: string },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentActionRow | null> {
    return this.attachUuid("receipt_id", input.actionId, input.receiptId, client);
  }

  private async attachUuid(
    column: "quote_id" | "payment_id" | "receipt_id",
    actionIdRaw: string,
    valueRaw: string,
    client: pg.PoolClient,
  ): Promise<AgentActionRow | null> {
    const actionId = normalizeUuid(actionIdRaw, "actionId");
    const value = normalizeUuid(valueRaw, column);

    const sql = `
      UPDATE agent.actions
      SET ${column} = $2::uuid
      WHERE id = $1::uuid
        AND deleted_at IS NULL
      RETURNING *;
    `;

    const { rows } = await this.query<AgentActionRow>(client, sql, [actionId, value]);
    return rows[0] ?? null;
  }
}

function normalizeMaxAttempts(value: unknown): number {
  if (value === undefined || value === null) return 3;

  const n = Number(value);

  if (!Number.isInteger(n) || n < 0 || n > 25) {
    throw new Error("maxAttempts must be an integer between 0 and 25");
  }

  return n;
}