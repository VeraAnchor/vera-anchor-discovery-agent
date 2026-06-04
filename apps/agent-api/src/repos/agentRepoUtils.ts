import crypto from "node:crypto";
import type {
  Pool,
  PoolClient,
  QueryConfig,
  QueryResult,
  QueryResultRow,
} from "pg";

const AGENT_CTX_MARKER = Symbol.for("vera.agentRepoContext");

const DEFAULT_QUERY_TIMEOUT_MS = 5_000;
const MAX_QUERY_TIMEOUT_MS = 30_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;
const MAX_OFFSET = 10_000;
const MAX_TEXT_LEN = 2_048;
const MAX_REF_LEN = 256;
const MAX_ERROR_LEN = 1_024;
const MAX_JSON_BYTES = 64 * 1024;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const HASH_RE = /^[a-z0-9:_-]{32,256}$/i;

const PROVIDER_RE = /^[a-z][a-z0-9_:-]{1,79}$/;
const ACTION_TYPE_RE = /^[a-z][a-z0-9_:-]{1,79}$/;
const CURRENCY_RE = /^[A-Z0-9_]{2,20}$/;

const HEDERA_TX_ID_RE = /^0\.0\.\d+@\d+\.\d{1,9}$/;
const HEDERA_ACCOUNT_ID_RE = /^0\.0\.\d+$/;

export type AgentContext = Readonly<{
  actorRef?: string | null;
  orgRef?: string | null;
  requestId?: string | null;
  systemScope?: boolean;
}>;

type AgentContextMarker = Readonly<{
  actorRef: string | null;
  orgRef: string | null;
  requestId: string | null;
  systemScope: boolean;
}>;

export type AgentTxClient = PoolClient & {
  [AGENT_CTX_MARKER]?: AgentContextMarker;
};

export type Queryable = Pool | PoolClient;

export class AgentRepoError extends Error {
  readonly status: number;
  readonly code: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    {
      status = 500,
      code = "AGENT_REPO_ERROR",
      cause,
    }: {
      status?: number;
      code?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "AgentRepoError";
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

export async function withAgentTransaction<T>(
  pool: Pool,
  context: AgentContext,
  fn: (client: AgentTxClient) => Promise<T>,
): Promise<T> {
  if (!pool || typeof pool.connect !== "function") {
    throw new AgentRepoError("Valid pg pool is required", {
      status: 500,
      code: "AGENT_POOL_REQUIRED",
    });
  }

  if (typeof fn !== "function") {
    throw new AgentRepoError("Transaction handler is required", {
      status: 500,
      code: "AGENT_TX_HANDLER_REQUIRED",
    });
  }

  const normalized = normalizeAgentContext(context);
  const client = (await pool.connect()) as AgentTxClient;

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL row_security = on");
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      `${normalizeQueryTimeoutMs()}ms`,
    ]);
    await client.query("SELECT utils.set_agent_context($1, $2, $3)", [
      normalized.actorRef,
      normalized.orgRef,
      normalized.requestId,
    ]);

    if (normalized.systemScope) {
      await client.query("SELECT utils.set_agent_system_scope(true)");
    }

    client[AGENT_CTX_MARKER] = normalized;

    const result = await fn(client);
    await client.query("COMMIT");

    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve original error.
    }

    throw err;
  } finally {
    delete client[AGENT_CTX_MARKER];
    client.release();
  }
}

export function requireAgentClient(client: PoolClient | null | undefined): AgentTxClient {
  if (!client) {
    throw new AgentRepoError("Agent repo operation requires a scoped transaction client", {
      status: 500,
      code: "AGENT_SCOPED_CLIENT_REQUIRED",
    });
  }

  const tx = client as AgentTxClient;
  const marker = tx[AGENT_CTX_MARKER];

  if (!marker) {
    throw new AgentRepoError(
      "Agent repo client is missing agent session context. Use withAgentTransaction().",
      {
        status: 500,
        code: "AGENT_CONTEXT_REQUIRED",
      },
    );
  }

  if (!marker.systemScope && !marker.actorRef && !marker.orgRef) {
    throw new AgentRepoError(
      "Agent repo context requires actorRef, orgRef, or systemScope.",
      {
        status: 500,
        code: "AGENT_CONTEXT_INCOMPLETE",
      },
    );
  }

  return tx;
}

export function normalizeAgentContext(context: AgentContext): AgentContextMarker {
  const actorRef = normalizeOptionalRef(context.actorRef, "actorRef");
  const orgRef = normalizeOptionalRef(context.orgRef, "orgRef");
  const requestId = normalizeOptionalRef(context.requestId, "requestId");
  const systemScope = Boolean(context.systemScope);

  if (!systemScope && !actorRef && !orgRef) {
    throw new AgentRepoError("agent context requires actorRef, orgRef, or systemScope", {
      status: 400,
      code: "AGENT_CONTEXT_REQUIRED",
    });
  }

  return {
    actorRef,
    orgRef,
    requestId,
    systemScope,
  };
}

export abstract class AgentRepoBase {
  protected readonly pool: Pool;
  protected readonly tableName: string;

  constructor({
    pool,
    tableName,
  }: {
    pool: Pool;
    tableName: string;
  }) {
    if (!pool) {
      throw new AgentRepoError("pool is required", {
        code: "AGENT_POOL_REQUIRED",
      });
    }

    if (!/^[a-z_][a-z0-9_]{1,62}$/.test(tableName)) {
      throw new AgentRepoError(`Invalid table name: ${tableName}`, {
        code: "AGENT_INVALID_TABLE",
      });
    }

    this.pool = pool;
    this.tableName = tableName;
  }

  protected get fullTableName(): string {
    return `agent.${this.tableName}`;
  }

  protected async query<T extends QueryResultRow = QueryResultRow>(
    client: PoolClient,
    text: string,
    values: readonly unknown[] = [],
    timeoutMs = DEFAULT_QUERY_TIMEOUT_MS,
  ): Promise<QueryResult<T>> {
    const runner = requireAgentClient(client);

    assertSingleStatement(text);

    await runner.query("SELECT set_config('statement_timeout', $1, true)", [
      `${normalizeQueryTimeoutMs(timeoutMs)}ms`,
    ]);

    const queryConfig: QueryConfig<unknown[]> = {
      text,
      values: [...values],
    };

    return runner.query<T>(queryConfig);
  }

  protected mapUniqueViolation(err: unknown, fallbackCode: string): never {
    const e = err as { code?: string; constraint?: string; message?: string };

    if (e?.code === "23505") {
      throw new AgentRepoError("Unique constraint violated", {
        status: 409,
        code: fallbackCode,
        cause: err,
      });
    }

    throw err;
  }
}

export function randomUuid(): string {
  return crypto.randomUUID();
}

export function normalizeUuid(value: unknown, name: string): string {
  const s = normalizeRequiredString(value, name, 36);

  if (!UUID_RE.test(s)) {
    throw new AgentRepoError(`${name} must be a UUID`, {
      status: 400,
      code: "INVALID_UUID",
    });
  }

  return s;
}

export function normalizeOptionalUuid(value: unknown, name: string): string | null {
  const s = normalizeOptionalString(value, name, 36);
  if (!s) return null;

  if (!UUID_RE.test(s)) {
    throw new AgentRepoError(`${name} must be a UUID`, {
      status: 400,
      code: "INVALID_UUID",
    });
  }

  return s;
}

export function normalizeRequiredString(
  value: unknown,
  name: string,
  maxLen = MAX_TEXT_LEN,
): string {
  const s = String(value ?? "").trim();

  if (!s) {
    throw new AgentRepoError(`${name} is required`, {
      status: 400,
      code: "REQUIRED_FIELD",
    });
  }

  rejectControlChars(s, name);

  if (s.length > maxLen) {
    throw new AgentRepoError(`${name} is too long`, {
      status: 400,
      code: "FIELD_TOO_LONG",
    });
  }

  return s;
}

export function normalizeOptionalString(
  value: unknown,
  name: string,
  maxLen = MAX_TEXT_LEN,
): string | null {
  if (value === undefined || value === null) return null;

  const s = String(value).trim();
  if (!s) return null;

  rejectControlChars(s, name);

  if (s.length > maxLen) {
    throw new AgentRepoError(`${name} is too long`, {
      status: 400,
      code: "FIELD_TOO_LONG",
    });
  }

  return s;
}

export function normalizeOptionalRef(value: unknown, name: string): string | null {
  return normalizeOptionalString(value, name, MAX_REF_LEN);
}

export function normalizeActionType(value: unknown): string {
  const s = normalizeRequiredString(value, "action_type", 80).toLowerCase();

  if (!ACTION_TYPE_RE.test(s)) {
    throw new AgentRepoError("action_type is invalid", {
      status: 400,
      code: "INVALID_ACTION_TYPE",
    });
  }

  return s;
}

export function normalizeProvider(value: unknown, fallback = "vera_anchor"): string {
  const s = normalizeOptionalString(value, "provider", 80)?.toLowerCase() ?? fallback;

  if (!PROVIDER_RE.test(s)) {
    throw new AgentRepoError("provider is invalid", {
      status: 400,
      code: "INVALID_PROVIDER",
    });
  }

  return s;
}

export function normalizeCurrency(value: unknown): string {
  const s = normalizeRequiredString(value, "currency", 20).toUpperCase();

  if (!CURRENCY_RE.test(s)) {
    throw new AgentRepoError("currency is invalid", {
      status: 400,
      code: "INVALID_CURRENCY",
    });
  }

  return s;
}

export function normalizeOptionalNetwork(value: unknown): string | null {
  return normalizeOptionalString(value, "network", 64)?.toLowerCase() ?? null;
}

export function normalizeHash(value: unknown, name: string): string {
  const s = normalizeRequiredString(value, name, 256);

  if (!HASH_RE.test(s)) {
    throw new AgentRepoError(`${name} is invalid`, {
      status: 400,
      code: "INVALID_HASH",
    });
  }

  return s;
}

export function normalizeOptionalHash(value: unknown, name: string): string | null {
  const s = normalizeOptionalString(value, name, 256);
  if (!s) return null;

  if (!HASH_RE.test(s)) {
    throw new AgentRepoError(`${name} is invalid`, {
      status: 400,
      code: "INVALID_HASH",
    });
  }

  return s;
}

export function normalizeAmountMinor(value: unknown): number {
  const n = Number(value);

  if (!Number.isSafeInteger(n) || n < 0) {
    throw new AgentRepoError("amount_minor must be a non-negative safe integer", {
      status: 400,
      code: "INVALID_AMOUNT_MINOR",
    });
  }

  return n;
}

export function normalizeLimit(value: unknown, fallback = DEFAULT_LIMIT): number {
  const n = Number(value);
  const x = Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.max(1, Math.min(MAX_LIMIT, x));
}

export function normalizeOffset(value: unknown): number {
  const n = Number(value);
  const x = Number.isFinite(n) ? Math.trunc(n) : 0;
  return Math.max(0, Math.min(MAX_OFFSET, x));
}

export function normalizeJsonObject(value: unknown, name = "metadata"): Record<string, unknown> {
  if (value === undefined || value === null) return {};

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AgentRepoError(`${name} must be a JSON object`, {
      status: 400,
      code: "INVALID_JSON_OBJECT",
    });
  }

  let json: string;

  try {
    json = JSON.stringify(value);
  } catch {
    throw new AgentRepoError(`${name} must be JSON serializable`, {
      status: 400,
      code: "INVALID_JSON_OBJECT",
    });
  }

  if (Buffer.byteLength(json, "utf8") > MAX_JSON_BYTES) {
    throw new AgentRepoError(`${name} is too large`, {
      status: 413,
      code: "JSON_OBJECT_TOO_LARGE",
    });
  }

  return value as Record<string, unknown>;
}

export function normalizeOptionalHederaTransactionId(value: unknown): string | null {
  const s = normalizeOptionalString(value, "transaction_reference", 128);
  if (!s) return null;

  if (!HEDERA_TX_ID_RE.test(s)) {
    throw new AgentRepoError("transaction_reference must be a Hedera transaction id", {
      status: 400,
      code: "INVALID_HEDERA_TRANSACTION_ID",
    });
  }

  return s;
}

export function normalizeOptionalHederaAccountId(
  value: unknown,
  name: string,
): string | null {
  const s = normalizeOptionalString(value, name, 64);
  if (!s) return null;

  if (!HEDERA_ACCOUNT_ID_RE.test(s)) {
    throw new AgentRepoError(`${name} must be a Hedera account id`, {
      status: 400,
      code: "INVALID_HEDERA_ACCOUNT_ID",
    });
  }

  return s;
}

export function normalizeDateOrNull(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;

  const d = value instanceof Date ? value : new Date(String(value));

  if (Number.isNaN(d.getTime())) {
    throw new AgentRepoError(`${name} must be a valid datetime`, {
      status: 400,
      code: "INVALID_DATETIME",
    });
  }

  return d.toISOString();
}

export function normalizeFutureDate(value: unknown, name: string): string {
  const iso = normalizeDateOrNull(value, name);

  if (!iso) {
    throw new AgentRepoError(`${name} is required`, {
      status: 400,
      code: "REQUIRED_FIELD",
    });
  }

  return iso;
}

export function normalizeErrorCode(value: unknown): string | null {
  const s = normalizeOptionalString(value, "error_code", 128);
  if (!s) return null;

  if (!/^[A-Z0-9_:-]{2,128}$/.test(s)) {
    throw new AgentRepoError("error_code is invalid", {
      status: 400,
      code: "INVALID_ERROR_CODE",
    });
  }

  return s;
}

export function normalizeErrorMessage(value: unknown): string | null {
  return normalizeOptionalString(value, "error_message", MAX_ERROR_LEN);
}

function normalizeQueryTimeoutMs(value: unknown = DEFAULT_QUERY_TIMEOUT_MS): number {
  const n = Number(value);
  const fallback = DEFAULT_QUERY_TIMEOUT_MS;
  const ms = Number.isFinite(n) ? Math.trunc(n) : fallback;

  return Math.max(1, Math.min(MAX_QUERY_TIMEOUT_MS, ms));
}

function rejectControlChars(s: string, name: string): void {
  if (/[\u0000-\u001f\u007f]/.test(s)) {
    throw new AgentRepoError(`${name} contains control characters`, {
      status: 400,
      code: "CONTROL_CHARS_REJECTED",
    });
  }
}

function assertSingleStatement(sql: string): void {
  const stripped = stripSqlLiterals(sql);
  const trimmed = stripped.trim();
  const withoutTrailing = trimmed.replace(/;+\s*$/g, "");

  if (withoutTrailing.includes(";")) {
    throw new AgentRepoError("Multiple SQL statements are not allowed", {
      status: 500,
      code: "MULTI_STATEMENT_SQL_REJECTED",
    });
  }
}

function stripSqlLiterals(sql: string): string {
  let s = String(sql ?? "");
  s = s.replace(/--[^\n\r]*/g, "--COMMENT--");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "/*COMMENT*/");
  s = s.replace(/\$[a-zA-Z0-9_]*\$[\s\S]*?\$[a-zA-Z0-9_]*\$/g, "$$DOLLAR_QUOTED$$");
  s = s.replace(/'(?:''|[^'])*'/g, "''");
  return s;
}