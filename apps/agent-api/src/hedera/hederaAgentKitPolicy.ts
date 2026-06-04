// apps/agent-api/src/hedera/hederaAgentKitPolicy.ts

import type {
  HederaAgentOperation,
  HederaAgentPolicyDecision,
  HederaNetwork,
} from "./hederaAgentTypes.js";

export type HederaAgentPolicyInput = Readonly<{
  operation: HederaAgentOperation;
  network: HederaNetwork;
  verificationMode: "demo" | "mirror" | "disabled";
  mainnetWritesEnabled: boolean;
  hcsReceiptAnchoringEnabled: boolean;
  userWritesEnabled: boolean;
}>;

const SAFE_HEDERA_READ_OPERATIONS = new Set<HederaAgentOperation>([
  "agent_status",
  "account_validate",
  "account_balance_read",
  "payment_requirement_describe",
  "mirror_transaction_read",
  "hcs_message_read",
  "hcs_receipt_verify",
]);

const SAFE_EXPLORER_READ_OPERATIONS = new Set<HederaAgentOperation>([
  "explorer_query_plan",
  "explorer_evidence_search",
  "explorer_evidence_preview",
  "explorer_proof_chain_explain",
  "explorer_answer_summarize",
]);

function allow(
  operation: HederaAgentOperation,
  reason: string,
): HederaAgentPolicyDecision {
  return {
    operation,
    allowed: true,
    reason,
  };
}

function deny(
  operation: HederaAgentOperation,
  reason: string,
): HederaAgentPolicyDecision {
  return {
    operation,
    allowed: false,
    reason,
  };
}

export function evaluateHederaAgentPolicy(
  input: HederaAgentPolicyInput,
): HederaAgentPolicyDecision {
  if (input.operation === "autonomous_transfer") {
    return deny(input.operation, "AUTONOMOUS_USER_FUND_TRANSFERS_DISABLED");
  }

  if (input.operation === "arbitrary_tool_execution") {
    return deny(input.operation, "ARBITRARY_AGENT_KIT_TOOL_EXECUTION_DISABLED");
  }

  if (SAFE_HEDERA_READ_OPERATIONS.has(input.operation)) {
    return allow(input.operation, "SAFE_HEDERA_READ_OPERATION_ALLOWED");
  }

  if (SAFE_EXPLORER_READ_OPERATIONS.has(input.operation)) {
    return allow(input.operation, "SAFE_EXPLORER_READ_OPERATION_ALLOWED");
  }

  if (input.operation === "payment_transaction_verify") {
    if (input.verificationMode === "disabled") {
      return deny(input.operation, "PAYMENT_VERIFICATION_DISABLED");
    }

    return allow(
      input.operation,
      input.verificationMode === "mirror"
        ? "MIRROR_PAYMENT_VERIFICATION_ALLOWED"
        : "DEMO_PAYMENT_VERIFICATION_ALLOWED",
    );
  }

  if (input.operation === "payment_state_mark_verified") {
    if (input.verificationMode === "disabled") {
      return deny(
        input.operation,
        "PAYMENT_STATE_MUTATION_REQUIRES_VERIFICATION_MODE",
      );
    }

    return allow(
      input.operation,
      "PAYMENT_STATE_MUTATION_ALLOWED_AFTER_VERIFICATION",
    );
  }

  if (input.operation === "hcs_receipt_anchor") {
    if (!input.hcsReceiptAnchoringEnabled) {
      return deny(input.operation, "HCS_RECEIPT_ANCHORING_DISABLED");
    }

    if (input.network === "mainnet" && !input.mainnetWritesEnabled) {
      return deny(input.operation, "MAINNET_WRITES_DISABLED");
    }

    return allow(input.operation, "HCS_RECEIPT_ANCHOR_ALLOWED_BY_POLICY");
  }

  if (input.operation === "user_write_prepare") {
    if (!input.userWritesEnabled) {
      return deny(input.operation, "USER_WRITES_DISABLED");
    }

    return allow(
      input.operation,
      "USER_WRITE_PREPARE_ALLOWED_WITH_HUMAN_APPROVAL_REQUIRED",
    );
  }

  if (input.operation === "user_write_submit") {
    if (!input.userWritesEnabled) {
      return deny(input.operation, "USER_WRITES_DISABLED");
    }

    if (input.network === "mainnet" && !input.mainnetWritesEnabled) {
      return deny(input.operation, "MAINNET_WRITES_DISABLED");
    }

    return allow(
      input.operation,
      "USER_WRITE_SUBMIT_ALLOWED_ONLY_FOR_USER_SIGNED_TRANSACTIONS",
    );
  }

  return deny(input.operation, "UNKNOWN_OPERATION_DENIED");
}

export function evaluateHederaAgentPolicies(
  input: Omit<HederaAgentPolicyInput, "operation">,
  operations: readonly HederaAgentOperation[],
): HederaAgentPolicyDecision[] {
  return operations.map((operation) =>
    evaluateHederaAgentPolicy({
      ...input,
      operation,
    }),
  );
}