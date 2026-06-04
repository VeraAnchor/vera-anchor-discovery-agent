import type pg from "pg";
import {
  AgentRepoBase,
  normalizeHash,
  normalizeJsonObject,
  normalizeOptionalHash,
  normalizeOptionalHederaTransactionId,
  normalizeOptionalRef,
  normalizeOptionalString,
  normalizeOptionalUuid,
  normalizeUuid,
  randomUuid,
} from "./agentRepoUtils.js";

const RECEIPT_TYPE = new Set([
  "quote",
  "payment",
  "proof_export",
  "anchor",
  "verification",
  "mcp_result",
  "error",
]);

export type AgentReceiptType =
  | "quote"
  | "payment"
  | "proof_export"
  | "anchor"
  | "verification"
  | "mcp_result"
  | "error";

export type AgentReceiptRow = Readonly<{
  id: string;
  action_id: string | null;
  quote_id: string | null;
  payment_id: string | null;
  receipt_type: AgentReceiptType;
  receipt_hash: string;
  core_reference_id: string | null;
  core_reference_type: string | null;
  hcs_transaction_id: string | null;
  hcs_topic_id: string | null;
  explorer_url: string | null;
  artifact_uri: string | null;
  artifact_hash: string | null;
  payload: Record<string, unknown>;
  actor_ref: string | null;
  org_ref: string | null;
  request_id: string | null;
  idempotency_key: string | null;
  created_at: Date;
  deleted_at: Date | null;
}>;

function normalizeReceiptType(value: unknown): AgentReceiptType {
  const s = String(value ?? "").trim();

  if (!RECEIPT_TYPE.has(s)) {
    throw new Error(`Invalid receipt_type: ${s}`);
  }

  return s as AgentReceiptType;
}

export class AgentReceiptRepo extends AgentRepoBase {
  constructor({ pool }: { pool: pg.Pool }) {
    super({
      pool,
      tableName: "receipts",
    });
  }

  async createReceipt(
    input: {
      id?: string | null;
      actionId?: string | null;
      quoteId?: string | null;
      paymentId?: string | null;
      receiptType: AgentReceiptType;
      receiptHash: string;
      coreReferenceId?: string | null;
      coreReferenceType?: string | null;
      hcsTransactionId?: string | null;
      hcsTopicId?: string | null;
      explorerUrl?: string | null;
      artifactUri?: string | null;
      artifactHash?: string | null;
      payload: Record<string, unknown>;
      actorRef?: string | null;
      orgRef?: string | null;
      requestId?: string | null;
      idempotencyKey?: string | null;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentReceiptRow> {
    const id = input.id ? normalizeUuid(input.id, "id") : randomUuid();
    const actionId = normalizeOptionalUuid(input.actionId, "actionId");
    const quoteId = normalizeOptionalUuid(input.quoteId, "quoteId");
    const paymentId = normalizeOptionalUuid(input.paymentId, "paymentId");
    const receiptType = normalizeReceiptType(input.receiptType);
    const receiptHash = normalizeHash(input.receiptHash, "receipt_hash");
    const coreReferenceId = normalizeOptionalString(input.coreReferenceId, "coreReferenceId", 256);
    const coreReferenceType = normalizeOptionalString(input.coreReferenceType, "coreReferenceType", 128);
    const hcsTransactionId = normalizeOptionalHederaTransactionId(input.hcsTransactionId);
    const hcsTopicId = normalizeOptionalString(input.hcsTopicId, "hcsTopicId", 64);
    const explorerUrl = normalizeOptionalString(input.explorerUrl, "explorerUrl", 512);
    const artifactUri = normalizeOptionalString(input.artifactUri, "artifactUri", 1024);
    const artifactHash = normalizeOptionalHash(input.artifactHash, "artifact_hash");
    const payload = normalizeJsonObject(input.payload, "payload");
    const actorRef = normalizeOptionalRef(input.actorRef, "actorRef");
    const orgRef = normalizeOptionalRef(input.orgRef, "orgRef");
    const requestId = normalizeOptionalRef(input.requestId, "requestId");
    const idempotencyKey = normalizeOptionalString(input.idempotencyKey, "idempotencyKey", 256);

    const sql = `
      INSERT INTO agent.receipts (
        id,
        action_id,
        quote_id,
        payment_id,
        receipt_type,
        receipt_hash,
        core_reference_id,
        core_reference_type,
        hcs_transaction_id,
        hcs_topic_id,
        explorer_url,
        artifact_uri,
        artifact_hash,
        payload,
        actor_ref,
        org_ref,
        request_id,
        idempotency_key
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::uuid,
        $5::agent.receipt_type_domain,
        $6::text,
        $7::text,
        $8::text,
        $9::text,
        $10::text,
        $11::text,
        $12::text,
        $13::text,
        $14::jsonb,
        $15::text,
        $16::text,
        $17::text,
        $18::text
      )
      RETURNING *;
    `;

    try {
      const { rows } = await this.query<AgentReceiptRow>(
        client,
        sql,
        [
          id,
          actionId,
          quoteId,
          paymentId,
          receiptType,
          receiptHash,
          coreReferenceId,
          coreReferenceType,
          hcsTransactionId,
          hcsTopicId,
          explorerUrl,
          artifactUri,
          artifactHash,
          payload,
          actorRef,
          orgRef,
          requestId,
          idempotencyKey,
        ],
      );

      return rows[0];
    } catch (err) {
      this.mapUniqueViolation(err, "AGENT_RECEIPT_CONFLICT");
    }
  }

  async getById(
    id: string,
    { client }: { client: pg.PoolClient },
  ): Promise<AgentReceiptRow | null> {
    const receiptId = normalizeUuid(id, "id");

    const sql = `
      SELECT *
      FROM agent.receipts
      WHERE id = $1::uuid
        AND deleted_at IS NULL
      LIMIT 1;
    `;

    const { rows } = await this.query<AgentReceiptRow>(client, sql, [receiptId]);
    return rows[0] ?? null;
  }

  async getByHash(
    hashRaw: string,
    { client }: { client: pg.PoolClient },
  ): Promise<AgentReceiptRow | null> {
    const receiptHash = normalizeHash(hashRaw, "receipt_hash");

    const sql = `
      SELECT *
      FROM agent.receipts
      WHERE receipt_hash = $1::text
        AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1;
    `;

    const { rows } = await this.query<AgentReceiptRow>(client, sql, [receiptHash]);
    return rows[0] ?? null;
  }

  async getByActionAndType(
    input: { actionId: string; receiptType: AgentReceiptType },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentReceiptRow | null> {
    const actionId = normalizeUuid(input.actionId, "actionId");
    const receiptType = normalizeReceiptType(input.receiptType);

    const sql = `
      SELECT *
      FROM agent.receipts
      WHERE action_id = $1::uuid
        AND receipt_type = $2::agent.receipt_type_domain
        AND deleted_at IS NULL
      LIMIT 1;
    `;

    const { rows } = await this.query<AgentReceiptRow>(client, sql, [
      actionId,
      receiptType,
    ]);

    return rows[0] ?? null;
  }
}