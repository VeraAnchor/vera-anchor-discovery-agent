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

const repos = createAgentRepos(agentDbPool);

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 25;
const EVIDENCE_CACHE_TTL_MS = 5 * 60 * 1000;
const LOCAL_DEMO_SOURCE = "local_demo";
const LIVE_SOURCE = "live";

type EvidenceKind =
  | "sage_result"
  | "cipher_result"
  | "dataset"
  | "hcs_transaction"
  | "proof_card";

type EvidenceSource = "live" | "cache" | "local_demo";

type EvidenceSearchInput = Readonly<{
  query?: unknown;
  limit?: unknown;
  type?: unknown;
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
    proof_card_url: `${config.veraPublicSiteUrl}/proof-cards`,
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
    proof_card_url: `${config.veraPublicSiteUrl}/proof-cards`,
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
    result_url: `${config.veraPublicSiteUrl}/proof-cards`,
    verify_url: `${config.veraPublicSiteUrl}/proof`,
    proof_card_url: `${config.veraPublicSiteUrl}/proof-cards`,
    hcs_transaction_id: null,
    hcs_topic_id: null,
  }),
];

const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "for",
  "from",
  "in",
  "is",
  "me",
  "of",
  "on",
  "please",
  "public",
  "show",
  "the",
  "this",
  "to",
  "what",
  "with",
]);

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_.:@-]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !QUERY_STOP_WORDS.has(token));
}

function matchesQuery(record: NormalizedEvidenceRecord, query: string): boolean {
  if (!query) return true;

  const haystack = [
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
  ]
    .join(" ")
    .toLowerCase();

  if (haystack.includes(query)) {
    return true;
  }

  const tokens = queryTokens(query);

  if (tokens.length === 0) {
    return true;
  }

  return tokens.every((token) => haystack.includes(token));
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

/**
 * Placeholder for live Vera public API reads.
 *
 * Keep this isolated. The implementation should later call the Explorer/Core
 * public API with hard allowlisted base URLs, short timeouts, response-size
 * caps, and strict normalization.
 */
async function searchLivePublicEvidence(_input: {
  query: string;
  limit: number;
  type: EvidenceKind | "all";
}): Promise<NormalizedEvidenceRecord[]> {
  return [];
}

async function getLivePublicEvidencePreview(_input: {
  subjectType: EvidenceKind;
  subjectId: string;
}): Promise<NormalizedEvidenceRecord | null> {
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
  const scopedContext = normalizeServiceContext(context);

  const liveItems = await searchLivePublicEvidence({ query, limit, type });

  if (liveItems.length > 0) {
    const normalized = liveItems.map(toEvidenceRecord).slice(0, limit);
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
      items: cachedItems,
      source: "cache",
    };
  }

  const localItems = searchLocalDemoEvidence({ query, limit, type });

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