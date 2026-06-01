import { hashJson, type HashEnvelopeV1 } from "@vera-discovery/hashing-core";
import { PROOF_DOMAINS } from "./domains.js";
import type {
  EvidenceLinks,
  EvidenceSubject,
  NormalizedEvidenceRecord,
} from "./normalizeEvidence.js";

export type EvidenceSnapshotV1 = Readonly<{
  schema: "vera.discovery_agent.evidence_snapshot.v1";
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

export type ActionInputV1 = Readonly<{
  schema: "vera.discovery_agent.action_input.v1";
  action_type: string;
  subject_type: string;
  subject_id: string;
  network: string;
  amount: string;
  token: string;
  recipient_account_id: string;
  evidence_snapshot_hash: string;
}>;

export type AgentActionForBundle = Readonly<{
  id: string;
  action_type: string;
  network: string;
}>;

export type PaymentForBundle = Readonly<{
  token: string;
  amount: string;
  network: string;
  transaction_id: string;
  recipient_account_id: string;
  payer_account_id?: string | null;
}>;

export type ProofBundleAgent = Readonly<{
  name?: string;
  version?: string;
}>;

export type ProofBundleV1 = Readonly<{
  schema: "vera.proof_bundle.v1";
  network: string;
  agent: Readonly<{
    name: string;
    version: string;
  }>;
  action: Readonly<{
    id: string;
    type: string;
    created_at: string;
  }>;
  payment: Readonly<{
    token: string;
    amount: string;
    network: string;
    transaction_id: string;
    recipient_account_id: string;
    payer_account_id: string | null;
  }>;
  subject: EvidenceSubject;
  evidence: EvidenceLinks;
  hashes: Readonly<{
    evidence_snapshot_hash: string;
    evidence_snapshot_hash_envelope?: HashEnvelopeV1;
    action_input_hash: string;
    action_input_hash_envelope?: HashEnvelopeV1;
    proof_bundle_hash: string;
    proof_bundle_hash_envelope: HashEnvelopeV1;
  }>;
}>;

export function buildEvidenceSnapshot(record: NormalizedEvidenceRecord): EvidenceSnapshotV1 {
  return Object.freeze({
    schema: "vera.discovery_agent.evidence_snapshot.v1",
    subject_type: record.subject_type,
    subject_id: record.subject_id,
    title: record.title,
    summary: record.summary,
    network: record.network,
    result_url: record.result_url,
    verify_url: record.verify_url,
    proof_card_url: record.proof_card_url,
    hcs_transaction_id: record.hcs_transaction_id,
    hcs_topic_id: record.hcs_topic_id,
  });
}

export function hashEvidenceSnapshot(snapshot: EvidenceSnapshotV1): HashEnvelopeV1 {
  return hashJson({
    domain: PROOF_DOMAINS.EVIDENCE_SNAPSHOT,
    value: snapshot,
  });
}

export function buildActionInput(input: {
  actionType: string;
  subjectType: string;
  subjectId: string;
  network: string;
  amount: string;
  token: string;
  recipientAccountId: string;
  evidenceSnapshotHash: string;
}): ActionInputV1 {
  return Object.freeze({
    schema: "vera.discovery_agent.action_input.v1",
    action_type: input.actionType,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    network: input.network,
    amount: input.amount,
    token: input.token,
    recipient_account_id: input.recipientAccountId,
    evidence_snapshot_hash: input.evidenceSnapshotHash,
  });
}

export function hashActionInput(actionInput: ActionInputV1): HashEnvelopeV1 {
  return hashJson({
    domain: PROOF_DOMAINS.ACTION_INPUT,
    value: actionInput,
  });
}

export function buildProofBundle(input: {
  action: AgentActionForBundle;
  subject: EvidenceSubject;
  evidence: EvidenceLinks;
  payment: PaymentForBundle;
  evidenceSnapshotHash: string;
  actionInputHash: string;
  evidenceSnapshotHashEnvelope?: HashEnvelopeV1;
  actionInputHashEnvelope?: HashEnvelopeV1;
  agent?: ProofBundleAgent;
  createdAt?: string;
}): ProofBundleV1 {
  const createdAt = input.createdAt ?? new Date().toISOString();

  const base = {
    schema: "vera.proof_bundle.v1" as const,
    network: input.payment.network || input.action.network || "testnet",
    agent: {
      name: input.agent?.name || "Vera Discovery Agent",
      version: input.agent?.version || "0.1.0",
    },
    action: {
      id: input.action.id,
      type: input.action.action_type,
      created_at: createdAt,
    },
    payment: {
      token: input.payment.token,
      amount: input.payment.amount,
      network: input.payment.network,
      transaction_id: input.payment.transaction_id,
      recipient_account_id: input.payment.recipient_account_id,
      payer_account_id: input.payment.payer_account_id ?? null,
    },
    subject: input.subject,
    evidence: input.evidence,
    hashes: {
      evidence_snapshot_hash: input.evidenceSnapshotHash,
      ...(input.evidenceSnapshotHashEnvelope
        ? { evidence_snapshot_hash_envelope: input.evidenceSnapshotHashEnvelope }
        : {}),
      action_input_hash: input.actionInputHash,
      ...(input.actionInputHashEnvelope
        ? { action_input_hash_envelope: input.actionInputHashEnvelope }
        : {}),
      proof_bundle_hash: null,
    },
  };

  const proofBundleHashEnvelope = hashJson({
    domain: PROOF_DOMAINS.PROOF_BUNDLE,
    value: base,
  });

  return Object.freeze({
    ...base,
    hashes: {
      ...base.hashes,
      proof_bundle_hash: proofBundleHashEnvelope.digest,
      proof_bundle_hash_envelope: proofBundleHashEnvelope,
    },
  });
}