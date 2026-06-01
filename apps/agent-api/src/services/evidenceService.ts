import {
  normalizeEvidenceRecord,
  type NormalizedEvidenceRecord,
} from "@vera-discovery/proof-core";
import { config } from "../config.js";

type EvidenceKind = "sage_result" | "cipher_result" | "dataset" | "hcs_transaction" | "proof_card";

type EvidenceSearchInput = Readonly<{
  query?: unknown;
  limit?: unknown;
  type?: unknown;
}>;

type EvidencePreviewInput = Readonly<{
  subjectType: string;
  subjectId: string;
}>;

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeLimit(value: unknown, fallback = 10): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), 25);
}

function normalizeType(value: unknown): EvidenceKind | "all" {
  const s = cleanString(value).toLowerCase();
  if (
    s === "sage_result" ||
    s === "cipher_result" ||
    s === "dataset" ||
    s === "hcs_transaction" ||
    s === "proof_card"
  ) {
    return s;
  }
  return "all";
}

/**
 * Local bounty/demo records.
 *
 * These intentionally do not invent HCS transaction IDs or topic IDs.
 * The purpose is to exercise the paid proof-bundle export flow while
 * keeping chain references honest until live Explorer reads are wired.
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

  return haystack.includes(query);
}

function matchesType(record: NormalizedEvidenceRecord, type: EvidenceKind | "all"): boolean {
  if (type === "all") return true;
  return record.subject_type === type;
}

/**
 * Placeholder for live Vera public API reads.
 *
 * Keep this function isolated so we can safely add real Explorer/SAGE/CIPHER
 * calls without mixing network code into the local demo adapter.
 */
async function searchLivePublicEvidence(_input: {
  query: string;
  limit: number;
  type: EvidenceKind | "all";
}): Promise<NormalizedEvidenceRecord[]> {
  return [];
}

export async function searchEvidence(
  input: EvidenceSearchInput
): Promise<{ items: NormalizedEvidenceRecord[]; source: "live" | "local_demo" }> {
  const query = cleanString(input.query).toLowerCase();
  const limit = normalizeLimit(input.limit, 10);
  const type = normalizeType(input.type);

  const liveItems = await searchLivePublicEvidence({ query, limit, type });

  if (liveItems.length > 0) {
    return {
      items: liveItems.slice(0, limit),
      source: "live",
    };
  }

  const localItems = localEvidenceRecords
    .filter((record) => matchesType(record, type))
    .filter((record) => matchesQuery(record, query))
    .slice(0, limit);

  return {
    items: localItems,
    source: "local_demo",
  };
}

export async function getEvidencePreview(
  input: EvidencePreviewInput
): Promise<NormalizedEvidenceRecord> {
  const subjectType = cleanString(input.subjectType);
  const subjectId = cleanString(input.subjectId);

  if (!subjectType) {
    const err = new Error("evidence_preview_missing_subject_type");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }

  if (!subjectId) {
    const err = new Error("evidence_preview_missing_subject_id");
    (err as Error & { status?: number }).status = 400;
    throw err;
  }

  const found = localEvidenceRecords.find(
    (record) => record.subject_type === subjectType && record.subject_id === subjectId
  );

  if (!found) {
    const err = new Error("evidence_not_found");
    (err as Error & { status?: number }).status = 404;
    throw err;
  }

  return found;
}