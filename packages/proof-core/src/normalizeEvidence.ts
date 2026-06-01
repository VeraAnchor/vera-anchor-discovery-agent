export type EvidenceRecordInput = Readonly<{
  subject_type?: unknown;
  type?: unknown;
  subject_id?: unknown;
  id?: unknown;
  title?: unknown;
  summary?: unknown;
  network?: unknown;
  result_url?: unknown;
  verify_url?: unknown;
  proof_card_url?: unknown;
  hcs_transaction_id?: unknown;
  hcs_topic_id?: unknown;
}>;

export type NormalizedEvidenceRecord = Readonly<{
  subject_type: string;
  subject_id: string;
  title: string;
  summary: string;
  network: string;
  result_url: string;
  verify_url: string;
  proof_card_url: string;
  hcs_transaction_id: string | null;
  hcs_topic_id: string | null;
}>;

export type EvidenceSubject = Readonly<{
  type: string;
  id: string;
  title: string;
  summary: string;
  network: string;
}>;

export type EvidenceLinks = Readonly<{
  result_url: string;
  verify_url: string;
  proof_card_url: string;
  hcs_transaction_id: string | null;
  hcs_topic_id: string | null;
}>;

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanNullableString(value: unknown): string | null {
  const s = cleanString(value);
  return s ? s : null;
}

export function normalizeEvidenceRecord(input: EvidenceRecordInput): NormalizedEvidenceRecord {
  const subjectType = cleanString(input.subject_type ?? input.type);
  const subjectId = cleanString(input.subject_id ?? input.id);

  if (!subjectType) {
    throw new Error("normalizeEvidence_missing_subject_type");
  }

  if (!subjectId) {
    throw new Error("normalizeEvidence_missing_subject_id");
  }

  return Object.freeze({
    subject_type: subjectType,
    subject_id: subjectId,
    title: cleanString(input.title),
    summary: cleanString(input.summary),
    network: cleanString(input.network || "testnet").toLowerCase(),
    result_url: cleanString(input.result_url),
    verify_url: cleanString(input.verify_url),
    proof_card_url: cleanString(input.proof_card_url),
    hcs_transaction_id: cleanNullableString(input.hcs_transaction_id),
    hcs_topic_id: cleanNullableString(input.hcs_topic_id),
  });
}

export function evidenceSubjectFromRecord(record: NormalizedEvidenceRecord): EvidenceSubject {
  return Object.freeze({
    type: record.subject_type,
    id: record.subject_id,
    title: record.title,
    summary: record.summary,
    network: record.network,
  });
}

export function evidenceLinksFromRecord(record: NormalizedEvidenceRecord): EvidenceLinks {
  return Object.freeze({
    result_url: record.result_url,
    verify_url: record.verify_url,
    proof_card_url: record.proof_card_url,
    hcs_transaction_id: record.hcs_transaction_id,
    hcs_topic_id: record.hcs_topic_id,
  });
}