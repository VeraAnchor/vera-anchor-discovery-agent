export type AgentActionStatus =
  | "pending_payment"
  | "executing"
  | "completed"
  | "failed"
  | "expired";

export type AgentActionRecord = Readonly<{
  id: string;
  action_type: "proof_bundle_export";
  status: AgentActionStatus;
  subject_type: string;
  subject_id: string;
  network: string;
  quote_amount: string;
  quote_token: "HBAR";
  recipient_account_id: string;
  evidence_snapshot_hash: string;
  action_input_hash: string;
  input_hash: string;
  payment_transaction_id: string | null;
  output_hash: string | null;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
}>;

export type PaymentVerification = Readonly<{
  transaction_id: string;
  payer_account_id: string | null;
  amount: string;
  token: "HBAR";
  network: string;
  recipient_account_id: string;
  verified_mode: "demo" | "hedera" | "mirror";
}>;

export type AgentReceiptRecord = Readonly<{
  id: string;
  action_id: string;
  proof_bundle: unknown;
  proof_bundle_hash: string;
  proof_card: unknown;
  proof_card_hash: string | null;
  created_at: string;
}>;