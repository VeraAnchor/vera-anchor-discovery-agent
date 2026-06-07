export type HederaExactPaymentRequirement = Readonly<{
  scheme: "exact";
  kind: "hedera_hbar_transfer";
  network: string;
  asset: "HBAR";
  amount: string;
  amount_minor: number;
  pay_to: string;
  memo: string;
  resource: string;
  action_id: string;
  quote_id: string;
  quote_hash: string;
  input_hash: string;
  expires_at: string;
  description: string;
  facilitator_url: string | null;
  payment_url: string | null;
}>;

export type ActionPaymentRequirements = Readonly<{
  x402_version: 1;
  payment_required: true;
  accepts: readonly HederaExactPaymentRequirement[];
  selected: HederaExactPaymentRequirement;
}>;

export type ProofExportQuote = Readonly<{
  action_id: string;
  quote_id: string;
  action_type: "proof_bundle_export";
  amount: string;
  amount_minor: number;
  token: "HBAR";
  currency: "HBAR";
  network: string;
  recipient_account_id: string;
  evidence_snapshot_hash: string;
  action_input_hash: string;
  input_hash: string;
  quote_hash: string;
  expires_at: string;
  payment_memo: string;
  payment_url: string | null;
  payment_requirements: ActionPaymentRequirements;
}>;

export type ExecutePaidActionResult = Readonly<{
  status: "completed";
  action_id: string;
  payment_id: string | null;
  proof_bundle_id: string;
  proof_bundle_hash: string;
  proof_card_hash: string | null;
  proof_bundle_url: string;
  proof_card_url: string;
  verify_url: string;
  receipt: unknown;
}>;

export type CreateProofExportQuoteInput = Readonly<{
  subjectType: "cipher_result" | "sage_result" | "dataset" | "hcs_transaction" | "proof_card";
  subjectId: string;
  idempotencyKey?: string | null;
}>;

export type ExecutePaidActionInput = Readonly<{
  actionId: string;
  paymentTransactionId: string;
  payerAccountId?: string | null;
}>;

async function readJsonOrThrow<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : `HTTP_${response.status}`;

    throw new Error(message);
  }

  return payload as T;
}

export async function createProofExportQuote(
  input: CreateProofExportQuoteInput,
): Promise<ProofExportQuote> {
  const response = await fetch("/v1/quotes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      action_type: "proof_bundle_export",
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
    }),
  });

  return readJsonOrThrow<ProofExportQuote>(response);
}

export async function executePaidAction(
  input: ExecutePaidActionInput,
): Promise<ExecutePaidActionResult> {
  const response = await fetch(`/v1/actions/${encodeURIComponent(input.actionId)}/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      payment_transaction_id: input.paymentTransactionId,
      payer_account_id: input.payerAccountId ?? null,
    }),
  });

  return readJsonOrThrow<ExecutePaidActionResult>(response);
}