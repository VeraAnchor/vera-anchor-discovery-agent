// apps/agent-api/src/services/proofExecutionService.ts

import crypto from "node:crypto";
import {
  buildProofBundle,
  buildProofCard,
  evidenceLinksFromRecord,
  evidenceSubjectFromRecord,
} from "@vera-discovery/proof-core";
import { config } from "../config.js";
import { agentDbPool } from "../db/db.js";
import { createAgentRepos } from "../repos/agentRepos.js";
import { withAgentTransaction } from "../repos/agentRepoUtils.js";
import type { AgentActionRow } from "../repos/agentActionRepo.js";
import type { AgentPaymentRow } from "../repos/agentPaymentRepo.js";
import type { AgentReceiptRow } from "../repos/agentReceiptRepo.js";
import type { PaymentVerification } from "../types.js";
import type { AgentServiceContext } from "./agentServiceContext.js";
import { getEvidencePreview } from "./evidenceService.js";
import { verifyPaymentForAction } from "./paymentService.js";

const repos = createAgentRepos(agentDbPool);

const RECEIPT_TYPE = "proof_export" as const;
const PAYMENT_TOKEN = "HBAR" as const;
const VERIFIED_MODE_MIRROR = "mirror" as const;

type ProofCoreAction = Readonly<{
  id: string;
  action_type: string;
  status: string;
  subject_type: string;
  subject_id: string;
  network: string;
  quote_amount: string;
  quote_token: typeof PAYMENT_TOKEN;
  recipient_account_id: string;
  evidence_snapshot_hash: string;
  action_input_hash: string;
  input_hash: string;
  payment_transaction_id: string;
  output_hash: string | null;
  created_at: string;
  expires_at: string | null;
  completed_at: string | null;
}>;

export type ExecuteProofBundleInput = Readonly<{
  actionId: string;
  paymentTransactionId: string;
  payerAccountId?: string | null;
}>;

export type ExecuteProofBundleResult = Readonly<{
  status: "completed";
  action_id: string;
  payment_id: string | null;
  proof_bundle_id: string;
  proof_bundle_hash: string;
  proof_card_hash: string | null;
  proof_bundle_url: string;
  proof_card_url: string;
  verify_url: string;
  receipt: AgentReceiptRow;
}>;

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function rejectControlChars(value: string, field: string): void {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throwHttp(`${field.toUpperCase()}_CONTAINS_CONTROL_CHARACTERS`, 400);
  }
}

function throwHttp(message: string, status: number): never {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  throw err;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeUuid(value: unknown, field: string): string {
  const s = cleanString(value).toLowerCase();

  if (!s) {
    throwHttp(`${field.toUpperCase()}_REQUIRED`, 400);
  }

  rejectControlChars(s, field);

  if (!UUID_RE.test(s)) {
    throwHttp(`INVALID_${field.toUpperCase()}`, 400);
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

function normalizeContextRef(value: unknown, field: string): string | null {
  const s = cleanString(value);

  if (!s) return null;

  rejectControlChars(s, field);

  if (s.length > 256) {
    throwHttp(`${field.toUpperCase()}_TOO_LONG`, 400);
  }

  return s;
}

function normalizeServiceContext(context: AgentServiceContext): Required<AgentServiceContext> {
  return {
    actorRef: normalizeContextRef(context.actorRef, "actor_ref"),
    orgRef: normalizeContextRef(context.orgRef, "org_ref"),
    requestId: normalizeContextRef(context.requestId, "request_id"),
    systemScope: Boolean(context.systemScope),
  };
}

function metadataString(
  metadata: Record<string, unknown>,
  key: string,
  fallback?: string | null,
): string {
  const value = metadata[key];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (fallback && fallback.trim()) {
    return fallback.trim();
  }

  throwHttp(`ACTION_METADATA_MISSING:${key}`, 500);
}

function metadataHbarToken(
  metadata: Record<string, unknown>,
  key: string,
  fallback: typeof PAYMENT_TOKEN = PAYMENT_TOKEN,
): typeof PAYMENT_TOKEN {
  const value = metadata[key];

  if (typeof value === "string" && value.trim().toUpperCase() === PAYMENT_TOKEN) {
    return PAYMENT_TOKEN;
  }

  if (!value) {
    return fallback;
  }

  throwHttp(`ACTION_METADATA_INVALID:${key}`, 500);
}

function optionalMetadataString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();

  const d = new Date(String(value));

  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString();
  }

  return d.toISOString();
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

function proofCardHashOf(proofCard: unknown): string | null {
  if (!proofCard || typeof proofCard !== "object") return null;

  const obj = proofCard as {
    proof_card_hash?: unknown;
    proofCardHash?: unknown;
    hashes?: {
      proof_card_hash?: unknown;
      proofCardHash?: unknown;
    };
  };

  const maybeHash =
    obj.proofCardHash ??
    obj.proof_card_hash ??
    obj.hashes?.proofCardHash ??
    obj.hashes?.proof_card_hash;

  return typeof maybeHash === "string" && maybeHash.trim() ? maybeHash : null;
}

function buildProofCoreAction(input: {
  action: AgentActionRow;
  paymentTransactionId: string;
}): ProofCoreAction {
  const metadata = input.action.metadata ?? {};

  const subjectType = metadataString(metadata, "subject_type");
  const subjectId = metadataString(metadata, "subject_id");
  const network = metadataString(metadata, "network", config.hederaNetwork);
  const quoteAmount = metadataString(metadata, "quote_amount");
  const quoteToken = metadataHbarToken(metadata, "quote_token");
  const recipientAccountId = metadataString(
    metadata,
    "recipient_account_id",
    config.treasuryAccountId,
  );
  const evidenceSnapshotHash = metadataString(metadata, "evidence_snapshot_hash");
  const actionInputHash = metadataString(
    metadata,
    "action_input_hash",
    input.action.input_hash,
  );

  return Object.freeze({
    id: input.action.id,
    action_type: input.action.action_type,
    status: input.action.status,
    subject_type: subjectType,
    subject_id: subjectId,
    network,
    quote_amount: quoteAmount,
    quote_token: quoteToken,
    recipient_account_id: recipientAccountId,
    evidence_snapshot_hash: evidenceSnapshotHash,
    action_input_hash: actionInputHash,
    input_hash: input.action.input_hash ?? actionInputHash,
    payment_transaction_id: input.paymentTransactionId,
    output_hash: input.action.output_hash,
    created_at: toIso(input.action.created_at),
    expires_at: input.action.expires_at ? toIso(input.action.expires_at) : null,
    completed_at: input.action.completed_at ? toIso(input.action.completed_at) : null,
  });
}

function getActionSubject(input: AgentActionRow): {
  subjectType: string;
  subjectId: string;
} {
  const metadata = input.metadata ?? {};

  return {
    subjectType: metadataString(metadata, "subject_type"),
    subjectId: metadataString(metadata, "subject_id"),
  };
}

function getActionEvidenceHashes(input: AgentActionRow): {
  evidenceSnapshotHash: string;
  actionInputHash: string;
} {
  const metadata = input.metadata ?? {};

  return {
    evidenceSnapshotHash: metadataString(metadata, "evidence_snapshot_hash"),
    actionInputHash: metadataString(metadata, "action_input_hash", input.input_hash),
  };
}

function receiptPayload(input: {
  action: AgentActionRow;
  payment: PaymentVerification;
  proofBundle: unknown;
  proofCard: unknown;
  proofBundleHash: string;
  proofCardHash: string | null;
  verifyUrl: string;
}): Record<string, unknown> {
  return {
    action_id: input.action.id,
    action_type: input.action.action_type,
    payment_id: input.action.payment_id,
    payment: input.payment,
    proof_bundle: input.proofBundle,
    proof_bundle_hash: input.proofBundleHash,
    proof_card: input.proofCard,
    proof_card_hash: input.proofCardHash,
    verify_url: input.verifyUrl,
  };
}

function payloadString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return null;
}

function toCompletedResult(input: {
  action: AgentActionRow;
  receipt: AgentReceiptRow;
  verifyUrl?: string | null;
}): ExecuteProofBundleResult {
  const payload = input.receipt.payload ?? {};
  const proofCardHash =
    typeof payload.proof_card_hash === "string" && payload.proof_card_hash.trim()
      ? payload.proof_card_hash
      : null;
  const verifyUrl = input.verifyUrl ?? payloadString(payload, "verify_url");

  if (!verifyUrl) {
    throwHttp("RECEIPT_VERIFY_URL_MISSING", 500);
  }

  return Object.freeze({
    status: "completed",
    action_id: input.action.id,
    payment_id: input.action.payment_id,
    proof_bundle_id: input.receipt.id,
    proof_bundle_hash: input.receipt.receipt_hash,
    proof_card_hash: proofCardHash,
    proof_bundle_url: `/proof-bundles/${input.receipt.id}`,
    proof_card_url: `/proof-cards/${input.receipt.id}`,
    verify_url: verifyUrl,
    receipt: input.receipt,
  });
}

async function returnExistingCompletedResult(input: {
  action: AgentActionRow;
  context: Required<AgentServiceContext>;
}): Promise<ExecuteProofBundleResult | null> {
  if (input.action.status !== "completed" || !input.action.receipt_id) {
    return null;
  }

  return withAgentTransaction(agentDbPool, input.context, async (client) => {
    const receipt = await repos.receipts.getById(input.action.receipt_id as string, {
      client,
    });

    if (!receipt) {
      return null;
    }

    return toCompletedResult({
      action: input.action,
      receipt,
      verifyUrl: null,
    });
  });
}

async function loadActionForStateCheck(input: {
  actionId: string;
  context: Required<AgentServiceContext>;
}): Promise<AgentActionRow | null> {
  return withAgentTransaction(agentDbPool, input.context, async (client) => {
    return repos.actions.getById(input.actionId, { client });
  });
}

async function loadAttachedPayment(input: {
  paymentId: string;
  context: Required<AgentServiceContext>;
}): Promise<AgentPaymentRow | null> {
  return withAgentTransaction(agentDbPool, input.context, async (client) => {
    return repos.payments.getById(input.paymentId, { client });
  });
}

export async function executeProofBundleExport(
  input: ExecuteProofBundleInput,
  context: AgentServiceContext,
): Promise<ExecuteProofBundleResult> {
  const actionId = normalizeUuid(input.actionId, "action_id");
  const paymentTransactionId = normalizePaymentTransactionId(input.paymentTransactionId);
  const payerAccountId = normalizePayerAccountId(input.payerAccountId);
  const scopedContext = normalizeServiceContext(context);

  const existingAction = await loadActionForStateCheck({
    actionId,
    context: scopedContext,
  });

  if (!existingAction) {
    throwHttp("ACTION_NOT_FOUND", 404);
  }

  const existingCompleted = await returnExistingCompletedResult({
    action: existingAction,
    context: scopedContext,
  });

  if (existingCompleted) {
    return existingCompleted;
  }

  let payment: PaymentVerification;
  let paymentId = existingAction.payment_id;

  if (existingAction.status === "payment_pending") {
    const verification = await verifyPaymentForAction(
      {
        actionId,
        paymentTransactionId,
        payerAccountId,
      },
      scopedContext,
    );

    if (!verification.ok) {
      throwHttp(verification.code, verification.status);
    }

    payment = verification.payment;
    paymentId = verification.payment_id;
  } else if (existingAction.status === "payment_verified" && existingAction.payment_id) {
    const attachedPayment = await loadAttachedPayment({
      paymentId: existingAction.payment_id,
      context: scopedContext,
    });

    if (!attachedPayment) {
      throwHttp("ATTACHED_PAYMENT_NOT_FOUND", 409);
    }

    if (
      attachedPayment.provider_payment_id &&
      attachedPayment.provider_payment_id !== paymentTransactionId
    ) {
      throwHttp("PAYMENT_TRANSACTION_MISMATCH", 409);
    }

    payment = {
      transaction_id: attachedPayment.provider_payment_id ?? paymentTransactionId,
      payer_account_id: attachedPayment.payer_ref ?? payerAccountId,
      amount: metadataString(existingAction.metadata, "quote_amount"),
      token: metadataHbarToken(existingAction.metadata, "quote_token"),
      network: metadataString(existingAction.metadata, "network", config.hederaNetwork),
      recipient_account_id: metadataString(
        existingAction.metadata,
        "recipient_account_id",
        config.treasuryAccountId,
      ),
      verified_mode: VERIFIED_MODE_MIRROR,
    };
    paymentId = existingAction.payment_id;
  } else {
    throwHttp(`ACTION_NOT_EXECUTABLE:${existingAction.status}`, 409);
  }

  try {
    return await withAgentTransaction(agentDbPool, scopedContext, async (client) => {
      const lockedAction = await repos.actions.getByIdForUpdate(actionId, { client });

      if (!lockedAction) {
        throwHttp("ACTION_NOT_FOUND", 404);
      }

      if (lockedAction.status === "completed" && lockedAction.receipt_id) {
        const receipt = await repos.receipts.getById(lockedAction.receipt_id, {
          client,
        });

        if (receipt) {
          return toCompletedResult({
            action: lockedAction,
            receipt,
            verifyUrl: null,
          });
        }
      }

      if (lockedAction.status !== "payment_verified") {
        throwHttp(`ACTION_NOT_EXECUTABLE:${lockedAction.status}`, 409);
      }

      const runningAction =
        (await repos.actions.markStatus(
          {
            id: lockedAction.id,
            status: "running",
          },
          { client },
        )) ?? lockedAction;

      const { subjectType, subjectId } = getActionSubject(runningAction);

      const evidence = await getEvidencePreview(
        {
          subjectType,
          subjectId,
        },
        scopedContext,
      );

      const { evidenceSnapshotHash, actionInputHash } =
        getActionEvidenceHashes(runningAction);

      const proofCoreAction = buildProofCoreAction({
        action: runningAction,
        paymentTransactionId: payment.transaction_id,
      });

      const proofBundle = buildProofBundle({
        action: proofCoreAction,
        subject: evidenceSubjectFromRecord(evidence),
        evidence: evidenceLinksFromRecord(evidence),
        payment,
        evidenceSnapshotHash,
        actionInputHash,
      });

      const proofCard = buildProofCard(proofBundle);
      const proofCardHash = proofCardHashOf(proofCard);
      const proofBundleHash = proofBundle.hashes.proof_bundle_hash;

      const payload = receiptPayload({
        action: runningAction,
        payment,
        proofBundle,
        proofCard,
        proofBundleHash,
        proofCardHash,
        verifyUrl: evidence.verify_url,
      });

      const receiptHash = proofBundleHash || sha3_512Json(payload);

      const existingReceipt = await repos.receipts.getByActionAndType(
        {
          actionId: runningAction.id,
          receiptType: RECEIPT_TYPE,
        },
        { client },
      );

      const receipt =
        existingReceipt ??
        (await repos.receipts.createReceipt(
          {
            actionId: runningAction.id,
            quoteId: runningAction.quote_id,
            paymentId,
            receiptType: RECEIPT_TYPE,
            receiptHash,
            artifactHash: proofBundleHash,
            payload,
            actorRef: runningAction.actor_ref,
            orgRef: runningAction.org_ref,
            requestId: runningAction.request_id,
            idempotencyKey: runningAction.idempotency_key
              ? `${runningAction.idempotency_key}:proof_export`
              : null,
          },
          { client },
        ));

      await repos.actions.attachReceipt(
        {
          actionId: runningAction.id,
          receiptId: receipt.id,
        },
        { client },
      );

      const completedAction =
        (await repos.actions.markStatus(
          {
            id: runningAction.id,
            status: "completed",
            outputHash: receiptHash,
          },
          { client },
        )) ?? runningAction;

      return toCompletedResult({
        action: completedAction,
        receipt,
        verifyUrl: evidence.verify_url,
      });
    });
  } catch (err) {
    await withAgentTransaction(agentDbPool, scopedContext, async (client) => {
      const action = await repos.actions.getByIdForUpdate(actionId, { client });

      if (action && action.status !== "completed") {
        await repos.actions.markStatus(
          {
            id: action.id,
            status: "failed",
            errorCode: "PROOF_EXPORT_FAILED",
            errorMessage:
              err instanceof Error ? err.message.slice(0, 512) : "Proof export failed.",
          },
          { client },
        );
      }
    });

    throw err;
  }
}

export async function getProofReceipt(
  receiptId: string,
  context: AgentServiceContext,
): Promise<AgentReceiptRow | null> {
  const id = normalizeUuid(receiptId, "receipt_id");
  const scopedContext = normalizeServiceContext(context);

  return withAgentTransaction(agentDbPool, scopedContext, async (client) => {
    return repos.receipts.getById(id, { client });
  });
}