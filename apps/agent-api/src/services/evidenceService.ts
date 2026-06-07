// apps/agent-api/src/services/evidenceService.ts

import crypto from "node:crypto";
import {
  normalizeEvidenceRecord,
  type NormalizedEvidenceRecord,
} from "@vera-discovery/proof-core";
import { config } from "../config.js";
import { agentDbPool } from "../db/db.js";
import { createAgentRepos } from "../repos/agentRepos.js";
import { withAgentTransaction } from "../repos/agentRepoUtils.js";
import type { AgentEvidenceCacheRow } from "../repos/agentEvidenceCacheRepo.js";
import type { AgentServiceContext } from "./agentServiceContext.js";
import type { ExplorerAgentTemporalRange } from "../explorer/explorerAgentTypes.js";
import { getExplorerJson, encodePathSegment } from "../explorer/explorerPublicClient.js";
import {
  mapExplorerComputeResultToEvidence,
  mapExplorerDatasetToEvidence,
  mapExplorerHcsTransactionToEvidence,
  pageItems,
} from "../explorer/explorerEvidenceMapper.js";
import {
  compileExplorerSearchText,
  expandExplorerSearchTexts,
  matchExplorerQueryText,
  normalizeExplorerText,
  textMatchesExplorerToken,
  tokenizeExplorerQuery,
} from "../explorer/explorerAgentQueryText.js";

const repos = createAgentRepos(agentDbPool);

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 25;
const EVIDENCE_CACHE_TTL_MS = 5 * 60 * 1000;
const LIVE_SOURCE = "live";

type EvidenceKind =
  | "sage_result"
  | "cipher_result"
  | "dataset"
  | "hcs_transaction"
  | "proof_card";

type EvidenceSource = "live" | "cache" | "local_demo";
type EvidenceSort = "relevance" | "latest" | "highest_score";
type EvidenceTimeWindow = "any" | "today" | "last_24h" | "last_7d" | "last_30d"; 

type EvidenceSearchInput = Readonly<{
  query?: unknown;
  limit?: unknown;
  type?: unknown;
  sort?: unknown;
  timeWindow?: unknown;
  dateRange?: ExplorerAgentTemporalRange | null;
  datasetKey?: unknown;
  verifiedOnly?: unknown;
  anchoredOnly?: unknown;
}>;

type EvidencePreviewInput = Readonly<{
  subjectType: string;
  subjectId: string;
}>;

export type EvidenceSearchResult = Readonly<{
  items: NormalizedEvidenceRecord[];
  source: EvidenceSource;
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

function normalizeLimit(value: unknown, fallback = DEFAULT_SEARCH_LIMIT): number {
  const n = Number(value);
  const x = Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.max(1, Math.min(MAX_SEARCH_LIMIT, x));
}

function normalizeSearchQuery(value: unknown): string {
  const s = cleanString(value).toLowerCase();

  rejectControlChars(s, "query");

  if (s.length > 256) {
    throwHttp("QUERY_TOO_LONG", 400);
  }

  return s;
}

function normalizeType(value: unknown): EvidenceKind | "all" {
  const s = cleanString(value).toLowerCase();

  if (!s) return "all";

  rejectControlChars(s, "type");

  if (s === "all") {
    return "all";
  }

  if (
    s === "sage_result" ||
    s === "cipher_result" ||
    s === "dataset" ||
    s === "hcs_transaction" ||
    s === "proof_card"
  ) {
    return s;
  }

  throwHttp("INVALID_EVIDENCE_TYPE", 400);
}

function normalizeSort(value: unknown): EvidenceSort {
  const s = cleanString(value).toLowerCase();

  if (!s) return "relevance";

  rejectControlChars(s, "sort");

  if (s === "relevance" || s === "latest" || s === "highest_score") {
    return s;
  }

  throwHttp("INVALID_EVIDENCE_SORT", 400);
}

function normalizeTimeWindow(value: unknown): EvidenceTimeWindow {
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

  throwHttp("INVALID_EVIDENCE_TIME_WINDOW", 400);
}

function normalizeDatasetKey(value: unknown): string | null {
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

function normalizeBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (value === false) return false;
  if (value === undefined || value === null || value === "") return false;

  const s = cleanString(value).toLowerCase();

  if (s === "true") return true;
  if (s === "false") return false;

  throwHttp("INVALID_BOOLEAN_FILTER", 400);
}

function normalizeSubjectType(value: unknown): EvidenceKind {
  const s = cleanString(value).toLowerCase();

  if (!s) {
    throwHttp("EVIDENCE_PREVIEW_MISSING_SUBJECT_TYPE", 400);
  }

  rejectControlChars(s, "subject_type");

  if (
    s === "sage_result" ||
    s === "cipher_result" ||
    s === "dataset" ||
    s === "hcs_transaction" ||
    s === "proof_card"
  ) {
    return s;
  }

  throwHttp("INVALID_SUBJECT_TYPE", 400);
}

function normalizeSubjectId(value: unknown): string {
  const s = cleanString(value);

  if (!s) {
    throwHttp("EVIDENCE_PREVIEW_MISSING_SUBJECT_ID", 400);
  }

  rejectControlChars(s, "subject_id");

  if (s.length > 256) {
    throwHttp("SUBJECT_ID_TOO_LONG", 400);
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

function normalizeServiceContext(context?: AgentServiceContext): Required<AgentServiceContext> {
  return {
    actorRef: normalizeContextRef(context?.actorRef, "actor_ref") ?? "public:anonymous",
    orgRef: normalizeContextRef(context?.orgRef, "org_ref") ?? "public",
    requestId: normalizeContextRef(context?.requestId, "request_id"),
    systemScope: Boolean(context?.systemScope),
  };
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

function evidenceCacheKey(subjectType: string, subjectId: string): string {
  return `evidence:${subjectType}:${subjectId}`;
}

function evidenceSourceRef(subjectType: string, subjectId: string): string {
  return `${subjectType}:${subjectId}`;
}

function cacheExpiresAt(): Date {
  return new Date(Date.now() + EVIDENCE_CACHE_TTL_MS);
}

function toEvidenceRecord(value: unknown): NormalizedEvidenceRecord {
  return normalizeEvidenceRecord(value as NormalizedEvidenceRecord);
}

function evidenceFromCacheRow(row: AgentEvidenceCacheRow): NormalizedEvidenceRecord {
  return toEvidenceRecord(row.evidence_payload);
}

/**
 * Local bounty/demo records.
 *
 * These intentionally do not invent HCS transaction IDs or topic IDs.
 */
const localEvidenceRecords: readonly NormalizedEvidenceRecord[] = [
  normalizeEvidenceRecord({
    subject_type: "cipher_result",
    subject_id: "demo-cipher-public-result",
    title: "CIPHER public evidence preview",
    summary:
      "Demo CIPHER evidence record for the Vera Discovery Agent proof-bundle export flow.",
    network: config.hederaNetwork,
    result_url: `${config.veraPublicSiteUrl}/cipher/results`,
    verify_url: `${config.veraPublicSiteUrl}/cipher/verify`,
    proof_card_url: `${config.veraPublicSiteUrl}/explore`,
    hcs_transaction_id: null,
    hcs_topic_id: null,
  }),
  normalizeEvidenceRecord({
    subject_type: "sage_result",
    subject_id: "demo-sage-public-result",
    title: "SAGE public evidence preview",
    summary:
      "Demo SAGE evidence record for the Vera Discovery Agent proof-bundle export flow.",
    network: config.hederaNetwork,
    result_url: `${config.veraPublicSiteUrl}/sage/results`,
    verify_url: `${config.veraPublicSiteUrl}/sage/verify`,
    proof_card_url: `${config.veraPublicSiteUrl}/explore`,
    hcs_transaction_id: null,
    hcs_topic_id: null,
  }),
  normalizeEvidenceRecord({
    subject_type: "proof_card",
    subject_id: "demo-proof-card-public-record",
    title: "Vera Anchor proof card preview",
    summary:
      "Demo proof-card evidence record showing how exported proof bundles can route back to public review surfaces.",
    network: config.hederaNetwork,
    result_url: `${config.veraPublicSiteUrl}/explore`,
    verify_url: `${config.veraPublicSiteUrl}/proof`,
    proof_card_url: `${config.veraPublicSiteUrl}/explore`,
    hcs_transaction_id: null,
    hcs_topic_id: null,
  }),
];

const PROGRAM_QUERY_TOKENS = new Set(["sage", "cipher"]);
const TYPE_QUERY_TOKENS = new Set([
  "anchor",
  "anchors",
  "dataset",
  "datasets",
  "result",
  "results",
  "hcs",
  "hedera",
  "transaction",
  "transactions",
  "tx",
  "txs",
  "proofcard",
  "proofcards",
  "proof-card",
  "proof-cards",
]);

const MODIFIER_QUERY_TOKENS = new Set([
  "anchor",
  "anchored",
  "anchors",
  "best",
  "highest",
  "latest",
  "live",
  "mirror",
  "new",
  "newest",
  "only",
  "recent",
  "reviewable",
  "score",
  "scores",
  "scoring",
  "strong",
  "strongest",
  "top",
  "trust",
  "trusted",
  "trustworthy",
  "validated",
  "verified",
]);

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  return out;
}

function searchableText(record: NormalizedEvidenceRecord): string {
  return normalizeExplorerText([
    record.subject_type,
    record.subject_id,
    record.title,
    record.summary,
    record.network,
    record.result_url,
    record.verify_url,
    record.proof_card_url,
    record.hcs_transaction_id ?? "",
    record.hcs_topic_id ?? "",
  ].join(" "));
}

function evidenceRecordDate(record: NormalizedEvidenceRecord): string | null {
  const haystack = `${record.title} ${record.summary}`;
  const proofDate = haystack.match(/\bproof date\s+(\d{4}-\d{2}-\d{2})\b/i)?.[1];
  if (proofDate) return proofDate;

  const consensusDate = haystack.match(
    /\bconsensus timestamp\s+(\d{4}-\d{2}-\d{2})/i,
  )?.[1];
  if (consensusDate) return consensusDate;

  return null;
}

function evidenceScore(record: NormalizedEvidenceRecord): number | null {
  const haystack = `${record.title} ${record.summary}`;
  const match = haystack.match(/\b(?:score|rank score|quality score)\s+([0-9]+(?:\.[0-9]+)?)\b/i);

  if (!match?.[1]) return null;

  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function isMirrorVerified(record: NormalizedEvidenceRecord): boolean {
  return searchableText(record).includes("mirror verified");
}

function isAnchored(record: NormalizedEvidenceRecord): boolean {
  return Boolean(record.hcs_transaction_id || record.hcs_topic_id);
}

function relevanceScore(record: NormalizedEvidenceRecord, query: string): number {
  if (!query) return 0;

  const haystack = searchableText(record);
  const tokens = matchTokensForRecord(record, query);
  let score = 0;

  for (const token of tokens) {
    if (!textMatchesExplorerToken(haystack, token)) continue;

    if (textMatchesExplorerToken(record.subject_id, token)) {
      score += 40;
      continue;
    }

    if (textMatchesExplorerToken(record.title, token)) {
      score += 25;
      continue;
    }

    score += 10;
  }

  if (isAnchored(record)) score += 8;
  if (isMirrorVerified(record)) score += 8;
  if (record.proof_card_url) score += 4;

  return score;
}

function compareIsoDateDesc(a: string | null, b: string | null): number {
  if (a && b) return b.localeCompare(a);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function rankAndFilterEvidence(input: {
  records: readonly NormalizedEvidenceRecord[];
  query: string;
  sort: EvidenceSort;
  dateRange?: ExplorerAgentTemporalRange | null;
  anchoredOnly: boolean;
  verifiedOnly: boolean;
}): NormalizedEvidenceRecord[] {
  const filtered = input.records
    .filter((record) => (input.anchoredOnly ? isAnchored(record) : true))
    .filter((record) => (input.verifiedOnly ? isMirrorVerified(record) : true))
    .filter((record) =>
      inDateRange({
        date: evidenceRecordDate(record),
        range: input.dateRange,
      }),
    );

  if (input.sort === "latest") {
    return [...filtered].sort((a, b) =>
      compareIsoDateDesc(evidenceRecordDate(a), evidenceRecordDate(b)),
    );
  }

  if (input.sort === "highest_score") {
    return [...filtered].sort((a, b) => {
      const scoreA = evidenceScore(a);
      const scoreB = evidenceScore(b);

      if (scoreA !== null && scoreB !== null) return scoreB - scoreA;
      if (scoreA !== null) return -1;
      if (scoreB !== null) return 1;

      return relevanceScore(b, input.query) - relevanceScore(a, input.query);
    });
  }

  return [...filtered].sort(
    (a, b) => relevanceScore(b, input.query) - relevanceScore(a, input.query),
  );
}

function localProofDateForWindow(window: EvidenceTimeWindow): string | null {
  if (window !== "today") return null;

  return new Date().toISOString().slice(0, 10);
}

function exactDateForRange(
  range: ExplorerAgentTemporalRange | null | undefined,
): string | null {
  if (!range?.startDate || !range.endDate) return null;
  return range.startDate === range.endDate ? range.startDate : null;
}

function dateRangeParams(
  range: ExplorerAgentTemporalRange | null,
): Record<string, string | number | null> {
  const exactDate = exactDateForRange(range);

  return {
    date: exactDate,
    startDate: range?.startDate ?? null,
    endDate: range?.endDate ?? null,
    start_date: range?.startDate ?? null,
    end_date: range?.endDate ?? null,
    from: range?.startDate ?? null,
    to: range?.endDate ?? null,
  };
}

function inDateRange(input: {
  date: string | null;
  range: ExplorerAgentTemporalRange | null | undefined;
}): boolean {
  if (!input.range) return true;
  if (!input.date) return false;

  if (input.range.startDate && input.date < input.range.startDate) {
    return false;
  }

  if (input.range.endDate && input.date > input.range.endDate) {
    return false;
  }

  return true;
}

function evidenceSearchTerms(query: string): string {
  return tokenizeExplorerQuery(query)
    .filter((token) => !MODIFIER_QUERY_TOKENS.has(token))
    .join(" ");
}

const ROUTING_QUERY_TOKENS = new Set([
  "anchor",
  "anchors",
  "sage",
  "cipher",
  "compute",
  "dataset",
  "datasets",
  "result",
  "results",
  "hcs",
  "hedera",
  "transaction",
  "transactions",
  "tx",
  "txs",
  "proofcard",
  "proofcards",
  "proof-card",
  "proof-cards",
  ...MODIFIER_QUERY_TOKENS,
]);

function contentSearchTerms(query: string): string {
  return tokenizeExplorerQuery(query)
    .filter((token) => !ROUTING_QUERY_TOKENS.has(token))
    .join(" ");
}

function dedupeByTypeAndId(
  records: readonly NormalizedEvidenceRecord[],
): NormalizedEvidenceRecord[] {
  return uniqueEvidenceRecords(records);
}

function matchTokensForRecord(
  record: NormalizedEvidenceRecord,
  query: string,
): string[] {
  const tokens = tokenizeExplorerQuery(query);

  if (record.subject_type === "sage_result") {
    return tokens.filter((token) => token !== "sage");
  }

  if (record.subject_type === "cipher_result") {
    return tokens.filter((token) => token !== "cipher");
  }

  if (record.subject_type === "dataset") {
    return tokens.filter((token) => token !== "dataset" && token !== "datasets");
  }

  if (record.subject_type === "hcs_transaction") {
    return tokens.filter(
      (token) =>
        token !== "anchor" &&
        token !== "anchors" &&
        token !== "hcs" &&
        token !== "hedera" &&
        token !== "tx" &&
        token !== "txs" &&
        token !== "transaction" &&
        token !== "transactions",
    );
  }

  return tokens;
}

function matchesQuery(record: NormalizedEvidenceRecord, query: string): boolean {
  if (!query) return true;

  const haystack = searchableText(record);
  const normalizedQuery = evidenceSearchTerms(query);

  if (!normalizedQuery) return true;

  const phraseMatch = matchExplorerQueryText({
    haystack,
    query: normalizedQuery,
    minimumRatio: 0.75,
  });

  if (phraseMatch.matched) {
    return true;
  }

  const tokens = matchTokensForRecord(record, query);

  if (tokens.length === 0) {
    return true;
  }

  const strongTokens = tokens.filter(
    (token) =>
      !PROGRAM_QUERY_TOKENS.has(token) &&
      !TYPE_QUERY_TOKENS.has(token) &&
      !MODIFIER_QUERY_TOKENS.has(token),
  );

  const requiredTokens = strongTokens.length > 0 ? strongTokens : tokens;

  return matchExplorerQueryText({
    haystack,
    query: requiredTokens.join(" "),
    minimumRatio: 0.67,
  }).matched;
}

function matchesType(record: NormalizedEvidenceRecord, type: EvidenceKind | "all"): boolean {
  if (type === "all") return true;
  return record.subject_type === type;
}

function searchLocalDemoEvidence(input: {
  query: string;
  limit: number;
  type: EvidenceKind | "all";
}): NormalizedEvidenceRecord[] {
  return localEvidenceRecords
    .filter((record) => matchesType(record, input.type))
    .filter((record) => matchesQuery(record, input.query))
    .slice(0, input.limit);
}

function searchCandidatesForQuery(input: {
  query: string;
  searchTerms: string;
}): string[] {
  return uniqueStrings([
    input.searchTerms,
    compileExplorerSearchText(input.query),
    ...expandExplorerSearchTexts(input.query),
  ])
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function uniqueEvidenceRecords(
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

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function looksLikeHcsTransactionId(value: string): boolean {
  return /^\d+\.\d+\.\d+@\d+\.\d+$/.test(value);
}

function evidenceTypeFromQuery(query: string): EvidenceKind | null {
  const tokens = new Set(tokenizeExplorerQuery(query));

  if (tokens.has("cipher")) return "cipher_result";
  if (tokens.has("sage")) return "sage_result";

  if (tokens.has("dataset") || tokens.has("datasets")) {
    return "dataset";
  }

  if (
    tokens.has("hcs") ||
    tokens.has("hedera") ||
    tokens.has("anchor") ||
    tokens.has("anchors") ||
    tokens.has("tx") ||
    tokens.has("txs") ||
    tokens.has("transaction") ||
    tokens.has("transactions")
  ) {
    return "hcs_transaction";
  }
  if (tokens.has("proofcard") || tokens.has("proofcards")) return "proof_card";

  return null;
}

function shouldSearchType(input: {
  requestedType: EvidenceKind | "all";
  inferredType: EvidenceKind | null;
  candidateType: EvidenceKind;
}): boolean {
  if (input.requestedType !== "all") {
    return input.requestedType === input.candidateType;
  }

  if (!input.inferredType) {
    return true;
  }

  return input.inferredType === input.candidateType;
}

async function searchLiveComputeResults(input: {
  program: "sage" | "cipher";
  query: string;
  searchTerms: string;
  limit: number;
  sort: EvidenceSort;
  timeWindow: EvidenceTimeWindow;
  dateRange: ExplorerAgentTemporalRange | null;
  datasetKey: string | null;
}): Promise<NormalizedEvidenceRecord[]> {
  const records: NormalizedEvidenceRecord[] = [];

  if (looksLikeUuid(input.query)) {
    const detail = await getExplorerJson(
      `/${input.program}/results/${encodePathSegment(input.query)}`,
    );

    const mapped = mapExplorerComputeResultToEvidence(input.program, detail);

    if (mapped) {
      records.push(mapped);
    }
  }

  const candidates = searchCandidatesForQuery({
    query: input.query,
    searchTerms: input.searchTerms,
  });

  async function appendList(candidate: string | null): Promise<void> {
    const list = await getExplorerJson(`/${input.program}/results`, {
      q: candidate,
      date: exactDateForRange(input.dateRange) ?? localProofDateForWindow(input.timeWindow),
      datasetKey: input.datasetKey,
      limit: exactDateForRange(input.dateRange) ? input.limit : Math.max(input.limit, 25),
    });

    for (const item of pageItems(list)) {
      const mapped = mapExplorerComputeResultToEvidence(input.program, item);

      if (mapped && matchesQuery(mapped, input.searchTerms || input.query)) {
        records.push(mapped);
      }
    }
  }

  for (const candidate of candidates) {
    await appendList(candidate);
    if (uniqueEvidenceRecords(records).length >= input.limit) break;
  }

  if (records.length === 0 && input.searchTerms) {
    await appendList(null);
  }

  return rankAndFilterEvidence({
    records: uniqueEvidenceRecords(records),
    query: input.searchTerms,
    sort: input.sort,
    dateRange: input.dateRange,
    anchoredOnly: false,
    verifiedOnly: false,
  }).slice(0, input.limit);
}

async function searchLiveTopRunScores(input: {
  program: "sage" | "cipher";
  datasetKey: string;
  limit: number;
}): Promise<NormalizedEvidenceRecord[]> {
  const records: NormalizedEvidenceRecord[] = [];

  const list = await getExplorerJson("/run-scores/top", {
    program: input.program,
    datasetKey: input.datasetKey,
    includeDeleted: "false",
    limit: input.limit,
  });

  for (const item of pageItems(list)) {
    const mapped = mapExplorerComputeResultToEvidence(input.program, item);

    if (mapped) {
      records.push(mapped);
    }
  }

  return uniqueEvidenceRecords(records).slice(0, input.limit);
}

async function hydrateLiveDatasetEvidence(
  record: NormalizedEvidenceRecord,
): Promise<NormalizedEvidenceRecord> {
  if (record.hcs_transaction_id || record.hcs_topic_id) {
    return record;
  }

  try {
    const detail = await getExplorerJson(
      `/datasets/${encodePathSegment(record.subject_id)}`,
    );
    const hydrated = mapExplorerDatasetToEvidence(detail);

    if (!hydrated) {
      return record;
    }

    return toEvidenceRecord({
      ...record,
      title: hydrated.title || record.title,
      summary: hydrated.summary || record.summary,
      network: hydrated.network || record.network,
      result_url: hydrated.result_url || record.result_url,
      verify_url: hydrated.verify_url || record.verify_url,
      proof_card_url: hydrated.proof_card_url || record.proof_card_url,
      hcs_transaction_id:
        hydrated.hcs_transaction_id ?? record.hcs_transaction_id,
      hcs_topic_id: hydrated.hcs_topic_id ?? record.hcs_topic_id,
    });
  } catch {
    return record;
  }
}

async function searchLiveDatasets(input: {
  query: string;
  searchTerms: string;
  limit: number;
  sort: EvidenceSort;
  dateRange: ExplorerAgentTemporalRange | null;
  anchoredOnly: boolean;
  verifiedOnly: boolean;
}): Promise<NormalizedEvidenceRecord[]> {
  const records: NormalizedEvidenceRecord[] = [];

  const candidates = searchCandidatesForQuery({
    query: input.query,
    searchTerms: input.searchTerms,
  });

  async function appendList(candidate: string | null): Promise<void> {
    const list = await getExplorerJson("/datasets", {
      q: candidate,
      visibility: "public",
      limit: Math.max(input.limit, 25),
    });

    for (const item of pageItems(list)) {
      const mapped = mapExplorerDatasetToEvidence(item);

      if (mapped && matchesQuery(mapped, input.searchTerms || input.query)) {
        records.push(await hydrateLiveDatasetEvidence(mapped));
      }
    }
  }

  for (const candidate of candidates) {
    await appendList(candidate);
    if (uniqueEvidenceRecords(records).length >= input.limit) break;
  }

  if (records.length === 0 && input.searchTerms) {
    await appendList(null);
  }

  return rankAndFilterEvidence({
    records: uniqueEvidenceRecords(records),
    query: input.searchTerms || input.query,
    sort: input.sort === "highest_score" ? "relevance" : input.sort,
    dateRange: input.dateRange,
    anchoredOnly: input.anchoredOnly,
    verifiedOnly: input.verifiedOnly,
  }).slice(0, input.limit);
}

async function searchLiveHcsTransactions(input: {
  query: string;
  searchTerms: string;
  limit: number;
  sort: EvidenceSort;
  dateRange: ExplorerAgentTemporalRange | null;
  verifiedOnly: boolean;
}): Promise<NormalizedEvidenceRecord[]> {
  if (looksLikeHcsTransactionId(input.query)) {
    const mapped = mapExplorerHcsTransactionToEvidence({
      transaction_id: input.query,
    });

    return mapped ? [mapped] : [];
  }

  const fetchLimit = input.dateRange ? Math.max(input.limit, 25) : input.limit;
  const records: NormalizedEvidenceRecord[] = [];

  const candidates = searchCandidatesForQuery({
    query: input.query,
    searchTerms: input.searchTerms,
  });

  async function appendList(candidate: string | null): Promise<void> {
    const list = await getExplorerJson("/hcs/transactions", {
      q: candidate,
      limit: fetchLimit,
      sort: input.sort === "latest" ? "latest" : null,
      ...dateRangeParams(input.dateRange),
    });

    for (const item of pageItems(list)) {
      const mapped = mapExplorerHcsTransactionToEvidence(item);

      if (mapped && matchesQuery(mapped, input.searchTerms || input.query)) {
        records.push(mapped);
      }
    }
  }

  for (const candidate of candidates) {
    await appendList(candidate);

    if (uniqueEvidenceRecords(records).length >= input.limit) {
      break;
    }
  }

  if (records.length === 0 && input.searchTerms) {
    await appendList(null);
  }

  return rankAndFilterEvidence({
    records: uniqueEvidenceRecords(records),
    query: input.searchTerms || input.query,
    sort: input.sort,
    dateRange: input.dateRange,
    anchoredOnly: false,
    verifiedOnly: input.verifiedOnly,
  }).slice(0, input.limit);
}

async function searchLivePublicEvidence(input: {
  query: string;
  limit: number;
  type: EvidenceKind | "all";
  sort: EvidenceSort;
  timeWindow: EvidenceTimeWindow;
  dateRange: ExplorerAgentTemporalRange | null;
  datasetKey: string | null;
  anchoredOnly: boolean;
  verifiedOnly: boolean;
}): Promise<NormalizedEvidenceRecord[]> {
  const inferredType = evidenceTypeFromQuery(input.query);
  const searchTerms = contentSearchTerms(input.query);
  const broadSearchTerms = evidenceSearchTerms(input.query);

  async function runForType(inputType: EvidenceKind): Promise<NormalizedEvidenceRecord[]> {
    if (inputType === "cipher_result") {
      if (input.sort === "highest_score" && input.datasetKey) {
        return searchLiveTopRunScores({
          program: "cipher",
          datasetKey: input.datasetKey,
          limit: input.limit,
        });
      }

      return searchLiveComputeResults({
        program: "cipher",
        query: input.query,
        searchTerms,
        limit: input.limit,
        sort: input.sort,
        timeWindow: input.timeWindow,
        dateRange: input.dateRange,
        datasetKey: input.datasetKey,
      });
    }

    if (inputType === "sage_result") {
      if (input.sort === "highest_score" && input.datasetKey) {
        return searchLiveTopRunScores({
          program: "sage",
          datasetKey: input.datasetKey,
          limit: input.limit,
        });
      }

      return searchLiveComputeResults({
        program: "sage",
        query: input.query,
        searchTerms,
        limit: input.limit,
        sort: input.sort,
        timeWindow: input.timeWindow,
        dateRange: input.dateRange,
        datasetKey: input.datasetKey,
      });
    }

    if (inputType === "dataset") {
      return searchLiveDatasets({
        query: input.query,
        searchTerms,
        limit: input.limit,
        sort: input.sort,
        anchoredOnly: input.anchoredOnly,
        dateRange: input.dateRange,
        verifiedOnly: input.verifiedOnly,
      });
    }

    if (inputType === "hcs_transaction") {
      return searchLiveHcsTransactions({
        query: input.query,
        searchTerms,
        limit: input.limit,
        sort: input.sort,
        dateRange: input.dateRange,
        verifiedOnly: input.verifiedOnly,
      });
    }

    return [];
  }

  function finalize(records: readonly NormalizedEvidenceRecord[]): NormalizedEvidenceRecord[] {
    return rankAndFilterEvidence({
      records: dedupeByTypeAndId(records),
      query: input.query,
      sort: input.sort,
      dateRange: input.dateRange,
      anchoredOnly: input.anchoredOnly,
      verifiedOnly: input.verifiedOnly,
    }).slice(0, input.limit);
  }

  if (input.type !== "all") {
    return finalize(await runForType(input.type));
  }

  const primaryTypes: EvidenceKind[] = inferredType
    ? [inferredType]
    : ["cipher_result", "sage_result", "dataset"];

  const primaryRecords: NormalizedEvidenceRecord[] = [];

  for (const inputType of primaryTypes) {
    primaryRecords.push(...(await runForType(inputType)));
  }

  if (primaryRecords.length > 0) {
    return finalize(primaryRecords);
  }

  const fallbackRecords: NormalizedEvidenceRecord[] = [];

  for (const inputType of ["cipher_result", "sage_result", "dataset", "hcs_transaction"] as const) {
    if (inferredType === inputType) continue;

    fallbackRecords.push(...(await runForType(inputType)));
  }

  if (fallbackRecords.length > 0) {
    return finalize(fallbackRecords);
  }

  if (broadSearchTerms !== searchTerms) {
    const broadRecords: NormalizedEvidenceRecord[] = [];

    for (const inputType of ["cipher_result", "sage_result", "dataset"] as const) {
      if (inputType === "cipher_result") {
        broadRecords.push(
          ...(await searchLiveComputeResults({
            program: "cipher",
            query: input.query,
            searchTerms: broadSearchTerms,
            limit: input.limit,
            sort: input.sort,
            timeWindow: input.timeWindow,
            dateRange: input.dateRange,
            datasetKey: input.datasetKey,
          })),
        );
        continue;
      }

      if (inputType === "sage_result") {
        broadRecords.push(
          ...(await searchLiveComputeResults({
            program: "sage",
            query: input.query,
            searchTerms: broadSearchTerms,
            limit: input.limit,
            sort: input.sort,
            timeWindow: input.timeWindow,
            dateRange: input.dateRange,
            datasetKey: input.datasetKey,
          })),
        );
        continue;
      }

      broadRecords.push(
        ...(await searchLiveDatasets({
          query: input.query,
          searchTerms: broadSearchTerms,
          limit: input.limit,
          sort: input.sort,
          anchoredOnly: input.anchoredOnly,
          dateRange: input.dateRange,
          verifiedOnly: input.verifiedOnly,
        })),
      );
    }

    return finalize(broadRecords);
  }

  return [];
}

async function getLivePublicEvidencePreview(input: {
  subjectType: EvidenceKind;
  subjectId: string;
}): Promise<NormalizedEvidenceRecord | null> {
  if (input.subjectType === "cipher_result") {
    const detail = await getExplorerJson(
      `/cipher/results/${encodePathSegment(input.subjectId)}`,
    );

    return mapExplorerComputeResultToEvidence("cipher", detail);
  }

  if (input.subjectType === "sage_result") {
    const detail = await getExplorerJson(
      `/sage/results/${encodePathSegment(input.subjectId)}`,
    );

    return mapExplorerComputeResultToEvidence("sage", detail);
  }

  if (input.subjectType === "dataset") {
    const detail = await getExplorerJson(
      `/datasets/${encodePathSegment(input.subjectId)}`,
    );

    return mapExplorerDatasetToEvidence(detail);
  }

  if (input.subjectType === "hcs_transaction") {
    return mapExplorerHcsTransactionToEvidence({
      transaction_id: input.subjectId,
    });
  }

  return null;
}

async function cacheEvidenceRecords(
  records: readonly NormalizedEvidenceRecord[],
  context: Required<AgentServiceContext>,
): Promise<void> {
  if (records.length === 0) return;

  await withAgentTransaction(agentDbPool, context, async (client) => {
    for (const record of records) {
      const evidenceHash = sha3_512Json(record);

      await repos.evidenceCache.upsertFresh(
        {
          cacheKey: evidenceCacheKey(record.subject_type, record.subject_id),
          sourceType: record.subject_type,
          sourceRef: evidenceSourceRef(record.subject_type, record.subject_id),
          evidenceHash,
          evidencePayload: record,
          expiresAt: cacheExpiresAt(),
          metadata: {
            source: LIVE_SOURCE,
          },
        },
        { client },
      );
    }
  });
}

async function getFreshCachedPreview(
  input: {
    subjectType: EvidenceKind;
    subjectId: string;
  },
  context: Required<AgentServiceContext>,
): Promise<NormalizedEvidenceRecord | null> {
  return withAgentTransaction(agentDbPool, context, async (client) => {
    const row = await repos.evidenceCache.getFreshByCacheKey(
      evidenceCacheKey(input.subjectType, input.subjectId),
      { client },
    );

    return row ? evidenceFromCacheRow(row) : null;
  });
}

async function searchFreshCachedEvidence(
  input: {
    query: string;
    limit: number;
    type: EvidenceKind | "all";
  },
  context: Required<AgentServiceContext>,
): Promise<NormalizedEvidenceRecord[]> {
  return withAgentTransaction(agentDbPool, context, async (client) => {
    const rows = await repos.evidenceCache.searchFresh(
      {
        query: input.query || null,
        sourceType: input.type === "all" ? null : input.type,
        limit: input.limit,
      },
      { client },
    );

    return rows.map(evidenceFromCacheRow);
  });
}

export async function searchEvidence(
  input: EvidenceSearchInput,
  context?: AgentServiceContext,
): Promise<EvidenceSearchResult> {
  const query = normalizeSearchQuery(input.query);
  const limit = normalizeLimit(input.limit, DEFAULT_SEARCH_LIMIT);
  const type = normalizeType(input.type);
  const sort = normalizeSort(input.sort);
  const timeWindow = normalizeTimeWindow(input.timeWindow);
  const dateRange = input.dateRange ?? null;
  const datasetKey = normalizeDatasetKey(input.datasetKey);
  const verifiedOnly = normalizeBoolean(input.verifiedOnly);
  const anchoredOnly = normalizeBoolean(input.anchoredOnly);
  const scopedContext = normalizeServiceContext(context);

  const liveItems = await searchLivePublicEvidence({
    query,
    limit,
    type,
    sort,
    timeWindow,
    dateRange,
    datasetKey,
    verifiedOnly,
    anchoredOnly,
  });

  if (liveItems.length > 0) {
    const normalized = rankAndFilterEvidence({
      records: liveItems.map(toEvidenceRecord),
      query,
      sort,
      dateRange,
      anchoredOnly,
      verifiedOnly,
    }).slice(0, limit);

    await cacheEvidenceRecords(normalized, scopedContext);

    return {
      items: normalized,
      source: "live",
    };
  }

  const cachedItems = await searchFreshCachedEvidence(
    {
      query,
      limit,
      type,
    },
    scopedContext,
  );

  if (cachedItems.length > 0) {
    return {
      items: rankAndFilterEvidence({
        records: cachedItems,
        query,
        sort,
        dateRange,
        anchoredOnly,
        verifiedOnly,
      }).slice(0, limit),
      source: "cache",
    };
  }

  const localItems = rankAndFilterEvidence({
    records: searchLocalDemoEvidence({ query, limit, type }),
    query,
    sort,
    dateRange,
    anchoredOnly,
    verifiedOnly,
  }).slice(0, limit);

  if (localItems.length > 0) {
    await cacheEvidenceRecords(localItems, scopedContext);
  }

  return {
    items: localItems,
    source: "local_demo",
  };
}

export async function getEvidencePreview(
  input: EvidencePreviewInput,
  context?: AgentServiceContext,
): Promise<NormalizedEvidenceRecord> {
  const subjectType = normalizeSubjectType(input.subjectType);
  const subjectId = normalizeSubjectId(input.subjectId);
  const scopedContext = normalizeServiceContext(context);

  const liveItem = await getLivePublicEvidencePreview({
    subjectType,
    subjectId,
  });

  if (liveItem) {
    const normalized = toEvidenceRecord(liveItem);
    await cacheEvidenceRecords([normalized], scopedContext);
    return normalized;
  }

  const cached = await getFreshCachedPreview(
    {
      subjectType,
      subjectId,
    },
    scopedContext,
  );

  if (cached) {
    return cached;
  }

  const local = localEvidenceRecords.find(
    (record) =>
      record.subject_type === subjectType && record.subject_id === subjectId,
  );

  if (!local) {
    throwHttp("EVIDENCE_NOT_FOUND", 404);
  }

  await cacheEvidenceRecords([local], scopedContext);

  return local;
}