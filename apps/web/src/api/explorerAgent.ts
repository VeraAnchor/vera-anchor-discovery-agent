const HEDERA_TRANSACTION_ID_RE = /^0\.0\.\d+@\d{1,20}\.\d{1,9}$/;

export type AgentSubjectType =
  | "cipher_result"
  | "sage_result"
  | "dataset"
  | "hcs_transaction"
  | "proof_card";

export type ExplorerAgentMode =
  | "search"
  | "explain_selected"
  | "verify_hcs"
  | "capabilities";

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

export type ExplorerAgentSource = Readonly<{
  kind: string;
  label: string;
  ref: string;
  href: string | null;
}>;

export type ExplorerAgentEvidenceItem = Readonly<{
  subject_type: AgentSubjectType;
  subject_id: string;
  title: string;
  summary: string;
  network: string;
  result_url: string | null;
  verify_url: string | null;
  proof_card_url: string | null;
  hcs_transaction_id: string | null;
  hcs_topic_id: string | null;
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
  warnings: readonly string[];
}>;

export type ExplorerAgentToolTrace = Readonly<{
  tool_name: string;
  audit_id: string | null;
  status: "completed" | "rejected" | "failed";
}>;

export type ExplorerAgentPolicyTrace = Readonly<{
  operation: string;
  allowed: boolean;
  reason: string;
}>;

export type ExplorerAgentQueryResult = Readonly<{
  ok: true;
  intent: string;
  answer: string;
  confidence: "low" | "medium" | "high";
  sources: readonly ExplorerAgentSource[];
  evidence_items: readonly ExplorerAgentEvidenceItem[];
  tools: readonly ExplorerAgentToolTrace[];
  policy: readonly ExplorerAgentPolicyTrace[];
  warnings: readonly string[];
  verification: ExplorerAgentVerification | null;
}>;

export type ExplorerAgentQueryInput = Readonly<{
  question: string;
  mode?: ExplorerAgentMode | null;
  subjectType?: AgentSubjectType | null;
  subjectId?: string | null;
  hcsTransactionId?: string | null;
  hcsTopicId?: string | null;
  limit?: number | null;
  sort?: ExplorerAgentSort | null;
  timeWindow?: ExplorerAgentTimeWindow | null;
  datasetKey?: string | null;
  verifiedOnly?: boolean | null;
  anchoredOnly?: boolean | null;
}>;

async function readJsonOrThrow<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : `HTTP_${response.status}`;

    throw new Error(message);
  }

  return payload as T;
}

export async function queryExplorerAgent(
  input: ExplorerAgentQueryInput,
): Promise<ExplorerAgentQueryResult> {
  const response = await fetch("/v1/explorer/agent/query", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      question: input.question,
      mode: input.mode ?? null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      hcsTransactionId: input.hcsTransactionId ?? null,
      hcsTopicId: input.hcsTopicId ?? null,
      limit: input.limit ?? 5,
      sort: input.sort ?? null,
      timeWindow: input.timeWindow ?? null,
      datasetKey: input.datasetKey ?? null,
      verifiedOnly: input.verifiedOnly ?? null,
      anchoredOnly: input.anchoredOnly ?? null,
    }),
  });

  const result = await readJsonOrThrow<ExplorerAgentQueryResult>(response);

  return {
    ...result,
    evidence_items: result.evidence_items ?? [],
    tools: result.tools ?? [],
    policy: result.policy ?? [],
    warnings: result.warnings ?? [],
    verification: result.verification ?? null,
  };
}

export function subjectFromAgentSource(
  source: ExplorerAgentSource,
): { subjectType: AgentSubjectType; subjectId: string } | null {
  const label = String(source.label ?? "").trim();
  const ref = String(source.ref ?? "").trim();

  const [rawType, ...rest] = label.split(":");
  const subjectType = rawType as AgentSubjectType;
  const subjectId = rest.join(":") || ref;

  if (
    subjectType !== "cipher_result" &&
    subjectType !== "sage_result" &&
    subjectType !== "dataset" &&
    subjectType !== "hcs_transaction" &&
    subjectType !== "proof_card"
  ) {
    return null;
  }

  if (!subjectId) return null;

  if (subjectType === "hcs_transaction" && !HEDERA_TRANSACTION_ID_RE.test(subjectId)) {
    return null;
  }

  return {
    subjectType,
    subjectId,
  };
}

export function subjectFromEvidenceItem(
  item: ExplorerAgentEvidenceItem,
): { subjectType: AgentSubjectType; subjectId: string } {
  return {
    subjectType: item.subject_type,
    subjectId: item.subject_id,
  };
}

const VERA_PUBLIC_SITE_URL = "https://veraanchor.com";

export function isHederaTransactionId(value: unknown): boolean {
  return HEDERA_TRANSACTION_ID_RE.test(String(value ?? "").trim());
}

function absoluteVeraHref(path: string): string {
  return `${VERA_PUBLIC_SITE_URL}${path}`;
}

export function buildVeraSubjectHref(input: {
  subjectType: AgentSubjectType;
  subjectId: string;
}): string {
  const subjectId = String(input.subjectId ?? "").trim();
  const encodedSubjectId = encodeURIComponent(subjectId);

  if (input.subjectType === "cipher_result") {
    return absoluteVeraHref(
      `/cipher/verify?mode=result&id=${encodedSubjectId}`,
    );
  }

  if (input.subjectType === "sage_result") {
    return absoluteVeraHref(`/sage/results/${encodedSubjectId}`);
  }

  if (input.subjectType === "dataset") {
    return absoluteVeraHref(`/datasets/${encodedSubjectId}`);
  }

  if (input.subjectType === "hcs_transaction") {
    return absoluteVeraHref(`/hcs/transactions/${encodedSubjectId}`);
  }

  return absoluteVeraHref("/explore");
}

export function buildVeraEvidenceHref(
  item: ExplorerAgentEvidenceItem,
): string {
  return buildVeraSubjectHref({
    subjectType: item.subject_type,
    subjectId: item.subject_id,
  });
}