// apps/agent-api/src/config.ts

import dotenv from "dotenv";

dotenv.config();

function readString(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`missing_env:${name}`);
  }
  return value;
}

function readOptionalString(name: string): string | null {
  const value = process.env[name];
  if (value === undefined || value === "") return null;
  return value;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;

  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`invalid_number_env:${name}`);
  }

  return n;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;

  const value = raw.trim().toLowerCase();

  if (["1", "true", "t", "yes", "y", "on"].includes(value)) return true;
  if (["0", "false", "f", "no", "n", "off"].includes(value)) return false;

  throw new Error(`invalid_boolean_env:${name}`);
}

function normalizeBaseUrl(value: string, name: string): string {
  const trimmed = value.trim();

  try {
    const url = new URL(trimmed);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`invalid_url_protocol_env:${name}`);
    }

    url.hash = "";
    url.search = "";

    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new Error(`invalid_url_env:${name}`);
  }
}

type PaymentVerificationMode = "demo" | "mirror" | "disabled";

function readPaymentVerificationMode(): PaymentVerificationMode {
  const raw = (
    process.env.HEDERA_AGENT_PAYMENT_VERIFICATION_MODE ??
    (readBoolean("DEMO_PAYMENT_MODE", true) ? "demo" : "mirror")
  )
    .trim()
    .toLowerCase();

  if (raw === "demo" || raw === "mirror" || raw === "disabled") {
    return raw;
  }

  throw new Error("invalid_env:HEDERA_AGENT_PAYMENT_VERIFICATION_MODE");
}

const veraPublicSiteUrl = normalizeBaseUrl(
  readString("VERA_PUBLIC_SITE_URL", "https://veraanchor.com"),
  "VERA_PUBLIC_SITE_URL",
);

const defaultPublicApiBaseUrl = `${veraPublicSiteUrl}/v1`;

const veraPublicApiBaseUrl = normalizeBaseUrl(
  readString("VERA_PUBLIC_API_BASE_URL", defaultPublicApiBaseUrl),
  "VERA_PUBLIC_API_BASE_URL",
);

const paymentVerificationMode = readPaymentVerificationMode();

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  port: readNumber("AGENT_API_PORT", readNumber("PORT", 8787)),
  webOrigin: readString("WEB_ORIGIN", "http://localhost:5173"),

  hederaNetwork: readString("HEDERA_NETWORK", "testnet"),
  treasuryAccountId: readString("HEDERA_TREASURY_ACCOUNT_ID", "0.0.REPLACE_ME"),
  hederaMirrorNodeBaseUrl: readOptionalString("HEDERA_MIRROR_NODE_BASE_URL"),

  proofBundlePriceHbar: readString("PROOF_BUNDLE_PRICE_HBAR", "0.25"),
  quoteTtlSeconds: readNumber("QUOTE_TTL_SECONDS", 900),

  veraPublicSiteUrl,
  veraPublicApiBaseUrl,

  explorerLiveEvidenceEnabled: readBoolean(
    "EXPLORER_LIVE_EVIDENCE_ENABLED",
    true,
  ),
  explorerApiTimeoutMs: readNumber("EXPLORER_API_TIMEOUT_MS", 4_000),
  explorerApiMaxResponseBytes: readNumber(
    "EXPLORER_API_MAX_RESPONSE_BYTES",
    262_144,
  ),
  explorerApiUserAgent: readString(
    "EXPLORER_API_USER_AGENT",
    "vera-discovery-agent/1.0",
  ),
  explorerApiKey: readOptionalString("EXPLORER_API_KEY"),

  paymentVerificationMode,
  demoPaymentMode: paymentVerificationMode === "demo",
});