// apps/agent-api/src/hedera/hederaAgentTypes.ts

export type HederaNetwork = "mainnet" | "testnet" | "previewnet";

export type HederaAgentVerificationMode = "demo" | "mirror" | "disabled";

export type HederaAgentRuntimeMode = "restricted_adapter";

export type HederaAgentOperation =
  | "agent_status"
  | "account_validate"
  | "account_balance_read"
  | "payment_requirement_describe"
  | "mirror_transaction_read"
  | "hcs_message_read"
  | "hcs_receipt_verify"
  | "explorer_query_plan"
  | "explorer_evidence_search"
  | "explorer_evidence_preview"
  | "explorer_proof_chain_explain"
  | "explorer_answer_summarize"
  | "payment_transaction_verify"
  | "payment_state_mark_verified"
  | "hcs_receipt_anchor"
  | "user_write_prepare"
  | "user_write_submit"
  | "autonomous_transfer"
  | "arbitrary_tool_execution";

export type HederaAgentPolicyDecision = Readonly<{
  operation: HederaAgentOperation;
  allowed: boolean;
  reason: string;
}>;

export type HederaAgentSafetyStatus = Readonly<{
  autonomous_user_fund_transfers: false;
  arbitrary_tool_execution: false;
  raw_agent_kit_client_exposed: false;
  user_private_keys_accepted: false;
  mainnet_writes_enabled: boolean;
  hcs_receipt_anchoring_enabled: boolean;
  user_writes_enabled: boolean;
  human_approval_required_for_writes: true;
}>;

export type HederaAgentConfigStatus = Readonly<{
  network: HederaNetwork;
  operator_account_id: string | null;
  treasury_account_id: string | null;
  has_operator_private_key: boolean;
  has_treasury_private_key: boolean;
  verification_mode: HederaAgentVerificationMode;
  mainnet_writes_enabled: boolean;
  hcs_receipt_anchoring_enabled: boolean;
  user_writes_enabled: boolean;
}>;

export type HederaAgentKitRuntimeStatus = Readonly<{
  enabled: boolean;

  /**
   * Keep this explicit: the API is not exposing raw Agent Kit tooling.
   * The current design is a restricted adapter boundary for Explorer/Hedera reads.
   */
  integration: "isolated_v4_adapter";

  /**
   * Kept for route/schema compatibility and simple status rendering.
   */
  package_name: "@hashgraph/hedera-agent-kit";

  /**
   * More precise v4 package names for the bounty/status surface.
   */
  core_package_name: "@hashgraph/hedera-agent-kit";
  mcp_package_name: "@hashgraph/hedera-agent-kit-mcp";

  /**
   * The main API intentionally does not load the raw Agent Kit runtime.
   * A later adapter/MCP process can report loaded=true from its own status route.
   */
  loaded: false;

  mode: HederaAgentRuntimeMode;
  load_error: string | null;
  isolation_reason: string;
}>;

export type HederaAgentStatus = Readonly<{
  ok: true;
  network: HederaNetwork;
  agent_kit: HederaAgentKitRuntimeStatus;
  operator: {
    account_id: string | null;
    configured: boolean;
  };
  treasury: {
    account_id: string | null;
    configured: boolean;
  };
  payments: {
    asset: "HBAR";
    verification_mode: HederaAgentVerificationMode;
    x402_version: 1;
  };
  safety: HederaAgentSafetyStatus;
  policy: {
    decisions: HederaAgentPolicyDecision[];
  };
}>;

export type HederaAgentReadSource =
  | "hedera_mirror_node"
  | "hedera_agent_kit_adapter";

export type HederaMirrorTransactionReadInput = Readonly<{
  transactionId: string;
}>;

export type HederaHcsMessageReadInput = Readonly<{
  topicId: string;
  transactionId?: string | null;
  consensusTimestamp?: string | null;
}>;

export type HederaMirrorTransactionReadResult = Readonly<{
  ok: true;
  network: HederaNetwork;
  source: HederaAgentReadSource;
  transaction_id: string;
  normalized_transaction_id: string;
  found: boolean;
  consensus_timestamp: string | null;
  name: string | null;
  result: string | null;
  charged_tx_fee: number | null;
  entity_id: string | null;
  node: string | null;
  valid_start_timestamp: string | null;
  raw: Record<string, unknown> | null;
}>;

export type HederaHcsMessageReadResult = Readonly<{
  ok: true;
  network: HederaNetwork;
  source: HederaAgentReadSource;
  topic_id: string;
  transaction_id: string | null;
  normalized_transaction_id: string | null;
  consensus_timestamp: string | null;
  found: boolean;
  sequence_number: number | null;
  running_hash: string | null;
  running_hash_version: number | null;
  payer_account_id: string | null;
  message_base64: string | null;
  raw: Record<string, unknown> | null;
}>;

export type HederaHcsReceiptVerificationResult = Readonly<{
  ok: true;
  network: HederaNetwork;
  source: HederaAgentReadSource;
  transaction_id: string;
  normalized_transaction_id: string;
  topic_id: string | null;
  mirror_transaction_found: boolean;
  hcs_message_found: boolean;
  consensus_timestamp: string | null;
  sequence_number: number | null;
  running_hash: string | null;
  payer_account_id: string | null;
  transaction_result: string | null;
  verified: boolean;
  warnings: string[];
  transaction: HederaMirrorTransactionReadResult;
  message: HederaHcsMessageReadResult | null;
}>;