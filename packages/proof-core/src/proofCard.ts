import { hashJson, type HashEnvelopeV1 } from "@vera-discovery/hashing-core";
import { PROOF_DOMAINS } from "./domains.js";
import type { ProofBundleV1 } from "./proofBundle.js";

export type ProofCardV1 = Readonly<{
  type: string;
  title: string;
  status: string;
  subject: string;
  description: string;
  primaryId: string;
  secondaryId: string;
  anchorId: string;
  verifyUrl: string;
  network: string;
  tags: readonly string[];

  proofBundleHash: string;
  proofCardHash: string;
  proofCardHashEnvelope: HashEnvelopeV1;
}>;

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function compactId(value: unknown): string {
  return cleanString(value);
}

function networkLabel(value: unknown): string {
  const s = cleanString(value).toLowerCase();
  if (!s) return "Hedera";
  if (s === "testnet") return "Hedera testnet";
  if (s === "mainnet") return "Hedera mainnet";
  return s;
}

function titleForSubjectType(subjectType: string): string {
  switch (subjectType) {
    case "sage_result":
      return "SAGE result proof bundle";
    case "cipher_result":
      return "CIPHER result proof bundle";
    case "dataset":
      return "Dataset proof bundle";
    case "hcs_transaction":
      return "Public timestamp proof bundle";
    case "proof_card":
      return "Proof card bundle";
    default:
      return "Vera Anchor proof bundle";
  }
}

function tagsForSubjectType(subjectType: string): string[] {
  const base = ["Reviewer-ready", "Paid export"];

  switch (subjectType) {
    case "sage_result":
      return ["Reviewable", "SAGE", "Verifiable compute", ...base];
    case "cipher_result":
      return ["Reviewable", "CIPHER", "Verifiable compute", ...base];
    case "dataset":
      return ["Reviewable", "Dataset", ...base];
    case "hcs_transaction":
      return ["Reviewable", "HCS", "Public timestamp", ...base];
    case "proof_card":
      return ["Reviewable", "Proof Card", ...base];
    default:
      return ["Reviewable", ...base];
  }
}

export function buildProofCard(bundle: ProofBundleV1): ProofCardV1 {
  const subjectType = cleanString(bundle.subject.type || "proof_bundle");
  const subjectId = cleanString(bundle.subject.id);
  const subjectTitle = cleanString(bundle.subject.title);
  const anchorId = cleanString(
    bundle.evidence.hcs_transaction_id || bundle.evidence.hcs_topic_id || ""
  );

  const base = {
    type: subjectType,
    title: titleForSubjectType(subjectType),
    status: anchorId ? "Anchored" : "Reviewable",
    subject: subjectTitle || (subjectId ? `Record ${subjectId}` : "Vera Anchor record"),
    description:
      "Paid Vera Anchor Discovery Agent export with evidence context, verifier link, payment reference, and deterministic proof-bundle hash.",
    primaryId: compactId(bundle.hashes.proof_bundle_hash),
    secondaryId: compactId(subjectId),
    anchorId,
    verifyUrl: cleanString(bundle.evidence.verify_url),
    network: networkLabel(bundle.network),
    tags: tagsForSubjectType(subjectType),

    proofBundleHash: bundle.hashes.proof_bundle_hash,
  };

  const proofCardHashEnvelope = hashJson({
    domain: PROOF_DOMAINS.PROOF_CARD,
    value: base,
  });

  return Object.freeze({
    ...base,
    proofCardHash: proofCardHashEnvelope.digest,
    proofCardHashEnvelope,
  });
}