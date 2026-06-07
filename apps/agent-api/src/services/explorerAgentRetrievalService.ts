// apps/agent-api/src/services/explorerAgentRetrievalService.ts

import type { NormalizedEvidenceRecord } from "@vera-discovery/proof-core";
import type {
  ExplorerAgentCompiledQuery,
  ExplorerAgentEvidenceKind,
  ExplorerAgentNormalizedQueryInput,
  ExplorerAgentRetrievalPlan,
  ExplorerAgentRetrievalResult,
  ExplorerAgentRetrievalStep,
  ExplorerAgentRetrievalStepTrace,
} from "../explorer/explorerAgentTypes.js";
import type { AgentServiceContext } from "./agentServiceContext.js";
import { searchEvidence, type EvidenceSearchResult } from "./evidenceService.js";
import {
  rankExplorerEvidenceRecords,
  type ExplorerAgentRankInputRecord,
} from "./explorerAgentRetrievalScoring.js";
import {
  getExplorerAgentRuntimeLimits,
  type ExplorerAgentRuntimeLimits,
} from "../explorer/explorerAgentRuntimeLimits.js";

type EvidenceSource = EvidenceSearchResult["source"];

const SOURCE_PRIORITY: Record<EvidenceSource, number> = {
  live: 3,
  cache: 2,
  local_demo: 1,
};

const SEARCH_STEP_KINDS = new Set<ExplorerAgentRetrievalStep["kind"]>([
  "search_primary_surface",
  "search_broad_evidence",
  "search_dataset_candidates",
  "search_top_scores_for_dataset",
]);

function nowMs(): number {
  return Date.now();
}

function elapsedMs(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs);
}

function isSearchStep(step: ExplorerAgentRetrievalStep): boolean {
  return SEARCH_STEP_KINDS.has(step.kind);
}

function timeoutError(message: string): Error {
  const err = new Error(message) as Error & { code?: string };
  err.code = "EXPLORER_AGENT_STEP_TIMEOUT";
  return err;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(timeoutError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function skippedTrace(input: {
  step: ExplorerAgentRetrievalStep;
  source: "skipped" | "budget_exhausted" | "timeout" | "local_demo_blocked";
  warning: string;
}): ExplorerAgentRetrievalStepTrace {
  return trace({
    kind: input.step.kind,
    label: input.step.label,
    type: input.step.type,
    query: input.step.query,
    datasetKey: input.step.datasetKey,
    source: input.source,
    itemCount: 0,
    required: input.step.required,
    reason: input.step.reason,
    warning: input.warning,
  });
}

function uniqueRecords(
  records: readonly NormalizedEvidenceRecord[],
): NormalizedEvidenceRecord[] {
  const seen = new Set<string>();
  const out: NormalizedEvidenceRecord[] = [];

  for (const record of records) {
    const key = `${record.subject_type}:${record.subject_id}`;

    if (seen.has(key)) continue;

    seen.add(key);
    out.push(record);
  }

  return out;
}

function bestSource(sources: readonly EvidenceSource[]): EvidenceSource {
  if (sources.length === 0) return "live";

  return [...sources].sort((a, b) => SOURCE_PRIORITY[b] - SOURCE_PRIORITY[a])[0];
}

function isDatasetRecord(record: NormalizedEvidenceRecord): boolean {
  return record.subject_type === "dataset" && Boolean(record.subject_id);
}

function resolveDatasetKeyFromItems(
  items: readonly NormalizedEvidenceRecord[],
): string | null {
  const dataset = items.find(isDatasetRecord);

  return dataset?.subject_id ?? null;
}

function trace(input: ExplorerAgentRetrievalStepTrace): ExplorerAgentRetrievalStepTrace {
  return Object.freeze(input);
}

function stepQuery(input: {
  step: ExplorerAgentRetrievalStep;
  plan: ExplorerAgentRetrievalPlan;
  normalized: ExplorerAgentNormalizedQueryInput;
  compiled: ExplorerAgentCompiledQuery;
}): string {
  if (input.step.query) return input.step.query;
  if (input.plan.searchText) return input.plan.searchText;

  if (input.compiled.intent === "evidence_search") {
    return input.compiled.searchText;
  }

  return input.compiled.searchText || input.normalized.question;
}

function effectiveSort(input: {
  step: ExplorerAgentRetrievalStep;
  normalized: ExplorerAgentNormalizedQueryInput;
}): "relevance" | "latest" | "highest_score" {
  if (input.step.kind === "search_top_scores_for_dataset") {
    return "highest_score";
  }

  if (input.step.kind === "search_dataset_candidates") {
    return "relevance";
  }

  return input.normalized.sort;
}

function effectiveDatasetKey(input: {
  step: ExplorerAgentRetrievalStep;
  resolvedDatasetKey: string | null;
  normalized: ExplorerAgentNormalizedQueryInput;
}): string | null {
  return (
    input.step.datasetKey ??
    input.resolvedDatasetKey ??
    input.normalized.datasetKey ??
    null
  );
}

async function executeSearchStep(input: {
  step: ExplorerAgentRetrievalStep;
  plan: ExplorerAgentRetrievalPlan;
  normalized: ExplorerAgentNormalizedQueryInput;
  compiled: ExplorerAgentCompiledQuery;
  context: AgentServiceContext;
  resolvedDatasetKey: string | null;
  limits: ExplorerAgentRuntimeLimits;
}): Promise<{
  result: EvidenceSearchResult | null;
  trace: ExplorerAgentRetrievalStepTrace;
  warning: string | null;
}> {
  if (
    input.step.kind === "exact_hcs_verify" ||
    input.step.kind === "exact_subject_preview"
  ) {
    return {
      result: null,
      trace: trace({
        kind: input.step.kind,
        label: input.step.label,
        type: input.step.type,
        query: input.step.query,
        datasetKey: input.step.datasetKey,
        source: "skipped",
        itemCount: 0,
        required: input.step.required,
        reason: input.step.reason,
        warning:
          "Exact verification/preview steps are handled by the dedicated agent execution path.",
      }),
      warning: null,
    };
  }

  const query = stepQuery(input);
  const datasetKey = effectiveDatasetKey({
    step: input.step,
    resolvedDatasetKey: input.resolvedDatasetKey,
    normalized: input.normalized,
  });

  if (input.step.kind === "search_top_scores_for_dataset" && !datasetKey) {
    const warning =
      "Skipped score-aware retrieval because no dataset key was available.";

    return {
      result: null,
      trace: trace({
        kind: input.step.kind,
        label: input.step.label,
        type: input.step.type,
        query,
        datasetKey: null,
        source: "skipped",
        itemCount: 0,
        required: input.step.required,
        reason: input.step.reason,
        warning,
      }),
      warning,
    };
  }

  try {
    const result = await withTimeout(
      searchEvidence(
        {
          query,
          limit: input.step.limit,
          type: input.step.type,
          sort: effectiveSort({
            step: input.step,
            normalized: input.normalized,
          }),
          timeWindow: input.normalized.timeWindow,
          dateRange: input.compiled.temporalRange,
          datasetKey,
          verifiedOnly: input.normalized.verifiedOnly,
          anchoredOnly: input.normalized.anchoredOnly,
        },
        input.context,
      ),
      input.limits.perStepTimeoutMs,
      `Explorer Agent retrieval step timed out: ${input.step.label}`,
    );

    if (result.source === "local_demo" && !input.limits.allowLocalDemoFallback) {
      const warning =
        "Local demo fallback evidence was returned by the evidence service but is disabled for this agent runtime.";

      return {
        result: null,
        trace: skippedTrace({
          step: input.step,
          source: "local_demo_blocked",
          warning,
        }),
        warning,
      };
    }

    return {
      result,
      trace: trace({
        kind: input.step.kind,
        label: input.step.label,
        type: input.step.type,
        query,
        datasetKey,
        source: result.source,
        itemCount: result.items.length,
        required: input.step.required,
        reason: input.step.reason,
        warning: null,
      }),
      warning: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "EXPLORER_RETRIEVAL_STEP_FAILED";

    const timedOut =
      (err as { code?: unknown })?.code === "EXPLORER_AGENT_STEP_TIMEOUT";

    if (input.step.required) {
      throw err;
    }

    return {
      result: null,
      trace: trace({
        kind: input.step.kind,
        label: input.step.label,
        type: input.step.type,
        query,
        datasetKey,
        source: timedOut ? "timeout" : "failed",
        itemCount: 0,
        required: input.step.required,
        reason: input.step.reason,
        warning: timedOut
          ? `Retrieval step timed out (${input.step.label}): ${message}`
          : `Retrieval step failed (${input.step.label}): ${message}`,
      }),
       warning: timedOut
        ? `Retrieval step timed out (${input.step.label}): ${message}`
        : `Retrieval step failed (${input.step.label}): ${message}`,
    };
  }
}

export async function runExplorerAgentRetrievalPlan(input: {
  plan: ExplorerAgentRetrievalPlan;
  normalized: ExplorerAgentNormalizedQueryInput;
  compiled: ExplorerAgentCompiledQuery;
  context: AgentServiceContext;
}): Promise<ExplorerAgentRetrievalResult> {
  const limits = getExplorerAgentRuntimeLimits();
  const startedAtMs = nowMs();
  const startedAt = new Date(startedAtMs).toISOString();
  const warnings: string[] = [...input.plan.warnings];
  const traces: ExplorerAgentRetrievalStepTrace[] = [];
  const rankedInputs: ExplorerAgentRankInputRecord[] = [];
  const sources: EvidenceSource[] = [];
  let attemptedStepCount = 0;
  let executedSearchStepCount = 0;
  let budgetExhausted = false;

  let resolvedDatasetKey = input.normalized.datasetKey ?? input.compiled.datasetKey;

  for (const [stepIndex, step] of input.plan.steps
    .slice(0, limits.maxRetrievalSteps)
    .entries()) {
    attemptedStepCount += 1;

    if (elapsedMs(startedAtMs) >= limits.totalTimeoutMs) {
      budgetExhausted = true;
      const warning = "Explorer Agent retrieval total timeout budget was exhausted.";
      warnings.push(warning);
      traces.push(
        skippedTrace({
          step,
          source: "budget_exhausted",
          warning,
        }),
      );
      continue;
    }

    if (isSearchStep(step) && executedSearchStepCount >= limits.maxSearchSteps) {
      budgetExhausted = true;
      const warning = "Explorer Agent retrieval search-step budget was exhausted.";
      warnings.push(warning);
      traces.push(
        skippedTrace({
          step,
          source: "budget_exhausted",
          warning,
        }),
      );
      continue;
    }

    if (isSearchStep(step)) {
      executedSearchStepCount += 1;
    }

    const executed = await executeSearchStep({
      step,
      plan: input.plan,
      normalized: input.normalized,
      compiled: input.compiled,
      context: input.context,
      resolvedDatasetKey,
      limits,
    });

    traces.push(executed.trace);

    if (executed.warning) {
      warnings.push(executed.warning);
    }

    if (!executed.result) {
      continue;
    }

    if (executed.result.items.length > 0) {
      sources.push(executed.result.source);
    }

    if (step.kind === "search_dataset_candidates" && !resolvedDatasetKey) {
      resolvedDatasetKey = resolveDatasetKeyFromItems(executed.result.items);

      if (resolvedDatasetKey) {
        warnings.push(
          `Resolved dataset key "${resolvedDatasetKey}" from public dataset candidates for score-aware retrieval.`,
        );
      }
    }

    for (const record of executed.result.items) {
      rankedInputs.push({
        record,
        stepIndex,
        stepKind: step.kind,
        source: executed.result.source,
      });
    }

    if (
      input.normalized.limit > 0 &&
      uniqueRecords(rankedInputs.map((entry) => entry.record)).length >=
        input.normalized.limit &&
      step.kind !== "search_dataset_candidates"
    ) {
      continue;
    }
  }

  const ranked = rankExplorerEvidenceRecords({
    records: rankedInputs,
    normalized: input.normalized,
    compiled: input.compiled,
    resolvedDatasetKey,
    limit: input.normalized.limit,
  });

  if (input.plan.steps.length > limits.maxRetrievalSteps) {
    budgetExhausted = true;
    warnings.push(
      `Retrieval plan contained ${input.plan.steps.length} steps, but runtime is capped at ${limits.maxRetrievalSteps}.`,
    );
  }

  const skippedStepCount = traces.filter(
    (trace) =>
      trace.source === "skipped" ||
      trace.source === "budget_exhausted" ||
      trace.source === "local_demo_blocked",
  ).length;
  const failedStepCount = traces.filter((trace) => trace.source === "failed").length;
  const timeoutStepCount = traces.filter((trace) => trace.source === "timeout").length;

  return Object.freeze({
    items: ranked.items,
    source: bestSource(sources),
    resolvedDatasetKey,
    stepTraces: Object.freeze(traces),
    ranks: ranked.ranks,
    quality: ranked.quality,
    execution: Object.freeze({
      startedAt,
      elapsedMs: elapsedMs(startedAtMs),
      attemptedStepCount,
      executedSearchStepCount,
      skippedStepCount,
      failedStepCount,
      timeoutStepCount,
      maxSearchSteps: limits.maxSearchSteps,
      maxTotalSteps: limits.maxRetrievalSteps,
      perStepTimeoutMs: limits.perStepTimeoutMs,
      totalTimeoutMs: limits.totalTimeoutMs,
      localDemoFallbackAllowed: limits.allowLocalDemoFallback,
      budgetExhausted,
    }),
    warnings: Object.freeze(Array.from(new Set([...warnings, ...ranked.quality.warnings]))),
    reasons: Object.freeze(Array.from(new Set(input.plan.reasons))),
  });
}