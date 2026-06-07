// apps/agent-api/src/hedera/hederaAgentKitReadAdapter.ts

import { config } from "../config.js";
import { getHederaAgentConfigStatus } from "./hederaAgentKitClient.js";
import type {
  HederaHcsMessageReadInput,
  HederaHcsMessageReadResult,
  HederaHcsReceiptVerificationResult,
  HederaMirrorTransactionReadInput,
  HederaMirrorTransactionReadResult,
  HederaNetwork,
} from "./hederaAgentTypes.js";

const HCS_TRANSACTION_ID_RE = /^0\.0\.\d+@\d{1,20}\.\d{1,9}$/;
const HCS_TOPIC_ID_RE = /^0\.0\.\d+$/;
const CONSENSUS_TIMESTAMP_RE = /^\d{1,20}\.\d{1,9}$/;

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function throwHttp(message: string, status: number): never {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  throw err;
}

function normalizeTransactionId(value: unknown): string {
  const s = cleanString(value);

  if (!s) {
    throwHttp("HEDERA_TRANSACTION_ID_REQUIRED", 400);
  }

  if (!HCS_TRANSACTION_ID_RE.test(s)) {
    throwHttp("INVALID_HEDERA_TRANSACTION_ID", 400);
  }

  return s;
}

function normalizeOptionalTransactionId(value: unknown): string | null {
  const s = cleanString(value);
  if (!s) return null;
  return normalizeTransactionId(s);
}

function normalizeTopicId(value: unknown): string {
  const s = cleanString(value);

  if (!s) {
    throwHttp("HCS_TOPIC_ID_REQUIRED", 400);
  }

  if (!HCS_TOPIC_ID_RE.test(s)) {
    throwHttp("INVALID_HCS_TOPIC_ID", 400);
  }

  return s;
}

function normalizeOptionalConsensusTimestamp(value: unknown): string | null {
  const s = cleanString(value);

  if (!s) return null;

  if (!CONSENSUS_TIMESTAMP_RE.test(s)) {
    throwHttp("INVALID_HCS_CONSENSUS_TIMESTAMP", 400);
  }

  return s;
}

function normalizeForMirrorTransactionPath(transactionId: string): string {
  const [accountId, timestamp] = transactionId.split("@");
  const [seconds, nanos] = timestamp.split(".");
  return `${accountId}-${seconds}-${nanos}`;
}

function transactionIdFromMirror(value: unknown): string | null {
  const s = cleanString(value);

  if (!s) return null;

  if (HCS_TRANSACTION_ID_RE.test(s)) {
    return s;
  }

  const match = s.match(/^(0\.0\.\d+)-(\d{1,20})-(\d{1,9})$/);
  if (!match) return null;

  return `${match[1]}@${match[2]}.${match[3]}`;
}

function mirrorBaseUrl(network: HederaNetwork): URL {
  const configured = cleanString(
    (config as { hederaMirrorNodeBaseUrl?: unknown }).hederaMirrorNodeBaseUrl,
  );

  if (configured) {
    return new URL(configured);
  }

  if (network === "mainnet") {
    return new URL("https://mainnet-public.mirrornode.hedera.com/api/v1");
  }

  if (network === "previewnet") {
    return new URL("https://previewnet.mirrornode.hedera.com/api/v1");
  }

  return new URL("https://testnet.mirrornode.hedera.com/api/v1");
}

function buildMirrorUrl(path: string, query?: Record<string, string | null>): URL {
  if (!path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    throwHttp("UNSAFE_MIRROR_PATH", 500);
  }

  const status = getHederaAgentConfigStatus();
  const url = mirrorBaseUrl(status.network);
  const basePath = url.pathname.replace(/\/+$/g, "");
  url.pathname = `${basePath}${path}`;

  for (const [key, value] of Object.entries(query ?? {})) {
    if (!value) continue;
    url.searchParams.set(key, value);
  }

  return url;
}

async function readMirrorJson(url: URL): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": "vera-discovery-agent/hedera-read-adapter",
      },
      redirect: "error",
      signal: controller.signal,
    });

    if (response.status === 404) {
      return null;
    }

    if (response.status === 429) {
      throwHttp("HEDERA_MIRROR_RATE_LIMITED", 503);
    }

    if (!response.ok) {
      throwHttp("HEDERA_MIRROR_REQUEST_FAILED", 502);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throwHttp("HEDERA_MIRROR_UNEXPECTED_CONTENT_TYPE", 502);
    }

    const parsed = (await response.json()) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throwHttp("HEDERA_MIRROR_INVALID_JSON_SHAPE", 502);
    }

    return parsed as Record<string, unknown>;
  } catch (err) {
    if ((err as { status?: number })?.status) {
      throw err;
    }

    if ((err as { name?: string })?.name === "AbortError") {
      throwHttp("HEDERA_MIRROR_TIMEOUT", 504);
    }

    throwHttp("HEDERA_MIRROR_UNAVAILABLE", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function firstRecord(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) return null;

  const transactions = value.transactions;
  if (Array.isArray(transactions) && transactions.length > 0) {
    const first = transactions[0];
    return first && typeof first === "object" && !Array.isArray(first)
      ? (first as Record<string, unknown>)
      : null;
  }

  const messages = value.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    const first = messages[0];
    return first && typeof first === "object" && !Array.isArray(first)
      ? (first as Record<string, unknown>)
      : null;
  }

  return value;
}

function optionalString(value: unknown): string | null {
  const s = cleanString(value);
  return s || null;
}

function optionalNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function readHederaMirrorTransaction(
  input: HederaMirrorTransactionReadInput,
): Promise<HederaMirrorTransactionReadResult> {
  const status = getHederaAgentConfigStatus();
  const transactionId = normalizeTransactionId(input.transactionId);
  const normalizedTransactionId = normalizeForMirrorTransactionPath(transactionId);

  const url = buildMirrorUrl(`/transactions/${encodeURIComponent(normalizedTransactionId)}`);
  const json = await readMirrorJson(url);
  const row = firstRecord(json);

  return {
    ok: true,
    network: status.network,
    source: "hedera_mirror_node",
    transaction_id: transactionId,
    normalized_transaction_id: normalizedTransactionId,
    found: Boolean(row),
    consensus_timestamp: optionalString(row?.consensus_timestamp),
    name: optionalString(row?.name),
    result: optionalString(row?.result),
    charged_tx_fee: optionalNumber(row?.charged_tx_fee),
    entity_id: optionalString(row?.entity_id),
    node: optionalString(row?.node),
    valid_start_timestamp: optionalString(row?.valid_start_timestamp),
    raw: row,
  };
}

export async function readHederaHcsMessage(
  input: HederaHcsMessageReadInput,
): Promise<HederaHcsMessageReadResult> {
  const status = getHederaAgentConfigStatus();
  const topicId = normalizeTopicId(input.topicId);
  const transactionId = normalizeOptionalTransactionId(input.transactionId);
  const normalizedTransactionId = transactionId
    ? normalizeForMirrorTransactionPath(transactionId)
    : null;
  const consensusTimestamp = normalizeOptionalConsensusTimestamp(
    input.consensusTimestamp,
  );

  const query: Record<string, string | null> = {
    limit: "1",
    order: "desc",
  };

  if (consensusTimestamp) {
    query.timestamp = consensusTimestamp;
  }

  const url = buildMirrorUrl(
    `/topics/${encodeURIComponent(topicId)}/messages`,
    query,
  );

  const json = await readMirrorJson(url);
  const messages = Array.isArray(json?.messages) ? json.messages : [];

  const row =
    messages.find((message) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        return false;
      }

      const candidate = message as Record<string, unknown>;

      if (
        consensusTimestamp &&
        cleanString(candidate.consensus_timestamp) === consensusTimestamp
      ) {
        return true;
      }

      if (transactionId) {
        const chunkInfo =
          candidate.chunk_info &&
          typeof candidate.chunk_info === "object" &&
          !Array.isArray(candidate.chunk_info)
            ? (candidate.chunk_info as Record<string, unknown>)
            : null;

        const initialTransactionId =
          chunkInfo?.initial_transaction_id &&
          typeof chunkInfo.initial_transaction_id === "object" &&
          !Array.isArray(chunkInfo.initial_transaction_id)
            ? (chunkInfo.initial_transaction_id as Record<string, unknown>)
            : null;

        const accountId = optionalString(initialTransactionId?.account_id);
        const validStart = optionalString(
          initialTransactionId?.transaction_valid_start,
        );

        if (accountId && validStart && `${accountId}@${validStart}` === transactionId) {
          return true;
        }

        const candidateTxId = transactionIdFromMirror(candidate.transaction_id);

        if (candidateTxId === transactionId) {
          return true;
        }
      }

      return !transactionId && !consensusTimestamp;
    }) ?? null;

  const record =
    row && typeof row === "object" && !Array.isArray(row)
      ? (row as Record<string, unknown>)
      : null;

  return {
    ok: true,
    network: status.network,
    source: "hedera_mirror_node",
    topic_id: topicId,
    transaction_id: transactionId,
    normalized_transaction_id: normalizedTransactionId,
    consensus_timestamp: optionalString(record?.consensus_timestamp),
    found: Boolean(record),
    sequence_number: optionalNumber(record?.sequence_number),
    running_hash: optionalString(record?.running_hash),
    running_hash_version: optionalNumber(record?.running_hash_version),
    payer_account_id: optionalString(record?.payer_account_id),
    message_base64: optionalString(record?.message),
    raw: record,
  };
}

export async function verifyHederaHcsReceipt(input: {
  transactionId: string;
  topicId?: string | null;
}): Promise<HederaHcsReceiptVerificationResult> {
  const transaction = await readHederaMirrorTransaction({
    transactionId: input.transactionId,
  });

  const warnings: string[] = [];

  const suppliedTopicId = input.topicId ? normalizeTopicId(input.topicId) : null;
  const transactionTopicId =
    transaction.name === "CONSENSUSSUBMITMESSAGE" && transaction.entity_id
      ? normalizeTopicId(transaction.entity_id)
      : null;

  const topicId = transactionTopicId ?? suppliedTopicId;

  if (
    suppliedTopicId &&
    transactionTopicId &&
    suppliedTopicId !== transactionTopicId
  ) {
    warnings.push(
      [
        `Supplied topic ${suppliedTopicId} did not match`,
        `Mirror Node transaction entity ${transactionTopicId};`,
        "using transaction entity topic.",
      ].join(" "),
    );
  }

  let message: HederaHcsMessageReadResult | null = null;

  if (topicId && transaction.consensus_timestamp) {
    message = await readHederaHcsMessage({
      topicId,
      transactionId: input.transactionId,
      consensusTimestamp: transaction.consensus_timestamp,
    });
  } else {
    warnings.push(
      "HCS message lookup skipped because topic ID or consensus timestamp was unavailable.",
    );
  }

  if (!transaction.found) {
    warnings.push("Mirror transaction was not found.");
  }

  if (transaction.found && transaction.result !== "SUCCESS") {
    warnings.push(
      `Mirror transaction result was ${transaction.result ?? "unknown"}, not SUCCESS.`,
    );
  }

  if (topicId && !message?.found) {
    warnings.push("HCS topic message was not found for the transaction timestamp.");
  }

  const verified = Boolean(
    transaction.found &&
      transaction.result === "SUCCESS" &&
      (!topicId || message?.found),
  );

  return {
    ok: true,
    network: transaction.network,
    source: "hedera_mirror_node",
    transaction_id: transaction.transaction_id,
    normalized_transaction_id: transaction.normalized_transaction_id,
    topic_id: topicId,
    mirror_transaction_found: transaction.found,
    hcs_message_found: Boolean(message?.found),
    consensus_timestamp: transaction.consensus_timestamp,
    sequence_number: message?.sequence_number ?? null,
    running_hash: message?.running_hash ?? null,
    payer_account_id: message?.payer_account_id ?? null,
    transaction_result: transaction.result,
    verified,
    warnings,
    transaction,
    message,
  };
}