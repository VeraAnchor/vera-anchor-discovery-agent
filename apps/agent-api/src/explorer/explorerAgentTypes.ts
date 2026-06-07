// apps/agent-api/src/explorer/explorerAgentTypes.ts

import type { NormalizedEvidenceRecord } from "@vera-discovery/proof-core";

export type ExplorerAgentIntent =
  | "agent_capabilities"
  | "evidence_search"
  | "evidence_preview"
  | "proof_chain_explain"
  | "hcs_transaction_verify"
  | "unknown";

export type ExplorerAgentMode =
  | "search"
  | "explain_selected"
  | "verify_hcs"
  | "capabilities";

export type ExplorerAgentConfidence = "high" | "medium" | "low";

export type ExplorerAgentSort =
  | "relevance"
  | "latest"
  | "highest_score";

export type ExplorerAgentTimeWindow =
  | "any"
  | "today"
  | "last_24h"
  | "last_7d"
  | "last_30d";

export type ExplorerAgentTemporalRange = Readonly<{
  startDate: string | null;
  endDate: string | null;
  label: string;
  sourceText: string;
  confidence: ExplorerAgentConfidence;
  timezone: "UTC";
}>;

export type ExplorerAgentQuantityConstraint = Readonly<{
  limit: number | null;
  sourceText: string;
  confidence: ExplorerAgentConfidence;
}>;

export type ExplorerAgentEvidenceKind =
  | "sage_result"
  | "cipher_result"
  | "dataset"
  | "hcs_transaction"
  | "proof_card";

export type ExplorerAgentSourceKind =
  | "vera_evidence"
  | "vera_cache"
  | "vera_local_demo"
  | "hedera_mirror"
  | "hedera_hcs"
  | "mcp_audit";

export type ExplorerAgentToolStatus = "completed" | "rejected" | "failed";

export type ExplorerAgentQueryConstraintKind =
  | "recent"
  | "date_range"
  | "strongest"
  | "anchored"
  | "verified"
  | "explain"
  | "export"
  | "dataset_scoped"
  | "quantity";

export type ExplorerAgentQueryConstraintSource =
  | "explicit_field"
  | "identifier"
  | "language";

export type ExplorerAgentQueryConstraint = Readonly<{
  kind: ExplorerAgentQueryConstraintKind;
  value: string | number | boolean | ExplorerAgentTemporalRange | null;
  confidence: ExplorerAgentConfidence;
  source: ExplorerAgentQueryConstraintSource;
}>;

export type ExplorerAgentCompiledQuery = Readonly<{
  originalQuestion: string;
  searchText: string;
  mode: ExplorerAgentMode | null;
  intent: ExplorerAgentIntent;
  evidenceTypes: readonly ExplorerAgentEvidenceKind[];
  subjectType: ExplorerAgentEvidenceKind | null;
  subjectId: string | null;
  hcsTransactionId: string | null;
  hcsTopicId: string | null;
  datasetKey: string | null;
  temporalRange: ExplorerAgentTemporalRange | null;
  quantity: ExplorerAgentQuantityConstraint | null;
  constraints: readonly ExplorerAgentQueryConstraint[];
  confidence: ExplorerAgentConfidence;
  reasons: readonly string[];
  warnings: readonly string[];
}>;

export type ExplorerAgentRetrievalStepKind =
  | "exact_subject_preview"
  | "exact_hcs_verify"
  | "search_primary_surface"
  | "search_broad_evidence"
  | "search_dataset_candidates"
  | "search_top_scores_for_dataset";

export type ExplorerAgentRetrievalStep = Readonly<{
  kind: ExplorerAgentRetrievalStepKind;
  label: string;
  type: ExplorerAgentEvidenceKind | "all";
  query: string;
  datasetKey: string | null;
  limit: number;
  required: boolean;
  reason: string;
}>;

export type ExplorerAgentRetrievalPlan = Readonly<{
  steps: readonly ExplorerAgentRetrievalStep[];
  searchText: string;
  shouldClarify: boolean;
  clarificationQuestion: string | null;
  warnings: readonly string[];
  reasons: readonly string[];
}>;

export type ExplorerAgentRetrievalStepTrace = Readonly<{
  kind: ExplorerAgentRetrievalStepKind;
  label: string;
  type: ExplorerAgentEvidenceKind | "all";
  query: string;
  datasetKey: string | null;
  source:
    | "live"
    | "cache"
    | "local_demo"
    | "local_demo_blocked"
    | "skipped"
    | "failed"
    | "timeout"
    | "budget_exhausted";
  itemCount: number;
  required: boolean;
  reason: string;
  warning: string | null;
}>;

export type ExplorerAgentEvidenceRank = Readonly<{
  subjectType: ExplorerAgentEvidenceKind;
  subjectId: string;
  score: number;
  confidence: ExplorerAgentConfidence;
  reasons: readonly string[];
  penalties: readonly string[];
}>;

export type ExplorerAgentRetrievalQuality = Readonly<{
  totalItems: number;
  liveItems: number;
  cacheItems: number;
  localDemoItems: number;
  anchoredItems: number;
  mirrorVerifiedItems: number;
  proofCardItems: number;
  evidenceTypes: readonly ExplorerAgentEvidenceKind[];
  topScore: number | null;
  confidence: ExplorerAgentConfidence;
  warnings: readonly string[];
}>;

export type ExplorerAgentRetrievalExecution = Readonly<{
  startedAt: string;
  elapsedMs: number;
  attemptedStepCount: number;
  executedSearchStepCount: number;
  skippedStepCount: number;
  failedStepCount: number;
  timeoutStepCount: number;
  maxSearchSteps: number;
  maxTotalSteps: number;
  perStepTimeoutMs: number;
  totalTimeoutMs: number;
  localDemoFallbackAllowed: boolean;
  budgetExhausted: boolean;
}>;

export type ExplorerAgentRetrievalResult = Readonly<{
  items: NormalizedEvidenceRecord[];
  source: "live" | "cache" | "local_demo";
  resolvedDatasetKey: string | null;
  stepTraces: readonly ExplorerAgentRetrievalStepTrace[];
  ranks: readonly ExplorerAgentEvidenceRank[];
  quality: ExplorerAgentRetrievalQuality;
  execution: ExplorerAgentRetrievalExecution;
  warnings: readonly string[];
  reasons: readonly string[];
}>;

export type ExplorerAgentQueryInput = Readonly<{
  question: string;
  mode?: ExplorerAgentMode | string | null;
  subjectType?: ExplorerAgentEvidenceKind | string | null;
  subjectId?: string | null;
  hcsTransactionId?: string | null;
  hcsTopicId?: string | null;
  limit?: number | null;
  sort?: ExplorerAgentSort | string | null;
  timeWindow?: ExplorerAgentTimeWindow | string | null;
  datasetKey?: string | null;
  verifiedOnly?: boolean | null;
  anchoredOnly?: boolean | null;
}>;

export type ExplorerAgentNormalizedQueryInput = Readonly<{
  question: string;
  mode: ExplorerAgentMode | null;
  subjectType: ExplorerAgentEvidenceKind | null;
  subjectId: string | null;
  hcsTransactionId: string | null;
  hcsTopicId: string | null;
  limit: number;
  sort: ExplorerAgentSort;
  timeWindow: ExplorerAgentTimeWindow;
  datasetKey: string | null;
  verifiedOnly: boolean;
  anchoredOnly: boolean;
}>;

export type ExplorerAgentSourceRef = Readonly<{
  kind: ExplorerAgentSourceKind;
  label: string;
  ref: string;
  href: string | null;
}>;

export type ExplorerAgentToolTrace = Readonly<{
  tool_name: string;
  audit_id: string | null;
  status: ExplorerAgentToolStatus;
}>;

export type ExplorerAgentPolicyTrace = Readonly<{
  operation: string;
  allowed: boolean;
  reason: string;
}>;

export type ExplorerAgentVerification = Readonly<{
  kind: "hcs_receipt";
  verified: boolean;
  verification_level: "receipt_metadata";
  transaction_id: string;
  topic_id: string | null;
  consensus_timestamp: string | null;
  sequence_number: number | null;
  running_hash: string | null;
  payer_account_id: string | null;
  transaction_result: string | null;
  warnings: string[];
}>;

export type ExplorerAgentQueryResult = Readonly<{
  ok: true;
  intent: ExplorerAgentIntent;
  answer: string;
  confidence: ExplorerAgentConfidence;
  sources: ExplorerAgentSourceRef[];
  tools: ExplorerAgentToolTrace[];
  policy: ExplorerAgentPolicyTrace[];
  warnings: string[];
  evidence_items: NormalizedEvidenceRecord[];
  verification: ExplorerAgentVerification | null;
}>;

export const EXPLORER_AGENT_EVIDENCE_KINDS: readonly ExplorerAgentEvidenceKind[] =
  [
    "sage_result",
    "cipher_result",
    "dataset",
    "hcs_transaction",
    "proof_card",
  ] as const;

export const EXPLORER_AGENT_MODES: readonly ExplorerAgentMode[] = [
  "search",
  "explain_selected",
  "verify_hcs",
  "capabilities",
] as const;

export function isExplorerAgentEvidenceKind(
  value: string,
): value is ExplorerAgentEvidenceKind {
  return (EXPLORER_AGENT_EVIDENCE_KINDS as readonly string[]).includes(value);
}

export function isExplorerAgentMode(value: string): value is ExplorerAgentMode {
  return (EXPLORER_AGENT_MODES as readonly string[]).includes(value);
}