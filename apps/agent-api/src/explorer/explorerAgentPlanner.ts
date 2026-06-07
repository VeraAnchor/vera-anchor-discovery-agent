// apps/agent-api/src/explorer/explorerAgentPlanner.ts

import type {
  ExplorerAgentCompiledQuery,
  ExplorerAgentConfidence,
  ExplorerAgentEvidenceKind,
  ExplorerAgentIntent,
  ExplorerAgentMode,
  ExplorerAgentNormalizedQueryInput,
  ExplorerAgentQueryConstraint,
  ExplorerAgentSort,
  ExplorerAgentTimeWindow,
  ExplorerAgentTemporalRange,
} from "../explorer/explorerAgentTypes.js";
import { parseExplorerAgentTemporalRange } from "../explorer/explorerAgentTemporalParser.js";
import { parseExplorerAgentQuantityConstraint } from "../explorer/explorerAgentQuantityParser.js";
import { compileExplorerSearchText } from "./explorerAgentQueryText.js";

export type ExplorerAgentPlannedQuery = Readonly<{
  normalized: ExplorerAgentNormalizedQueryInput;
  intent: ExplorerAgentIntent;
  compiled: ExplorerAgentCompiledQuery;
}>;

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

const HCS_TRANSACTION_ID_RE = /\b0\.0\.\d+@\d{1,20}\.\d{1,9}\b/i;
const HCS_TOPIC_HINT_RE =
  /\b(?:topic|topic id|hcs topic|hcs topic id)\s*(?:is|=|:|#|id)?\s*(0\.0\.\d+)\b/i;

const DATASET_KEY_HINT_RE =
  /\b(?:dataset|datasetkey|dataset_key)\s*(?:is|=|:)?\s*([a-zA-Z0-9][a-zA-Z0-9._:/-]{2,255})\b/i;

const CIPHER_ALIASES = [
  "cipher run",
  "cipher runs",
  "cipher result",
  "cipher results",
  "cipher output",
  "cipher outputs",
  "cipher record",
  "cipher records",
  "cipher job",
  "cipher jobs",
  "cipher analysis",
  "cipher analyses",
];

const SAGE_ALIASES = [
  "sage run",
  "sage runs",
  "sage result",
  "sage results",
 "sage output",
  "sage outputs",
  "sage record",
  "sage records",
  "sage job",
  "sage jobs",
  "sage analysis",
  "sage analyses",
];

const COMPUTE_ALIASES = [
  "compute run",
  "compute runs",
  "compute result",
  "compute results",
  "compute output",
  "compute outputs",
  "compute job",
  "compute jobs",
  "analysis job",
  "analysis jobs",
  "analysis result",
  "analysis results",
];

const QUALITY_ALIASES = [
  "good",
  "good result",
  "good results",
  "good job",
  "good jobs",
  "high quality",
  "high-quality",
  "quality result",
  "quality results",
  "best quality",
  "strong result",
  "strong results",
  "reliable result",
  "reliable results",
];

const DATASET_ALIASES = [
  "data",
  "recent data",
  "dataset registry",
  "public data",
  "public dataset",
  "public datasets",
  "registered dataset",
  "registered datasets",
  "dataset record",
  "dataset records",
];

const HCS_ALIASES = [
  "hcs transaction",
  "hcs transactions",
  "hcs tx",
  "hcs txs",
  "hcs data",
  "hcs record",
  "hcs records",
  "hedera data",
  "hedera transaction",
  "hedera transactions",
  "anchor transaction",
  "anchor transactions",
  "anchored record",
  "anchored records",
  "public anchor",
  "public anchors",
];

const PROOF_CARD_ALIASES = [
  "proof card",
  "proof cards",
  "proof-card",
  "proof-cards",
  "review card",
  "review cards",
  "report card",
  "report cards",
];

type ScoredIntent = Readonly<{
  intent: ExplorerAgentIntent;
  mode: ExplorerAgentMode | null;
  score: number;
  reasons: readonly string[];
}>;

type ScoredEvidenceType = Readonly<{
  type: ExplorerAgentEvidenceKind;
  score: number;
  reasons: readonly string[];
}>;

function cleanLower(value: string): string {
  return value.toLowerCase();
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9_@./:-]+/g)
      .map((token) => token.trim())
      .filter(Boolean),
  );
}

function hasToken(tokens: Set<string>, values: readonly string[]): boolean {
  return values.some((value) => tokens.has(value));
}

function includesAny(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function hasSearchVerb(tokens: Set<string>): boolean {
  return hasToken(tokens, [
    "find",
    "search",
    "show",
    "get",
    "give",
    "lookup",
    "look",
    "need",
    "want",
  ]);
}

function hasEvidenceNoun(tokens: Set<string>): boolean {
  return hasToken(tokens, [
    "data",
    "dataset",
    "datasets",
    "evidence",
    "job",
    "jobs",
    "record",
    "records",
    "result",
    "results",
    "run",
    "runs",
    "proof",
    "anchor",
    "anchors",
    "hcs",
    "cipher",
    "sage",
  ]);
}

function isCapabilityRequest(input: {
  text: string;
  tokens: Set<string>;
  searchText: string;
}): boolean {
  if (
    includesAny(input.text, [
      "what can you do",
      "how do you work",
      "what are your tools",
      "what tools do you have",
      "what are your capabilities",
      "show capabilities",
      "agent capabilities",
    ])
  ) {
    return true;
  }

  if (hasToken(input.tokens, ["capabilities"])) {
    return true;
  }

  if (!input.tokens.has("help")) {
    return false;
  }

  if (input.searchText) {
    return false;
  }

  if (hasSearchVerb(input.tokens) || hasEvidenceNoun(input.tokens)) {
    return false;
  }

  return true;
}

function unique<T>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];

  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  return out;
}

function compactReasons(values: readonly string[]): string[] {
  return unique(values.map((value) => value.trim()).filter(Boolean));
}

function confidenceFromScore(score: number): ExplorerAgentConfidence {
  if (score >= 80) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function firstUuid(question: string): string | null {
  return question.match(UUID_RE)?.[0] ?? null;
}

function firstHcsTransactionId(question: string): string | null {
  return question.match(HCS_TRANSACTION_ID_RE)?.[0] ?? null;
}

function firstHcsTopicId(question: string): string | null {
  return question.match(HCS_TOPIC_HINT_RE)?.[1] ?? null;
}

function explicitDatasetKey(input: ExplorerAgentNormalizedQueryInput): string | null {
  if (input.datasetKey) return input.datasetKey;

  const match = input.question.match(DATASET_KEY_HINT_RE);
  const value = match?.[1]?.trim();

  return value || null;
}

function explicitEvidenceTypeFromTokens(
  tokens: Set<string>,
): ExplorerAgentEvidenceKind | null {
  if (tokens.has("cipher")) return "cipher_result";
  if (tokens.has("sage")) return "sage_result";

  if (
    tokens.has("hcs") ||
    tokens.has("hedera") ||
    tokens.has("tx") ||
    tokens.has("txs") ||
    tokens.has("transaction") ||
    tokens.has("transactions") ||
    tokens.has("anchor") ||
    tokens.has("anchors")
  ) {
    return "hcs_transaction";
  }

  if (
    tokens.has("data") ||
    tokens.has("dataset") ||
    tokens.has("datasets") ||
    tokens.has("registry")
  ) {
    return "dataset";
  }

  if (
    tokens.has("proofcard") ||
    tokens.has("proof-card") ||
    tokens.has("proofcards") ||
    tokens.has("proof-cards") ||
    tokens.has("reviewcard") ||
    tokens.has("reportcard") ||
    (tokens.has("proof") && tokens.has("card"))
  ) {
    return "proof_card";
  }

  return null;
}

function constraint(
  input: ExplorerAgentQueryConstraint,
): ExplorerAgentQueryConstraint {
  return input;
}

function compileConstraints(
  input: ExplorerAgentNormalizedQueryInput,
  temporalRange: ExplorerAgentTemporalRange | null,
  quantityLimit: number | null,
): ExplorerAgentQueryConstraint[] {
  const text = cleanLower(input.question);
  const tokens = tokenSet(input.question);
  const constraints: ExplorerAgentQueryConstraint[] = [];

  if (input.datasetKey) {
    constraints.push(
      constraint({
        kind: "dataset_scoped",
        value: input.datasetKey,
        confidence: "high",
        source: "explicit_field",
      }),
    );
  } else {
    const datasetKey = explicitDatasetKey(input);
    if (datasetKey) {
      constraints.push(
        constraint({
          kind: "dataset_scoped",
          value: datasetKey,
          confidence: "high",
          source: "language",
        }),
      );
    }
  }

  if (input.anchoredOnly) {
    constraints.push(
      constraint({
        kind: "anchored",
        value: true,
        confidence: "high",
        source: "explicit_field",
      }),
    );
  }

  if (input.verifiedOnly) {
    constraints.push(
      constraint({
        kind: "verified",
        value: true,
        confidence: "high",
        source: "explicit_field",
      }),
    );
  }

  if (input.sort === "latest" || input.timeWindow !== "any") {
    constraints.push(
      constraint({
        kind: "recent",
        value: input.timeWindow !== "any" ? input.timeWindow : true,
        confidence: "high",
        source: "explicit_field",
      }),
    );
  }

  if (temporalRange) {
    constraints.push(
      constraint({
        kind: "date_range",
        value: temporalRange,
        confidence: temporalRange.confidence,
        source: "language",
      }),
    );

    constraints.push(
      constraint({
        kind: "recent",
        value: temporalRange.label,
        confidence: temporalRange.confidence,
        source: "language",
      }),
    );
  }

  if (quantityLimit !== null) {
    constraints.push(
      constraint({
        kind: "quantity",
        value: quantityLimit,
        confidence: "high",
        source: "language",
      }),
    );
  }

  if (input.sort === "highest_score") {
    constraints.push(
      constraint({
        kind: "strongest",
        value: true,
        confidence: "high",
        source: "explicit_field",
      }),
    );
  }

  if (
    hasToken(tokens, ["anchor", "anchored", "anchors"]) ||
    includesAny(text, [
      "strong anchor",
      "hcs anchor",
      "with hcs",
      "has hcs",
      "has anchor",
      "with anchor",
      "anchored record",
      "anchored result",
      "anchored dataset",
    ])
  ) {
    constraints.push(
      constraint({
        kind: "anchored",
        value: true,
        confidence: "medium",
        source: "language",
      }),
    );
  }

  if (
    hasToken(tokens, ["verified", "verify", "validated", "trusted", "trustworthy"]) ||
    includesAny(text, [
      "mirror verified",
      "mirror-verified",
      "verified record",
      "verified result",
      "verified dataset",
      "trusted record",
      "trustworthy record",
      "prove this",
      "prove it",
    ])
  ) {
    constraints.push(
      constraint({
        kind: "verified",
        value: true,
        confidence: "medium",
        source: "language",
      }),
    );
  }

  if (
    hasToken(tokens, ["recent", "new", "newest", "latest"]) ||
    includesAny(text, ["most recent", "recent runs", "recent results"])
  ) {
    constraints.push(
      constraint({
        kind: "recent",
        value: true,
        confidence: "medium",
        source: "language",
      }),
    );
  }

  if (
    hasToken(tokens, [
      "good",
      "quality",
      "reliable",
      "top",
      "best",
      "strong",
      "strongest",
      "score",
      "scores",
      "scoring",
      "ranked",
    ]) ||
    includesAny(text, [
      "highest scoring",
      "highest score",
      "top scoring",
      ...QUALITY_ALIASES,
    ])
  ) {
    constraints.push(
      constraint({
        kind: "strongest",
        value: true,
        confidence: "medium",
        source: "language",
      }),
    );
  }

  if (
    hasToken(tokens, [
      "explain",
      "summarize",
      "inspect",
      "describe",
      "review",
      "analyze",
    ]) ||
    includesAny(text, [
      "proof chain",
      "this proof",
      "this record",
      "why should i trust",
    ])
  ) {
    constraints.push(
      constraint({
        kind: "explain",
        value: true,
        confidence: "medium",
        source: "language",
      }),
    );
  }

  if (
    hasToken(tokens, [
      "export",
      "download",
      "bundle",
      "receipt",
      "report",
      "pay",
      "paid",
      "quote",
    ]) ||
    includesAny(text, [
      "proof export",
      "proof bundle",
      "paid export",
      "trust report",
      "export bundle",
      "download bundle",
      "make a receipt",
    ])
  ) {
    constraints.push(
      constraint({
        kind: "export",
        value: true,
        confidence: "medium",
        source: "language",
      }),
    );
  }

  const deduped = new Map<string, ExplorerAgentQueryConstraint>();

  for (const item of constraints) {
    const key = `${item.kind}:${String(item.value)}`;

    const existing = deduped.get(key);
    if (!existing || existing.confidence !== "high") {
      deduped.set(key, item);
    }
  }

  return Array.from(deduped.values());
}

function hasConstraint(
  constraints: readonly ExplorerAgentQueryConstraint[],
  kind: ExplorerAgentQueryConstraint["kind"],
): boolean {
  return constraints.some((constraint) => constraint.kind === kind);
}

function constraintString(
  constraints: readonly ExplorerAgentQueryConstraint[],
  kind: ExplorerAgentQueryConstraint["kind"],
): string | null {
  const found = constraints.find(
    (constraint) => constraint.kind === kind && typeof constraint.value === "string",
  );

  return typeof found?.value === "string" ? found.value : null;
}

const SEARCH_CONTROL_TOKENS = new Set([
  "a",
  "about",
  "across",
  "agent",
  "all",
  "an",
  "and",
  "any",
  "are",
  "best",
  "bundle",
  "bundles",
  "can",
  "card",
  "cards",
  "cipher",
  "compute",
  "could",
  "dataset",
  "datasets",
  "download",
  "evidence",
  "explain",
  "export",
  "find",
  "for",
  "from",
  "generate",
  "give",
  "good",
  "hcs",
  "hedera",
  "help",
  "in",
  "inspect",
  "is",
  "job",
  "jobs",
  "latest",
  "look",
  "lookup",
  "me",
  "mirror",
  "new",
  "newest",
  "only",
  "of",
  "on",
  "please",
  "proof",
  "proofcard",
  "public",
  "quality",
  "receipt",
  "reliable",
  "ranked",
  "recent",
  "record",
  "records",
  "result",
  "results",
  "run",
  "runs",
  "sage",
  "score",
  "scores",
  "scoring",
  "select",
  "search",
  "show",
  "strong",
  "strongest",
  "summarize",
  "tell",
  "trust",
  "trusted",
  "trustworthy",
  "the",
  "this",
  "to",
  "top",
  "transaction",
  "transactions",
  "tx",
  "txs",
  "verified",
  "verify",
  "what",
  "with",
]);

function compileSearchText(input: ExplorerAgentNormalizedQueryInput): string {
  return compileExplorerSearchText(input.question, {
    stripPatterns: [
      HCS_TRANSACTION_ID_RE,
      UUID_RE,
      DATASET_KEY_HINT_RE,
    ],
    extraStopWords: SEARCH_CONTROL_TOKENS,
  });
}

function scoreEvidenceTypes(input: {
  normalized: ExplorerAgentNormalizedQueryInput;
  constraints: readonly ExplorerAgentQueryConstraint[];
}): ScoredEvidenceType[] {
  const text = cleanLower(input.normalized.question);
  const tokens = tokenSet(input.normalized.question);
  const scores = new Map<ExplorerAgentEvidenceKind, { score: number; reasons: string[] }>();

  function add(
    type: ExplorerAgentEvidenceKind,
    score: number,
    reason: string,
  ): void {
    const current = scores.get(type) ?? { score: 0, reasons: [] };
    current.score += score;
    current.reasons.push(reason);
    scores.set(type, current);
  }

  if (input.normalized.subjectType) {
    add(input.normalized.subjectType, 100, `explicit subject type ${input.normalized.subjectType}`);
  }

  const explicit = explicitEvidenceTypeFromTokens(tokens);
  if (explicit) {
    add(explicit, 70, `language mentioned ${explicit}`);
  }

  if (input.normalized.hcsTransactionId || input.normalized.hcsTopicId) {
    add("hcs_transaction", 90, "HCS transaction identifier detected");
  }

  if (hasToken(tokens, ["cipher"])) add("cipher_result", 70, "language mentioned CIPHER");
  if (includesAny(text, CIPHER_ALIASES)) {
    add("cipher_result", 70, "language mentioned CIPHER result alias");
  }
  if (hasToken(tokens, ["sage"])) add("sage_result", 70, "language mentioned SAGE");
  if (includesAny(text, SAGE_ALIASES)) {
    add("sage_result", 70, "language mentioned SAGE result alias");
  }

  if (includesAny(text, COMPUTE_ALIASES)) {
    add("cipher_result", 30, "language mentioned compute result alias");
    add("sage_result", 30, "language mentioned compute result alias");
  }

  if (hasToken(tokens, ["data", "dataset", "datasets"])) {
    add("dataset", 70, "language mentioned datasets");
  }
  if (includesAny(text, DATASET_ALIASES)) {
    add("dataset", 70, "language mentioned dataset alias");
  }

  if (hasToken(tokens, ["proofcard"]) || includesAny(text, ["proof card", "proof-card"])) {
    add("proof_card", 70, "language mentioned proof card");
  }

  if (includesAny(text, PROOF_CARD_ALIASES)) {
    add("proof_card", 70, "language mentioned proof-card alias");
  }

  if (includesAny(text, HCS_ALIASES)) {
    add("hcs_transaction", 80, "language mentioned HCS/anchor alias");
  }

  if (
    hasConstraint(input.constraints, "anchored") &&
    !hasToken(tokens, ["cipher", "sage", "dataset", "datasets", "proofcard"])
  ) {
    add("hcs_transaction", 40, "anchored-only query without a narrower surface can include HCS anchors");
  }

  if (
    hasToken(tokens, ["run", "runs", "result", "results", "compute"]) ||
    hasConstraint(input.constraints, "strongest") ||
    hasConstraint(input.constraints, "recent")
  ) {
    add("cipher_result", 20, "query appears compute-result oriented");
    add("sage_result", 20, "query appears compute-result oriented");
  }

  if (hasConstraint(input.constraints, "dataset_scoped")) {
    add("cipher_result", 15, "dataset-scoped searches can return compute results");
    add("sage_result", 15, "dataset-scoped searches can return compute results");
    add("dataset", 15, "dataset-scoped search can return dataset records");
  }

  if (scores.size === 0) {
    add("cipher_result", 10, "default broad evidence search includes CIPHER results");
    add("sage_result", 10, "default broad evidence search includes SAGE results");
    add("dataset", 10, "default broad evidence search includes datasets");
  }

  return Array.from(scores.entries())
    .map(([type, value]) => ({
      type,
      score: value.score,
      reasons: compactReasons(value.reasons),
    }))
    .sort((a, b) => b.score - a.score);
}

function scoreIntent(input: {
  normalized: ExplorerAgentNormalizedQueryInput;
  constraints: readonly ExplorerAgentQueryConstraint[];
  evidenceTypes: readonly ScoredEvidenceType[];
}): ScoredIntent {
  const text = cleanLower(input.normalized.question);
  const tokens = tokenSet(input.normalized.question);

  const candidates: ScoredIntent[] = [];

  function add(
    intent: ExplorerAgentIntent,
    mode: ExplorerAgentMode | null,
    score: number,
    reasons: readonly string[],
  ): void {
    candidates.push({
      intent,
      mode,
      score,
      reasons,
    });
  }

  if (input.normalized.mode) {
    add(
      intentForExplicitMode(input.normalized.mode, input.normalized),
      input.normalized.mode,
      100,
      [`explicit mode ${input.normalized.mode}`],
    );
  }

  const compiledSearchText = compileSearchText(input.normalized);

  if (
    isCapabilityRequest({
      text,
      tokens,
      searchText: compiledSearchText,
    })
  ) {
    add("agent_capabilities", "capabilities", 90, [
      "capability/help request detected",
    ]);
  }

  if (input.normalized.hcsTransactionId) {
    add("hcs_transaction_verify", "verify_hcs", 95, ["HCS transaction identifier detected"]);
  }

  if (hasConstraint(input.constraints, "explain")) {
    add(
      input.normalized.subjectType && input.normalized.subjectId
        ? "proof_chain_explain"
        : "evidence_search",
      input.normalized.subjectType && input.normalized.subjectId
        ? "explain_selected"
        : "search",
      input.normalized.subjectType && input.normalized.subjectId ? 85 : 45,
      [
        input.normalized.subjectType && input.normalized.subjectId
          ? "explain request includes selected subject"
          : "explain-like language detected without selected subject, searching first",
      ],
    );
  }

  if (input.normalized.subjectType && input.normalized.subjectId) {
    add("proof_chain_explain", "explain_selected", 80, [
      "subject type and subject id are present",
    ]);
  }

  if (firstUuid(input.normalized.question) && input.normalized.subjectType) {
    add("proof_chain_explain", "explain_selected", 65, [
      "UUID and subject type detected",
    ]);
  }

  if (
    input.evidenceTypes.length > 0 ||
    compiledSearchText.length > 0 ||
    hasConstraint(input.constraints, "strongest") ||
    hasConstraint(input.constraints, "recent") ||
    hasConstraint(input.constraints, "anchored") ||
    hasConstraint(input.constraints, "verified")
  ) {
    add("evidence_search", "search", 50, ["evidence retrieval request detected"]);
  }

  if (candidates.length === 0) {
    add("evidence_search", "search", 20, [
      "defaulting to broad evidence search for unclassified user language",
    ]);
  }

  const selected = [...candidates].sort((a, b) => b.score - a.score)[0];

  return {
    ...selected,
    reasons: compactReasons(selected.reasons),
  };
}

function intentForExplicitMode(
  mode: ExplorerAgentMode,
  input: ExplorerAgentNormalizedQueryInput,
): ExplorerAgentIntent {
  if (mode === "capabilities") return "agent_capabilities";
  if (mode === "verify_hcs") return "hcs_transaction_verify";
  if (mode === "search") return "evidence_search";

  if (mode === "explain_selected") {
    return input.subjectType && input.subjectId
      ? "proof_chain_explain"
      : "evidence_search";
  }

  return "unknown";
}

function selectPrimarySubjectType(input: {
  evidenceTypes: readonly ScoredEvidenceType[];
  intent: ExplorerAgentIntent;
}): ExplorerAgentEvidenceKind | null {
  if (input.intent !== "evidence_search") {
    return null;
  }

  const strong = input.evidenceTypes.filter((item) => item.score >= 60);

  if (strong.length === 1) {
    return strong[0].type;
  }

  return null;
}

function sortFromConstraints(input: {
  normalized: ExplorerAgentNormalizedQueryInput;
  constraints: readonly ExplorerAgentQueryConstraint[];
}): ExplorerAgentSort {
  if (input.normalized.sort !== "relevance") return input.normalized.sort;
  if (hasConstraint(input.constraints, "strongest")) return "highest_score";
  if (hasConstraint(input.constraints, "recent")) return "latest";
  return "relevance";
}

function timeWindowFromConstraints(input: {
  normalized: ExplorerAgentNormalizedQueryInput;
}): ExplorerAgentTimeWindow {
  return input.normalized.timeWindow;
}

function compiledWarnings(input: {
  normalized: ExplorerAgentNormalizedQueryInput;
  searchText: string;
  evidenceTypes: readonly ScoredEvidenceType[];
  constraints: readonly ExplorerAgentQueryConstraint[];
}): string[] {
  const warnings: string[] = [];
      
  if (
    hasConstraint(input.constraints, "strongest") &&
    !constraintString(input.constraints, "dataset_scoped") &&
    input.normalized.sort === "highest_score"
  ) {
    warnings.push(
      "Highest-score searches are most precise when a dataset key is available.",
    );
  }

  return warnings;
}

export function compileExplorerAgentQuery(
  input: ExplorerAgentNormalizedQueryInput,
): ExplorerAgentCompiledQuery {
  const temporal = parseExplorerAgentTemporalRange(input.question);
  const quantity = parseExplorerAgentQuantityConstraint(temporal.searchQuestion);
  const compiledInput: ExplorerAgentNormalizedQueryInput = {
    ...input,
    question: quantity.searchQuestion,
  };

  const constraints = compileConstraints(input, temporal.range, quantity.quantity?.limit ?? null);
  const evidenceTypes = scoreEvidenceTypes({
    normalized: input,
    constraints,
  });
  const intent = scoreIntent({
    normalized: input,
    constraints,
    evidenceTypes,
  });
  const searchText = compileSearchText(compiledInput);
  const datasetKey = constraintString(constraints, "dataset_scoped") ?? explicitDatasetKey(input);
  const hcsTransactionId = input.hcsTransactionId ?? firstHcsTransactionId(input.question);
  const hcsTopicId = input.hcsTopicId ?? firstHcsTopicId(input.question);
  const subjectId = input.subjectId ?? firstUuid(input.question);
  const selectedSubjectType =
    input.subjectType ??
    selectPrimarySubjectType({
      evidenceTypes,
      intent: intent.intent,
    });

  const reasons = compactReasons([
    ...intent.reasons,
    ...evidenceTypes.flatMap((item) => item.reasons),
    searchText ? `compiled dynamic search text "${searchText}"` : "",
    datasetKey ? `dataset key resolved as ${datasetKey}` : "",
    temporal.range ? `compiled temporal range ${temporal.range.label}` : "",
    quantity.quantity?.limit ? `compiled quantity limit ${quantity.quantity.limit}` : "",
  ]);

  const warnings = compiledWarnings({
    normalized: input,
    searchText,
    evidenceTypes,
    constraints,
  });

  return {
    originalQuestion: input.question,
    searchText,
    mode: intent.mode,
    intent: intent.intent,
    evidenceTypes: evidenceTypes.map((item) => item.type),
    subjectType: selectedSubjectType,
    subjectId,
    hcsTransactionId,
    hcsTopicId,
    datasetKey,
    temporalRange: temporal.range,
    quantity: quantity.quantity,
    constraints,
    confidence: confidenceFromScore(intent.score),
    reasons,
    warnings,
  };
}

export function planExplorerAgentQuery(
  input: ExplorerAgentNormalizedQueryInput,
): ExplorerAgentPlannedQuery {
  const compiled = compileExplorerAgentQuery(input);

  const normalized: ExplorerAgentNormalizedQueryInput = {
    ...input,
    mode: compiled.mode,
    subjectType: compiled.subjectType,
    subjectId:
      compiled.intent === "evidence_search"
        ? null
        : compiled.subjectId,
    hcsTransactionId: compiled.hcsTransactionId,
    hcsTopicId: compiled.hcsTopicId,
    limit: compiled.quantity?.limit ?? input.limit,
    sort: sortFromConstraints({
      normalized: input,
      constraints: compiled.constraints,
    }),
    timeWindow: timeWindowFromConstraints({
      normalized: input,
    }),
    datasetKey: compiled.datasetKey,
    verifiedOnly: input.verifiedOnly,
    anchoredOnly: input.anchoredOnly,
  };

  if (compiled.intent === "agent_capabilities") {
    return {
      normalized: {
        ...normalized,
        subjectType: null,
        subjectId: null,
        hcsTransactionId: null,
        hcsTopicId: null,
      },
      intent: "agent_capabilities",
      compiled,
    };
  }

  if (compiled.intent === "hcs_transaction_verify") {
    return {
      normalized: {
        ...normalized,
        subjectType: null,
        subjectId: null,
      },
      intent: "hcs_transaction_verify",
      compiled,
    };
  }

  if (compiled.intent === "proof_chain_explain") {
    return {
      normalized: {
        ...normalized,
        mode: "explain_selected",
      },
      intent: "proof_chain_explain",
      compiled,
    };
  }

  if (compiled.intent === "evidence_preview") {
    return {
      normalized,
      intent: "evidence_preview",
      compiled,
    };
  }

  return {
    normalized: {
      ...normalized,
      mode: "search",
      subjectId: null,
    },
    intent: "evidence_search",
    compiled,
  };
}