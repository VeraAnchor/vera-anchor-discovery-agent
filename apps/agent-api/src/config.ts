import dotenv from "dotenv";

dotenv.config();

function readString(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`missing_env:${name}`);
  }
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

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  port: readNumber("AGENT_API_PORT", 8787),
  webOrigin: readString("WEB_ORIGIN", "http://localhost:5173"),

  hederaNetwork: readString("HEDERA_NETWORK", "testnet"),
  treasuryAccountId: readString("HEDERA_TREASURY_ACCOUNT_ID", "0.0.REPLACE_ME"),

  proofBundlePriceHbar: readString("PROOF_BUNDLE_PRICE_HBAR", "0.25"),
  quoteTtlSeconds: readNumber("QUOTE_TTL_SECONDS", 900),

  veraPublicSiteUrl: readString("VERA_PUBLIC_SITE_URL", "https://veraanchor.com"),
  veraPublicApiBaseUrl: readString("VERA_PUBLIC_API_BASE_URL", "https://veraanchor.com/v1"),

  demoPaymentMode: String(process.env.DEMO_PAYMENT_MODE || "true") === "true",
});