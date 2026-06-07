// apps/agent-api/src/services/explorerAgentRetrievalPlanner.ts

import type {
  ExplorerAgentCompiledQuery,
  ExplorerAgentEvidenceKind,
  ExplorerAgentNormalizedQueryInput,
  ExplorerAgentQueryConstraint,
  ExplorerAgentRetrievalPlan,
  ExplorerAgentRetrievalStep,
} from "../explorer/explorerAgentTypes.js";

const COMPUTE_EVIDENCE_TYPES = new Set<ExplorerAgentEvidenceKind>([
  "cipher_result",
  "sage_result",
]);

function hasConstraint(
  constraints: readonly ExplorerAgentQueryConstraint[],
  kind: ExplorerAgentQueryConstraint["kind"],
): boolean {
  return constraints.some((constraint) => constraint.kind === kind);
}

function uniqueEvidenceTypes(
  values: readonly ExplorerAgentEvidenceKind[],
): ExplorerAgentEvidenceKind[] {
  const seen = new Set<ExplorerAgentEvidenceKind>();
  const out: ExplorerAgentEvidenceKind[] = [];

  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  return out;
}

function compact(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function searchTextForPlan(input: {
  normalized: ExplorerAgentNormalizedQueryInput;
  compiled: ExplorerAgentCompiledQuery;
}): string {
  if (input.compiled.intent === "evidence_search") {
    return input.compiled.searchText;
  }

  return input.compiled.searchText || input.normalized.question;
}

function computeSearchTypes(
  compiled: ExplorerAgentCompiledQuery,
): ExplorerAgentEvidenceKind[] {
  const computeTypes = uniqueEvidenceTypes(
    compiled.evidenceTypes.filter((type) => COMPUTE_EVIDENCE_TYPES.has(type)),
  );

  return computeTypes.length > 0 ? computeTypes : ["cipher_result", "sage_result"];
}

function primarySearchTypes(input: {
  normalized: ExplorerAgentNormalizedQueryInput;
  compiled: ExplorerAgentCompiledQuery;
}): ExplorerAgentEvidenceKind[] {
  if (input.normalized.subjectType) {
    return [input.normalized.subjectType];
  }

  if (input.compiled.evidenceTypes.length > 0) {
    return uniqueEvidenceTypes(input.compiled.evidenceTypes).slice(0, 3);
  }

  return ["cipher_result", "sage_result", "dataset"];
}

function hasStructuredSearchConstraint(input: {
  normalized: ExplorerAgentNormalizedQueryInput;
  compiled: ExplorerAgentCompiledQuery;
}): boolean {
  return Boolean(
    input.normalized.subjectType ||
      input.normalized.hcsTransactionId ||
      input.normalized.hcsTopicId ||
      input.normalized.datasetKey ||
      input.compiled.evidenceTypes.length > 0 ||
      input.compiled.temporalRange ||
      input.compiled.quantity?.limit ||
      hasConstraint(input.compiled.constraints, "recent") ||
      hasConstraint(input.compiled.constraints, "date_range") ||
      hasConstraint(input.compiled.constraints, "quantity") ||
      hasConstraint(input.compiled.constraints, "anchored") ||
      hasConstraint(input.compiled.constraints, "verified") ||
      hasConstraint(input.compiled.constraints, "strongest"),
  );
}

function step(input: ExplorerAgentRetrievalStep): ExplorerAgentRetrievalStep {
  return Object.freeze(input);
}

export function buildExplorerAgentRetrievalPlan(input: {
  normalized: ExplorerAgentNormalizedQueryInput;
  compiled: ExplorerAgentCompiledQuery;
}): ExplorerAgentRetrievalPlan {
  const searchText = searchTextForPlan(input);
  const wantsStrongest = hasConstraint(input.compiled.constraints, "strongest");
  const wantsExplanation = hasConstraint(input.compiled.constraints, "explain");
  const wantsExport = hasConstraint(input.compiled.constraints, "export");
  const steps: ExplorerAgentRetrievalStep[] = [];
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (input.normalized.hcsTransactionId || input.compiled.hcsTransactionId) {
    steps.push(
      step({
        kind: "exact_hcs_verify",
        label: "Verify exact HCS transaction",
        type: "hcs_transaction",
        query: input.normalized.hcsTransactionId ?? input.compiled.hcsTransactionId ?? "",
        datasetKey: null,
        limit: 1,
        required: true,
        reason: "A Hedera HCS transaction identifier was detected.",
      }),
    );

    reasons.push("retrieval plan includes exact HCS verification");
  }

  if (input.normalized.subjectType && input.normalized.subjectId) {
    steps.push(
      step({
        kind: "exact_subject_preview",
        label: "Preview exact selected evidence record",
        type: input.normalized.subjectType,
        query: input.normalized.subjectId,
        datasetKey: input.normalized.datasetKey,
        limit: 1,
        required: true,
        reason: "A concrete subject type and subject id are available.",
      }),
    );

    reasons.push("retrieval plan includes exact subject preview");
  }

  if (wantsStrongest && !input.normalized.datasetKey && searchText.trim()) {
    steps.push(
      step({
        kind: "search_dataset_candidates",
        label: "Resolve dataset candidates",
        type: "dataset",
        query: searchText,
        datasetKey: null,
        limit: Math.max(3, Math.min(8, input.normalized.limit)),
        required: false,
        reason:
          "The user asked for strongest/scored evidence without an explicit dataset key.",
      }),
    );

    reasons.push("retrieval plan will try dataset-key resolution before score search");
  }

  if (wantsStrongest && input.normalized.datasetKey) {
    for (const type of computeSearchTypes(input.compiled)) {
      steps.push(
        step({
          kind: "search_top_scores_for_dataset",
          label: `Search top scored ${type}`,
          type,
          query: searchText,
          datasetKey: input.normalized.datasetKey,
          limit: input.normalized.limit,
          required: false,
          reason:
            "The query asks for strongest/scored compute evidence and a dataset key is available.",
        }),
      );
    }

    reasons.push("retrieval plan includes score-aware dataset-scoped compute search");
  }

  for (const type of primarySearchTypes(input)) {
    steps.push(
      step({
        kind: "search_primary_surface",
        label: `Search primary ${type} evidence`,
        type,
        query: searchText,
        datasetKey: input.normalized.datasetKey,
        limit: input.normalized.limit,
        required: false,
        reason: "Primary evidence surface selected by compiled query.",
      }),
    );
  }

  if (!input.normalized.subjectType) {
    steps.push(
      step({
        kind: "search_broad_evidence",
        label: "Search broad public evidence",
        type: "all",
        query: searchText,
        datasetKey: input.normalized.datasetKey,
        limit: input.normalized.limit,
        required: false,
        reason:
          "Broad fallback search keeps the agent useful when no single evidence surface is decisive.",
      }),
    );

    reasons.push("retrieval plan includes broad fallback evidence search");
  }

  let shouldClarify = false;
  let clarificationQuestion: string | null = null;

  if ((wantsExplanation || wantsExport) && !input.normalized.subjectId) {
    shouldClarify = true;
    clarificationQuestion =
      "Which evidence record should I use? Select or provide a result ID, dataset key, proof card, or HCS transaction.";
    warnings.push(
      "The user requested explanation/export behavior without a concrete selected evidence record.",
    );
  }

  if (!searchText.trim() && steps.length === 0 && !hasStructuredSearchConstraint(input)) {
    shouldClarify = true;
    clarificationQuestion =
      "What public evidence should I search for? You can provide a result ID, dataset key, HCS transaction, disease, tissue, donor, platform, or dataset term.";
    warnings.push("The retrieval planner did not find a searchable term or identifier.");
  }

  return Object.freeze({
    steps: Object.freeze(steps),
    searchText,
    shouldClarify,
    clarificationQuestion,
    warnings: Object.freeze(compact([...warnings, ...input.compiled.warnings])),
    reasons: Object.freeze(compact([...reasons, ...input.compiled.reasons])),
  });
}