import {
  buildProofBundle,
  buildProofCard,
  evidenceLinksFromRecord,
  evidenceSubjectFromRecord,
} from "@vera-discovery/proof-core";
import {
  getReceipt as readReceipt,
  saveAction,
  saveReceipt,
} from "../stores/memoryStore.js";
import type { AgentActionRecord, AgentReceiptRecord } from "../types.js";
import { getEvidencePreview } from "./evidenceService.js";
import { getAction } from "./quoteService.js";
import { verifyPaymentForAction } from "./paymentService.js";

export type ExecuteProofBundleInput = Readonly<{
  actionId: string;
  paymentTransactionId: string;
  payerAccountId?: string;
}>;

export type ExecuteProofBundleResult = Readonly<{
  status: "completed";
  action_id: string;
  proof_bundle_id: string;
  proof_bundle_hash: string;
  proof_card_hash: string | null;
  proof_bundle_url: string;
  proof_card_url: string;
  verify_url: string;
  receipt: AgentReceiptRecord;
}>;

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function httpError(message: string, status: number): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function markActionExecuting(
  action: AgentActionRecord,
  paymentTransactionId: string
): AgentActionRecord {
  return saveAction({
    ...action,
    status: "executing",
    payment_transaction_id: paymentTransactionId,
  });
}

function markActionCompleted(input: {
  action: AgentActionRecord;
  paymentTransactionId: string;
  outputHash: string;
  completedAt: string;
}): AgentActionRecord {
  return saveAction({
    ...input.action,
    status: "completed",
    payment_transaction_id: input.paymentTransactionId,
    output_hash: input.outputHash,
    completed_at: input.completedAt,
  });
}

function markActionFailed(
  action: AgentActionRecord,
  paymentTransactionId?: string
): AgentActionRecord {
  return saveAction({
    ...action,
    status: "failed",
    payment_transaction_id: paymentTransactionId ?? action.payment_transaction_id,
  });
}

function proofCardHashOf(proofCard: unknown): string | null {
  if (!proofCard || typeof proofCard !== "object") return null;

  const obj = proofCard as {
    proof_card_hash?: unknown;
    proofCardHash?: unknown;
  };

  const maybeHash = obj.proofCardHash ?? obj.proof_card_hash;
  return typeof maybeHash === "string" && maybeHash.trim() ? maybeHash : null;
}

export async function executeProofBundleExport(
  input: ExecuteProofBundleInput
): Promise<ExecuteProofBundleResult> {
  const actionId = cleanString(input.actionId);
  const paymentTransactionId = cleanString(input.paymentTransactionId);
  const payerAccountId = cleanString(input.payerAccountId);

  if (!actionId) {
    throw httpError("ACTION_ID_REQUIRED", 400);
  }

  if (!paymentTransactionId) {
    throw httpError("PAYMENT_TRANSACTION_ID_REQUIRED", 400);
  }

  const action = getAction(actionId);

  const verification = await verifyPaymentForAction({
    action,
    paymentTransactionId,
    ...(payerAccountId ? { payerAccountId } : {}),
  });

  if (!verification.ok) {
    throw httpError(verification.code, verification.status);
  }

  if (!action) {
    throw httpError("ACTION_NOT_FOUND", 404);
  }

  try {
    const executingAction = markActionExecuting(
      action,
      verification.payment.transaction_id
    );

    const evidence = await getEvidencePreview({
      subjectType: executingAction.subject_type,
      subjectId: executingAction.subject_id,
    });

    const proofBundle = buildProofBundle({
      action: executingAction,
      subject: evidenceSubjectFromRecord(evidence),
      evidence: evidenceLinksFromRecord(evidence),
      payment: verification.payment,
      evidenceSnapshotHash: executingAction.evidence_snapshot_hash,
      actionInputHash: executingAction.action_input_hash,
    });

    const proofCard = buildProofCard(proofBundle);
    const proofCardHash = proofCardHashOf(proofCard);

    const completedAt = new Date().toISOString();

    const completedAction = markActionCompleted({
      action: executingAction,
      paymentTransactionId: verification.payment.transaction_id,
      outputHash: proofBundle.hashes.proof_bundle_hash,
      completedAt,
    });

    const receipt: AgentReceiptRecord = saveReceipt({
      id: completedAction.id,
      action_id: completedAction.id,
      proof_bundle: proofBundle,
      proof_bundle_hash: proofBundle.hashes.proof_bundle_hash,
      proof_card: proofCard,
      proof_card_hash: proofCardHash,
      created_at: completedAt,
    });

    return {
      status: "completed",
      action_id: completedAction.id,
      proof_bundle_id: receipt.id,
      proof_bundle_hash: receipt.proof_bundle_hash,
      proof_card_hash: receipt.proof_card_hash,
      proof_bundle_url: `/proof-bundles/${receipt.id}`,
      proof_card_url: `/proof-cards/${receipt.id}`,
      verify_url: evidence.verify_url,
      receipt,
    };
  } catch (err) {
    markActionFailed(action, verification.payment.transaction_id);
    throw err;
  }
}

export function getProofReceipt(receiptId: string): AgentReceiptRecord | null {
  return readReceipt(receiptId);
}