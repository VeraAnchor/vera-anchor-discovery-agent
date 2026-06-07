// apps/agent-api/src/services/explorerAgentService.ts

import type { HederaAgentOperation } from "../hedera/hederaAgentTypes.js";
import { evaluateHederaAgentPolicies } from "../hedera/hederaAgentKitPolicy.js";
import { getHederaAgentConfigStatus } from "../hedera/hederaAgentKitClient.js";
import type {
  ExplorerAgentEvidenceKind,
  ExplorerAgentIntent,
  ExplorerAgentCompiledQuery,
  ExplorerAgentMode,
  ExplorerAgentNormalizedQueryInput,
  ExplorerAgentPolicyTrace,
  ExplorerAgentVerification,
  ExplorerAgentQueryInput,
  ExplorerAgentQueryResult,
  ExplorerAgentRetrievalPlan,
  ExplorerAgentRetrievalResult,
  ExplorerAgentSort,
  ExplorerAgentSourceKind,
  ExplorerAgentTimeWindow,
  ExplorerAgentSourceRef,
  ExplorerAgentToolTrace,
} from "../explorer/explorerAgentTypes.js";
import {
  isExplorerAgentEvidenceKind,
  isExplorerAgentMode,
} from "../explorer/explorerAgentTypes.js";
import type { AgentServiceContext } from "./agentServiceContext.js";
import { getEvidencePreview } from "./evidenceService.js";
import { verifyHederaAgentHcsReceipt } from "./hederaAgentService.js";
import { planExplorerAgentQuery } from "../explorer/explorerAgentPlanner.js";
import { buildExplorerAgentRetrievalPlan } from "./explorerAgentRetrievalPlanner.js";
import { runExplorerAgentRetrievalPlan } from "./explorerAgentRetrievalService.js";
import { getExplorerAgentRuntimeLimits } from "../explorer/explorerAgentRuntimeLimits.js";
import { withMcpAudit } from "./mcpAuditService.js";
import { config } from "../config.js";

const MAX_QUESTION_LEN = 1000;
const MAX_REF_LEN = 256;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;

const HCS_TRANSACTION_ID_RE = /\b0\.0\.\d+@\d{1,20}\.\d{1,9}\b/g;
const HCS_TOPIC_ID_RE = /\b0\.0\.\d+\b/g;
const EXPLICIT_TOPIC_ID_RE =
  /\b(?:topic|topic id|hcs topic|hcs topic id)\s*(?:is|=|:|#|id)?\s*(0\.0\.\d+)\b/i;

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function throwHttp(message: string, status: number): never {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  throw err;
}

function rejectControlChars(value: string, field: string): void {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throwHttp(`${field.toUpperCase()}_CONTAINS_CONTROL_CHARACTERS`, 400);
  }
}

function normalizeQuestion(value: unknown): string {
  const s = cleanString(value);

  if (!s) {
    throwHttp("EXPLORER_AGENT_QUESTION_REQUIRED", 400);
  }

  rejectControlChars(s, "question");

  if (s.length > MAX_QUESTION_LEN) {
    throwHttp("EXPLORER_AGENT_QUESTION_TOO_LONG", 400);
  }

  return s;
}

function normalizeOptionalRef(value: unknown, field: string): string | null {
  const s = cleanString(value);

  if (!s) return null;

  rejectControlChars(s, field);

  if (s.length > MAX_REF_LEN) {
    throwHttp(`${field.toUpperCase()}_TOO_LONG`, 400);
  }

  return s;
}

function normalizeOptionalEvidenceKind(
  value: unknown,
): ExplorerAgentEvidenceKind | null {
  const s = cleanString(value).toLowerCase();

  if (!s) return null;

  rejectControlChars(s, "subject_type");

  if (!isExplorerAgentEvidenceKind(s)) {
    throwHttp("INVALID_EXPLORER_AGENT_SUBJECT_TYPE", 400);
  }

  return s;
}

function normalizeOptionalMode(value: unknown): ExplorerAgentMode | null {
  const s = cleanString(value).toLowerCase();

  if (!s) return null;

  rejectControlChars(s, "mode");

  if (!isExplorerAgentMode(s)) {
    throwHttp("INVALID_EXPLORER_AGENT_MODE", 400);
  }

  return s;
}

function normalizeLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_LIMIT;
  }

  const n = Number(value);

  if (!Number.isFinite(n)) {
    throwHttp("EXPLORER_AGENT_LIMIT_MUST_BE_NUMERIC", 400);
  }

  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(n)));
}

function normalizeOptionalSort(value: unknown): ExplorerAgentSort {
  const s = cleanString(value).toLowerCase();

  if (!s) return "relevance";

  rejectControlChars(s, "sort");

  if (s === "relevance" || s === "latest" || s === "highest_score") {
    return s;
  }

  throwHttp("INVALID_EXPLORER_AGENT_SORT", 400);
}

function normalizeOptionalTimeWindow(value: unknown): ExplorerAgentTimeWindow {
  const s = cleanString(value).toLowerCase();

  if (!s) return "any";

  rejectControlChars(s, "time_window");

  if (
    s === "any" ||
    s === "today" ||
    s === "last_24h" ||
    s === "last_7d" ||
    s === "last_30d"
  ) {
    return s;
  }

  throwHttp("INVALID_EXPLORER_AGENT_TIME_WINDOW", 400);
}

function normalizeOptionalDatasetKey(value: unknown): string | null {
  const s = cleanString(value);

  if (!s) return null;

  rejectControlChars(s, "dataset_key");

  if (s.length > 512) {
    throwHttp("DATASET_KEY_TOO_LONG", 400);
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(s)) {
    throwHttp("INVALID_DATASET_KEY", 400);
  }

  return s;
}

function normalizeOptionalBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (value === false) return false;
  if (value === undefined || value === null || value === "") return false;

  const s = cleanString(value).toLowerCase();

  if (s === "true") return true;
  if (s === "false") return false;

  throwHttp("INVALID_BOOLEAN_QUERY_MODIFIER", 400);
}

function extractHcsTransactionId(question: string): string | null {
  const match = Array.from(question.matchAll(HCS_TRANSACTION_ID_RE))[0];
  return match?.[0] ?? null;
}

function transactionPayerAccountIds(question: string): Set<string> {
  const payers = new Set<string>();

  for (const match of question.matchAll(HCS_TRANSACTION_ID_RE)) {
    const txId = match[0];
    const payer = txId.split("@")[0];

    if (payer) {
      payers.add(payer);
    }
  }

  return payers;
}

function extractHcsTopicId(question: string): string | null {
  const explicit = question.match(EXPLICIT_TOPIC_ID_RE)?.[1];

  if (explicit) {
    return explicit;
  }

  const payerIds = transactionPayerAccountIds(question);
  const candidates = Array.from(question.matchAll(HCS_TOPIC_ID_RE))
    .map((match) => match[0])
    .filter((id) => !payerIds.has(id));

  return candidates[0] ?? null;
}

function normalizeExplorerAgentInput(
  rawInput: ExplorerAgentQueryInput,
): ExplorerAgentNormalizedQueryInput {
  const question = normalizeQuestion(rawInput.question);
  const suppliedHcsTransactionId = normalizeOptionalRef(
    rawInput.hcsTransactionId,
    "hcs_transaction_id",
  );
  const suppliedHcsTopicId = normalizeOptionalRef(
    rawInput.hcsTopicId,
    "hcs_topic_id",
  );

  return {
    question,
    mode: normalizeOptionalMode(rawInput.mode),
    subjectType: normalizeOptionalEvidenceKind(rawInput.subjectType),
    subjectId: normalizeOptionalRef(rawInput.subjectId, "subject_id"),
    hcsTransactionId: suppliedHcsTransactionId ?? extractHcsTransactionId(question),
    hcsTopicId: suppliedHcsTopicId ?? extractHcsTopicId(question),
    limit: normalizeLimit(rawInput.limit),
    sort: normalizeOptionalSort(rawInput.sort),
    timeWindow: normalizeOptionalTimeWindow(rawInput.timeWindow),
    datasetKey: normalizeOptionalDatasetKey(rawInput.datasetKey),
    verifiedOnly: normalizeOptionalBoolean(rawInput.verifiedOnly),
    anchoredOnly: normalizeOptionalBoolean(rawInput.anchoredOnly),
  };
}

function operationsForIntent(intent: ExplorerAgentIntent): HederaAgentOperation[] {
  if (intent === "agent_capabilities") {
    return ["agent_status", "explorer_query_plan"];
  }

  if (intent === "evidence_preview") {
    return [
      "explorer_query_plan",
      "explorer_evidence_preview",
      "explorer_answer_summarize",
    ];
  }

  if (intent === "proof_chain_explain") {
    return [
      "explorer_query_plan",
      "explorer_evidence_preview",
      "explorer_proof_chain_explain",
      "explorer_answer_summarize",
      "hcs_receipt_verify",
    ];
  }

  if (intent === "hcs_transaction_verify") {
    return [
      "explorer_query_plan",
      "mirror_transaction_read",
      "hcs_message_read",
      "hcs_receipt_verify",
      "explorer_answer_summarize",
    ];
  }

  if (intent === "evidence_search") {
    return [
      "explorer_query_plan",
      "explorer_evidence_search",
      "explorer_answer_summarize",
    ];
  }

  return ["explorer_query_plan"];
}

function toPolicyTrace(
  decisions: readonly {
    operation: HederaAgentOperation;
    allowed: boolean;
    reason: string;
  }[],
): ExplorerAgentPolicyTrace[] {
  return decisions.map((decision) => ({
    operation: decision.operation,
    allowed: decision.allowed,
    reason: decision.reason,
  }));
}

function evaluatePolicyForIntent(intent: ExplorerAgentIntent): ExplorerAgentPolicyTrace[] {
  const config = getHederaAgentConfigStatus();

  const decisions = evaluateHederaAgentPolicies(
    {
      network: config.network,
      verificationMode: config.verification_mode,
      mainnetWritesEnabled: config.mainnet_writes_enabled,
      hcsReceiptAnchoringEnabled: config.hcs_receipt_anchoring_enabled,
      userWritesEnabled: config.user_writes_enabled,
    },
    operationsForIntent(intent),
  );

  const denied = decisions.find((decision) => !decision.allowed);

  if (denied) {
    throwHttp(denied.reason, 403);
  }

  return toPolicyTrace(decisions);
}

function veraHcsTransactionHref(transactionId: string): string {
  return `${config.veraPublicSiteUrl}/hcs/transactions/${encodeURIComponent(transactionId)}`;
}

function sourceKindFromEvidenceSource(source: string): ExplorerAgentSourceKind {
  if (source === "cache") return "vera_cache";
  if (source === "local_demo") return "vera_local_demo";
  return "vera_evidence";
}

function toolTrace(input: {
  toolName: string;
  auditId: string | null;
  status?: ExplorerAgentToolTrace["status"];
}): ExplorerAgentToolTrace {
  return {
    tool_name: input.toolName,
    audit_id: input.auditId,
    status: input.status ?? "completed",
  };
}

function sourceFromEvidenceRecord(input: {
  kind: ExplorerAgentSourceKind;
  subjectType: string;
  subjectId: string;
  href?: string | null;
}): ExplorerAgentSourceRef {
  return {
    kind: input.kind,
    label: `${input.subjectType}:${input.subjectId}`,
    ref: input.subjectId,
    href: input.href ?? null,
  };
}

type AgentHcsVerificationSummary = Readonly<{
  verified: boolean;
  verificationLevel: "receipt_metadata";
  transactionId: string;
  topicId: string | null;
  consensusTimestamp: string | null;
  sequenceNumber: number | null;
  runningHash: string | null;
  payerAccountId: string | null;
  transactionResult: string | null;
  warnings: string[];
}>;

function sourceFromHcsVerification(input: {
  transactionId: string;
  topicId?: string | null;
}): ExplorerAgentSourceRef[] {
  const sources: ExplorerAgentSourceRef[] = [
    {
      kind: "hedera_mirror",
      label: "hcs_transaction",
      ref: input.transactionId,
      href: veraHcsTransactionHref(input.transactionId),
    },
  ];

  if (input.topicId) {
    sources.push({
      kind: "hedera_hcs",
      label: "hcs_topic",
      ref: input.topicId,
      href: null,
    });
  }

  return sources;
}

function formatHcsVerificationSummary(
  summary: AgentHcsVerificationSummary | null,
): string | null {
  if (!summary) return null;

  return [
    summary.verified
      ? "Hedera receipt verification: passed."
      : "Hedera receipt verification: not fully verified.",
    "Verification level: receipt metadata. Encrypted payload content was not decrypted by this agent flow.",
    `Mirror transaction: ${summary.transactionId}.`,
    summary.topicId ? `HCS topic: ${summary.topicId}.` : null,
    summary.transactionResult
      ? `Transaction result: ${summary.transactionResult}.`
      : null,
    summary.consensusTimestamp
      ? `Consensus timestamp: ${summary.consensusTimestamp}.`
      : null,
    summary.sequenceNumber !== null
      ? `HCS sequence: ${summary.sequenceNumber}.`
      : null,
    summary.runningHash ? `Running hash: ${summary.runningHash}.` : null,
    summary.payerAccountId ? `Payer: ${summary.payerAccountId}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function verificationFromHcsSummary(
  summary: AgentHcsVerificationSummary | null,
): ExplorerAgentVerification | null {
  if (!summary) return null;

  return {
    kind: "hcs_receipt",
    verified: summary.verified,
    verification_level: summary.verificationLevel,
    transaction_id: summary.transactionId,
    topic_id: summary.topicId,
    consensus_timestamp: summary.consensusTimestamp,
    sequence_number: summary.sequenceNumber,
    running_hash: summary.runningHash,
    payer_account_id: summary.payerAccountId,
    transaction_result: summary.transactionResult,
    warnings: summary.warnings,
  };
}

async function runAuditedHcsReceiptVerification(input: {
  transactionId: string;
  topicId: string | null;
  context: AgentServiceContext;
  intent: ExplorerAgentIntent;
}): Promise<{
  summary: AgentHcsVerificationSummary | null;
  tool: ExplorerAgentToolTrace;
  sources: ExplorerAgentSourceRef[];
  warnings: string[];
}> {
  const toolName = "hedera.restricted_adapter.hcs_receipt_verify";

  try {
    const { result, audit } = await withMcpAudit(
      {
        toolName,
        input: {
          transactionId: input.transactionId,
          topicId: input.topicId,
        },
        context: input.context,
        metadata: {
          intent: input.intent,
          adapter: "restricted_hedera_read_adapter",
          verification_level: "receipt_metadata",
        },
      },
      async () =>
        verifyHederaAgentHcsReceipt(
          {
            transactionId: input.transactionId,
            topicId: input.topicId,
          },
          input.context,
        ),
    );

    return {
      summary: {
        verified: result.verified,
        verificationLevel: "receipt_metadata",
        transactionId: result.transaction_id,
        topicId: result.topic_id,
        consensusTimestamp: result.consensus_timestamp,
        sequenceNumber: result.sequence_number,
        runningHash: result.running_hash,
        payerAccountId: result.payer_account_id,
        transactionResult: result.transaction_result,
        warnings: result.warnings,
      },
      tool: toolTrace({
        toolName,
        auditId: audit?.id ?? null,
      }),
      sources: sourceFromHcsVerification({
        transactionId: result.transaction_id,
        topicId: result.topic_id,
      }),
      warnings: result.warnings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "HCS_RECEIPT_VERIFICATION_FAILED";

    return {
      summary: null,
      tool: toolTrace({
        toolName,
        auditId: null,
        status: "failed",
      }),
      sources: sourceFromHcsVerification({
        transactionId: input.transactionId,
        topicId: input.topicId,
      }),
      warnings: [`Hedera receipt verification failed: ${message}`],
    };
  }
}

function buildCapabilityResult(
  policy: ExplorerAgentPolicyTrace[],
): ExplorerAgentQueryResult {
  return {
    ok: true,
    intent: "agent_capabilities",
    answer:
      "I can search Vera Anchor evidence, preview SAGE/CIPHER/dataset/HCS/proof-card records, explain proof chains, and verify Hedera/HCS references when verification tools are available. I cannot move funds, accept private keys, expose raw Agent Kit tools, or execute arbitrary Hedera actions.",
    confidence: "high",
    sources: [],
    evidence_items: [],
    tools: [],
    policy,
    warnings: [],
    verification: null,
  };
}

function buildUnknownResult(
  policy: ExplorerAgentPolicyTrace[],
): ExplorerAgentQueryResult {
  return {
    ok: true,
    intent: "unknown",
    answer:
      "I could not classify that Explorer question yet. Try asking about a SAGE result, CIPHER result, dataset, proof card, HCS transaction, or proof chain.",
    confidence: "low",
    sources: [],
    evidence_items: [],
    tools: [],
    policy,
    warnings: ["Question did not match a supported deterministic Explorer Agent intent."],
    verification: null,
  };
}

function searchScopeText(input: ExplorerAgentNormalizedQueryInput): string {
  if (input.subjectType === "cipher_result") return "CIPHER results";
  if (input.subjectType === "sage_result") return "SAGE results";
  if (input.subjectType === "dataset") return "datasets";
  if (input.subjectType === "hcs_transaction") return "HCS transactions";
  if (input.subjectType === "proof_card") return "proof-card records";

  return "CIPHER results, SAGE results, datasets, and cached Vera evidence";
}

function searchFailureAnswer(input: {
  normalized: ExplorerAgentNormalizedQueryInput;
  compiled: ExplorerAgentCompiledQuery;
  retrievalPlan: ExplorerAgentRetrievalPlan;
  retrievalResult: ExplorerAgentRetrievalResult;
  warnings: readonly string[];
}): string {
  const modifierSummary = searchModifierSummary(input.normalized);
  return [
    `I searched ${searchScopeText(input.normalized)} for: "${input.normalized.question}".`,
    input.compiled.searchText
      ? `Compiled search text: "${input.compiled.searchText}".`
      : null,
    modifierSummary ? `Applied query modifiers: ${modifierSummary}.` : null,
    "No matching live Vera Anchor evidence records were returned for that search.",
    input.compiled.reasons.length > 0
      ? ["Plan trace:", ...input.compiled.reasons.slice(0, 6).map((reason) => `- ${reason}`)].join("\n")
      : null,
    retrievalPlanSummary(input.retrievalPlan),
    retrievalTraceSummary(input.retrievalResult),
    retrievalOperationalSummary(input.retrievalResult),
    input.warnings.length > 0
      ? [
          "Search caveats:",
          ...Array.from(new Set(input.warnings)).map((warning) => `- ${warning}`),
        ].join("\n")
      : null,
    [
      "Next options:",
      "- Try a broader biomedical, dataset, job, result, donor, model, or disease term.",
      "- Ask for a specific surface, such as CIPHER results, SAGE results, or datasets.",
      "- Paste an exact result ID, dataset key, or HCS transaction ID.",
      "- Select an existing evidence card and ask me to explain the proof chain.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function queryModifierWarnings(
  input: ExplorerAgentNormalizedQueryInput,
): string[] {
  const warnings: string[] = [];

  if (input.sort === "highest_score" && !input.datasetKey) {
    warnings.push(
      [
        "Highest-score search requires a dataset key for the Explorer run-score endpoint.",
        "I used the normal evidence search path and deterministic local ranking instead.",
      ].join(" "),
    );
  }

  if (
    input.sort === "highest_score" &&
    input.datasetKey &&
    input.subjectType !== "cipher_result" &&
    input.subjectType !== "sage_result"
  ) {
    warnings.push(
      [
        "Highest-score search is currently supported for SAGE and CIPHER compute results.",
        "For this search scope, I used deterministic local ranking instead.",
      ].join(" "),
    );
  }

  if (
    input.timeWindow === "last_24h" ||
    input.timeWindow === "last_7d" ||
    input.timeWindow === "last_30d"
  ) {
    warnings.push(
      [
       `The ${input.timeWindow} window is normalized by the agent, but the current public Explorer evidence search path only maps an exact day filter directly.`,
        "I used live search plus deterministic local ranking/filtering where possible.",
      ].join(" "),
    );
  }

  if (input.verifiedOnly) {
    warnings.push(
      [
        "Verified-only filtering is based on public normalized evidence indicators such as mirror-verified status.",
        "It does not decrypt private payloads or perform private artifact inspection.",
      ].join(" "),
    );
  }

  if (input.anchoredOnly) {
    warnings.push(
      "Anchored-only filtering keeps evidence records that expose a public HCS transaction ID or HCS topic ID.",
    );
  }

  return warnings;
}

function searchModifierSummary(input: ExplorerAgentNormalizedQueryInput): string | null {
  const parts: string[] = [];

  if (input.sort !== "relevance") {
    parts.push(`sort=${input.sort}`);
  }

  if (input.timeWindow !== "any") {
    parts.push(`timeWindow=${input.timeWindow}`);
  }

  if (input.datasetKey) {
    parts.push(`datasetKey=${input.datasetKey}`);
  }

  if (input.verifiedOnly) {
    parts.push("verifiedOnly=true");
  }

  if (input.anchoredOnly) {
    parts.push("anchoredOnly=true");
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

function retrievalTraceSummary(
  result: ExplorerAgentRetrievalResult,
): string | null {
  const meaningful = result.stepTraces.filter(
    (step) => step.source !== "skipped",
  );

  if (meaningful.length === 0) return null;

  return [
    "Retrieval trace:",
    ...meaningful.slice(0, 8).map((step) =>
      [
        `- ${step.label}`,
        `type=${step.type}`,
        `source=${step.source}`,
        `items=${step.itemCount}`,
        step.datasetKey ? `datasetKey=${step.datasetKey}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    ),
  ].join("\n");
}

function retrievalPlanSummary(plan: ExplorerAgentRetrievalPlan): string | null {
  if (plan.steps.length === 0) return null;

  return [
    "Retrieval plan:",
    ...plan.steps.slice(0, 8).map((step) =>
      `- ${step.label}: ${step.reason}`,
    ),
  ].join("\n");
}

function evidenceTypeCounts(result: ExplorerAgentRetrievalResult): string | null {
  const counts = new Map<string, number>();

  for (const item of result.items) {
    counts.set(item.subject_type, (counts.get(item.subject_type) ?? 0) + 1);
  }

  if (counts.size === 0) return null;

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count} ${type}`)
    .join(", ");
}

function retrievalQualitySummary(
  result: ExplorerAgentRetrievalResult,
): string | null {
  if (result.quality.totalItems === 0) return null;

  return [
    "Retrieval quality:",
    `- ranked records: ${result.quality.totalItems}`,
    `- source mix: ${result.quality.liveItems} live, ${result.quality.cacheItems} cache, ${result.quality.localDemoItems} local demo`,
    `- evidence types: ${evidenceTypeCounts(result) ?? "none"}`,
    `- anchored records: ${result.quality.anchoredItems}`,
    `- mirror-verified records: ${result.quality.mirrorVerifiedItems}`,
    `- proof-card links: ${result.quality.proofCardItems}`,
    result.quality.topScore !== null
      ? `- top score: ${result.quality.topScore} (${result.quality.confidence} confidence)`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function retrievalOperationalSummary(
  result: ExplorerAgentRetrievalResult,
): string | null {
  return [
    "Operational guardrails:",
    `- retrieval elapsed: ${result.execution.elapsedMs}ms`,
    `- search steps executed: ${result.execution.executedSearchStepCount}/${result.execution.maxSearchSteps}`,
    `- total steps attempted: ${result.execution.attemptedStepCount}/${result.execution.maxTotalSteps}`,
    `- step timeouts: ${result.execution.timeoutStepCount}`,
    `- failed steps: ${result.execution.failedStepCount}`,
    result.execution.budgetExhausted
      ? "- budget status: exhausted"
      : "- budget status: within limits",
    result.execution.localDemoFallbackAllowed
      ? "- local demo fallback: allowed"
      : "- local demo fallback: disabled",
  ].join("\n");
}

function topMatchReasonSummary(
  result: ExplorerAgentRetrievalResult,
): string | null {
  const top = result.ranks[0];

  if (!top) return null;

  const lines = [
    `Why this ranked first:`,
    ...top.reasons.slice(0, 6).map((reason) => `- ${reason}`),
  ];

  if (top.penalties.length > 0) {
    lines.push(
      "Caveats:",
      ...top.penalties.slice(0, 4).map((penalty) => `- ${penalty}`),
    );
  }

  return lines.join("\n");
}

function nextBestActionSummary(result: ExplorerAgentRetrievalResult): string {
  const top = result.items[0] ?? null;

  if (!top) {
    return "Next best action: try a broader term, provide a specific result ID, dataset key, proof card, or HCS transaction.";
  }

  if (top.hcs_transaction_id) {
    return "Next best action: verify the HCS anchor or inspect the proof chain for the top evidence record.";
  }

  return "Next best action: inspect the selected evidence record, then verify or export if an anchor/proof card is available.";
}

function searchConfidence(input: {
  normalized: ExplorerAgentNormalizedQueryInput;
  itemCount: number;
  warningCount: number;
  retrievalResult?: ExplorerAgentRetrievalResult;
}): ExplorerAgentQueryResult["confidence"] {
  if (input.itemCount === 0) return "low";

  if (input.retrievalResult) {
    if (
      input.retrievalResult.quality.confidence === "high" &&
      input.warningCount === 0
    ) {
      return "high";
    }

    if (input.retrievalResult.quality.confidence === "low") {
      return "low";
    }
  }

  if (
    input.normalized.sort === "highest_score" &&
    !input.normalized.datasetKey
  ) {
    return "medium";
  }

  if (input.warningCount > 0) {
    return "medium";
  }

  return "high";
}

function searchSuccessAnswer(input: {
  count: number;
  scope: string;
  strongestTitle: string;
  strongestSummary: string;
  modifierSummary: string | null;
  compiledSearchText: string | null;
  planReasons: readonly string[];
  retrievalTrace: string | null;
  resolvedDatasetKey: string | null;
  qualitySummary: string | null;
  operationalSummary: string | null;
  topMatchReasons: string | null;
  nextBestAction: string;
}): string {
  return [
    `Found ${input.count} evidence record(s) across ${input.scope}.`,
    input.compiledSearchText
      ? `Compiled search text: "${input.compiledSearchText}".`
      : null,
    input.resolvedDatasetKey
      ? `Resolved dataset key: ${input.resolvedDatasetKey}.`
      : null,
    input.modifierSummary ? `Applied query modifiers: ${input.modifierSummary}.` : null,
    `Strongest match: ${input.strongestTitle}.`,
    input.strongestSummary,
    input.qualitySummary,
    input.operationalSummary,
    input.topMatchReasons,
    input.planReasons.length > 0
      ? ["Plan trace:", ...input.planReasons.slice(0, 6).map((reason) => `- ${reason}`)].join("\n")
      : null,
    input.retrievalTrace,
    input.nextBestAction,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function runEvidencePreview(input: {
  normalized: ExplorerAgentNormalizedQueryInput;
  context: AgentServiceContext;
  policy: ExplorerAgentPolicyTrace[];
  intent: ExplorerAgentIntent;
}): Promise<ExplorerAgentQueryResult> {
  if (!input.normalized.subjectType || !input.normalized.subjectId) {
    throwHttp("EXPLORER_AGENT_SUBJECT_REQUIRED_FOR_PREVIEW", 400);
  }

  const toolName = "vera.explorer.evidence_preview";

  const { result, audit } = await withMcpAudit(
    {
      toolName,
      input: input.normalized,
      context: input.context,
      metadata: {
        intent: input.intent,
      },
    },
    async () =>
      getEvidencePreview(
        {
          subjectType: input.normalized.subjectType as string,
          subjectId: input.normalized.subjectId as string,
        },
        input.context,
      ),
  );

  const warnings: string[] = queryModifierWarnings(input.normalized);

  if (!result.hcs_transaction_id) {
    warnings.push("Evidence record does not include an HCS transaction ID yet.");
  }

  if (!result.hcs_topic_id) {
    warnings.push("Evidence record does not include an HCS topic ID yet.");
  }

  const tools: ExplorerAgentToolTrace[] = [
    toolTrace({
      toolName,
      auditId: audit?.id ?? null,
    }),
  ];

  const sources: ExplorerAgentSourceRef[] = [
    sourceFromEvidenceRecord({
      kind: "vera_evidence",
      subjectType: result.subject_type,
      subjectId: result.subject_id,
      href: result.verify_url,
    }),
  ];

  let hcsSummary: AgentHcsVerificationSummary | null = null;

  if (result.hcs_transaction_id) {
    const verification = await runAuditedHcsReceiptVerification({
      transactionId: result.hcs_transaction_id,
      topicId: result.hcs_topic_id,
      context: input.context,
      intent: input.intent,
    });

    hcsSummary = verification.summary;
    tools.push(verification.tool);
    sources.push(...verification.sources);
    warnings.push(...verification.warnings);
  }

  const hcsSummaryText = formatHcsVerificationSummary(hcsSummary);

  return {
    ok: true,
    intent: input.intent,
    answer: [
      result.title,
      result.summary,
      result.hcs_transaction_id
        ? `HCS transaction: ${result.hcs_transaction_id}`
        : "No HCS transaction is present on this evidence record.",
      result.hcs_topic_id
        ? `HCS topic: ${result.hcs_topic_id}`
        : "No HCS topic is present on this evidence record.",
      hcsSummaryText,
      result.verify_url ? `Verify URL: ${result.verify_url}` : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
    confidence:
      result.hcs_transaction_id && hcsSummary?.verified
        ? "high"
        : result.hcs_transaction_id
          ? "medium"
          : "medium",
    sources,
    tools,
    evidence_items: [result],
    policy: input.policy,
    warnings: Array.from(new Set(warnings)),
    verification: verificationFromHcsSummary(hcsSummary),
  };
}

async function runEvidenceSearch(input: {
  normalized: ExplorerAgentNormalizedQueryInput;
  compiled: ExplorerAgentCompiledQuery;
  context: AgentServiceContext;
  policy: ExplorerAgentPolicyTrace[];
  intent: ExplorerAgentIntent;
}): Promise<ExplorerAgentQueryResult> {
  const toolName = "vera.explorer.evidence_search";

  const retrievalPlan = buildExplorerAgentRetrievalPlan({
    normalized: input.normalized,
    compiled: input.compiled,
  });
  const runtimeLimits = getExplorerAgentRuntimeLimits();

  const { result, audit } = await withMcpAudit(
    {
      toolName,
      input: {
        normalized: input.normalized,
        compiled: input.compiled,
        retrievalPlan,
      },
      context: input.context,
      metadata: {
        intent: input.intent,
        compiled_search_text: input.compiled.searchText,
        compiled_evidence_types: input.compiled.evidenceTypes,
        compiled_constraints: input.compiled.constraints.map((constraint) => constraint.kind),
        retrieval_steps: retrievalPlan.steps.map((step) => step.kind),
        runtime_limits: runtimeLimits,
      },
    },
    async () =>
      runExplorerAgentRetrievalPlan({
        plan: retrievalPlan,
        normalized: input.normalized,
        compiled: input.compiled,
        context: input.context,
      }),
  );

  const kind = sourceKindFromEvidenceSource(result.source);

  const sources = result.items.map((item) =>
    sourceFromEvidenceRecord({
      kind,
      subjectType: item.subject_type,
      subjectId: item.subject_id,
      href: item.verify_url,
    }),
  );

  const warnings: string[] = [
    ...input.compiled.warnings,
    ...retrievalPlan.warnings,
    ...result.warnings,
    ...queryModifierWarnings(input.normalized),
  ];

  if (result.source === "local_demo") {
    warnings.push("Returned local demo evidence because no live Explorer evidence matched.");
  }

  if (result.items.length === 0) {
    warnings.push("No matching evidence records were found.");
  }

  if (
    retrievalPlan.shouldClarify &&
    result.items.length === 0 &&
    retrievalPlan.clarificationQuestion
  ) {
    return {
      ok: true,
      intent: input.intent,
      answer: [
        retrievalPlan.clarificationQuestion,
        input.compiled.searchText
          ? `I compiled the searchable terms as "${input.compiled.searchText}", but did not find a concrete evidence record to act on.`
          : null,
        retrievalPlanSummary(retrievalPlan),
        warnings.length > 0
          ? ["Search caveats:", ...Array.from(new Set(warnings)).map((warning) => `- ${warning}`)].join("\n")
          : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      confidence: "low",
      sources,
      tools: [
        toolTrace({
          toolName,
          auditId: audit?.id ?? null,
        }),
      ],
      evidence_items: result.items,
      policy: input.policy,
      warnings: Array.from(new Set(warnings)),
      verification: null,
    };
  }

  const strongest = result.items[0] ?? null;

  return {
    ok: true,
    intent: input.intent,
    answer: strongest
      ? searchSuccessAnswer({
          count: result.items.length,
          scope: searchScopeText(input.normalized),
          strongestTitle: strongest.title,
          strongestSummary: strongest.summary,
          modifierSummary: searchModifierSummary(input.normalized),
          compiledSearchText: input.compiled.searchText || null,
          planReasons: [...input.compiled.reasons, ...result.reasons],
          retrievalTrace: retrievalTraceSummary(result),
          resolvedDatasetKey: result.resolvedDatasetKey,
          qualitySummary: retrievalQualitySummary(result),
          operationalSummary: retrievalOperationalSummary(result),
          topMatchReasons: topMatchReasonSummary(result),
          nextBestAction: nextBestActionSummary(result),
        })
      : searchFailureAnswer({
          normalized: input.normalized,
          compiled: input.compiled,
          retrievalPlan,
          retrievalResult: result,
          warnings: Array.from(new Set(warnings)),
        }),
    confidence: searchConfidence({
      normalized: input.normalized,
      itemCount: result.items.length,
      warningCount: warnings.length,
      retrievalResult: result,
    }),
    sources,
    tools: [
      toolTrace({
        toolName,
        auditId: audit?.id ?? null,
      }),
    ],
    evidence_items: result.items,
    policy: input.policy,
    warnings: Array.from(new Set(warnings)),
    verification: null,
  };
}

async function runHcsTransactionVerification(input: {
  normalized: ExplorerAgentNormalizedQueryInput;
  context: AgentServiceContext;
  policy: ExplorerAgentPolicyTrace[];
}): Promise<ExplorerAgentQueryResult> {
  if (!input.normalized.hcsTransactionId) {
    throwHttp("HCS_TRANSACTION_ID_REQUIRED_FOR_VERIFICATION", 400);
  }

  const verification = await runAuditedHcsReceiptVerification({
    transactionId: input.normalized.hcsTransactionId,
    topicId: input.normalized.hcsTopicId,
    context: input.context,
    intent: "hcs_transaction_verify",
  });

  const summaryText = formatHcsVerificationSummary(verification.summary);

  return {
    ok: true,
    intent: "hcs_transaction_verify",
    answer: [
      verification.summary?.verified
        ? "Hedera HCS receipt verification passed."
        : "Hedera HCS receipt verification did not fully pass.",
      summaryText,
    ]
      .filter(Boolean)
      .join("\n\n"),
    confidence: verification.summary?.verified ? "high" : "low",
    sources: verification.sources,
    tools: [verification.tool],
    evidence_items: [],
    policy: input.policy,
    warnings: verification.warnings,
    verification: verificationFromHcsSummary(verification.summary),
  };
}

export async function runExplorerAgentQuery(
  rawInput: ExplorerAgentQueryInput,
  context: AgentServiceContext,
): Promise<ExplorerAgentQueryResult> {
  const initialNormalized = normalizeExplorerAgentInput(rawInput);
  const planned = planExplorerAgentQuery(initialNormalized);
  const { normalized, intent, compiled } = planned;
  const policy = evaluatePolicyForIntent(intent);

  if (intent === "agent_capabilities") {
    return buildCapabilityResult(policy);
  }

  if (intent === "unknown") {
    return buildUnknownResult(policy);
  }

  if (intent === "hcs_transaction_verify") {
    return runHcsTransactionVerification({
      normalized,
      context,
      policy,
    });
  }

  if (intent === "evidence_preview" || intent === "proof_chain_explain") {
    if (normalized.subjectType && normalized.subjectId) {
      return runEvidencePreview({
        normalized,
        context,
        policy,
        intent,
      });
    }

    return runEvidenceSearch({
      normalized,
      compiled,
      context,
      policy,
      intent,
    });
  }

  return runEvidenceSearch({
    normalized,
    compiled,
    context,
    policy,
    intent,
  });
}