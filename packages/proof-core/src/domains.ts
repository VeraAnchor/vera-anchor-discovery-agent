export const PROOF_DOMAINS = Object.freeze({
  ACTION_INPUT: "vera.discovery_agent.action_input.v1",
  EVIDENCE_SNAPSHOT: "vera.discovery_agent.evidence_snapshot.v1",
  PROOF_BUNDLE: "vera.discovery_agent.proof_bundle.v1",
  PROOF_CARD: "vera.discovery_agent.proof_card.v1",
  RECEIPT: "vera.discovery_agent.receipt.v1",
} as const);

export type ProofDomainKey = keyof typeof PROOF_DOMAINS;
export type ProofDomain = (typeof PROOF_DOMAINS)[ProofDomainKey];