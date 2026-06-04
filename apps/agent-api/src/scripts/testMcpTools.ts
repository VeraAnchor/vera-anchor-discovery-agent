// apps/agent-api/src/scripts/testMcpTools.ts

import { executeVeraMcpTool } from "../mcp/mcpTools.js";
import { MCP_TOOL_NAMES } from "../mcp/mcpSchemas.js";
import type { VeraMcpExecutionContext } from "../mcp/mcpTools.js";

const runId = Date.now();

const context: VeraMcpExecutionContext = {
  serviceContext: {
    actorRef: "public:anonymous",
    orgRef: "public",
    requestId: `local-mcp-test-${runId}`,
    systemScope: false,
  },
  sessionId: "local-dev-session",
  clientRef: "local-dev-cli",
};

function print(label: string, value: unknown): void {
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(value, null, 2));
}

function getObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object at ${path}`);
  }

  return value as Record<string, unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getNestedString(value: unknown, path: readonly string[]): string {
  let current: unknown = value;

  for (const key of path) {
    const obj = getObject(current, path.join("."));
    current = obj[key];
  }

  if (typeof current !== "string" || !current.trim()) {
    throw new Error(`Expected non-empty string at path: ${path.join(".")}`);
  }

  return current;
}

function getNestedOptionalString(value: unknown, path: readonly string[]): string | null {
  let current: unknown = value;

  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" && current.trim() ? current : null;
}

function demoHederaTransactionId(): string {
  const seconds = Math.floor(Date.now() / 1000);
  const nanos = String(runId % 1_000_000_000).padStart(9, "0");

  return `0.0.12345@${seconds}.${nanos}`;
}

function getNestedUuid(value: unknown, path: readonly string[]): string {
  const id = getNestedString(value, path).toLowerCase();

  if (!UUID_RE.test(id)) {
    throw new Error(`Expected UUID at path ${path.join(".")}; received: ${id}`);
  }

  return id;
}

async function main(): Promise<void> {
  const search = await executeVeraMcpTool(
    MCP_TOOL_NAMES.SEARCH_EVIDENCE,
    {
      q: "demo",
      limit: 3,
    },
    context,
  );

  print("search", search);

  const preview = await executeVeraMcpTool(
    MCP_TOOL_NAMES.PREVIEW_EVIDENCE,
    {
      subject_type: "cipher_result",
      subject_id: "demo-cipher-public-result",
    },
    context,
  );

  print("preview", preview);

  const quote = await executeVeraMcpTool(
    MCP_TOOL_NAMES.CREATE_PROOF_BUNDLE_QUOTE,
    {
      subject_type: "cipher_result",
      subject_id: "demo-cipher-public-result",
      idempotency_key: `local-mcp-proof-${runId}`,
    },
    context,
  );

  print("quote", quote);

  const actionId = getNestedUuid(quote, ["data", "action_id"]);

  const requirements = await executeVeraMcpTool(
    MCP_TOOL_NAMES.GET_PAYMENT_REQUIREMENTS,
    {
      action_id: actionId,
    },
    context,
  );

  print("payment requirements", requirements);

  const unpaidExecute = await executeVeraMcpTool(
    MCP_TOOL_NAMES.EXECUTE_PROOF_BUNDLE_EXPORT,
    {
      action_id: actionId,
    },
    context,
  );

  print("unpaid execute", unpaidExecute);

  const paymentTransactionId = demoHederaTransactionId();

  const paidExecute = await executeVeraMcpTool(
    MCP_TOOL_NAMES.EXECUTE_PROOF_BUNDLE_EXPORT,
    {
      action_id: actionId,
      payment_transaction_id: paymentTransactionId,
      payer_account_id: "0.0.12345",
    },
    context,
  );

  print("paid execute", paidExecute);

  const receiptId =
    getNestedOptionalString(paidExecute, ["data", "receipt", "id"]) ??
    getNestedOptionalString(paidExecute, ["data", "proof_bundle_id"]);

  if (!receiptId) {
    throw new Error("Expected receipt id from paid execute response");
  }

  const receipt = await executeVeraMcpTool(
    MCP_TOOL_NAMES.GET_RECEIPT,
    {
      receipt_id: receiptId,
    },
    context,
  );

  print("receipt", receipt);

  const retrySameAction = await executeVeraMcpTool(
    MCP_TOOL_NAMES.EXECUTE_PROOF_BUNDLE_EXPORT,
    {
      action_id: actionId,
      payment_transaction_id: paymentTransactionId,
      payer_account_id: "0.0.12345",
    },
    context,
  );

  print("retry same action", retrySameAction);

  console.log("\nMCP E2E test completed");
  console.log(`action_id=${actionId}`);
  console.log(`receipt_id=${receiptId}`);
  console.log(`payment_transaction_id=${paymentTransactionId}`);
}

main().catch((err) => {
  console.error("\nMCP E2E test failed");
  console.error(err);
  process.exit(1);
});