// apps/agent-api/src/services/quoteService.ts

import crypto from "node:crypto";
import {
  buildActionInput,
  buildEvidenceSnapshot,
  hashActionInput,
  hashEvidenceSnapshot,
} from "@vera-discovery/proof-core";
import { config } from "../config.js";
import { agentDbPool } from "../db/db.js";
import { createAgentRepos } from "../repos/agentRepos.js";
import { withAgentTransaction } from "../repos/agentRepoUtils.js";
import type { AgentActionRow } from "../repos/agentActionRepo.js";
import type { AgentServiceContext } from "./agentServiceContext.js";
import { getEvidencePreview } from "./evidenceService.js";

const repos = createAgentRepos(agentDbPool);

const ACTION_TYPE = "proof_bundle_export" as const;
const QUOTE_TOKEN = "HBAR" as const;
const PAYMENT_PROVIDER = "vera_anchor";
const QUOTE_KIND = "proof_export";

export type ProofBundleQuote = Readonly<{
  action_id: string;
  quote_id: string;
  action_type: typeof ACTION_TYPE;
  amount: string;
  amount_minor: number;
  token: typeof QUOTE_TOKEN;
  currency: typeof QUOTE_TOKEN;
  network: string;
  recipient_account_id: string;
  evidence_snapshot_hash: string;
  action_input_hash: string;
  input_hash: string;
  quote_hash: string;
  expires_at: string;
  payment_memo: string;
  payment_url: string | null;
}>;

export type CreateProofBundleQuoteInput = Readonly<{
  subjectType: string;
  subjectId: string;
  idempotencyKey?: string | null;
}>;

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function rejectControlChars(value: string, field: string): void {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    const err = new Error(`${field.toUpperCase()}_CONTAINS_CONTROL_CHARACTERS`);
    (err as Error & { status?: number }).status = 400;
    throw err;
  }
}

function normalizeSubjectType(value: unknown): string {
  const s = cleanString(value).toLowerCase();

  if (!s) {
    const err = new Error("SUBJECT_TYPE_REQUIRED");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }

  rejectControlChars(s, "subject_type");

  if (!/^[a-z][a-z0-9_:-]{1,127}$/.test(s)) {
    const err = new Error("INVALID_SUBJECT_TYPE");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }

  return s;
}

function normalizeSubjectId(value: unknown): string {
  const s = cleanString(value);

  if (!s) {
    const err = new Error("SUBJECT_ID_REQUIRED");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }

  rejectControlChars(s, "subject_id");

  if (s.length > 256) {
    const err = new Error("SUBJECT_ID_TOO_LONG");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }

  return s;
}

function normalizeIdempotencyKey(value: unknown): string | null {
  const s = cleanString(value);

  if (!s) return null;

  rejectControlChars(s, "idempotency_key");

  if (s.length < 8 || s.length > 256) {
    const err = new Error("INVALID_IDEMPOTENCY_KEY");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }

  return s;
}

function normalizeContextRef(value: unknown, field: string): string | null {
  const s = cleanString(value);

  if (!s) return null;

  rejectControlChars(s, field);

  if (s.length > 256) {
    const err = new Error(`${field.toUpperCase()}_TOO_LONG`);
    (err as Error & { status?: number }).status = 400;
    throw err;
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

function hbarToTinybars(value: unknown): number {
  const raw = cleanString(value);

  if (!/^\d+(\.\d{1,8})?$/.test(raw)) {
    const err = new Error("INVALID_HBAR_AMOUNT");
    (err as Error & { status?: number }).status = 500;
    throw err;
  }

  const [wholeRaw, fracRaw = ""] = raw.split(".");
  const whole = BigInt(wholeRaw);
  const frac = BigInt(fracRaw.padEnd(8, "0"));
  const tinybars = whole * 100_000_000n + frac;

  if (tinybars > BigInt(Number.MAX_SAFE_INTEGER)) {
    const err = new Error("HBAR_AMOUNT_EXCEEDS_SAFE_INTEGER");
    (err as Error & { status?: number }).status = 500;
    throw err;
  }

  return Number(tinybars);
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

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function toProofBundleQuote(input: {
  action: AgentActionRow;
  quoteId: string;
  quoteHash: string;
  amount: string;
  amountMinor: number;
  network: string;
  recipientAccountId: string;
  evidenceSnapshotHash: string;
  actionInputHash: string;
  expiresAt: string;
}): ProofBundleQuote {
  return Object.freeze({
    action_id: input.action.id,
    quote_id: input.quoteId,
    action_type: ACTION_TYPE,
    amount: input.amount,
    amount_minor: input.amountMinor,
    token: QUOTE_TOKEN,
    currency: QUOTE_TOKEN,
    network: input.network,
    recipient_account_id: input.recipientAccountId,
    evidence_snapshot_hash: input.evidenceSnapshotHash,
    action_input_hash: input.actionInputHash,
    input_hash: input.actionInputHash,
    quote_hash: input.quoteHash,
    expires_at: input.expiresAt,
    payment_memo: `vera-agent:${input.action.id}`,
    payment_url: null,
  });
}

export async function createProofBundleQuote(
  input: CreateProofBundleQuoteInput,
  context: AgentServiceContext,
): Promise<ProofBundleQuote> {
  const subjectType = normalizeSubjectType(input.subjectType);
  const subjectId = normalizeSubjectId(input.subjectId);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const scopedContext = normalizeServiceContext(context);

  const evidence = await getEvidencePreview({
    subjectType,
    subjectId,
  });

  const evidenceSnapshot = buildEvidenceSnapshot(evidence);
  const evidenceSnapshotHashEnvelope = hashEvidenceSnapshot(evidenceSnapshot);

  const actionInput = buildActionInput({
    actionType: ACTION_TYPE,
    subjectType: evidence.subject_type,
    subjectId: evidence.subject_id,
    network: config.hederaNetwork,
    amount: config.proofBundlePriceHbar,
    token: QUOTE_TOKEN,
    recipientAccountId: config.treasuryAccountId,
    evidenceSnapshotHash: evidenceSnapshotHashEnvelope.digest,
  });

  const actionInputHashEnvelope = hashActionInput(actionInput);

  const amount = cleanString(config.proofBundlePriceHbar);
  const amountMinor = hbarToTinybars(amount);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.quoteTtlSeconds * 1000);

  return withAgentTransaction(agentDbPool, scopedContext, async (client) => {
    const action = await repos.actions.createAction(
      {
        actionType: ACTION_TYPE,
        status: "payment_pending",
        actorRef: scopedContext.actorRef,
        orgRef: scopedContext.orgRef,
        requestId: scopedContext.requestId,
        idempotencyKey,
        inputHash: actionInputHashEnvelope.digest,
        metadata: {
          subject_type: evidence.subject_type,
          subject_id: evidence.subject_id,
          network: config.hederaNetwork,
          quote_amount: amount,
          quote_token: QUOTE_TOKEN,
          recipient_account_id: config.treasuryAccountId,
          evidence_snapshot_hash: evidenceSnapshotHashEnvelope.digest,
          action_input_hash: actionInputHashEnvelope.digest,
          evidence_snapshot: evidenceSnapshot,
        },
        expiresAt,
      },
      { client },
    );

    const paymentMemo = `vera-agent:${action.id}`;

    const quotePayload = {
      action_id: action.id,
      action_type: ACTION_TYPE,
      subject_type: evidence.subject_type,
      subject_id: evidence.subject_id,
      network: config.hederaNetwork,
      amount,
      amount_minor: amountMinor,
      token: QUOTE_TOKEN,
      currency: QUOTE_TOKEN,
      recipient_account_id: config.treasuryAccountId,
      evidence_snapshot_hash: evidenceSnapshotHashEnvelope.digest,
      action_input_hash: actionInputHashEnvelope.digest,
      input_hash: actionInputHashEnvelope.digest,
      payment_memo: paymentMemo,
      expires_at: expiresAt.toISOString(),
    };

    const quoteHash = sha3_512Json(quotePayload);

    const quote = await repos.quotes.createQuote(
      {
        actionId: action.id,
        status: "active",
        quoteKind: QUOTE_KIND,
        provider: PAYMENT_PROVIDER,
        amountMinor,
        currency: QUOTE_TOKEN,
        network: config.hederaNetwork,
        quoteHash,
        quotePayload,
        actorRef: scopedContext.actorRef,
        orgRef: scopedContext.orgRef,
        requestId: scopedContext.requestId,
        idempotencyKey,
        expiresAt,
      },
      { client },
    );

    const updatedAction = await repos.actions.attachQuote(
      {
        actionId: action.id,
        quoteId: quote.id,
      },
      { client },
    );

    return toProofBundleQuote({
      action: updatedAction ?? action,
      quoteId: quote.id,
      quoteHash,
      amount,
      amountMinor,
      network: config.hederaNetwork,
      recipientAccountId: config.treasuryAccountId,
      evidenceSnapshotHash: evidenceSnapshotHashEnvelope.digest,
      actionInputHash: actionInputHashEnvelope.digest,
      expiresAt: toIso(quote.expires_at),
    });
  });
}

export function assertActionPayable(action: AgentActionRow | null): AgentActionRow {
  if (!action) {
    const err = new Error("ACTION_NOT_FOUND");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }

  if (action.status !== "payment_pending") {
    const err = new Error(`ACTION_NOT_PAYABLE:${action.status}`);
    (err as Error & { status?: number }).status = 409;
    throw err;
  }

  if (action.expires_at && Date.now() > new Date(action.expires_at).getTime()) {
    const err = new Error("QUOTE_EXPIRED");
    (err as Error & { status?: number }).status = 410;
    throw err;
  }

  return action;
}