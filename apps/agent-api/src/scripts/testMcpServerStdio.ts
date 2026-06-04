// apps/agent-api/src/scripts/testMcpServerStdio.ts

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

type JsonRpcId = number;

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: unknown;
};

const runId = Date.now();
const serverPath = "apps/agent-api/dist/mcp/mcpServer.js";

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

function parseToolText(response: JsonRpcResponse): unknown {
  if (response.error) {
    throw new Error(`JSON-RPC error: ${JSON.stringify(response.error)}`);
  }

  const result = getObject(response.result, "result");
  const content = result.content;

  if (!Array.isArray(content) || content.length < 1) {
    throw new Error("Expected MCP content array");
  }

  const first = getObject(content[0], "result.content[0]");
  const text = first.text;

  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Expected MCP text content");
  }

  return JSON.parse(text) as unknown;
}

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

async function main(): Promise<void> {
  const child = spawn("node", [serverPath], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      MCP_ACTOR_REF: "public:anonymous",
      MCP_ORG_REF: "public",
      MCP_CLIENT_REF: "local-mcp-server-stdio-test",
      MCP_SESSION_ID: `local-mcp-stdio-session-${runId}`,
    },
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  const rl = createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });

  const pending = new Map<JsonRpcId, (response: JsonRpcResponse) => void>();

  rl.on("line", (line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    const response = JSON.parse(trimmed) as JsonRpcResponse;
    const resolve = pending.get(response.id);

    if (!resolve) {
      throw new Error(`Unexpected JSON-RPC response id: ${response.id}`);
    }

    pending.delete(response.id);
    resolve(response);
  });

  let nextId = 1;

  async function request(method: string, params: unknown): Promise<JsonRpcResponse> {
    const id = nextId++;

    const responsePromise = new Promise<JsonRpcResponse>((resolve) => {
      pending.set(id, resolve);
    });

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      })}\n`,
    );

    return responsePromise;
  }

  const initialize = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "local-stdio-test",
      version: "0.1.0",
    },
  });

  print("initialize", initialize);

  const toolsList = await request("tools/list", {});
  print("tools/list", toolsList);

  const searchResponse = await request("tools/call", {
    name: "vera.search_evidence",
    arguments: {
      q: "demo",
      limit: 3,
    },
  });

  const search = parseToolText(searchResponse);
  print("search", search);

  const previewResponse = await request("tools/call", {
    name: "vera.preview_evidence",
    arguments: {
      subject_type: "cipher_result",
      subject_id: "demo-cipher-public-result",
    },
  });

  const preview = parseToolText(previewResponse);
  print("preview", preview);

  const quoteResponse = await request("tools/call", {
    name: "vera.create_proof_bundle_quote",
    arguments: {
      subject_type: "cipher_result",
      subject_id: "demo-cipher-public-result",
      idempotency_key: `local-mcp-stdio-proof-${runId}`,
    },
  });

  const quote = parseToolText(quoteResponse);
  print("quote", quote);

  const actionId = getNestedString(quote, ["data", "action_id"]);

  const requirementsResponse = await request("tools/call", {
    name: "vera.get_payment_requirements",
    arguments: {
      action_id: actionId,
    },
  });

  const requirements = parseToolText(requirementsResponse);
  print("payment requirements", requirements);

  const unpaidExecuteResponse = await request("tools/call", {
    name: "vera.execute_proof_bundle_export",
    arguments: {
      action_id: actionId,
    },
  });

  const unpaidExecute = parseToolText(unpaidExecuteResponse);
  print("unpaid execute", unpaidExecute);

  const paymentTransactionId = demoHederaTransactionId();

  const paidExecuteResponse = await request("tools/call", {
    name: "vera.execute_proof_bundle_export",
    arguments: {
      action_id: actionId,
      payment_transaction_id: paymentTransactionId,
      payer_account_id: "0.0.12345",
    },
  });

  const paidExecute = parseToolText(paidExecuteResponse);
  print("paid execute", paidExecute);

  const receiptId =
    getNestedOptionalString(paidExecute, ["data", "receipt", "id"]) ??
    getNestedOptionalString(paidExecute, ["data", "proof_bundle_id"]);

  if (!receiptId) {
    throw new Error("Expected receipt id from paid execute response");
  }

  const receiptResponse = await request("tools/call", {
    name: "vera.get_receipt",
    arguments: {
      receipt_id: receiptId,
    },
  });

  const receipt = parseToolText(receiptResponse);
  print("receipt", receipt);

  const retryResponse = await request("tools/call", {
    name: "vera.execute_proof_bundle_export",
    arguments: {
      action_id: actionId,
      payment_transaction_id: paymentTransactionId,
      payer_account_id: "0.0.12345",
    },
  });

  const retrySameAction = parseToolText(retryResponse);
  print("retry same action", retrySameAction);

  child.stdin.end();
  await once(child, "exit");

  console.log("\nMCP stdio E2E test completed");
  console.log(`action_id=${actionId}`);
  console.log(`receipt_id=${receiptId}`);
  console.log(`payment_transaction_id=${paymentTransactionId}`);
}

main().catch((err) => {
  console.error("\nMCP stdio E2E test failed");
  console.error(err);
  process.exit(1);
});