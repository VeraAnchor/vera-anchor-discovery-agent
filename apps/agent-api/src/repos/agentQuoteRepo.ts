import type pg from "pg";
import {
  AgentRepoBase,
  normalizeAmountMinor,
  normalizeCurrency,
  normalizeFutureDate,
  normalizeHash,
  normalizeJsonObject,
  normalizeOptionalNetwork,
  normalizeOptionalRef,
  normalizeOptionalString,
  normalizeOptionalUuid,
  normalizeProvider,
  normalizeUuid,
  randomUuid,
} from "./agentRepoUtils.js";

const QUOTE_STATUS = new Set([
  "created",
  "active",
  "accepted",
  "expired",
  "cancelled",
  "failed",
]);

export type AgentQuoteStatus =
  | "created"
  | "active"
  | "accepted"
  | "expired"
  | "cancelled"
  | "failed";

export type AgentQuoteRow = Readonly<{
  id: string;
  action_id: string | null;
  status: AgentQuoteStatus;
  quote_kind: string;
  provider: string;
  amount_minor: string | number;
  currency: string;
  network: string | null;
  quote_hash: string;
  quote_payload: Record<string, unknown>;
  actor_ref: string | null;
  org_ref: string | null;
  request_id: string | null;
  idempotency_key: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
  deleted_at: Date | null;
}>;

function normalizeQuoteStatus(value: unknown, fallback: AgentQuoteStatus): AgentQuoteStatus {
  const s = String(value ?? fallback).trim();

  if (!QUOTE_STATUS.has(s)) {
    throw new Error(`Invalid quote status: ${s}`);
  }

  return s as AgentQuoteStatus;
}

export class AgentQuoteRepo extends AgentRepoBase {
  constructor({ pool }: { pool: pg.Pool }) {
    super({
      pool,
      tableName: "quotes",
    });
  }

  async createQuote(
    input: {
      id?: string | null;
      actionId?: string | null;
      status?: AgentQuoteStatus;
      quoteKind?: string;
      provider?: string;
      amountMinor: number;
      currency: string;
      network?: string | null;
      quoteHash: string;
      quotePayload: Record<string, unknown>;
      actorRef?: string | null;
      orgRef?: string | null;
      requestId?: string | null;
      idempotencyKey?: string | null;
      expiresAt: string | Date;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentQuoteRow> {
    const id = input.id ? normalizeUuid(input.id, "id") : randomUuid();
    const actionId = normalizeOptionalUuid(input.actionId, "actionId");
    const status = normalizeQuoteStatus(input.status, "active");
    const quoteKind = normalizeProvider(input.quoteKind, "proof_export");
    const provider = normalizeProvider(input.provider, "vera_anchor");
    const amountMinor = normalizeAmountMinor(input.amountMinor);
    const currency = normalizeCurrency(input.currency);
    const network = normalizeOptionalNetwork(input.network);
    const quoteHash = normalizeHash(input.quoteHash, "quote_hash");
    const quotePayload = normalizeJsonObject(input.quotePayload, "quote_payload");
    const actorRef = normalizeOptionalRef(input.actorRef, "actorRef");
    const orgRef = normalizeOptionalRef(input.orgRef, "orgRef");
    const requestId = normalizeOptionalRef(input.requestId, "requestId");
    const idempotencyKey = normalizeOptionalString(input.idempotencyKey, "idempotencyKey", 256);
    const expiresAt = normalizeFutureDate(input.expiresAt, "expiresAt");

    const sql = `
      INSERT INTO agent.quotes (
        id,
        action_id,
        status,
        quote_kind,
        provider,
        amount_minor,
        currency,
        network,
        quote_hash,
        quote_payload,
        actor_ref,
        org_ref,
        request_id,
        idempotency_key,
        expires_at
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::agent.quote_status_domain,
        $4::text,
        $5::text,
        $6::bigint,
        $7::text,
        $8::text,
        $9::text,
        $10::jsonb,
        $11::text,
        $12::text,
        $13::text,
        $14::text,
        $15::timestamptz
      )
      RETURNING *;
    `;

    try {
      const { rows } = await this.query<AgentQuoteRow>(
        client,
        sql,
        [
          id,
          actionId,
          status,
          quoteKind,
          provider,
          amountMinor,
          currency,
          network,
          quoteHash,
          quotePayload,
          actorRef,
          orgRef,
          requestId,
          idempotencyKey,
          expiresAt,
        ],
      );

      return rows[0];
    } catch (err) {
      this.mapUniqueViolation(err, "AGENT_QUOTE_CONFLICT");
    }
  }

  async getById(
    id: string,
    { client }: { client: pg.PoolClient },
  ): Promise<AgentQuoteRow | null> {
    const quoteId = normalizeUuid(id, "id");

    const sql = `
      SELECT *
      FROM agent.quotes
      WHERE id = $1::uuid
        AND deleted_at IS NULL
      LIMIT 1;
    `;

    const { rows } = await this.query<AgentQuoteRow>(client, sql, [quoteId]);
    return rows[0] ?? null;
  }

  async getActiveByActionId(
    actionIdRaw: string,
    { client }: { client: pg.PoolClient },
  ): Promise<AgentQuoteRow | null> {
    const actionId = normalizeUuid(actionIdRaw, "actionId");

    const sql = `
      SELECT *
      FROM agent.quotes
      WHERE action_id = $1::uuid
        AND status = 'active'
        AND expires_at > now()
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1;
    `;

    const { rows } = await this.query<AgentQuoteRow>(client, sql, [actionId]);
    return rows[0] ?? null;
  }

  async markAccepted(
    id: string,
    { client }: { client: pg.PoolClient },
  ): Promise<AgentQuoteRow | null> {
    return this.markStatus(id, "accepted", client);
  }

  async markExpired(
    id: string,
    { client }: { client: pg.PoolClient },
  ): Promise<AgentQuoteRow | null> {
    return this.markStatus(id, "expired", client);
  }

  private async markStatus(
    idRaw: string,
    status: AgentQuoteStatus,
    client: pg.PoolClient,
  ): Promise<AgentQuoteRow | null> {
    const id = normalizeUuid(idRaw, "id");

    const sql = `
      UPDATE agent.quotes
      SET
        status = $2::agent.quote_status_domain,
        accepted_at = CASE
          WHEN $2::text = 'accepted' THEN now()
          ELSE accepted_at
        END
      WHERE id = $1::uuid
        AND deleted_at IS NULL
      RETURNING *;
    `;

    const { rows } = await this.query<AgentQuoteRow>(client, sql, [id, status]);
    return rows[0] ?? null;
  }
}