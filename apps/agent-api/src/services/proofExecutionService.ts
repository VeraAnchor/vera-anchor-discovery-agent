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
const PROOF_BUNDLE_SCHEMA = "vera:agent:proof-bundle:v1" as const;
const PAYMENT_TOKEN = "HBAR" as const;
const VERIFIED_MODE_MIRROR = "mirror" as const;

type JsonRecord = Record<string, unknown>;

type ProofExportVerificationStatus =
  | "verified"
  | "partially_verified"
  | "reviewable";

type ProofExportCheckStatus =
  | "passed"
  | "warning"
  | "failed"
  | "not_available";

type ProofExportCheck = Readonly<{
  name: string;
  status: ProofExportCheckStatus;
  detail: string;
}>;

type ProofBundleExportPayload = Readonly<{
  schema: typeof PROOF_BUNDLE_SCHEMA;
  subject: Readonly<{
    type: string;
    id: string;
    title: string | null;
    summary: string | null;
    canonical_url: string | null;
  }>;
  action: Readonly<{
    action_id: string;
    action_type: string;
    input_hash: string;
    action_input_hash: string;
    quote_id: string | null;
    quote_hash: string | null;
    payment_transaction_id: string;
  }>;
  payment: PaymentVerification;
  evidence_snapshot: JsonRecord;
  verification: Readonly<{
    status: ProofExportVerificationStatus;
    checks: readonly ProofExportCheck[];
    limitations: readonly string[];
  }>;
  links: Readonly<{
    verify_url: string | null;
    proof_bundle_url: string;
    proof_card_url: string;
    explorer_url: string | null;
  }>;
  hashes: Readonly<{
    evidence_snapshot_hash: string;
    action_input_hash: string;
    proof_bundle_hash: string;
    proof_card_hash: string | null;
    export_payload_hash: string;
  }>;
  artifacts: Readonly<{
    proof_bundle_id: string | null;
    proof_card_available: boolean;
    export_format: "json";
  }>;
  proof_core: Readonly<{
    bundle: unknown;
    card: unknown;
  }>;
  generated_at: string;
}>;

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

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonRecord;
}

function optionalStringFromRecord(
  record: JsonRecord,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalBooleanFromRecord(
  record: JsonRecord,
  key: string,
): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function optionalArrayFromRecord(
  record: JsonRecord,
  key: string,
): readonly unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function pickRecordFields(
  record: JsonRecord,
  keys: readonly string[],
): JsonRecord {
  return keys.reduce<JsonRecord>((acc, key) => {
    if (record[key] !== undefined) {
      acc[key] = record[key];
    }

    return acc;
  }, {});
}

function publicExplorerUrl(input: {
  subjectType: string;
  subjectId: string;
  evidence: JsonRecord;
}): string | null {
  const verifyUrl = optionalStringFromRecord(input.evidence, "verify_url");
  if (verifyUrl) return verifyUrl;

  const base = String(config.veraPublicSiteUrl ?? "").replace(/\/+$/g, "");
  if (!base) return null;

  if (input.subjectType === "cipher_result") {
    return `${base}/cipher/results/${encodeURIComponent(input.subjectId)}`;
  }

  if (input.subjectType === "sage_result") {
    return `${base}/sage/results/${encodeURIComponent(input.subjectId)}`;
  }

  if (input.subjectType === "dataset") {
    return `${base}/datasets/${encodeURIComponent(input.subjectId)}`;
  }

  if (input.subjectType === "hcs_transaction") {
    return `${base}/hcs/transactions/${encodeURIComponent(input.subjectId)}`;
  }

  if (input.subjectType === "proof_card") {
    return `${base}/proof-cards/${encodeURIComponent(input.subjectId)}`;
  }

  return null;
}

function buildEvidenceSnapshot(input: {
  subjectType: string;
  subjectId: string;
  evidence: unknown;
}): JsonRecord {
  const evidence = asRecord(input.evidence);

  const hcsTransactionId =
    optionalStringFromRecord(evidence, "hcs_transaction_id") ??
    optionalStringFromRecord(evidence, "transaction_id");
  const hcsTopicId = optionalStringFromRecord(evidence, "hcs_topic_id");

  const hcsReceipts =
    hcsTransactionId || hcsTopicId
      ? [
          {
            transaction_id: hcsTransactionId,
            topic_id: hcsTopicId,
            mirror_verified:
              optionalBooleanFromRecord(evidence, "mirror_verified") ??
              optionalBooleanFromRecord(evidence, "verified"),
          },
        ]
      : [];

  return Object.freeze({
    subject: {
      type: input.subjectType,
      id: input.subjectId,
      title: optionalStringFromRecord(evidence, "title"),
      summary: optionalStringFromRecord(evidence, "summary"),
      verify_url: optionalStringFromRecord(evidence, "verify_url"),
    },
    result: pickRecordFields(evidence, [
      "result_id",
      "job_id",
      "program",
      "status",
      "proof_date",
      "score",
      "rank",
      "created_at",
      "updated_at",
      "result_hash",
      "service_hash",
      "global_hash",
      "pipeline_hash",
      "params_hash",
      "input_hash",
      "hcs_transaction_id",
      "hcs_topic_id",
    ]),
    dataset: pickRecordFields(evidence, [
      "dataset_key",
      "dataset_version",
      "dataset_fingerprint",
      "dataset_manifest_sha3_512",
      "resolved_metadata_sha3_512",
    ]),
    proof: pickRecordFields(evidence, [
      "proof_id",
      "proof_date",
      "root_id",
      "root_hash",
      "leaf_hash",
      "leaf_count",
      "domain",
      "verified",
      "mirror_verified",
      "mirror_verified_at",
    ]),
    hcs_receipts: hcsReceipts,
    artifacts: optionalArrayFromRecord(evidence, "artifacts"),
    score: evidence.score ?? null,
    raw_public_evidence: evidence,
  });
}

function buildVerificationChecks(input: {
  evidence: JsonRecord;
  proofBundleHash: string;
  proofCardHash: string | null;
}): readonly ProofExportCheck[] {
  const hcsTransactionId =
    optionalStringFromRecord(input.evidence, "hcs_transaction_id") ??
    optionalStringFromRecord(input.evidence, "transaction_id");
  const hcsTopicId = optionalStringFromRecord(input.evidence, "hcs_topic_id");
  const verifyUrl = optionalStringFromRecord(input.evidence, "verify_url");
  const verified =
    optionalBooleanFromRecord(input.evidence, "verified") ??
    optionalBooleanFromRecord(input.evidence, "mirror_verified");

  return Object.freeze([
    {
      name: "public_evidence_snapshot",
      status: "passed",
      detail:
        "Public evidence was loaded through the Vera Explorer evidence preview service.",
    },
    {
      name: "proof_bundle_hash",
      status: input.proofBundleHash ? "passed" : "failed",
      detail: input.proofBundleHash
        ? "Proof bundle hash was produced deterministically."
        : "Proof bundle hash was not produced.",
    },
    {
      name: "proof_card_hash",
      status: input.proofCardHash ? "passed" : "not_available",
      detail: input.proofCardHash
        ? "Proof card hash was produced."
        : "Proof card hash was not available from proof-core.",
    },
    {
      name: "hcs_transaction_reference",
      status: hcsTransactionId ? "passed" : "not_available",
      detail: hcsTransactionId
        ? `Evidence includes HCS transaction ${hcsTransactionId}.`
        : "Evidence does not include an HCS transaction reference.",
    },
    {
      name: "hcs_topic_reference",
      status: hcsTopicId ? "passed" : "not_available",
      detail: hcsTopicId
        ? `Evidence includes HCS topic ${hcsTopicId}.`
        : "Evidence does not include an HCS topic reference.",
    },
    {
      name: "public_verify_url",
      status: verifyUrl ? "passed" : "not_available",
      detail: verifyUrl
        ? "Evidence includes a public verification URL."
        : "Evidence does not include a public verification URL.",
    },
    {
      name: "public_verified_indicator",
      status:
        verified === true
          ? "passed"
          : verified === false
            ? "warning"
            : "not_available",
      detail:
        verified === true
          ? "Public evidence reports a verified indicator."
          : verified === false
            ? "Public evidence reports an unverified or pending indicator."
            : "Public evidence does not expose a verified indicator.",
    },
  ]);
}

function verificationStatus(
  checks: readonly ProofExportCheck[],
): ProofExportVerificationStatus {
  const failed = checks.some((check) => check.status === "failed");
  if (failed) return "reviewable";

  const passed = checks.filter((check) => check.status === "passed").length;
  const unavailable = checks.some((check) => check.status === "not_available");
  const warnings = checks.some((check) => check.status === "warning");

  if (passed >= 5 && !unavailable && !warnings) {
    return "verified";
  }

  if (passed >= 2) {
    return "partially_verified";
  }

  return "reviewable";
}

function buildProofBundleExportPayload(input: {
  action: AgentActionRow;
  payment: PaymentVerification;
  evidence: unknown;
  evidenceSnapshotHash: string;
  actionInputHash: string;
  proofBundle: unknown;
  proofCard: unknown;
  proofBundleHash: string;
  proofCardHash: string | null;
  verifyUrl: string | null;
  generatedAt: string;
}): ProofBundleExportPayload {
  const { subjectType, subjectId } = getActionSubject(input.action);
  const evidence = asRecord(input.evidence);
  const evidenceSnapshot = buildEvidenceSnapshot({
    subjectType,
    subjectId,
    evidence,
  });
  const checks = buildVerificationChecks({
    evidence,
    proofBundleHash: input.proofBundleHash,
    proofCardHash: input.proofCardHash,
  });

  const explorerUrl = publicExplorerUrl({
    subjectType,
    subjectId,
    evidence,
  });
  const verifyUrl =
    input.verifyUrl ?? optionalStringFromRecord(evidence, "verify_url");

  const basePayload = {
    schema: PROOF_BUNDLE_SCHEMA,
    subject: {
      type: subjectType,
      id: subjectId,
      title: optionalStringFromRecord(evidence, "title"),
      summary: optionalStringFromRecord(evidence, "summary"),
      canonical_url: verifyUrl ?? explorerUrl,
    },
    action: {
      action_id: input.action.id,
      action_type: input.action.action_type,
      input_hash: input.action.input_hash ?? input.actionInputHash,
      action_input_hash: input.actionInputHash,
      quote_id: input.action.quote_id,
      quote_hash: optionalMetadataString(input.action.metadata ?? {}, "quote_hash"),
      payment_transaction_id: input.payment.transaction_id,
    },
    payment: input.payment,
    evidence_snapshot: evidenceSnapshot,
    verification: {
      status: verificationStatus(checks),
      checks,
      limitations: [
        "This export is built from public Vera Anchor evidence available to the agent at execution time.",
        "This export verifies public evidence and receipt metadata only; it does not decrypt private payloads or inspect private source material.",
        "Raw storage URIs and private artifact material are intentionally excluded from this paid agent export.",
      ],
    },
    links: {
      verify_url: verifyUrl,
      proof_bundle_url: "/proof-bundles/pending",
      proof_card_url: "/proof-cards/pending",
      explorer_url: explorerUrl,
    },
    hashes: {
      evidence_snapshot_hash: input.evidenceSnapshotHash,
      action_input_hash: input.actionInputHash,
      proof_bundle_hash: input.proofBundleHash,
      proof_card_hash: input.proofCardHash,
      export_payload_hash: "",
    },
    artifacts: {
      proof_bundle_id: null,
      proof_card_available: input.proofCardHash !== null,
      export_format: "json" as const,
    },
    proof_core: {
      bundle: input.proofBundle,
      card: input.proofCard,
    },
    generated_at: input.generatedAt,
  } satisfies Omit<ProofBundleExportPayload, "hashes"> & {
    hashes: Omit<ProofBundleExportPayload["hashes"], "export_payload_hash"> & {
      export_payload_hash: string;
    };
  };

  const exportPayloadHash = sha3_512Json({
    ...basePayload,
    hashes: {
      ...basePayload.hashes,
      export_payload_hash: null,
    },
  });

  return Object.freeze({
    ...basePayload,
    hashes: Object.freeze({
      ...basePayload.hashes,
      export_payload_hash: exportPayloadHash,
    }),
  });
}

function finalizeProofBundleExportPayload(input: {
  payload: ProofBundleExportPayload;
  receiptId: string;
}): ProofBundleExportPayload {
  const proofBundleUrl = `/proof-bundles/${input.receiptId}`;
  const proofCardUrl = `/proof-cards/${input.receiptId}`;

  const finalized = {
    ...input.payload,
    links: {
      ...input.payload.links,
      proof_bundle_url: proofBundleUrl,
      proof_card_url: proofCardUrl,
    },
    artifacts: {
      ...input.payload.artifacts,
      proof_bundle_id: input.receiptId,
    },
  };

  const exportPayloadHash = sha3_512Json({
    ...finalized,
    hashes: {
      ...finalized.hashes,
      export_payload_hash: null,
    },
  });

  return Object.freeze({
    ...finalized,
    hashes: Object.freeze({
      ...finalized.hashes,
      export_payload_hash: exportPayloadHash,
    }),
  });
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
  evidence: unknown;
  evidenceSnapshotHash: string;
  actionInputHash: string;
  proofBundle: unknown;
  proofCard: unknown;
  proofBundleHash: string;
  proofCardHash: string | null;
  verifyUrl: string | null;
  generatedAt: string;
}): ProofBundleExportPayload {
  return buildProofBundleExportPayload({
    action: input.action,
    payment: input.payment,
    evidence: input.evidence,
    evidenceSnapshotHash: input.evidenceSnapshotHash,
    actionInputHash: input.actionInputHash,
    proofBundle: input.proofBundle,
    proofCard: input.proofCard,
    proofBundleHash: input.proofBundleHash,
    proofCardHash: input.proofCardHash,
    verifyUrl: input.verifyUrl,
    generatedAt: input.generatedAt,
  });
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
  const hashes =
    payload.hashes && typeof payload.hashes === "object" && !Array.isArray(payload.hashes)
      ? (payload.hashes as Record<string, unknown>)
      : {};
  const links =
    payload.links && typeof payload.links === "object" && !Array.isArray(payload.links)
      ? (payload.links as Record<string, unknown>)
      : {};
  const proofCardHash =
    typeof hashes.proof_card_hash === "string" && hashes.proof_card_hash.trim()
      ? hashes.proof_card_hash
      : typeof payload.proof_card_hash === "string" && payload.proof_card_hash.trim()
        ? payload.proof_card_hash
      : null;
  const verifyUrl =
    input.verifyUrl ??
    (typeof links.verify_url === "string" && links.verify_url.trim()
      ? links.verify_url
      : null) ??
    payloadString(payload, "verify_url");

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
    proof_bundle_url:
      typeof links.proof_bundle_url === "string" && links.proof_bundle_url.trim()
        ? links.proof_bundle_url
        : `/proof-bundles/${input.receipt.id}`,
    proof_card_url:
      typeof links.proof_card_url === "string" && links.proof_card_url.trim()
        ? links.proof_card_url
        : `/proof-cards/${input.receipt.id}`,
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
      const generatedAt = new Date().toISOString();

      const payload = receiptPayload({
        action: runningAction,
        payment,
        evidence,
        evidenceSnapshotHash,
        actionInputHash,
        proofBundle,
        proofCard,
        proofBundleHash,
        proofCardHash,
        verifyUrl: evidence.verify_url ?? null,
        generatedAt,
      });

      const receiptHash = payload.hashes.export_payload_hash || proofBundleHash;

      const existingReceipt = await repos.receipts.getByActionAndType(
        {
          actionId: runningAction.id,
          receiptType: RECEIPT_TYPE,
        },
        { client },
      );

      let receipt = existingReceipt;

      if (!receipt) {
        const inserted = await repos.receipts.createReceipt(
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
        );

        const finalizedPayload = finalizeProofBundleExportPayload({
          payload,
          receiptId: inserted.id,
        });

        receipt =
          (await repos.receipts.updatePayloadAndHash(
            {
              id: inserted.id,
              receiptHash: finalizedPayload.hashes.export_payload_hash,
              artifactHash: finalizedPayload.hashes.proof_bundle_hash,
              payload: finalizedPayload,
            },
            { client },
          )) ?? inserted;
      }

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
            outputHash: receipt.receipt_hash,
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