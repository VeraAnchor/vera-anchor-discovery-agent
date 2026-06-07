// apps/agent-api/src/hedera/hederaAgentKitClient.ts

import type {
  HederaAgentConfigStatus,
  HederaAgentKitRuntimeStatus,
  HederaAgentOperation,
  HederaAgentStatus,
  HederaAgentVerificationMode,
  HederaNetwork,
} from "./hederaAgentTypes.js";
import { evaluateHederaAgentPolicies } from "./hederaAgentKitPolicy.js";
import { config as appConfig } from "../config.js";

const ACCOUNT_ID_RE = /^0\.0\.\d+$/;

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function readEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = cleanString(process.env[name]);

    if (value && value !== "REPLACE_ME" && !value.includes("REPLACE_ME")) {
      return value;
    }
  }

  return null;
}

function readBooleanEnv(name: string, fallback = false): boolean {
  const raw = cleanString(process.env[name]).toLowerCase();

  if (!raw) return fallback;

  if (["1", "true", "t", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "f", "no", "n", "off"].includes(raw)) return false;

  throw new Error(`${name}_MUST_BE_BOOLEAN`);
}

function normalizeNetwork(value: unknown): HederaNetwork {
  const raw = cleanString(value || "testnet").toLowerCase();

  if (raw === "mainnet" || raw === "testnet" || raw === "previewnet") {
    return raw;
  }

  throw new Error("HEDERA_NETWORK_MUST_BE_MAINNET_TESTNET_OR_PREVIEWNET");
}

function normalizeVerificationMode(value: unknown): HederaAgentVerificationMode {
  const raw = cleanString(value || "demo").toLowerCase();

  if (raw === "demo" || raw === "mirror" || raw === "disabled") {
    return raw;
  }

  throw new Error("HEDERA_AGENT_PAYMENT_VERIFICATION_MODE_INVALID");
}

function validAccountIdOrNull(value: string | null): string | null {
  if (!value) return null;

  if (!ACCOUNT_ID_RE.test(value)) {
    throw new Error("HEDERA_ACCOUNT_ID_MUST_MATCH_0_0_NUMERIC");
  }

  return value;
}

function privateKeyConfigured(value: string | null): boolean {
  return Boolean(value && value.length >= 16);
}

export function getHederaAgentConfigStatus(): HederaAgentConfigStatus {
  const network = normalizeNetwork(
    readEnv("HEDERA_NETWORK", "HEDERA_AGENT_NETWORK") ?? "testnet",
  );

  const operatorAccountId = validAccountIdOrNull(
    readEnv(
      "HEDERA_OPERATOR_ACCOUNT_ID",
      "HEDERA_OPERATOR_ID",
      "HEDERA_ACCOUNT_ID",
    ),
  );

  const treasuryAccountId = validAccountIdOrNull(
    readEnv(
      "HEDERA_TREASURY_ACCOUNT_ID",
      "TREASURY_ACCOUNT_ID",
      "HEDERA_PAY_TO_ACCOUNT_ID",
    ),
  );

  const operatorPrivateKey = readEnv(
    "HEDERA_OPERATOR_PRIVATE_KEY",
    "HEDERA_OPERATOR_KEY",
    "HEDERA_PRIVATE_KEY",
  );

  const treasuryPrivateKey = readEnv(
    "HEDERA_TREASURY_PRIVATE_KEY",
    "TREASURY_PRIVATE_KEY",
  );

  const verificationMode = normalizeVerificationMode(
    readEnv("HEDERA_AGENT_PAYMENT_VERIFICATION_MODE") ?? "demo",
  );

  const mainnetWritesEnabled = readBooleanEnv(
    "HEDERA_AGENT_MAINNET_WRITES_ENABLED",
    false,
  );

  const hcsReceiptAnchoringEnabled = readBooleanEnv(
    "HEDERA_AGENT_HCS_RECEIPT_ANCHORING_ENABLED",
    false,
  );

  const userWritesEnabled = readBooleanEnv(
    "HEDERA_AGENT_USER_WRITES_ENABLED",
    false,
  );

  if (network === "mainnet" && mainnetWritesEnabled) {
    const explicitAllow = readBooleanEnv(
      "HEDERA_AGENT_EXPLICITLY_ALLOW_MAINNET_WRITES",
      false,
    );

    if (!explicitAllow) {
      throw new Error(
        "MAINNET_WRITES_REQUIRE_HEDERA_AGENT_EXPLICITLY_ALLOW_MAINNET_WRITES_TRUE",
      );
    }
  }

  if (network === "mainnet" && verificationMode === "demo") {
    throw new Error("DEMO_PAYMENT_VERIFICATION_NOT_ALLOWED_ON_MAINNET");
  }

  return {
    network,
    operator_account_id: operatorAccountId,
    treasury_account_id: treasuryAccountId,
    has_operator_private_key: privateKeyConfigured(operatorPrivateKey),
    has_treasury_private_key: privateKeyConfigured(treasuryPrivateKey),
    verification_mode: verificationMode,
    mainnet_writes_enabled: mainnetWritesEnabled,
    hcs_receipt_anchoring_enabled: hcsReceiptAnchoringEnabled,
    user_writes_enabled: userWritesEnabled,
  };
}

export async function getHederaAgentKitRuntimeStatus(): Promise<HederaAgentKitRuntimeStatus> {
  return {
    enabled: true,
    integration: "isolated_v4_adapter",
    package_name: "@hashgraph/hedera-agent-kit",
    core_package_name: "@hashgraph/hedera-agent-kit",
    mcp_package_name: "@hashgraph/hedera-agent-kit-mcp",
    loaded: false,
    mode: "restricted_adapter",
    load_error: null,
    isolation_reason:
      "Hedera Agent Kit v4 is intentionally isolated from the agent-api runtime. The production API exposes a restricted Explorer/Hedera query surface and can integrate Agent Kit through a separate MCP/adapter process without exposing raw tools, private keys, arbitrary execution, or autonomous fund transfers.",
  };
}

export async function getHederaAgentStatus(): Promise<HederaAgentStatus> {
  const config = getHederaAgentConfigStatus();
  const agentKit = await getHederaAgentKitRuntimeStatus();

  const policyOperations: HederaAgentOperation[] = [
    "agent_status",
    "account_validate",
    "account_balance_read",
    "payment_requirement_describe",
    "mirror_transaction_read",
    "hcs_message_read",
    "hcs_receipt_verify",
    "explorer_query_plan",
    "explorer_evidence_search",
    "explorer_evidence_preview",
    "explorer_proof_chain_explain",
    "explorer_answer_summarize",
    "payment_transaction_verify",
    "payment_state_mark_verified",
    "hcs_receipt_anchor",
    "user_write_prepare",
    "user_write_submit",
    "autonomous_transfer",
    "arbitrary_tool_execution",
  ];

  const decisions = evaluateHederaAgentPolicies(
    {
      network: config.network,
      verificationMode: config.verification_mode,
      mainnetWritesEnabled: config.mainnet_writes_enabled,
      hcsReceiptAnchoringEnabled: config.hcs_receipt_anchoring_enabled,
      userWritesEnabled: config.user_writes_enabled,
    },
    policyOperations,
  );

  const statusDecision = decisions.find((d) => d.operation === "agent_status");

  if (!statusDecision?.allowed) {
    throw new Error(statusDecision?.reason ?? "HEDERA_AGENT_STATUS_DENIED");
  }

  return {
    ok: true,
    network: config.network,
    agent_kit: agentKit,
    operator: {
      account_id: config.operator_account_id,
      configured: Boolean(
        config.operator_account_id && config.has_operator_private_key,
      ),
    },
    treasury: {
      account_id: config.treasury_account_id,
      configured: Boolean(config.treasury_account_id),
    },
    payments: {
      asset: "HBAR",
      verification_mode: config.verification_mode,
      x402_version: 1,
    },
    safety: {
      autonomous_user_fund_transfers: false,
      arbitrary_tool_execution: false,
      raw_agent_kit_client_exposed: false,
      user_private_keys_accepted: false,
      mainnet_writes_enabled: config.mainnet_writes_enabled,
      hcs_receipt_anchoring_enabled: config.hcs_receipt_anchoring_enabled,
      user_writes_enabled: config.user_writes_enabled,
      human_approval_required_for_writes: true,
    },
    policy: {
      decisions,
    },
  };
}