export { PROOF_DOMAINS } from "./domains.js";
export type { ProofDomain, ProofDomainKey } from "./domains.js";

export { buildProofCard } from "./proofCard.js";
export type { ProofCardV1 } from "./proofCard.js";

export {
  normalizeEvidenceRecord,
  evidenceSubjectFromRecord,
  evidenceLinksFromRecord,
} from "./normalizeEvidence.js";

export type {
  EvidenceRecordInput,
  NormalizedEvidenceRecord,
  EvidenceSubject,
  EvidenceLinks,
} from "./normalizeEvidence.js";

export {
  buildEvidenceSnapshot,
  hashEvidenceSnapshot,
  buildActionInput,
  hashActionInput,
  buildProofBundle,
} from "./proofBundle.js";

export type {
  EvidenceSnapshotV1,
  ActionInputV1,
  AgentActionForBundle,
  PaymentForBundle,
  ProofBundleAgent,
  ProofBundleV1,
} from "./proofBundle.js";