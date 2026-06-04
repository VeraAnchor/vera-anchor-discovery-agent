// apps/agent-api/src/scripts/testHttpActionPaymentFlow.ts

import type { FastifyInstance } from "fastify";

type HttpMethod = "GET" | "POST";

type InjectJsonInput = Readonly<{
  method: HttpMethod;
  url: string;
  payload?: Record<string, unknown>;
  expectedStatus?: number;
  label: string;
}>;

type InjectedJsonResponse = Readonly<{
  statusCode: number;
  headers: Record<string, unknown>;
  body: unknown;
}>;

type InjectResponseLike = Readonly<{
  statusCode: number;
  headers: Record<string, unknown>;
  payload: string;
}>;

const runId = Date.now();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function getNestedOptionalString(
  value: unknown,
  path: readonly string[],
): string | null {
  let current: unknown = value;

  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" && current.trim() ? current : null;
}

function getNestedUuid(value: unknown, path: readonly string[]): string {
  const id = getNestedString(value, path).toLowerCase();

  if (!UUID_RE.test(id)) {
    throw new Error(`Expected UUID at path ${path.join(".")}; received: ${id}`);
  }

  return id;
}

function parseJson(payload: string, label: string): unknown {
  try {
    return JSON.parse(payload) as unknown;
  } catch (err) {
    throw new Error(
      `Expected JSON response for ${label}; parse failed: ${
        err instanceof Error ? err.message : String(err)
      }; payload=${payload.slice(0, 512)}`,
    );
  }
}

function demoHederaTransactionId(): string {
  const seconds = Math.floor(Date.now() / 1000);
  const nanos = String(runId % 1_000_000_000).padStart(9, "0");

  return `0.0.12345@${seconds}.${nanos}`;
}

function headerString(
  headers: Record<string, unknown>,
  name: string,
): string | null {
  const value = headers[name] ?? headers[name.toLowerCase()];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0].trim();
  }

  return null;
}

async function injectJson(
  app: FastifyInstance,
  input: InjectJsonInput,
): Promise<InjectedJsonResponse> {
  const injectOptions: Record<string, unknown> = {
    method: input.method,
    url: input.url,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
  };

  if (input.payload !== undefined) {
    injectOptions.payload = input.payload;
  }

  const response = (await app.inject(
    injectOptions as never,
  )) as unknown as InjectResponseLike;

  const body = parseJson(response.payload, input.label);

  print(input.label, {
    statusCode: response.statusCode,
    headers: response.headers,
    body,
  });

  if (
    typeof input.expectedStatus === "number" &&
    response.statusCode !== input.expectedStatus
  ) {
    throw new Error(
      `${input.label}: expected HTTP ${input.expectedStatus}, received ${response.statusCode}`,
    );
  }

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body,
  };
}

function assertPaymentRequirementShape(value: unknown): void {
  const obj = getObject(value, "payment_requirements");

  if (obj.x402_version !== 1) {
    throw new Error(
      `Expected x402_version=1; received ${String(obj.x402_version)}`,
    );
  }

  const selected = getObject(obj.selected, "payment_requirements.selected");

  const payTo = selected.pay_to;
  if (typeof payTo !== "string" || !/^0\.0\.\d+$/.test(payTo)) {
    throw new Error(
      `Expected selected.pay_to Hedera account id; received ${String(payTo)}`,
    );
  }

  const memo = selected.memo;
  if (typeof memo !== "string" || !memo.startsWith("vera-agent:")) {
    throw new Error(
      `Expected selected.memo vera-agent:<action_id>; received ${String(memo)}`,
    );
  }

  const quoteHash = selected.quote_hash;
  if (typeof quoteHash !== "string" || quoteHash.length < 32) {
    throw new Error("Expected selected.quote_hash");
  }

  const inputHash = selected.input_hash;
  if (typeof inputHash !== "string" || inputHash.length < 32) {
    throw new Error("Expected selected.input_hash");
  }
}

async function main(): Promise<void> {
  process.env.NODE_ENV = "test";

  const [{ buildApp }, { bootstrapAgentDb }, { closeAgentDb }] =
    await Promise.all([
      import("../server.js"),
      import("../db/dbBootstrap.js"),
      import("../db/db.js"),
    ]);

  const app = await buildApp();

  try {
    await bootstrapAgentDb();
    await app.ready();

    const statusResponse = await injectJson(app, {
      method: "GET",
      url: "/v1/hedera/agent/status",
      expectedStatus: 200,
      label: "hedera agent status",
    });

    const statusBody = getObject(statusResponse.body, "hedera agent status");
    const agentKit = getObject(
      statusBody.agent_kit,
      "hedera agent status.agent_kit",
    );

    if (agentKit.enabled !== true) {
      throw new Error("Expected hedera agent status agent_kit.enabled=true");
    }

    if (agentKit.integration !== "external_adapter") {
      throw new Error(
        `Expected hedera agent status agent_kit.integration=external_adapter; received ${String(
          agentKit.integration,
        )}`,
      );
    }

    if (agentKit.loaded !== false) {
      throw new Error(
        `Expected hedera agent status agent_kit.loaded=false while Agent Kit is isolated from agent-api runtime; received ${String(
          agentKit.loaded,
        )}`,
      );
    }

    const quoteResponse = await injectJson(app, {
      method: "POST",
      url: "/v1/quotes",
      expectedStatus: 201,
      label: "create quote",
      payload: {
        action_type: "proof_bundle_export",
        subject_type: "cipher_result",
        subject_id: "demo-cipher-public-result",
        idempotency_key: `local-http-proof-${runId}`,
      },
    });

    const actionId = getNestedUuid(quoteResponse.body, ["action_id"]);
    const quoteId = getNestedUuid(quoteResponse.body, ["quote_id"]);

    assertPaymentRequirementShape(getObject(quoteResponse.body, "create quote body").payment_requirements);
    
    const quoteMemo = getNestedString(quoteResponse.body, ["payment_memo"]);
    if (quoteMemo !== `vera-agent:${actionId}`) {
      throw new Error(
        `Expected quote payment_memo vera-agent:${actionId}; received ${quoteMemo}`,
      );
    }

    const unpaidExecuteResponse = await injectJson(app, {
      method: "POST",
      url: `/v1/actions/${actionId}/execute`,
      expectedStatus: 402,
      label: "unpaid execute",
      payload: {},
    });

    const noStore = headerString(unpaidExecuteResponse.headers, "cache-control");
    if (!noStore || !noStore.toLowerCase().includes("no-store")) {
      throw new Error(
        "Expected unpaid execute to include cache-control: no-store",
      );
    }

    const x402Version = headerString(
      unpaidExecuteResponse.headers,
      "x-402-version",
    );
    if (x402Version !== "1") {
      throw new Error(
        `Expected x-402-version=1 header; received ${String(x402Version)}`,
      );
    }

    const unpaidBody = getObject(
      unpaidExecuteResponse.body,
      "unpaid execute body",
    );

    if (unpaidBody.error !== "PAYMENT_REQUIRED") {
      throw new Error(
        `Expected unpaid execute error PAYMENT_REQUIRED; received ${String(
          unpaidBody.error,
        )}`,
      );
    }

    assertPaymentRequirementShape(unpaidBody.payment_requirements);

    const paymentTransactionId = demoHederaTransactionId();

    const paidExecuteResponse = await injectJson(app, {
      method: "POST",
      url: `/v1/actions/${actionId}/execute`,
      expectedStatus: 200,
      label: "paid execute",
      payload: {
        payment_transaction_id: paymentTransactionId,
        payer_account_id: "0.0.12345",
      },
    });

    const paidBody = getObject(paidExecuteResponse.body, "paid execute body");

    if (paidBody.status !== "completed") {
      throw new Error(
        `Expected paid execute status completed; received ${String(
          paidBody.status,
        )}`,
      );
    }

    const receiptId =
      getNestedOptionalString(paidBody, ["receipt", "id"]) ??
      getNestedOptionalString(paidBody, ["proof_bundle_id"]);

    if (!receiptId || !UUID_RE.test(receiptId)) {
      throw new Error(
        `Expected receipt id from paid execute; received ${String(receiptId)}`,
      );
    }

    const proofBundleHash = getNestedString(paidBody, ["proof_bundle_hash"]);
    if (proofBundleHash.length < 32) {
      throw new Error("Expected proof_bundle_hash from paid execute");
    }

    const receiptResponse = await injectJson(app, {
      method: "GET",
      url: `/v1/receipts/${receiptId}`,
      expectedStatus: 200,
      label: "get receipt",
    });

    const receiptBody = getObject(receiptResponse.body, "receipt body");
    const receiptHash =
      getNestedOptionalString(receiptBody, ["receipt_hash"]) ??
      getNestedOptionalString(receiptBody, ["receipt", "receipt_hash"]);

    if (!receiptHash || receiptHash.length < 32) {
      throw new Error("Expected receipt hash from GET /v1/receipts/:receiptId");
    }

    const retryResponse = await injectJson(app, {
      method: "POST",
      url: `/v1/actions/${actionId}/execute`,
      expectedStatus: 200,
      label: "retry same action",
      payload: {
        payment_transaction_id: paymentTransactionId,
        payer_account_id: "0.0.12345",
      },
    });

    const retryBody = getObject(retryResponse.body, "retry body");
    const retryReceiptId =
      getNestedOptionalString(retryBody, ["receipt", "id"]) ??
      getNestedOptionalString(retryBody, ["proof_bundle_id"]);

    if (retryReceiptId !== receiptId) {
      throw new Error(
        `Expected retry to return same receipt id ${receiptId}; received ${String(
          retryReceiptId,
        )}`,
      );
    }

    console.log("\nHTTP action payment flow test completed");
    console.log(`action_id=${actionId}`);
    console.log(`quote_id=${quoteId}`);
    console.log(`receipt_id=${receiptId}`);
    console.log(`payment_transaction_id=${paymentTransactionId}`);
  } finally {
    await app.close().catch(() => undefined);
    await closeAgentDb().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("\nHTTP action payment flow test failed");
  console.error(err);
  process.exit(1);
});