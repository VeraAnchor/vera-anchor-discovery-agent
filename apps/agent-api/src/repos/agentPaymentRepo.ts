import type pg from "pg";
import {
  AgentRepoBase,
  normalizeAmountMinor,
  normalizeCurrency,
  normalizeHash,
  normalizeJsonObject,
  normalizeOptionalHash,
  normalizeOptionalHederaAccountId,
  normalizeOptionalHederaTransactionId,
  normalizeOptionalNetwork,
  normalizeOptionalRef,
  normalizeOptionalString,
  normalizeOptionalUuid,
  normalizeProvider,
  normalizeUuid,
  randomUuid,
} from "./agentRepoUtils.js";

const PAYMENT_STATUS = new Set([
  "created",
  "pending",
  "submitted",
  "verified",
  "failed",
  "expired",
  "cancelled",
]);

export type AgentPaymentStatus =
  | "created"
  | "pending"
  | "submitted"
  | "verified"
  | "failed"
  | "expired"
  | "cancelled";

export type AgentPaymentRow = Readonly<{
  id: string;
  action_id: string | null;
  quote_id: string | null;
  provider: string;
  provider_payment_id: string | null;
  status: AgentPaymentStatus;
  amount_minor: string | number | null;
  currency: string | null;
  network: string | null;
  payer_ref: string | null;
  payee_ref: string | null;
  transaction_reference: string | null;
  verification_reference: string | null;
  verification_attempts: number;
  last_verified_at: Date | null;
  verified_at: Date | null;
  payment_hash: string | null;
  metadata: Record<string, unknown>;
  actor_ref: string | null;
  org_ref: string | null;
  request_id: string | null;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date | null;
  deleted_at: Date | null;
}>;

function normalizePaymentStatus(value: unknown, fallback: AgentPaymentStatus): AgentPaymentStatus {
  const s = String(value ?? fallback).trim();

  if (!PAYMENT_STATUS.has(s)) {
    throw new Error(`Invalid payment status: ${s}`);
  }

  return s as AgentPaymentStatus;
}

export class AgentPaymentRepo extends AgentRepoBase {
  constructor({ pool }: { pool: pg.Pool }) {
    super({
      pool,
      tableName: "payment_transactions",
    });
  }

  async createPayment(
    input: {
      id?: string | null;
      actionId?: string | null;
      quoteId?: string | null;
      provider?: string;
      providerPaymentId?: string | null;
      status?: AgentPaymentStatus;
      amountMinor?: number | null;
      currency?: string | null;
      network?: string | null;
      payerRef?: string | null;
      payeeRef?: string | null;
      transactionReference?: string | null;
      verificationReference?: string | null;
      paymentHash?: string | null;
      metadata?: Record<string, unknown>;
      actorRef?: string | null;
      orgRef?: string | null;
      requestId?: string | null;
      idempotencyKey?: string | null;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentPaymentRow> {
    const id = input.id ? normalizeUuid(input.id, "id") : randomUuid();
    const actionId = normalizeOptionalUuid(input.actionId, "actionId");
    const quoteId = normalizeOptionalUuid(input.quoteId, "quoteId");
    const provider = normalizeProvider(input.provider, "hedera");
    const providerPaymentId = normalizeOptionalString(
      input.providerPaymentId,
      "providerPaymentId",
      256,
    );
    const status = normalizePaymentStatus(input.status, "submitted");
    const amountMinor =
      input.amountMinor === null || input.amountMinor === undefined
        ? null
        : normalizeAmountMinor(input.amountMinor);
    const currency = input.currency ? normalizeCurrency(input.currency) : null;
    const network = normalizeOptionalNetwork(input.network);
    const payerRef =
      normalizeOptionalHederaAccountId(input.payerRef, "payerRef") ??
      normalizeOptionalRef(input.payerRef, "payerRef");
    const payeeRef =
      normalizeOptionalHederaAccountId(input.payeeRef, "payeeRef") ??
      normalizeOptionalRef(input.payeeRef, "payeeRef");
    const transactionReference = normalizeOptionalHederaTransactionId(
      input.transactionReference,
    );
    const verificationReference = normalizeOptionalString(
      input.verificationReference,
      "verificationReference",
      256,
    );
    const paymentHash = normalizeOptionalHash(input.paymentHash, "payment_hash");
    const metadata = normalizeJsonObject(input.metadata, "metadata");
    const actorRef = normalizeOptionalRef(input.actorRef, "actorRef");
    const orgRef = normalizeOptionalRef(input.orgRef, "orgRef");
    const requestId = normalizeOptionalRef(input.requestId, "requestId");
    const idempotencyKey = normalizeOptionalString(input.idempotencyKey, "idempotencyKey", 256);

    const sql = `
      INSERT INTO agent.payment_transactions (
        id,
        action_id,
        quote_id,
        provider,
        provider_payment_id,
        status,
        amount_minor,
        currency,
        network,
        payer_ref,
        payee_ref,
        transaction_reference,
        verification_reference,
        payment_hash,
        metadata,
        actor_ref,
        org_ref,
        request_id,
        idempotency_key
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::text,
        $5::text,
        $6::agent.payment_status_domain,
        $7::bigint,
        $8::text,
        $9::text,
        $10::text,
        $11::text,
        $12::text,
        $13::text,
        $14::text,
        $15::jsonb,
        $16::text,
        $17::text,
        $18::text,
        $19::text
      )
      RETURNING *;
    `;

    try {
      const { rows } = await this.query<AgentPaymentRow>(
        client,
        sql,
        [
          id,
          actionId,
          quoteId,
          provider,
          providerPaymentId,
          status,
          amountMinor,
          currency,
          network,
          payerRef,
          payeeRef,
          transactionReference,
          verificationReference,
          paymentHash,
          metadata,
          actorRef,
          orgRef,
          requestId,
          idempotencyKey,
        ],
      );

      return rows[0];
    } catch (err) {
      this.mapUniqueViolation(err, "AGENT_PAYMENT_CONFLICT");
    }
  }

  async hasTransactionReference(
    transactionReferenceRaw: string,
    { client }: { client: pg.PoolClient },
  ): Promise<boolean> {
    const transactionReference = normalizeOptionalHederaTransactionId(transactionReferenceRaw);
    if (!transactionReference) return false;

    const sql = `
      SELECT 1
      FROM agent.payment_transactions
      WHERE transaction_reference = $1::text
        AND status IN ('submitted', 'verified')
        AND deleted_at IS NULL
      LIMIT 1;
    `;

    const { rowCount } = await this.query(client, sql, [transactionReference]);
    return Number(rowCount) > 0;
  }

  async getByProviderPaymentId(
    input: { provider?: string; providerPaymentId: string },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentPaymentRow | null> {
    const provider = normalizeProvider(input.provider, "hedera");
    const providerPaymentId = normalizeOptionalString(
      input.providerPaymentId,
      "providerPaymentId",
      256,
    );

    if (!providerPaymentId) return null;

    const sql = `
      SELECT *
      FROM agent.payment_transactions
      WHERE provider = $1::text
        AND provider_payment_id = $2::text
        AND deleted_at IS NULL
      LIMIT 1;
    `;

    const { rows } = await this.query<AgentPaymentRow>(client, sql, [
      provider,
      providerPaymentId,
    ]);

    return rows[0] ?? null;
  }

  async markVerified(
    input: {
      id: string;
      verificationReference?: string | null;
      paymentHash?: string | null;
      metadata?: Record<string, unknown>;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentPaymentRow | null> {
    const id = normalizeUuid(input.id, "id");
    const verificationReference = normalizeOptionalString(
      input.verificationReference,
      "verificationReference",
      256,
    );
    const paymentHash = normalizeOptionalHash(input.paymentHash, "payment_hash");
    const metadata = normalizeJsonObject(input.metadata, "metadata");

    const sql = `
      UPDATE agent.payment_transactions
      SET
        status = 'verified',
        verification_reference = COALESCE($2::text, verification_reference),
        payment_hash = COALESCE($3::text, payment_hash),
        metadata = metadata || $4::jsonb,
        verification_attempts = verification_attempts + 1,
        last_verified_at = now(),
        verified_at = now()
      WHERE id = $1::uuid
        AND deleted_at IS NULL
      RETURNING *;
    `;

    const { rows } = await this.query<AgentPaymentRow>(client, sql, [
      id,
      verificationReference,
      paymentHash,
      metadata,
    ]);

    return rows[0] ?? null;
  }

  async markFailed(
    input: {
      id: string;
      metadata?: Record<string, unknown>;
    },
    { client }: { client: pg.PoolClient },
  ): Promise<AgentPaymentRow | null> {
    const id = normalizeUuid(input.id, "id");
    const metadata = normalizeJsonObject(input.metadata, "metadata");

    const sql = `
      UPDATE agent.payment_transactions
      SET
        status = 'failed',
        metadata = metadata || $2::jsonb,
        verification_attempts = verification_attempts + 1,
        last_verified_at = now()
      WHERE id = $1::uuid
        AND deleted_at IS NULL
      RETURNING *;
    `;

    const { rows } = await this.query<AgentPaymentRow>(client, sql, [id, metadata]);
    return rows[0] ?? null;
  }
}