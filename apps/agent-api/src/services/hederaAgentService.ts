// apps/agent-api/src/services/hederaAgentService.ts

import type { AgentServiceContext } from "./agentServiceContext.js";
import type {
  HederaHcsMessageReadResult,
  HederaHcsReceiptVerificationResult,
  HederaMirrorTransactionReadResult,
  HederaAgentStatus,
} from "../hedera/hederaAgentTypes.js";
import { getHederaAgentStatus } from "../hedera/hederaAgentKitClient.js";
import {
  readHederaHcsMessage,
  readHederaMirrorTransaction,
  verifyHederaHcsReceipt,
} from "../hedera/hederaAgentKitReadAdapter.js";

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

function normalizeRef(value: unknown, field: string, maxLen = 256): string {
  const s = cleanString(value);

  if (!s) {
    throwHttp(`${field.toUpperCase()}_REQUIRED`, 400);
  }

  rejectControlChars(s, field);

  if (s.length > maxLen) {
    throwHttp(`${field.toUpperCase()}_TOO_LONG`, 400);
  }

  return s;
}

function normalizeOptionalRef(
  value: unknown,
  field: string,
  maxLen = 256,
): string | null {
  const s = cleanString(value);

  if (!s) return null;

  rejectControlChars(s, field);

  if (s.length > maxLen) {
    throwHttp(`${field.toUpperCase()}_TOO_LONG`, 400);
  }

  return s;
}

export async function getHederaAgentRuntimeStatus(
  context: AgentServiceContext,
): Promise<HederaAgentStatus> {
  normalizeServiceContext(context);

  return getHederaAgentStatus();
}

export async function readHederaAgentMirrorTransaction(
  input: { transactionId?: unknown },
  context: AgentServiceContext,
): Promise<HederaMirrorTransactionReadResult> {
  normalizeServiceContext(context);

  return readHederaMirrorTransaction({
    transactionId: normalizeRef(input.transactionId, "transaction_id"),
  });
}

export async function readHederaAgentHcsMessage(
  input: {
    topicId?: unknown;
    transactionId?: unknown;
    consensusTimestamp?: unknown;
  },
  context: AgentServiceContext,
): Promise<HederaHcsMessageReadResult> {
  normalizeServiceContext(context);

  return readHederaHcsMessage({
    topicId: normalizeRef(input.topicId, "topic_id"),
    transactionId: normalizeOptionalRef(input.transactionId, "transaction_id"),
    consensusTimestamp: normalizeOptionalRef(
      input.consensusTimestamp,
      "consensus_timestamp",
    ),
  });
}

export async function verifyHederaAgentHcsReceipt(
  input: {
    transactionId?: unknown;
    topicId?: unknown;
  },
  context: AgentServiceContext,
): Promise<HederaHcsReceiptVerificationResult> {
  normalizeServiceContext(context);

  return verifyHederaHcsReceipt({
    transactionId: normalizeRef(input.transactionId, "transaction_id"),
    topicId: normalizeOptionalRef(input.topicId, "topic_id"),
  });
}