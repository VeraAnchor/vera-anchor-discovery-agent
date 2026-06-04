import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { healthRoutes } from "./routes/healthRoutes.js";
import { evidenceRoutes } from "./routes/evidenceRoutes.js";
import { quoteRoutes } from "./routes/quoteRoutes.js";
import { actionRoutes } from "./routes/actionRoutes.js";
import { proofRoutes } from "./routes/proofRoutes.js";
import { hederaAgentRoutes } from "./routes/hederaAgentRoutes.js";
import { bootstrapAgentDb } from "./db/dbBootstrap.js";
import { closeAgentDb } from "./db/db.js";

type ReqWithTiming = FastifyRequest & { _reqStartNs?: bigint };

function cleanString(value: unknown, max = 256): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function toBool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  const s = String(value).trim().toLowerCase();
  if (!s) return fallback;
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function toInt(value: unknown, fallback: number, min?: number, max?: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;

  let out = Math.trunc(n);
  if (typeof min === "number") out = Math.max(min, out);
  if (typeof max === "number") out = Math.min(max, out);
  return out;
}

function parseCsvList(value: unknown): string[] {
  const s = String(value ?? "").trim();
  if (!s) return [];

  return s
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return origin.trim().toLowerCase();
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function statusFromError(err: unknown): number {
  const e = err as { status?: unknown; statusCode?: unknown };
  const raw = e.status ?? e.statusCode;
  const n = Number(raw);

  if (Number.isFinite(n) && n >= 400 && n <= 599) {
    return Math.trunc(n);
  }

  return 500;
}

function errorKeyFromStatus(status: number): string {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 410:
      return "gone";
    case 422:
      return "unprocessable_entity";
    default:
      return "internal_error";
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const isProd = config.nodeEnv.trim().toLowerCase() === "production";

  const app = Fastify({
    logger: {
      level: String(process.env.LOG_LEVEL || "info").toLowerCase(),
      redact: ["req.headers.authorization", "req.headers.cookie", "req.headers.x-api-key"],
    },
    disableRequestLogging: true,
    requestTimeout: toInt(process.env.REQUEST_TIMEOUT_MS, 10_000, 1_000, 120_000),
    keepAliveTimeout: toInt(process.env.KEEP_ALIVE_TIMEOUT_MS, 72_000, 1_000, 300_000),
    bodyLimit: toInt(process.env.BODY_LIMIT_BYTES, 262_144, 1_024, 1_048_576),
    trustProxy: toBool(process.env.TRUST_PROXY, false),
    genReqId: () => nanoid(),
    requestIdHeader: false,
    routerOptions: {
      maxParamLength: 255,
    },
  });

  app.addHook("onRequest", async (req) => {
    (req as ReqWithTiming)._reqStartNs = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (req, reply) => {
    const start = (req as ReqWithTiming)._reqStartNs;
    if (typeof start !== "bigint") return;

    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const route = req.routeOptions?.url || "unmatched";
    const ua = cleanString(req.headers["user-agent"], 180);

    const bytesOutHeader = reply.getHeader("content-length");
    const bytesOut =
      typeof bytesOutHeader === "string" || typeof bytesOutHeader === "number"
        ? Number(bytesOutHeader)
        : null;

    const logPayload: Record<string, unknown> = {
      reqId: req.id,
      method: req.method,
      route,
      status: reply.statusCode,
      ms: Math.round(ms),
      ...(ua ? { ua } : {}),
      ...(Number.isFinite(bytesOut as number) ? { bytesOut } : {}),
    };

    if (ms >= 1500) req.log.warn(logPayload, "slow_request");
    else if (reply.statusCode >= 500) req.log.error(logPayload, "request_5xx");
    else req.log.info(logPayload, "request");
  });

  app.addHook("onRoute", (route) => {
    app.log.info(
      {
        method: route.method,
        url: route.url,
        prefix: (route as { prefix?: string }).prefix ?? "",
      },
      "route_mounted"
    );
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });

  const allowedOrigins = unique(parseCsvList(process.env.CORS_ORIGINS).map(normalizeOrigin));

  await app.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "Cache-Control", "Pragma"],
    maxAge: 600,
  });

  await app.register(compress, { global: true });

  await app.register(healthRoutes);
  await app.register(evidenceRoutes);
  await app.register(quoteRoutes);
  await app.register(actionRoutes);
  await app.register(proofRoutes);
  await app.register(hederaAgentRoutes);

  app.get("/", async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      service: "vera-anchor-discovery-agent",
      description:
        "Hedera Agent Kit MCP/x402 gateway for Vera Anchor Explorer discovery and paid proof-bundle export.",
      health: "/healthz",
      ready: "/readyz",
      hedera_agent_status: "/v1/hedera/agent/status",
    });
  });

  app.setNotFoundHandler((req, reply) => {
    req.log.info({ reqId: req.id, route: req.url }, "not_found");

    return reply.code(404).send({
      error: "not_found",
      message: "not_found",
      request_id: req.id,
    });
  });

  app.setErrorHandler((err: FastifyError & { status?: number }, req, reply) => {
    const status = statusFromError(err);
    const errorKey = errorKeyFromStatus(status);
    const safeMessage =
      status >= 500 && isProd ? "internal_error" : String(err.message || errorKey);

    const logPayload = {
      reqId: req.id,
      route: req.routeOptions?.url || "unmatched",
      status,
      name: err.name ?? null,
      message: String(err.message || ""),
    };

    if (status >= 500) req.log.error(logPayload, "request_error");
    else req.log.info(logPayload, "request_error");

    return reply.code(status).send({
      error: errorKey,
      message: safeMessage,
      request_id: req.id,
    });
  });

  return app;
}

async function main(): Promise<void> {
  const app = await buildApp();

  app.addHook("onClose", async () => {
    await closeAgentDb();
  });

  app.log.info("agent_db_bootstrap_start");
  await bootstrapAgentDb();
  app.log.info("agent_db_bootstrap_complete");

  await app.ready();
  app.log.info({ routes: app.printRoutes() }, "route_tree");

  const host = cleanString(process.env.HOST, 128) || "0.0.0.0";

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutdown_start");

    try {
      await app.close();
      app.log.info({ signal }, "shutdown_complete");
      process.exit(0);
    } catch (err) {
      app.log.error({ err, signal }, "shutdown_failed");
      process.exit(1);
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.port, host });
  app.log.info({ port: config.port, host }, "Vera Anchor Discovery Agent started");
}

if (process.env.NODE_ENV !== "test") {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}