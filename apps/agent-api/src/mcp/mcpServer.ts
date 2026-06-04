// apps/agent-api/src/mcp/mcpServer.ts

import crypto from "node:crypto";
import readline from "node:readline";
import type { AgentServiceContext } from "../services/agentServiceContext.js";
import {
  executeVeraMcpTool,
  type VeraMcpExecutionContext,
} from "./mcpTools.js";
import {
  MCP_TOOL_NAMES,
  isVeraMcpToolName,
  type VeraMcpToolName,
} from "./mcpSchemas.js";

const SERVER_NAME = "vera-discovery-agent";
const SERVER_VERSION = "0.1.0";
const PROTOCOL_VERSION = "2024-11-05";

type JsonRpcId = string | number | null;

type JsonObject = Record<string, unknown>;

type JsonRpcRequest = Readonly<{
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}>;

type McpErrorLike = Error & {
  status?: unknown;
  code?: unknown;
  mcp_audit_id?: unknown;
};

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function optionalRef(value: unknown): string | null {
  const s = cleanString(value);
  return s || null;
}

function requestId(): string {
  return `mcp-${Date.now()}-${crypto.randomUUID()}`;
}

function buildServiceContext(): AgentServiceContext {
  return {
    actorRef: optionalRef(process.env.MCP_ACTOR_REF) ?? "public:anonymous",
    orgRef: optionalRef(process.env.MCP_ORG_REF) ?? "public",
    requestId: requestId(),
    systemScope: process.env.MCP_SYSTEM_SCOPE === "true",
  };
}

function buildExecutionContext(): VeraMcpExecutionContext {
  return {
    serviceContext: buildServiceContext(),
    sessionId: optionalRef(process.env.MCP_SESSION_ID) ?? "mcp-stdio-session",
    clientRef: optionalRef(process.env.MCP_CLIENT_REF) ?? "mcp-stdio",
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeArguments(value: unknown): JsonObject {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isJsonObject(value)) {
    throw new Error("MCP_TOOL_ARGUMENTS_MUST_BE_OBJECT");
  }

  return value;
}

function normalizeParams(value: unknown): JsonObject {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isJsonObject(value)) {
    throw new Error("MCP_PARAMS_MUST_BE_OBJECT");
  }

  return value;
}

function normalizeId(value: unknown): JsonRpcId {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    value === null
  ) {
    return value;
  }

  return null;
}

function errorCode(err: unknown): string {
  const e = err as McpErrorLike;

  const raw =
    typeof e?.code === "string" && e.code.trim()
      ? e.code.trim()
      : typeof e?.message === "string" && e.message.trim()
        ? e.message.trim()
        : "MCP_TOOL_FAILED";

  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9_:-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 128);
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message.trim()
    ? err.message.slice(0, 512)
    : "MCP tool execution failed.";
}

function errorStatus(err: unknown): number | null {
  const e = err as McpErrorLike;
  const status = Number(e?.status);
  return Number.isFinite(status) ? status : null;
}

function errorAuditId(err: unknown): string | null {
  const e = err as McpErrorLike;
  return typeof e?.mcp_audit_id === "string" && e.mcp_audit_id.trim()
    ? e.mcp_audit_id
    : null;
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function resultResponse(id: JsonRpcId, result: unknown): void {
  writeJson({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function errorResponse(input: {
  id: JsonRpcId;
  code: number;
  message: string;
  data?: unknown;
}): void {
  writeJson({
    jsonrpc: "2.0",
    id: input.id,
    error: {
      code: input.code,
      message: input.message,
      ...(input.data === undefined ? {} : { data: input.data }),
    },
  });
}

const searchEvidenceInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    q: {
      type: "string",
      maxLength: 256,
      description: "Search query. Alias of query.",
    },
    query: {
      type: "string",
      maxLength: 256,
      description: "Search query. Alias of q.",
    },
    type: {
      type: "string",
      maxLength: 128,
      description: "Optional evidence type filter.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 25,
      description: "Maximum number of evidence records to return.",
    },
  },
} as const;

const previewEvidenceInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["subject_type", "subject_id"],
  properties: {
    subject_type: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[a-z][a-z0-9_:-]{1,127}$",
      description: "Evidence subject type, such as cipher_result or sage_result.",
    },
    subject_id: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description: "Evidence subject id.",
    },
  },
} as const;

const createProofBundleQuoteInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["subject_type", "subject_id"],
  properties: {
    subject_type: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[a-z][a-z0-9_:-]{1,127}$",
      description: "Evidence subject type, such as cipher_result or sage_result.",
    },
    subject_id: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description: "Evidence subject id.",
    },
    idempotency_key: {
      type: "string",
      minLength: 8,
      maxLength: 256,
      description: "Optional idempotency key for quote/action creation.",
    },
  },
} as const;

const getPaymentRequirementsInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action_id"],
  properties: {
    action_id: {
      type: "string",
      format: "uuid",
      description: "Action id returned by vera.create_proof_bundle_quote.",
    },
  },
} as const;

const executeProofBundleExportInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action_id"],
  properties: {
    action_id: {
      type: "string",
      format: "uuid",
      description: "Action id returned by vera.create_proof_bundle_quote.",
    },
    payment_transaction_id: {
      type: "string",
      minLength: 8,
      maxLength: 128,
      description:
        "Hedera payment transaction id. Omit to receive payment requirements.",
    },
    payer_account_id: {
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^0\\.0\\.\\d+$",
      description: "Optional Hedera payer account id.",
    },
  },
} as const;

const getReceiptInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["receipt_id"],
  properties: {
    receipt_id: {
      type: "string",
      format: "uuid",
      description: "Receipt id returned by vera.execute_proof_bundle_export.",
    },
  },
} as const;

const tools = [
  {
    name: MCP_TOOL_NAMES.SEARCH_EVIDENCE,
    description:
      "Search Vera Anchor public evidence records available for preview or proof-bundle export.",
    inputSchema: searchEvidenceInputSchema,
  },
  {
    name: MCP_TOOL_NAMES.PREVIEW_EVIDENCE,
    description:
      "Preview a Vera Anchor evidence subject before creating a paid proof-bundle quote.",
    inputSchema: previewEvidenceInputSchema,
  },
  {
    name: MCP_TOOL_NAMES.CREATE_PROOF_BUNDLE_QUOTE,
    description:
      "Create a payment-gated proof-bundle export quote for a Vera Anchor evidence subject.",
    inputSchema: createProofBundleQuoteInputSchema,
  },
  {
    name: MCP_TOOL_NAMES.GET_PAYMENT_REQUIREMENTS,
    description:
      "Return x402-style Hedera HBAR payment requirements for a quoted action.",
    inputSchema: getPaymentRequirementsInputSchema,
  },
  {
    name: MCP_TOOL_NAMES.EXECUTE_PROOF_BUNDLE_EXPORT,
    description:
      "Execute a proof-bundle export. Without payment_transaction_id, returns payment requirements. With payment_transaction_id, verifies payment and returns the completed proof bundle receipt.",
    inputSchema: executeProofBundleExportInputSchema,
  },
  {
    name: MCP_TOOL_NAMES.GET_RECEIPT,
    description:
      "Fetch a previously created Vera Anchor proof-bundle receipt by receipt id.",
    inputSchema: getReceiptInputSchema,
  },
] as const;

async function handleInitialize(id: JsonRpcId): Promise<void> {
  resultResponse(id, {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
  });
}

async function handleToolsList(id: JsonRpcId): Promise<void> {
  resultResponse(id, {
    tools,
  });
}

async function handleToolsCall(id: JsonRpcId, paramsRaw: unknown): Promise<void> {
  const params = normalizeParams(paramsRaw);
  const toolNameRaw = params.name;

  if (!isVeraMcpToolName(toolNameRaw)) {
    resultResponse(id, {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: false,
              error_code: "UNSUPPORTED_MCP_TOOL",
              error_message: `Unsupported MCP tool: ${String(toolNameRaw)}`,
              tool_name: toolNameRaw,
            },
            null,
            2,
          ),
        },
      ],
    });
    return;
  }

  const toolName: VeraMcpToolName = toolNameRaw;

  try {
    const result = await executeVeraMcpTool(
      toolName,
      normalizeArguments(params.arguments),
      buildExecutionContext(),
    );

    resultResponse(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    });
  } catch (err) {
    resultResponse(id, {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: false,
              tool_name: toolName,
              mcp_audit_id: errorAuditId(err),
              error_code: errorCode(err),
              error_message: errorMessage(err),
              status: errorStatus(err),
            },
            null,
            2,
          ),
        },
      ],
    });
  }
}

async function handleRequest(raw: JsonRpcRequest): Promise<void> {
  const id = normalizeId(raw.id);
  const method = typeof raw.method === "string" ? raw.method : "";

  if (!method) {
    errorResponse({
      id,
      code: -32600,
      message: "Invalid Request",
    });
    return;
  }

  if (raw.id === undefined) {
    if (method === "notifications/initialized") {
      return;
    }

    return;
  }

  switch (method) {
    case "initialize":
      await handleInitialize(id);
      return;

    case "tools/list":
      await handleToolsList(id);
      return;

    case "tools/call":
      await handleToolsCall(id, raw.params);
      return;

    case "ping":
      resultResponse(id, {});
      return;

    default:
      errorResponse({
        id,
        code: -32601,
        message: `Method not found: ${method}`,
      });
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

let shuttingDown = false;

async function handleLine(line: string): Promise<void> {
  const trimmed = line.trim();

  if (!trimmed) {
    return;
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonRpcRequest;
    await handleRequest(parsed);
  } catch (err) {
    errorResponse({
      id: null,
      code: -32700,
      message: "Parse error",
      data: {
        error_message: errorMessage(err),
      },
    });
  }
}

async function main(): Promise<void> {
  try {
    for await (const line of rl) {
      await handleLine(line);
    }
  } finally {
    process.exit(0);
  }
}

function shutdown(): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  rl.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

void main();