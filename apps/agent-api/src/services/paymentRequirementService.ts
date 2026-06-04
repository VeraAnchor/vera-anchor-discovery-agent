// apps/agent-api/src/services/paymentRequirementService.ts

import { config } from "../config.js";
import { agentDbPool } from "../db/db.js";
import { createAgentRepos } from "../repos/agentRepos.js";
import { withAgentTransaction } from "../repos/agentRepoUtils.js";
import type { AgentActionRow } from "../repos/agentActionRepo.js";
import type { AgentQuoteRow } from "../repos/agentQuoteRepo.js";
import type { AgentServiceContext } from "./agentServiceContext.js";

const repos = createAgentRepos(agentDbPool);

const X402_VERSION = 1 as const;
const PAYMENT_SCHEME = "exact" as const;
const PAYMENT_ASSET = "HBAR" as const;
const PAYMENT_KIND = "hedera_hbar_transfer" as const;

export type HederaExactPaymentRequirement = Readonly<{
  scheme: typeof PAYMENT_SCHEME;
  kind: typeof PAYMENT_KIND;
  network: string;
  asset: typeof PAYMENT_ASSET;
  amount: string;
  amount_minor: number;
  pay_to: string;
  memo: string;
  resource: string;
  action_id: string;
  quote_id: string;
  quote_hash: string;
  input_hash: string;
  expires_at: string;
  description: string;
  facilitator_url: string | null;
  payment_url: string | null;
}>;

export type ActionPaymentRequirements = Readonly<{
  x402_version: typeof X402_VERSION;
  payment_required: true;
  accepts: readonly HederaExactPaymentRequirement[];
  selected: HederaExactPaymentRequirement;
}>;

export type GetActionPaymentRequirementsInput = Readonly<{
  actionId: string;
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeUuid(value: unknown, field: string): string {
  const s = cleanString(value).toLowerCase();

  if (!s) {
    throwHttp(`${field.toUpperCase()}_REQUIRED`, 400);
  }

  rejectControlChars(s, field);

  if (!UUID_RE.test(s)) {
    throwHttp(`INVALID_${field.toUpperCase()}`, 400);
  }

  return s;
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

function normalizeServiceContext(context: AgentServiceContext): Required<AgentServiceContext> {
  return {
    actorRef: normalizeContextRef(context.actorRef, "actor_ref"),
    orgRef: normalizeContextRef(context.orgRef, "org_ref"),
    requestId: normalizeContextRef(context.requestId, "request_id"),
    systemScope: Boolean(context.systemScope),
  };
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();

  const d = new Date(String(value));

  if (Number.isNaN(d.getTime())) {
    throwHttp("INVALID_QUOTE_EXPIRATION", 500);
  }

  return d.toISOString();
}

function amountMinorToHbar(amountMinorRaw: string | number | bigint | null): string {
  const amountMinor = BigInt(String(amountMinorRaw ?? "0"));
  const whole = amountMinor / 100_000_000n;
  const frac = amountMinor % 100_000_000n;

  if (frac === 0n) {
    return whole.toString();
  }

  return `${whole.toString()}.${frac.toString().padStart(8, "0").replace(/0+$/g, "")}`;
}

function amountMinorNumber(value: string | number | bigint): number {
  const n = Number(value);

  if (!Number.isSafeInteger(n) || n < 0) {
    throwHttp("INVALID_QUOTE_AMOUNT_MINOR", 500);
  }

  return n;
}

function quotePayloadString(
  quote: AgentQuoteRow,
  key: string,
  fallback: string,
): string {
  const value = quote.quote_payload?.[key];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return fallback;
}

function facilitatorUrl(): string | null {
  const value = cleanString(process.env.X402_FACILITATOR_URL);
  return value || null;
}

function paymentResource(actionId: string): string {
  return `/v1/actions/${encodeURIComponent(actionId)}/execute`;
}

function actionInputHash(action: AgentActionRow, quote: AgentQuoteRow): string {
  const fromQuote = quotePayloadString(quote, "action_input_hash", "");
  if (fromQuote) return fromQuote;

  if (action.input_hash) return action.input_hash;

  throwHttp("ACTION_INPUT_HASH_MISSING", 500);
}

function paymentMemo(action: AgentActionRow, quote: AgentQuoteRow): string {
  return quotePayloadString(quote, "payment_memo", `vera-agent:${action.id}`);
}

function payToAccount(quote: AgentQuoteRow): string {
  return quotePayloadString(quote, "recipient_account_id", config.treasuryAccountId);
}

function paymentNetwork(quote: AgentQuoteRow): string {
  return quote.network || config.hederaNetwork;
}

function paymentAmount(quote: AgentQuoteRow): string {
  return quotePayloadString(quote, "amount", amountMinorToHbar(quote.amount_minor));
}

function assertQuoteActive(action: AgentActionRow, quote: AgentQuoteRow): void {
  if (action.status !== "payment_pending") {
    if (action.status === "payment_verified") {
      throwHttp("PAYMENT_ALREADY_VERIFIED", 409);
    }

    if (action.status === "completed") {
      throwHttp("ACTION_ALREADY_COMPLETED", 409);
    }

    if (action.status === "expired") {
      throwHttp("QUOTE_EXPIRED", 410);
    }

    throwHttp(`ACTION_NOT_PAYABLE:${action.status}`, 409);
  }

  if (quote.status !== "active") {
    if (quote.status === "expired") {
      throwHttp("QUOTE_EXPIRED", 410);
    }

    throwHttp(`QUOTE_NOT_ACTIVE:${quote.status}`, 409);
  }
}

async function loadActionAndQuote(
  actionId: string,
  context: Required<AgentServiceContext>,
): Promise<{
  action: AgentActionRow;
  quote: AgentQuoteRow;
}> {
  return withAgentTransaction(agentDbPool, context, async (client) => {
    const action = await repos.actions.getByIdForUpdate(actionId, { client });

    if (!action) {
      throwHttp("ACTION_NOT_FOUND", 404);
    }

    const quote =
      action.quote_id != null
        ? await repos.quotes.getById(action.quote_id, { client })
        : await repos.quotes.getActiveByActionId(action.id, { client });

    if (!quote) {
      throwHttp("ACTIVE_QUOTE_NOT_FOUND", 404);
    }

    if (Date.now() > new Date(quote.expires_at).getTime()) {
      await repos.quotes.markExpired(quote.id, { client });
      await repos.actions.markStatus(
        {
          id: action.id,
          status: "expired",
          errorCode: "QUOTE_EXPIRED",
          errorMessage: "Quote expired before payment requirements were requested.",
        },
        { client },
      );

      throwHttp("QUOTE_EXPIRED", 410);
    }

    assertQuoteActive(action, quote);

    return {
      action,
      quote,
    };
  });
}

function buildRequirement(input: {
  action: AgentActionRow;
  quote: AgentQuoteRow;
}): HederaExactPaymentRequirement {
  const amountMinor = amountMinorNumber(input.quote.amount_minor);
  const amount = paymentAmount(input.quote);
  const payTo = payToAccount(input.quote);
  const network = paymentNetwork(input.quote);
  const memo = paymentMemo(input.action, input.quote);
  const inputHash = actionInputHash(input.action, input.quote);

  return Object.freeze({
    scheme: PAYMENT_SCHEME,
    kind: PAYMENT_KIND,
    network,
    asset: PAYMENT_ASSET,
    amount,
    amount_minor: amountMinor,
    pay_to: payTo,
    memo,
    resource: paymentResource(input.action.id),
    action_id: input.action.id,
    quote_id: input.quote.id,
    quote_hash: input.quote.quote_hash,
    input_hash: inputHash,
    expires_at: toIso(input.quote.expires_at),
    description:
      "Pay this Hedera HBAR requirement, then retry the execute endpoint with the payment transaction id.",
    facilitator_url: facilitatorUrl(),
    payment_url: null,
  });
}

export async function getActionPaymentRequirements(
  input: GetActionPaymentRequirementsInput,
  context: AgentServiceContext,
): Promise<ActionPaymentRequirements> {
  const actionId = normalizeUuid(input.actionId, "action_id");
  const scopedContext = normalizeServiceContext(context);

  const { action, quote } = await loadActionAndQuote(actionId, scopedContext);
  const selected = buildRequirement({ action, quote });

  return Object.freeze({
    x402_version: X402_VERSION,
    payment_required: true,
    accepts: Object.freeze([selected]),
    selected,
  });
}