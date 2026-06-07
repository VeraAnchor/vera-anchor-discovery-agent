     // apps/agent-api/src/explorer/explorerEvidenceMapper.ts

import {
  normalizeEvidenceRecord,
  type NormalizedEvidenceRecord,
} from "@vera-discovery/proof-core";
import { config } from "../config.js";

type EvidenceKind =
  | "sage_result"
  | "cipher_result"
  | "dataset"
  | "hcs_transaction"
  | "proof_card";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const s = cleanString(value);
    if (s) return s;
  }

  return "";
}

function canonicalHcsTransactionId(value: unknown): string {
  const s = cleanString(value);

  if (!s) return "";

  if (/^0\.0\.\d+@\d{1,20}\.\d{1,9}$/.test(s)) {
    return s;
  }

  const mirror = s.match(/^(0\.0\.\d+)-(\d{1,20})-(\d{1,9})$/);
  if (mirror) {
    return `${mirror[1]}@${mirror[2]}.${mirror[3]}`;
  }

  return s;
}

function firstBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
  }

  return null;
}

function shortHash(value: string, chars = 16): string {
  return value ? `${value.slice(0, chars)}…` : "";
}

function siteUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${config.veraPublicSiteUrl}${p}`;
}

function publicExploreUrl(): string {
  return siteUrl("/explore");
}

function publicComputeVerifyUrl(program: "sage" | "cipher", resultId: string): string {
  return program === "cipher"
    ? siteUrl(`/cipher/verify?mode=result&id=${encodeURIComponent(resultId)}`)
    : siteUrl(`/sage/results/${encodeURIComponent(resultId)}`);
}

function preferredUrl(value: unknown, fallback: string): string {
  const s = cleanString(value);
  return s || fallback;
}

function unwrapResultEnvelope(value: unknown): Record<string, unknown> | null {
  const root = asRecord(value);
  if (!root) return null;

  const nestedResult = asRecord(root.result);
  if (nestedResult) return nestedResult;

  const nestedItem = asRecord(root.item);
  if (nestedItem) return nestedItem;

  const nestedData = asRecord(root.data);
  if (nestedData) return nestedData;

  return root;
}

export function pageItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;

  const root = asRecord(value);
  if (!root) return [];

  const items = asArray(root.items);
  if (items.length > 0) return items;

  const results = asArray(root.results);
  if (results.length > 0) return results;

  const data = asArray(root.data);
  if (data.length > 0) return data;

  const records = asArray(root.records);
  if (records.length > 0) return records;

  return [];
}

export function mapExplorerComputeResultToEvidence(
  program: "sage" | "cipher",
  value: unknown,
): NormalizedEvidenceRecord | null {
  const row = unwrapResultEnvelope(value);
  if (!row) return null;

  const dataset = asRecord(row.dataset);

  const resultId = firstString(row.result_id, row.id);
  if (!resultId) return null;

  const jobId = firstString(row.job_id);
  const proofDate = firstString(row.proof_date);
  const schemaVersion = firstString(row.schema_version);

  const datasetKey = firstString(row.dataset_key, dataset?.dataset_key, dataset?.key);
  const datasetVersion = firstString(
    row.dataset_version,
    dataset?.dataset_version,
    dataset?.version,
  );
  const datasetFingerprint = firstString(
    row.dataset_fingerprint,
    dataset?.dataset_fingerprint,
    dataset?.fingerprint,
  );
  const datasetManifestHash = firstString(
    row.dataset_manifest_sha3_512,
    dataset?.dataset_manifest_sha3_512,
    dataset?.manifest_hash,
  );
  const resolvedMetadataHash = firstString(
    row.resolved_metadata_sha3_512,
    dataset?.resolved_metadata_sha3_512,
  );

  const dataHash = firstString(row.data_hash, row.result_hash, row.hash);

  const hcsTransactionId = firstString(
    row.hcs_transaction_id,
    row.dataset_hcs_transaction_id,
    row.version_hcs_transaction_id,
    row.primary_anchor,
    row.publication_transaction_id,
    row.anchor_transaction_id,
    row.primary_anchor,
    row.publication_transaction_id,
    row.dataset_publication_transaction_id,
    row.publication_dataset_hcs_transaction_id,
  );

  const hcsTopicId = firstString(
    row.hcs_topic_id,
    row.dataset_hcs_topic_id,
    row.version_hcs_topic_id,
    row.anchor_topic_id,
    row.publication_topic_id,
    row.publication_topic_id,
    row.dataset_publication_topic_id,
    row.publication_dataset_topic_id,
    row.publication_version_topic_id,
    row.publication_dataset_hcs_topic_id,
    row.publication_version_hcs_topic_id,
  );

  const hcsMessageId = firstString(
    row.hcs_message_id,
    row.dataset_hcs_message_id,
    row.version_hcs_message_id,
    row.anchor_message_id,
    row.publication_dataset_message_id,
    row.publication_version_message_id,
  );

  const mirrorVerified = firstBoolean(
    row.mirror_verified,
    row.anchor_mirror_verified,
    row.hcs_mirror_verified,
    row.publication_mirror_verified,
    row.dataset_publication_mirror_verified,
    row.publication_dataset_mirror_verified,
    row.publication_version_mirror_verified,
  );

  const titlePrefix = program === "cipher" ? "CIPHER" : "SAGE";
  const subjectType: EvidenceKind =
    program === "cipher" ? "cipher_result" : "sage_result";

  const resultUrl = preferredUrl(
    row.result_url,
    siteUrl(`/${program}/results/${encodeURIComponent(resultId)}`),
  );

  const verifyUrl = preferredUrl(
    row.verify_url,
    publicComputeVerifyUrl(program, resultId),
  );

  const proofCardUrl = preferredUrl(
    row.proof_card_url,
    publicExploreUrl(),
  );

  const summaryParts = [
    `Public ${titlePrefix} compute result`,
    jobId ? `job ${jobId}` : null,
    proofDate ? `proof date ${proofDate}` : null,
    schemaVersion ? `schema ${schemaVersion}` : null,
    datasetKey
      ? `dataset ${datasetKey}${datasetVersion ? ` v${datasetVersion}` : ""}`
      : null,
    datasetFingerprint ? `dataset fingerprint ${shortHash(datasetFingerprint)}` : null,
    datasetManifestHash ? `manifest ${shortHash(datasetManifestHash)}` : null,
    resolvedMetadataHash ? `resolved metadata ${shortHash(resolvedMetadataHash)}` : null,
    dataHash ? `data hash ${shortHash(dataHash)}` : null,
    hcsTransactionId ? `HCS anchor ${hcsTransactionId}` : null,
    hcsTopicId ? `HCS topic ${hcsTopicId}` : null,
    hcsMessageId ? `HCS message ${hcsMessageId}` : null,
    mirrorVerified === true ? "mirror verified" : null,
  ].filter(Boolean);

  return normalizeEvidenceRecord({
    subject_type: subjectType,
    subject_id: resultId,
    title: `${titlePrefix} public result`,
    summary: `${summaryParts.join(". ")}.`,
    network: config.hederaNetwork,
    result_url: resultUrl,
    verify_url: verifyUrl,
    proof_card_url: proofCardUrl,
    hcs_transaction_id: hcsTransactionId || null,
    hcs_topic_id: hcsTopicId || null,
  });
}

export function mapExplorerDatasetToEvidence(
  value: unknown,
): NormalizedEvidenceRecord | null {
  const row = unwrapResultEnvelope(value);
  if (!row) return null;

  const datasetKey = firstString(row.dataset_key, row.key, row.id);
  if (!datasetKey) return null;

  const displayName = firstString(row.display_name, row.name, datasetKey);
  const version = firstString(row.version, row.dataset_version);
  const fingerprint = firstString(row.dataset_fingerprint, row.fingerprint);
  const manifestHash = firstString(row.manifest_hash, row.dataset_manifest_sha3_512);
  const resolvedMetadataHash = firstString(row.resolved_metadata_sha3_512);
  const visibility = firstString(row.visibility);
  const anchorStatus = firstString(row.anchor_status);
  const anchorTopicName = firstString(row.anchor_topic_name);
  const publicationTopicName = firstString(row.publication_topic_name);
  const publicationDatasetTransactionId = firstString(
    row.publication_dataset_transaction_id,
  );
  const publicationVersionTransactionId = firstString(
    row.publication_version_transaction_id,
  );

  const hcsTransactionId = firstString(
    row.hcs_transaction_id,
    row.anchor_transaction_id,
    row.dataset_transaction_id,
    publicationDatasetTransactionId,
  );

  const hcsTopicId = firstString(
    row.hcs_topic_id,
    row.anchor_topic_id,
    row.dataset_topic_id,
  );

  const mirrorVerified = firstBoolean(
    row.anchor_mirror_verified,
    row.mirror_verified,
    row.hcs_mirror_verified,
  );

  const resultUrl = preferredUrl(
    row.result_url,
    siteUrl(`/datasets/${encodeURIComponent(datasetKey)}`),
  );

  const verifyUrl = preferredUrl(
    row.verify_url,
    siteUrl(`/datasets/${encodeURIComponent(datasetKey)}`),
  );

  const proofCardUrl = preferredUrl(
    row.proof_card_url,
    publicExploreUrl(),
  );

  const summaryParts = [
    "Public dataset registry record",
    version ? `version ${version}` : null,
    visibility ? `visibility ${visibility}` : null,
    fingerprint ? `fingerprint ${shortHash(fingerprint)}` : null,
    manifestHash ? `manifest ${shortHash(manifestHash)}` : null,
    resolvedMetadataHash ? `resolved metadata ${shortHash(resolvedMetadataHash)}` : null,
    anchorStatus ? `anchor status ${anchorStatus}` : null,
    hcsTransactionId ? `HCS anchor ${hcsTransactionId}` : null,
    hcsTopicId ? `HCS topic ${hcsTopicId}` : null,
    anchorTopicName ? `anchor topic ${anchorTopicName}` : null,
    publicationTopicName ? `publication topic ${publicationTopicName}` : null,
    publicationVersionTransactionId
      ? `version publication ${publicationVersionTransactionId}`
      : null,
    mirrorVerified === true ? "mirror verified" : null,
  ].filter(Boolean);

  return normalizeEvidenceRecord({
    subject_type: "dataset",
    subject_id: datasetKey,
    title: `Dataset public record: ${displayName}`,
    summary: `${summaryParts.join(". ")}.`,
    network: config.hederaNetwork,
    result_url: resultUrl,
    verify_url: verifyUrl,
    proof_card_url: proofCardUrl,
    hcs_transaction_id: hcsTransactionId || null,
    hcs_topic_id: hcsTopicId || null,
  });
}

export function mapExplorerHcsTransactionToEvidence(
  value: unknown,
): NormalizedEvidenceRecord | null {
  const row = unwrapResultEnvelope(value);
  if (!row) return null;

  const transactionId = canonicalHcsTransactionId(
    firstString(row.transaction_id, row.hcs_transaction_id),
  );
  const messageId = firstString(row.message_id, row.hcs_message_id);
  const topicId = firstString(row.topic_id, row.hcs_topic_id);
  const consensusTimestamp = firstString(row.consensus_timestamp);
  const sequenceNumber = firstString(row.sequence_number, row.sequence);
  const subjectId = transactionId || messageId;

  if (!subjectId) return null;

  const mirrorVerified = firstBoolean(
    row.mirror_verified,
    row.hcs_mirror_verified,
  );
  const dataHash = firstString(row.data_hash, row.payload_hash, row.message_hash);

  const verifyUrl = siteUrl(`/hcs/transactions/${encodeURIComponent(subjectId)}`);

  const summaryParts = [
    "Public Hedera HCS transaction",
    topicId ? `topic ${topicId}` : null,
    consensusTimestamp ? `consensus timestamp ${consensusTimestamp}` : null,
    sequenceNumber ? `sequence ${sequenceNumber}` : null,
    dataHash ? `data hash ${shortHash(dataHash)}` : null,
    mirrorVerified === true ? "mirror verified" : null,
  ].filter(Boolean);

  return normalizeEvidenceRecord({
    subject_type: "hcs_transaction",
    subject_id: subjectId,
    title: mirrorVerified ? "HCS transaction verified" : "HCS transaction public record",
    summary: `${summaryParts.join(". ")}.`,
    network: config.hederaNetwork,
    result_url: verifyUrl,
    verify_url: verifyUrl,
    proof_card_url: publicExploreUrl(),
    hcs_transaction_id: transactionId || null,
    hcs_topic_id: topicId || null,
  });
}