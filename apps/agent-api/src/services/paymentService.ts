// apps/agent-api/src/services/paymentService.ts

import crypto from "node:crypto";
import { config } from "../config.js";
import { agentDbPool } from "../db/db.js";
import { createAgentRepos } from "../repos/agentRepos.js";
import {
  AgentRepoError,
  type AgentTxClient,
  withAgentTransaction,
} from "../repos/agentRepoUtils.js";
import type { AgentActionRow } from "../repos/agentActionRepo.js";
import type { AgentQuoteRow } from "../repos/agentQuoteRepo.js";
import type { AgentPaymentRow } from "../repos/agentPaymentRepo.js";
import type { PaymentVerification } from "../types.js";
import type { AgentServiceContext } from "./agentServiceContext.js";
import { assertActionPayable } from "./quoteService.js";

const repos = createAgentRepos(agentDbPool);

const PAYMENT_PROVIDER = "hedera";
const PAYMENT_TOKEN = "HBAR" as const;
const VERIFIED_MODE_DEMO = "demo" as const;

export type PaymentVerificationInput = Readonly<{
  actionId: string;
  paymentTransactionId: string;
  payerAccountId?: string | null;
}>;

export type PaymentVerificationResult =
  | Readonly<{
      ok: true;
      payment: PaymentVerification;
      payment_id: string;
    }>
  | Readonly<{
      ok: false;
      code: string;
      status: number;
    }>;

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function rejectControlChars(value: string, field: string): void {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throwHttp(`${field.toUpperCase()}_CONTAINS_CONTROL_CHARACTERS`, 400);
  }
}

function normalizeActionId(value: unknown): string {
  const s = cleanString(value);

  if (!s) {
    throwHttp("ACTION_ID_REQUIRED", 400);
  }

  rejectControlChars(s, "action_id");

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      s,
    )
  ) {
    throwHttp("INVALID_ACTION_ID", 400);
  }

  return s;
}

function normalizePaymentTransactionId(value: unknown): string {
  const s = cleanString(value);

  if (!s) {
    throwHttp("PAYMENT_TRANSACTION_ID_REQUIRED", 400);
  }

  rejectControlChars(s, "payment_transaction_id");

  if (s.length > 128) {
    throwHttp("PAYMENT_TRANSACTION_ID_TOO_LONG", 400);
  }

  return s;
}

function normalizePayerAccountId(value: unknown): string | null {
  const s = cleanString(value);

  if (!s) return null;

  rejectControlChars(s, "payer_account_id");

  if (!/^0\.0\.\d+$/.test(s)) {
    throwHttp("INVALID_PAYER_ACCOUNT_ID", 400);
  }

  return s;
}

function looksLikeHederaTransactionId(value: string): boolean {
  return /^0\.0\.\d+@\d+\.\d{1,9}$/.test(value);
}

function throwHttp(message: string, status: number): never {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  throw err;
}

function toFailure(err: unknown, fallbackCode = "PAYMENT_VERIFICATION_FAILED"): {
  ok: false;
  code: string;
  status: number;
} {
  const e = err as Error & { status?: number; code?: string };

  if (e instanceof AgentRepoError && e.code === "AGENT_PAYMENT_CONFLICT") {
    return {
      ok: false,
      code: "PAYMENT_TRANSACTION_ALREADY_USED",
      status: 409,
    };
  }

  return {
    ok: false,
    code: e?.message || e?.code || fallbackCode,
    status: e?.status || 400,
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;

    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortJson(obj[key]);
        return acc;
      }, {});
  }

  return value;
}

function sha3_512Json(value: unknown): string {
  return crypto.createHash("sha3-512").update(stableStringify(value)).digest("hex");
}

function amountMinorToHbar(amountMinorRaw: string | number | bigint | null): string {
  const amountMinor = BigInt(String(amountMinorRaw ?? "0"));
  const whole = amountMinor / 100_000_000n;
  const frac = amountMinor % 100_000_000n;

  if (frac === 0n) {
    return whole.toString();
  }

  return `${whole.toString()}.${frac.toString().padStart(8, "0").replace(/0+$/g, "")}`;
}

function quotePayloadString(
  quote: AgentQuoteRow,
  key: string,
  fallback: string,
): string {
  const value = quote.quote_payload?.[key];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return fallback;
}

function getQuoteAmount(quote: AgentQuoteRow): string {
  return quotePayloadString(quote, "amount", amountMinorToHbar(quote.amount_minor));
}

function getQuoteRecipientAccountId(quote: AgentQuoteRow): string {
  return quotePayloadString(quote, "recipient_account_id", config.treasuryAccountId);
}

function getQuoteNetwork(quote: AgentQuoteRow): string {
  return quote.network || config.hederaNetwork;
}

function buildPaymentHash(input: {
  action: AgentActionRow;
  quote: AgentQuoteRow;
  paymentTransactionId: string;
  payerAccountId: string | null;
  verifiedMode: string;
}): string {
  return sha3_512Json({
    action_id: input.action.id,
    quote_id: input.quote.id,
    action_type: input.action.action_type,
    input_hash: input.action.input_hash,
    quote_hash: input.quote.quote_hash,
    payment_transaction_id: input.paymentTransactionId,
    payer_account_id: input.payerAccountId,
    amount_minor: input.quote.amount_minor,
    currency: input.quote.currency,
    network: getQuoteNetwork(input.quote),
    recipient_account_id: getQuoteRecipientAccountId(input.quote),
    verified_mode: input.verifiedMode,
  });
}

async function loadPayableActionAndQuote(
  actionId: string,
  client: AgentTxClient,
): Promise<{
  action: AgentActionRow;
  quote: AgentQuoteRow;
}> {
  const action = await repos.actions.getByIdForUpdate(actionId, { client });

  assertActionPayable(action);

  if (!action) {
    throwHttp("ACTION_NOT_FOUND", 404);
  }

  const quote =
    action.quote_id != null
      ? await repos.quotes.getById(action.quote_id, { client })
      : await repos.quotes.getActiveByActionId(action.id, { client });

  if (!quote) {
    throwHttp("ACTIVE_QUOTE_NOT_FOUND", 404);
  }

  if (quote.status !== "active") {
    throwHttp(`QUOTE_NOT_ACTIVE:${quote.status}`, 409);
  }

  if (Date.now() > new Date(quote.expires_at).getTime()) {
    await repos.quotes.markExpired(quote.id, { client });
    await repos.actions.markStatus(
      {
        id: action.id,
        status: "expired",
        errorCode: "QUOTE_EXPIRED",
        errorMessage: "Quote expired before payment verification.",
      },
      { client },
    );

    throwHttp("QUOTE_EXPIRED", 410);
  }

  return {
    action,
    quote,
  };
}

async function createFailedPaymentAttempt(input: {
  action: AgentActionRow;
  quote: AgentQuoteRow;
  paymentTransactionId: string;
  payerAccountId: string | null;
  code: string;
  client: AgentTxClient;
}): Promise<void> {
  await repos.payments.createPayment(
    {
      actionId: input.action.id,
      quoteId: input.quote.id,
      provider: PAYMENT_PROVIDER,
      providerPaymentId: input.paymentTransactionId,
      status: "failed",
      amountMinor: Number(input.quote.amount_minor),
      currency: input.quote.currency,
      network: getQuoteNetwork(input.quote),
      payerRef: input.payerAccountId,
      payeeRef: getQuoteRecipientAccountId(input.quote),
      transactionReference: looksLikeHederaTransactionId(input.paymentTransactionId)
        ? input.paymentTransactionId
        : null,
      metadata: {
        error_code: input.code,
        verified_mode: config.demoPaymentMode ? VERIFIED_MODE_DEMO : "real",
      },
      actorRef: input.action.actor_ref,
      orgRef: input.action.org_ref,
      requestId: input.action.request_id,
      idempotencyKey: null,
    },
    { client: input.client },
  );
}

export async function verifyPaymentForAction(
  input: PaymentVerificationInput,
  context: AgentServiceContext,
): Promise<PaymentVerificationResult> {
  try {
    const actionId = normalizeActionId(input.actionId);
    const paymentTransactionId = normalizePaymentTransactionId(
      input.paymentTransactionId,
    );
    const payerAccountId = normalizePayerAccountId(input.payerAccountId);

    return await withAgentTransaction(agentDbPool, context, async (client) => {
      const { action, quote } = await loadPayableActionAndQuote(actionId, client);

      /*
       * Advisory precheck only.
       *
       * This can miss rows hidden by RLS from another actor, so the real replay
       * protection is the DB unique index on (provider, provider_payment_id).
       */
      const existing = await repos.payments.getByProviderPaymentId(
        {
          provider: PAYMENT_PROVIDER,
          providerPaymentId: paymentTransactionId,
        },
        { client },
      );

      if (existing) {
        return {
          ok: false,
          code: "PAYMENT_TRANSACTION_ALREADY_USED",
          status: 409,
        } as const;
      }

      if (config.demoPaymentMode) {
        if (!looksLikeHederaTransactionId(paymentTransactionId)) {
          await createFailedPaymentAttempt({
            action,
            quote,
            paymentTransactionId,
            payerAccountId,
            code: "INVALID_DEMO_PAYMENT_TRANSACTION_ID",
            client,
          });

          return {
            ok: false,
            code: "INVALID_DEMO_PAYMENT_TRANSACTION_ID",
            status: 400,
          } as const;
        }

        const paymentHash = buildPaymentHash({
          action,
          quote,
          paymentTransactionId,
          payerAccountId,
          verifiedMode: VERIFIED_MODE_DEMO,
        });

        const submittedPayment = await repos.payments.createPayment(
          {
            actionId: action.id,
            quoteId: quote.id,
            provider: PAYMENT_PROVIDER,
            providerPaymentId: paymentTransactionId,
            status: "submitted",
            amountMinor: Number(quote.amount_minor),
            currency: quote.currency,
            network: getQuoteNetwork(quote),
            payerRef: payerAccountId,
            payeeRef: getQuoteRecipientAccountId(quote),
            transactionReference: paymentTransactionId,
            verificationReference: paymentTransactionId,
            paymentHash,
            metadata: {
              verified_mode: VERIFIED_MODE_DEMO,
              quote_hash: quote.quote_hash,
              action_input_hash: action.input_hash,
            },
            actorRef: action.actor_ref,
            orgRef: action.org_ref,
            requestId: action.request_id,
            idempotencyKey: null,
          },
          { client },
        );

        const verifiedPayment = await repos.payments.markVerified(
          {
            id: submittedPayment.id,
            verificationReference: paymentTransactionId,
            paymentHash,
            metadata: {
              verified_mode: VERIFIED_MODE_DEMO,
              verified_by: "agent-payment-service",
            },
          },
          { client },
        );

        const payment = verifiedPayment ?? submittedPayment;

        await repos.quotes.markAccepted(quote.id, { client });

        await repos.actions.attachPayment(
          {
            actionId: action.id,
            paymentId: payment.id,
          },
          { client },
        );

        await repos.actions.markStatus(
          {
            id: action.id,
            status: "payment_verified",
          },
          { client },
        );

        return {
          ok: true,
          payment_id: payment.id,
          payment: {
            transaction_id: paymentTransactionId,
            payer_account_id: payerAccountId,
            amount: getQuoteAmount(quote),
            token: PAYMENT_TOKEN,
            network: getQuoteNetwork(quote),
            recipient_account_id: getQuoteRecipientAccountId(quote),
            verified_mode: VERIFIED_MODE_DEMO,
          },
        } as const;
      }

      /*
       * Real verification placeholder.
       *
       * This should later verify against Hedera Mirror / Agent Kit / x402 facilitator:
       * - transaction exists and is final
       * - network matches quote
       * - recipient matches quote recipient_account_id
       * - amount >= quote amount
       * - token/currency matches quote currency
       * - memo or facilitator metadata binds to action.id / action.input_hash
       * - transaction has not been reused
       */
      await createFailedPaymentAttempt({
        action,
        quote,
        paymentTransactionId,
        payerAccountId,
        code: "REAL_PAYMENT_VERIFICATION_NOT_IMPLEMENTED",
        client,
      });

      return {
        ok: false,
        code: "REAL_PAYMENT_VERIFICATION_NOT_IMPLEMENTED",
        status: 501,
      } as const;
    });
  } catch (err) {
    return toFailure(err);
  }
}