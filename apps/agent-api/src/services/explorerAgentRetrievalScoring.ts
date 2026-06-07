// apps/agent-api/src/services/explorerAgentRetrievalScoring.ts

import type { NormalizedEvidenceRecord } from "@vera-discovery/proof-core";
import type {
  ExplorerAgentCompiledQuery,
  ExplorerAgentConfidence,
  ExplorerAgentEvidenceKind,
  ExplorerAgentEvidenceRank,
  ExplorerAgentNormalizedQueryInput,
  ExplorerAgentRetrievalQuality,
  ExplorerAgentRetrievalStepKind,
} from "../explorer/explorerAgentTypes.js";
import {
  matchExplorerQueryText,
  normalizeExplorerText,
  textMatchesExplorerToken,
  tokenizeExplorerQuery,
} from "../explorer/explorerAgentQueryText.js";

export type ExplorerAgentRankInputSource = "live" | "cache" | "local_demo";

export type ExplorerAgentRankInputRecord = Readonly<{
  record: NormalizedEvidenceRecord;
  stepIndex: number;
  stepKind: ExplorerAgentRetrievalStepKind;
  source: ExplorerAgentRankInputSource;
}>;

export type ExplorerAgentRankedEvidence = Readonly<{
  items: NormalizedEvidenceRecord[];
  ranks: readonly ExplorerAgentEvidenceRank[];
  quality: ExplorerAgentRetrievalQuality;
}>;

const SOURCE_SCORE: Record<ExplorerAgentRankInputSource, number> = {
  live: 20,
  cache: 10,
  local_demo: -40,
};

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

function compact(values: readonly string[]): string[] {
  return unique(values.map((value) => value.trim()).filter(Boolean));
}

function confidenceFromScore(score: number): ExplorerAgentConfidence {
  if (score >= 140) return "high";
  if (score >= 70) return "medium";
  return "low";
}

function qualityConfidence(input: {
  topScore: number | null;
  totalItems: number;
  localDemoItems: number;
  anchoredItems: number;
  mirrorVerifiedItems: number;
}): ExplorerAgentConfidence {
  if (input.totalItems === 0 || input.topScore === null) return "low";

  if (
    input.topScore >= 140 &&
    input.localDemoItems === 0 &&
    (input.anchoredItems > 0 || input.mirrorVerifiedItems > 0)
  ) {
    return "high";
  }

  if (input.topScore >= 70) return "medium";

  return "low";
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

function queryTokens(input: {
  normalized: ExplorerAgentNormalizedQueryInput;
  compiled: ExplorerAgentCompiledQuery;
}): string[] {
  const raw = input.compiled.searchText || input.normalized.question;
  return tokenizeExplorerQuery(raw);
}

function isAnchored(record: NormalizedEvidenceRecord): boolean {
  return Boolean(record.hcs_transaction_id || record.hcs_topic_id);
}

function isMirrorVerified(record: NormalizedEvidenceRecord): boolean {
  return searchableText(record).includes("mirror verified");
}

function hasProofCard(record: NormalizedEvidenceRecord): boolean {
  return Boolean(record.proof_card_url);
}

function evidenceType(value: string): ExplorerAgentEvidenceKind | null {
  if (
    value === "sage_result" ||
    value === "cipher_result" ||
    value === "dataset" ||
    value === "hcs_transaction" ||
    value === "proof_card"
  ) {
    return value;
  }

  return null;
}

function exactSubjectMatch(input: {
  record: NormalizedEvidenceRecord;
  normalized: ExplorerAgentNormalizedQueryInput;
  compiled: ExplorerAgentCompiledQuery;
}): boolean {
  const subjectId = input.normalized.subjectId ?? input.compiled.subjectId;

  if (!subjectId) return false;

  return (
    normalizeExplorerText(input.record.subject_id) ===
    normalizeExplorerText(subjectId)
  );
}

function exactHcsMatch(input: {
  record: NormalizedEvidenceRecord;
  normalized: ExplorerAgentNormalizedQueryInput;
  compiled: ExplorerAgentCompiledQuery;
}): boolean {
  const tx = input.normalized.hcsTransactionId ?? input.compiled.hcsTransactionId;
  const topic = input.normalized.hcsTopicId ?? input.compiled.hcsTopicId;

  if (tx && input.record.hcs_transaction_id === tx) return true;
  if (topic && input.record.hcs_topic_id === topic) return true;

  return false;
}

function datasetKeyMatch(input: {
  record: NormalizedEvidenceRecord;
  datasetKey: string | null;
}): boolean {
  if (!input.datasetKey) return false;

  const key = normalizeExplorerText(input.datasetKey);
  const text = searchableText(input.record);

  return normalizeExplorerText(input.record.subject_id) === key || text.includes(key);
}

function scoreRecord(input: {
  entry: ExplorerAgentRankInputRecord;
  normalized: ExplorerAgentNormalizedQueryInput;
  compiled: ExplorerAgentCompiledQuery;
  resolvedDatasetKey: string | null;
}): ExplorerAgentEvidenceRank {
  const record = input.entry.record;
  const subjectType = evidenceType(record.subject_type);
  const reasons: string[] = [];
  const penalties: string[] = [];
  const tokens = queryTokens({
    normalized: input.normalized,
    compiled: input.compiled,
  });
  const haystack = searchableText(record);
  const title = normalizeExplorerText(record.title);
  const summary = normalizeExplorerText(record.summary);

  let score = Math.max(0, 100 - input.entry.stepIndex * 10);

  score += SOURCE_SCORE[input.entry.source];

  if (input.entry.source === "live") {
    reasons.push("live Explorer source");
  } else if (input.entry.source === "cache") {
    reasons.push("cached Vera evidence source");
  } else {
    penalties.push("local demo fallback source");
  }

  if (
    exactSubjectMatch({
      record,
      normalized: input.normalized,
      compiled: input.compiled,
    })
  ) {
    score += 120;
    reasons.push("exact selected subject match");
  }

  if (
    exactHcsMatch({
      record,
      normalized: input.normalized,
      compiled: input.compiled,
    })
  ) {
    score += 120;
    reasons.push("exact HCS transaction/topic match");
  }

  if (
    input.normalized.subjectType &&
    subjectType === input.normalized.subjectType
  ) {
    score += 50;
    reasons.push(`matched requested evidence surface ${input.normalized.subjectType}`);
  }

  if (subjectType && input.compiled.evidenceTypes.includes(subjectType)) {
    score += 30;
    reasons.push(`matched compiled evidence type ${subjectType}`);
  }

  if (
    datasetKeyMatch({
      record,
      datasetKey: input.resolvedDatasetKey ?? input.normalized.datasetKey,
    })
  ) {
    score += 80;
    reasons.push("matched dataset key context");
  }

  for (const token of tokens) {
    if (!textMatchesExplorerToken(haystack, token)) continue;

    if (textMatchesExplorerToken(record.subject_id, token)) {
      score += 35;
      reasons.push(`subject id matched "${token}"`);
      continue;
    }

    if (textMatchesExplorerToken(title, token)) {
      score += 25;
      reasons.push(`title matched "${token}"`);
      continue;
    }

    if (textMatchesExplorerToken(summary, token)) {
      score += 15;
      reasons.push(`summary matched "${token}"`);
      continue;
    }

    score += 8;
    reasons.push(`record matched "${token}"`);
  }

  if (isAnchored(record)) {
    score += 20;
    reasons.push("record includes public HCS anchor/topic");
  } else if (input.normalized.anchoredOnly) {
    score -= 25;
    penalties.push("record does not expose a public HCS anchor/topic");
  }

  if (isMirrorVerified(record)) {
    score += 15;
    reasons.push("record indicates mirror verification");
  } else if (input.normalized.verifiedOnly) {
    score -= 25;
    penalties.push("record does not indicate mirror verification");
  }

  if (hasProofCard(record)) {
    score += 10;
    reasons.push("record exposes proof-card/proof-review URL");
  }

  if (
    tokens.length > 0 &&
    !matchExplorerQueryText({
      haystack,
      query: tokens.join(" "),
      minimumRatio: 0.34,
    }).matched
  ) {
    score -= 30;
    penalties.push("record did not match compiled domain tokens directly");
  }

  if (!subjectType) {
    penalties.push(`unsupported evidence type "${record.subject_type}"`);
  }

  return Object.freeze({
    subjectType: subjectType ?? "dataset",
    subjectId: record.subject_id,
    score,
    confidence: confidenceFromScore(score),
    reasons: Object.freeze(compact(reasons).slice(0, 12)),
    penalties: Object.freeze(compact(penalties).slice(0, 8)),
  });
}

function chooseBestDuplicate(input: {
  entries: readonly ExplorerAgentRankInputRecord[];
  normalized: ExplorerAgentNormalizedQueryInput;
  compiled: ExplorerAgentCompiledQuery;
  resolvedDatasetKey: string | null;
}): {
  entry: ExplorerAgentRankInputRecord;
  rank: ExplorerAgentEvidenceRank;
}[] {
  const best = new Map<
    string,
    { entry: ExplorerAgentRankInputRecord; rank: ExplorerAgentEvidenceRank }
  >();

  for (const entry of input.entries) {
    const key = `${entry.record.subject_type}:${entry.record.subject_id}`;
    const rank = scoreRecord({
      entry,
      normalized: input.normalized,
      compiled: input.compiled,
      resolvedDatasetKey: input.resolvedDatasetKey,
    });

    const existing = best.get(key);

    if (!existing || rank.score > existing.rank.score) {
      best.set(key, { entry, rank });
    }
  }

  return Array.from(best.values());
}

function buildQuality(input: {
  ranked: readonly {
    entry: ExplorerAgentRankInputRecord;
    rank: ExplorerAgentEvidenceRank;
  }[];
}): ExplorerAgentRetrievalQuality {
  const items = input.ranked.map((item) => item.entry.record);
  const types = unique(
    items
      .map((item) => evidenceType(item.subject_type))
      .filter((item): item is ExplorerAgentEvidenceKind => item !== null),
  );
  const liveItems = input.ranked.filter((item) => item.entry.source === "live").length;
  const cacheItems = input.ranked.filter((item) => item.entry.source === "cache").length;
  const localDemoItems = input.ranked.filter(
    (item) => item.entry.source === "local_demo",
  ).length;
  const anchoredItems = items.filter(isAnchored).length;
  const mirrorVerifiedItems = items.filter(isMirrorVerified).length;
  const proofCardItems = items.filter(hasProofCard).length;
  const topScore = input.ranked[0]?.rank.score ?? null;
  const warnings: string[] = [];

  if (items.length === 0) {
    warnings.push("No records were available for retrieval quality scoring.");
  }

  if (localDemoItems > 0) {
    warnings.push("One or more ranked records came from local demo fallback.");
  }

  if (anchoredItems === 0 && items.length > 0) {
    warnings.push("No ranked records expose a public HCS anchor/topic.");
  }

  if (mirrorVerifiedItems === 0 && items.length > 0) {
    warnings.push("No ranked records indicate mirror verification.");
  }

  return Object.freeze({
    totalItems: items.length,
    liveItems,
    cacheItems,
    localDemoItems,
    anchoredItems,
    mirrorVerifiedItems,
    proofCardItems,
    evidenceTypes: Object.freeze(types),
    topScore,
    confidence: qualityConfidence({
      topScore,
      totalItems: items.length,
      localDemoItems,
      anchoredItems,
      mirrorVerifiedItems,
    }),
    warnings: Object.freeze(warnings),
  });
}

export function rankExplorerEvidenceRecords(input: {
  records: readonly ExplorerAgentRankInputRecord[];
  normalized: ExplorerAgentNormalizedQueryInput;
  compiled: ExplorerAgentCompiledQuery;
  resolvedDatasetKey: string | null;
  limit: number;
}): ExplorerAgentRankedEvidence {
  const deduped = chooseBestDuplicate({
    entries: input.records,
    normalized: input.normalized,
    compiled: input.compiled,
    resolvedDatasetKey: input.resolvedDatasetKey,
  }).sort((a, b) => b.rank.score - a.rank.score);

  const limited = deduped.slice(0, input.limit);
  const quality = buildQuality({ ranked: limited });

  return Object.freeze({
    items: limited.map((item) => item.entry.record),
    ranks: Object.freeze(limited.map((item) => item.rank)),
    quality,
  });
}