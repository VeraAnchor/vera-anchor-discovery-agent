// apps/agent-api/src/services/mcpAuditService.ts

import crypto from "node:crypto";
import { agentDbPool } from "../db/db.js";
import { createAgentRepos } from "../repos/agentRepos.js";
import { withAgentTransaction } from "../repos/agentRepoUtils.js";
import type { AgentMcpRequestRow } from "../repos/agentMcpRequestRepo.js";
import type { AgentServiceContext } from "./agentServiceContext.js";

const repos = createAgentRepos(agentDbPool);

const MAX_MCP_METADATA_BYTES = 16 * 1024;
const MAX_ERROR_MESSAGE_LEN = 512;
const MAX_REF_LEN = 256;
const MAX_TOOL_NAME_LEN = 121;

export type McpAuditInput = Readonly<{
  toolName: string;
  input: unknown;
  context: AgentServiceContext;
  actionId?: string | null;
  requestId?: string | null;
  sessionId?: string | null;
  clientRef?: string | null;
  metadata?: Record<string, unknown>;
  rejectOnValidationError?: boolean;
}>;

export type McpAuditResult<T> = Readonly<{
  result: T;
  audit: AgentMcpRequestRow | null;
}>;

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function rejectControlChars(value: string, field: string): void {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throwHttp(`${field.toUpperCase()}_CONTAINS_CONTROL_CHARACTERS`, 400);
  }
}

function throwHttp(message: string, status: number): never {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  throw err;
}

function normalizeToolName(value: unknown): string {
  const s = cleanString(value);

  if (!s) {
    throwHttp("MCP_TOOL_NAME_REQUIRED", 400);
  }

  rejectControlChars(s, "tool_name");

  if (s.length > MAX_TOOL_NAME_LEN) {
    throwHttp("MCP_TOOL_NAME_TOO_LONG", 400);
  }

  if (!/^[a-zA-Z][a-zA-Z0-9_.:-]{1,120}$/.test(s)) {
    throwHttp("INVALID_MCP_TOOL_NAME", 400);
  }

  return s;
}

function normalizeUuidOrNull(value: unknown, field: string): string | null {
  const s = cleanString(value).toLowerCase();

  if (!s) return null;

  rejectControlChars(s, field);

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)
  ) {
    throwHttp(`INVALID_${field.toUpperCase()}`, 400);
  }

  return s;
}

function normalizeRef(value: unknown, field: string): string | null {
  const s = cleanString(value);

  if (!s) return null;

  rejectControlChars(s, field);

  if (s.length > MAX_REF_LEN) {
    throwHttp(`${field.toUpperCase()}_TOO_LONG`, 400);
  }

  return s;
}

function normalizeServiceContext(context: AgentServiceContext): Required<AgentServiceContext> {
  return {
    actorRef: normalizeRef(context.actorRef, "actor_ref"),
    orgRef: normalizeRef(context.orgRef, "org_ref"),
    requestId: normalizeRef(context.requestId, "request_id"),
    systemScope: Boolean(context.systemScope),
  };
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};

  if (typeof value !== "object" || Array.isArray(value)) {
    throwHttp("MCP_METADATA_MUST_BE_OBJECT", 400);
  }

  let json: string;

  try {
    json = JSON.stringify(value);
  } catch {
    throwHttp("MCP_METADATA_NOT_SERIALIZABLE", 400);
  }

  if (Buffer.byteLength(json, "utf8") > MAX_MCP_METADATA_BYTES) {
    throwHttp("MCP_METADATA_TOO_LARGE", 413);
  }

  return value as Record<string, unknown>;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;

    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortJson(obj[key]);
        return acc;
      }, {});
  }

  return value;
}

function sha3_512Json(value: unknown): string {
  return crypto
    .createHash("sha3-512")
    .update(stableStringify(value))
    .digest("hex");
}

function nowMs(): number {
  return Date.now();
}

function elapsedMs(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs);
}

function sanitizeErrorCode(err: unknown): string {
  const e = err as Error & { code?: unknown; message?: unknown };

  const raw =
    typeof e?.code === "string" && e.code.trim()
      ? e.code.trim()
      : typeof e?.message === "string" && e.message.trim()
        ? e.message.trim()
        : "MCP_TOOL_FAILED";

  const upper = raw
    .toUpperCase()
    .replace(/[^A-Z0-9_:-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 128);

  return upper.length >= 2 ? upper : "MCP_TOOL_FAILED";
}

function sanitizeErrorMessage(err: unknown): string {
  const e = err as Error & { message?: unknown };
  const message =
    typeof e?.message === "string" && e.message.trim()
      ? e.message.trim()
      : "MCP tool execution failed.";

  return message.slice(0, MAX_ERROR_MESSAGE_LEN);
}

function isValidationError(err: unknown): boolean {
  const e = err as Error & { status?: unknown; code?: unknown };
  const status = Number(e?.status);

  if (status >= 400 && status < 500) return true;

  const code = typeof e?.code === "string" ? e.code : "";
  return (
    code === "BAD_REQUEST" ||
    code === "VALIDATION_ERROR" ||
    code === "INVALID_INPUT"
  );
}

function errorMetadata(err: unknown): Record<string, unknown> {
  const e = err as Error & { status?: unknown; code?: unknown };

  return {
    error_name: e?.name || "Error",
    error_status: Number.isFinite(Number(e?.status)) ? Number(e?.status) : null,
  };
}

async function safeMarkFailed(input: {
  auditId: string;
  context: Required<AgentServiceContext>;
  outputHash: string;
  latencyMs: number;
  errorCode: string;
  errorMessage: string;
  rejected: boolean;
  metadata?: Record<string, unknown>;
}): Promise<AgentMcpRequestRow | null> {
  try {
    return await withAgentTransaction(agentDbPool, input.context, async (client) => {
      if (input.rejected) {
        return repos.mcpRequests.markRejected(
          {
            id: input.auditId,
            outputHash: input.outputHash,
            latencyMs: input.latencyMs,
            errorCode: input.errorCode,
            errorMessage: input.errorMessage,
            metadata: {
              ...(input.metadata ?? {}),
              terminal_state: "rejected",
            },
          },
          { client },
        );
      }

      return repos.mcpRequests.markFailed(
        {
          id: input.auditId,
          outputHash: input.outputHash,
          latencyMs: input.latencyMs,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          metadata: {
            ...(input.metadata ?? {}),
            terminal_state: "failed",
          },
        },
        { client },
      );
    });
  } catch {
    return null;
  }
}

export async function withMcpAudit<T>(
  input: McpAuditInput,
  fn: () => Promise<T>,
): Promise<McpAuditResult<T>> {
  const toolName = normalizeToolName(input.toolName);
  const actionId = normalizeUuidOrNull(input.actionId, "action_id");
  const requestId = normalizeRef(input.requestId ?? input.context.requestId, "request_id");
  const sessionId = normalizeRef(input.sessionId, "session_id");
  const clientRef = normalizeRef(input.clientRef, "client_ref");
  const scopedContext = normalizeServiceContext({
    ...input.context,
    requestId,
  });

  const metadata = normalizeMetadata(input.metadata);
  const inputHash = sha3_512Json(input.input);
  const startedAtMs = nowMs();

  let audit: AgentMcpRequestRow | null = null;

  try {
    audit = await withAgentTransaction(agentDbPool, scopedContext, async (client) => {
      const created = await repos.mcpRequests.createReceived(
        {
          actionId,
          requestId,
          sessionId,
          clientRef,
          toolName,
          inputHash,
          metadata: {
            ...metadata,
            input_kind: input.input === null ? "null" : typeof input.input,
          },
          actorRef: scopedContext.actorRef,
          orgRef: scopedContext.orgRef,
        },
        { client },
      );

      await repos.mcpRequests.markValidated(created.id, { client });

      return repos.mcpRequests.markRunning(created.id, { client });
    });
  } catch (err) {
    if (input.rejectOnValidationError ?? true) {
      throw err;
    }

    audit = null;
  }

  try {
    const result = await fn();
    const outputHash = sha3_512Json(result);
    const latencyMs = elapsedMs(startedAtMs);

    const completedAudit = audit
      ? await withAgentTransaction(agentDbPool, scopedContext, async (client) => {
          return repos.mcpRequests.markCompleted(
            {
              id: audit.id,
              outputHash,
              latencyMs,
              metadata: {
                output_kind: result === null ? "null" : typeof result,
              },
            },
            { client },
          );
        })
      : null;

    return {
      result,
      audit: completedAudit ?? audit,
    };
  } catch (err) {
    const latencyMs = elapsedMs(startedAtMs);
    const errorCode = sanitizeErrorCode(err);
    const errorMessage = sanitizeErrorMessage(err);
    const outputHash = sha3_512Json({
      ok: false,
      error_code: errorCode,
      error_message: errorMessage,
    });

    const rejected = isValidationError(err);

    const failedAudit = audit
      ? await safeMarkFailed({
          auditId: audit.id,
          context: scopedContext,
          outputHash,
          latencyMs,
          errorCode,
          errorMessage,
          rejected,
          metadata: errorMetadata(err),
        })
      : null;
      
    throw Object.assign(err instanceof Error ? err : new Error(errorMessage), {
      mcp_audit_id: failedAudit?.id ?? audit?.id ?? null,
    });
  }
}