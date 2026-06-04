// apps/agent-api/src/services/hederaAgentService.ts

import type { AgentServiceContext } from "./agentServiceContext.js";
import type { HederaAgentStatus } from "../hedera/hederaAgentTypes.js";
import { getHederaAgentStatus } from "../hedera/hederaAgentKitClient.js";

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

function normalizeContextRef(value: unknown, field: string): string | null {
  const s = cleanString(value);

  if (!s) return null;

  rejectControlChars(s, field);

  if (s.length > 256) {
    throwHttp(`${field.toUpperCase()}_TOO_LONG`, 400);
  }

  return s;
}

function normalizeServiceContext(
  context: AgentServiceContext,
): Required<AgentServiceContext> {
  return {
    actorRef: normalizeContextRef(context.actorRef, "actor_ref"),
    orgRef: normalizeContextRef(context.orgRef, "org_ref"),
    requestId: normalizeContextRef(context.requestId, "request_id"),
    systemScope: Boolean(context.systemScope),
  };
}

export async function getHederaAgentRuntimeStatus(
  context: AgentServiceContext,
): Promise<HederaAgentStatus> {
  normalizeServiceContext(context);

  return getHederaAgentStatus();
}