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
import { readHederaMirrorTransaction } from "../hedera/hederaAgentKitReadAdapter.js";

const repos = createAgentRepos(agentDbPool);

const PAYMENT_PROVIDER = "hedera";
const PAYMENT_TOKEN = "HBAR" as const;
const VERIFIED_MODE_DEMO = "demo" as const;
const VERIFIED_MODE_MIRROR = "mirror" as const;

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

function amountMinorToBigInt(amountMinorRaw: string | number | bigint | null): bigint {
  return BigInt(String(amountMinorRaw ?? "0"));
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

function getQuotePaymentMemo(action: AgentActionRow, quote: AgentQuoteRow): string {
  return quotePayloadString(quote, "payment_memo", `vera-agent:${action.id}`);
}

function getQuoteNetwork(quote: AgentQuoteRow): string {
  return quote.network || config.hederaNetwork;
}

function getQuoteActionInputHash(quote: AgentQuoteRow): string | null {
  return quotePayloadString(quote, "action_input_hash", "");
}

function getQuoteInputHash(quote: AgentQuoteRow): string | null {
  return quotePayloadString(quote, "input_hash", "");
}

function getQuoteEvidenceSnapshotHash(quote: AgentQuoteRow): string | null {
  return quotePayloadString(quote, "evidence_snapshot_hash", "");
}

function actionMetadataString(
  action: AgentActionRow,
  key: string,
): string | null {
  const value = action.metadata?.[key];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function assertQuoteBoundToAction(input: {
  action: AgentActionRow;
  quote: AgentQuoteRow;
}): void {
  const quoteActionId = quotePayloadString(input.quote, "action_id", "");

  if (quoteActionId && quoteActionId !== input.action.id) {
    throwHttp("QUOTE_ACTION_ID_MISMATCH", 409);
  }

  const quoteActionType = quotePayloadString(input.quote, "action_type", "");

  if (quoteActionType && quoteActionType !== input.action.action_type) {
    throwHttp("QUOTE_ACTION_TYPE_MISMATCH", 409);
  }

  const quoteActionInputHash = getQuoteActionInputHash(input.quote);
  const quoteInputHash = getQuoteInputHash(input.quote);

  if (
    quoteActionInputHash &&
    input.action.input_hash &&
    quoteActionInputHash !== input.action.input_hash
  ) {
    throwHttp("QUOTE_ACTION_INPUT_HASH_MISMATCH", 409);
  }

  if (
    quoteInputHash &&
    input.action.input_hash &&
    quoteInputHash !== input.action.input_hash
  ) {
    throwHttp("QUOTE_INPUT_HASH_MISMATCH", 409);
  }

  const actionEvidenceSnapshotHash = actionMetadataString(
    input.action,
    "evidence_snapshot_hash",
  );
  const quoteEvidenceSnapshotHash = getQuoteEvidenceSnapshotHash(input.quote);

  if (
    actionEvidenceSnapshotHash &&
    quoteEvidenceSnapshotHash &&
    actionEvidenceSnapshotHash !== quoteEvidenceSnapshotHash
  ) {
    throwHttp("QUOTE_EVIDENCE_SNAPSHOT_HASH_MISMATCH", 409);
  }

  const actionNetwork = actionMetadataString(input.action, "network");

  if (actionNetwork && actionNetwork !== getQuoteNetwork(input.quote)) {
    throwHttp("QUOTE_NETWORK_MISMATCH", 409);
  }

  const actionRecipient = actionMetadataString(
    input.action,
    "recipient_account_id",
  );

  if (actionRecipient && actionRecipient !== getQuoteRecipientAccountId(input.quote)) {
    throwHttp("QUOTE_RECIPIENT_MISMATCH", 409);
  }

  const actionAmount = actionMetadataString(input.action, "quote_amount");

  if (actionAmount && actionAmount !== getQuoteAmount(input.quote)) {
    throwHttp("QUOTE_AMOUNT_MISMATCH", 409);
  }
}

function buildPaymentHash(input: {
  action: AgentActionRow;
  quote: AgentQuoteRow;
  paymentTransactionId: string;
  payerAccountId: string | null;
  verifiedMode: string;
  receivedAmountMinor?: string | null;
  memo?: string | null;
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
    received_amount_minor: input.receivedAmountMinor ?? null,
    memo: input.memo ?? null,
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

  assertQuoteBoundToAction({ action, quote });
  
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
        verified_mode: config.paymentVerificationMode,
      },
      actorRef: input.action.actor_ref,
      orgRef: input.action.org_ref,
      requestId: input.action.request_id,
      idempotencyKey: null,
    },
    { client: input.client },
  );
}

function optionalString(value: unknown): string | null {
  const s = cleanString(value);
  return s || null;
}

function transactionPayerAccountId(transactionId: string): string {
  const payer = transactionId.split("@")[0];

  if (!/^0\.0\.\d+$/.test(payer)) {
    throwHttp("INVALID_PAYMENT_TRANSACTION_PAYER", 400);
  }

  return payer;
}

function decodeMemoBase64(value: unknown): string | null {
  const s = optionalString(value);

  if (!s) return null;

  try {
    const decoded = Buffer.from(s, "base64").toString("utf8").trim();
    return decoded || null;
  } catch {
    return null;
  }
}

function mirrorTransactionMemo(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null;

  return optionalString(raw.memo) ?? decodeMemoBase64(raw.memo_base64);
}

function mirrorTransfers(raw: Record<string, unknown> | null): Record<string, unknown>[] {
  const transfers = raw?.transfers;

  if (!Array.isArray(transfers)) {
    return [];
  }

  return transfers.filter(
    (transfer): transfer is Record<string, unknown> =>
      Boolean(transfer) &&
      typeof transfer === "object" &&
      !Array.isArray(transfer),
  );
}

function transferAccountId(transfer: Record<string, unknown>): string | null {
  return optionalString(transfer.account) ?? optionalString(transfer.account_id);
}

function transferAmountTinybars(transfer: Record<string, unknown>): bigint {
  const raw = transfer.amount;

  if (typeof raw === "bigint") return raw;

  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw)) {
      throwHttp("INVALID_MIRROR_TRANSFER_AMOUNT", 502);
    }

    return BigInt(raw);
  }

  const s = cleanString(raw);

  if (!/^-?\d+$/.test(s)) {
    throwHttp("INVALID_MIRROR_TRANSFER_AMOUNT", 502);
  }

  return BigInt(s);
}

function receivedTinybarsByAccount(
  raw: Record<string, unknown> | null,
  accountId: string,
): bigint {
  let total = 0n;

  for (const transfer of mirrorTransfers(raw)) {
    if (transferAccountId(transfer) !== accountId) continue;

    const amount = transferAmountTinybars(transfer);

    if (amount > 0n) {
      total += amount;
    }
  }

  return total;
}

async function verifyMirrorHbarPayment(input: {
  action: AgentActionRow;
  quote: AgentQuoteRow;
  paymentTransactionId: string;
  payerAccountId: string | null;
}): Promise<{
  paymentHash: string;
  payment: PaymentVerification;
  metadata: Record<string, unknown>;
}> {
  const transaction = await readHederaMirrorTransaction({
    transactionId: input.paymentTransactionId,
  });

  if (!transaction.found) {
    throwHttp("PAYMENT_TRANSACTION_NOT_FOUND_ON_MIRROR", 404);
  }

  if (transaction.result !== "SUCCESS") {
    throwHttp(`PAYMENT_TRANSACTION_NOT_SUCCESS:${transaction.result ?? "unknown"}`, 402);
  }

  const quoteNetwork = getQuoteNetwork(input.quote);

  if (transaction.network !== quoteNetwork) {
    throwHttp("PAYMENT_NETWORK_MISMATCH", 400);
  }

  const transactionPayer = transactionPayerAccountId(input.paymentTransactionId);

  if (input.payerAccountId && input.payerAccountId !== transactionPayer) {
    throwHttp("PAYMENT_PAYER_ACCOUNT_MISMATCH", 402);
  }

  const resolvedPayerAccountId = input.payerAccountId ?? transactionPayer;

  const expectedRecipient = getQuoteRecipientAccountId(input.quote);
  const expectedAmountMinor = amountMinorToBigInt(input.quote.amount_minor);
  const receivedAmountMinor = receivedTinybarsByAccount(
    transaction.raw,
    expectedRecipient,
  );

  if (receivedAmountMinor !== expectedAmountMinor) {
    throwHttp("PAYMENT_AMOUNT_MISMATCH", 402);
  }

  const expectedMemo = getQuotePaymentMemo(input.action, input.quote);
  const actualMemo = mirrorTransactionMemo(transaction.raw);

  if (actualMemo !== expectedMemo) {
    throwHttp("PAYMENT_MEMO_MISMATCH", 402);
  }

  const paymentHash = buildPaymentHash({
    action: input.action,
    quote: input.quote,
    paymentTransactionId: input.paymentTransactionId,
    payerAccountId: resolvedPayerAccountId,
    verifiedMode: VERIFIED_MODE_MIRROR,
    receivedAmountMinor: receivedAmountMinor.toString(),
    memo: actualMemo,
  });

  const metadata = {
    verified_mode: VERIFIED_MODE_MIRROR,
    verified_by: "hedera-mirror-node",
    quote_hash: input.quote.quote_hash,
    action_input_hash: input.action.input_hash,
    mirror_transaction_id: transaction.transaction_id,
    mirror_normalized_transaction_id: transaction.normalized_transaction_id,
    mirror_consensus_timestamp: transaction.consensus_timestamp,
    mirror_transaction_result: transaction.result,
    mirror_transaction_name: transaction.name,
    resolved_payer_account_id: resolvedPayerAccountId,
    expected_recipient_account_id: expectedRecipient,
    expected_amount_minor: expectedAmountMinor.toString(),
    received_amount_minor: receivedAmountMinor.toString(),
    expected_memo: expectedMemo,
    actual_memo: actualMemo,
  };

  return {
    paymentHash,
    metadata,
    payment: {
      transaction_id: input.paymentTransactionId,
      payer_account_id: resolvedPayerAccountId,
      amount: getQuoteAmount(input.quote),
      token: PAYMENT_TOKEN,
      network: quoteNetwork,
      recipient_account_id: expectedRecipient,
      verified_mode: VERIFIED_MODE_MIRROR,
    },
  };
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
    const verificationMode = config.paymentVerificationMode;

    return await withAgentTransaction(agentDbPool, context, async (client) => {
      const { action, quote } = await loadPayableActionAndQuote(actionId, client);

      /*
       * Advisory precheck only.
       *
       * This can miss rows hidden by RLS from another actor, so the authoritative replay
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

      if (verificationMode === VERIFIED_MODE_DEMO) {
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
          receivedAmountMinor: String(quote.amount_minor),
          memo: getQuotePaymentMemo(action, quote),
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

      if (verificationMode === "disabled") {
        return {
          ok: false,
          code: "PAYMENT_VERIFICATION_DISABLED",
          status: 403,
        } as const;
      }

      const mirror = await verifyMirrorHbarPayment({
        action,
        quote,
        paymentTransactionId,
        payerAccountId,
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
          payerRef: mirror.payment.payer_account_id,
          payeeRef: getQuoteRecipientAccountId(quote),
          transactionReference: paymentTransactionId,
          verificationReference: paymentTransactionId,
          paymentHash: mirror.paymentHash,
          metadata: mirror.metadata,
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
          paymentHash: mirror.paymentHash,
          metadata: {
            ...mirror.metadata,
            verified_at_source: "hedera_mirror_node",
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
        payment: mirror.payment,
      } as const;
    });
  } catch (err) {
    return toFailure(err);
  }
}