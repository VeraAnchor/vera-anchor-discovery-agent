import { randomUUID } from "node:crypto";
import {
  buildActionInput,
  buildEvidenceSnapshot,
  hashActionInput,
  hashEvidenceSnapshot,
} from "@vera-discovery/proof-core";
import { config } from "../config.js";
import { getAction as readAction, saveAction } from "../stores/memoryStore.js";
import type { AgentActionRecord } from "../types.js";
import { getEvidencePreview } from "./evidenceService.js";

export type ProofBundleQuote = Readonly<{
  action_id: string;
  action_type: "proof_bundle_export";
  amount: string;
  token: "HBAR";
  network: string;
  recipient_account_id: string;
  evidence_snapshot_hash: string;
  action_input_hash: string;
  input_hash: string;
  expires_at: string;
  payment_memo: string;
  payment_url: string | null;
}>;

export async function createProofBundleQuote(input: {
  subjectType: string;
  subjectId: string;
}): Promise<ProofBundleQuote> {
  const evidence = await getEvidencePreview({
    subjectType: input.subjectType,
    subjectId: input.subjectId,
  });

  const evidenceSnapshot = buildEvidenceSnapshot(evidence);
  const evidenceSnapshotHashEnvelope = hashEvidenceSnapshot(evidenceSnapshot);

  const actionInput = buildActionInput({
    actionType: "proof_bundle_export",
    subjectType: evidence.subject_type,
    subjectId: evidence.subject_id,
    network: config.hederaNetwork,
    amount: config.proofBundlePriceHbar,
    token: "HBAR",
    recipientAccountId: config.treasuryAccountId,
    evidenceSnapshotHash: evidenceSnapshotHashEnvelope.digest,
  });

  const actionInputHashEnvelope = hashActionInput(actionInput);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.quoteTtlSeconds * 1000);
  const actionId = randomUUID();

  const action: AgentActionRecord = Object.freeze({
    id: actionId,
    action_type: "proof_bundle_export",
    status: "pending_payment",
    subject_type: evidence.subject_type,
    subject_id: evidence.subject_id,
    network: config.hederaNetwork,
    quote_amount: config.proofBundlePriceHbar,
    quote_token: "HBAR",
    recipient_account_id: config.treasuryAccountId,
    evidence_snapshot_hash: evidenceSnapshotHashEnvelope.digest,
    action_input_hash: actionInputHashEnvelope.digest,
    input_hash: actionInputHashEnvelope.digest,
    payment_transaction_id: null,
    output_hash: null,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    completed_at: null,
  });

  saveAction(action);

  return Object.freeze({
    action_id: action.id,
    action_type: action.action_type,
    amount: action.quote_amount,
    token: action.quote_token,
    network: action.network,
    recipient_account_id: action.recipient_account_id,
    evidence_snapshot_hash: action.evidence_snapshot_hash,
    action_input_hash: action.action_input_hash,
    input_hash: action.input_hash,
    expires_at: action.expires_at,
    payment_memo: `vera-agent:${action.id}`,
    payment_url: null,
  });
}

export function getAction(actionId: string): AgentActionRecord | null {
  return readAction(actionId);
}

export function markActionExpired(action: AgentActionRecord): AgentActionRecord {
  return saveAction({
    ...action,
    status: "expired",
  });
}

export function assertActionPayable(action: AgentActionRecord | null): AgentActionRecord {
  if (!action) {
    const err = new Error("ACTION_NOT_FOUND");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }

  if (action.status !== "pending_payment") {
    const err = new Error(`ACTION_NOT_PAYABLE:${action.status}`);
    (err as Error & { status?: number }).status = 409;
    throw err;
  }

  if (Date.now() > new Date(action.expires_at).getTime()) {
    markActionExpired(action);
    const err = new Error("QUOTE_EXPIRED");
    (err as Error & { status?: number }).status = 410;
    throw err;
  }

  return action;
}