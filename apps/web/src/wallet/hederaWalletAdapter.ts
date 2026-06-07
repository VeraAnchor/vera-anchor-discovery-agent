import type { HederaExactPaymentRequirement } from "../api/paidProofExports";

export type HederaWalletPaymentResult = Readonly<{
  transactionId: string;
  payerAccountId: string | null;
}>;

export type HederaWalletAdapter = Readonly<{
  isAvailable(): boolean;
  connect(): Promise<{ accountId: string | null }>;
  pay(requirement: HederaExactPaymentRequirement): Promise<HederaWalletPaymentResult>;
}>;

export function createUnavailableWalletAdapter(): HederaWalletAdapter {
  return {
    isAvailable() {
      return false;
    },

    async connect() {
      throw new Error("HEDERA_WALLET_NOT_AVAILABLE");
    },

    async pay() {
      throw new Error("HEDERA_WALLET_NOT_AVAILABLE");
    },
  };
}