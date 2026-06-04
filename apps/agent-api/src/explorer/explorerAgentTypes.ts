// apps/agent-api/src/explorer/explorerAgentTypes.ts

export type ExplorerAgentIntent =
  | "agent_capabilities"
  | "evidence_search"
  | "evidence_preview"
  | "proof_chain_explain"
  | "hcs_transaction_verify"
  | "unknown";

export type ExplorerAgentConfidence = "high" | "medium" | "low";

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

export type ExplorerAgentQueryInput = Readonly<{
  question: string;
  subjectType?: ExplorerAgentEvidenceKind | string | null;
  subjectId?: string | null;
  hcsTransactionId?: string | null;
  hcsTopicId?: string | null;
  limit?: number | null;
}>;

export type ExplorerAgentNormalizedQueryInput = Readonly<{
  question: string;
  subjectType: ExplorerAgentEvidenceKind | null;
  subjectId: string | null;
  hcsTransactionId: string | null;
  hcsTopicId: string | null;
  limit: number;
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

export type ExplorerAgentQueryResult = Readonly<{
  ok: true;
  intent: ExplorerAgentIntent;
  answer: string;
  confidence: ExplorerAgentConfidence;
  sources: ExplorerAgentSourceRef[];
  tools: ExplorerAgentToolTrace[];
  policy: ExplorerAgentPolicyTrace[];
  warnings: string[];
}>;

export const EXPLORER_AGENT_EVIDENCE_KINDS: readonly ExplorerAgentEvidenceKind[] =
  [
    "sage_result",
    "cipher_result",
    "dataset",
    "hcs_transaction",
    "proof_card",
  ] as const;

export function isExplorerAgentEvidenceKind(
  value: string,
): value is ExplorerAgentEvidenceKind {
  return (EXPLORER_AGENT_EVIDENCE_KINDS as readonly string[]).includes(value);
}