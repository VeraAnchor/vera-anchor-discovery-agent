import { HederaChainId } from "@hashgraph/hedera-wallet-connect";
import { LedgerId } from "@hiero-ledger/sdk";

export type ExternalHederaNetwork = "mainnet" | "testnet";

export function getExternalHederaNetwork(): ExternalHederaNetwork {
  const raw = String(import.meta.env.VITE_HEDERA_NETWORK ?? "testnet").trim();

  if (raw === "mainnet" || raw === "testnet") {
    return raw;
  }

  throw new Error("VITE_HEDERA_NETWORK must be mainnet or testnet");
}

export function getWalletConnectProjectId(): string {
  const value = String(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "").trim();

  if (!value) {
    throw new Error("VITE_WALLETCONNECT_PROJECT_ID_REQUIRED");
  }

  return value;
}

export function getWalletConnectMetadataUrl(): string {
  const value = String(
    import.meta.env.VITE_WALLETCONNECT_METADATA_URL ?? window.location.origin,
  ).trim();

  if (!value) {
    throw new Error("VITE_WALLETCONNECT_METADATA_URL_REQUIRED");
  }

  return value.replace(/\/+$/, "");
}

export function getHederaLedgerId(
  network: ExternalHederaNetwork,
) {
  if (network === "mainnet") {
    return LedgerId.MAINNET;
  }

  return LedgerId.TESTNET;
}

export function getHederaChainId(network: ExternalHederaNetwork): HederaChainId {
  if (network === "mainnet") {
    return HederaChainId.Mainnet;
  }

  return HederaChainId.Testnet;
}

export function hederaSignerAccountId(
  network: ExternalHederaNetwork,
  accountId: string,
): string {
  // Hedera native WalletConnect / HIP-820 format.
  return `hedera:${network}:${accountId}`;
}