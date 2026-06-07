import {
  DAppConnector,
  HederaJsonRpcMethod,
  HederaSessionEvent,
  transactionToBase64String,
} from "@hashgraph/hedera-wallet-connect";
import { AccountId, Hbar, TransferTransaction } from "@hiero-ledger/sdk";
import type {
  HederaExactPaymentRequirement,
} from "../api/paidProofExports";
import type {
  HederaWalletAdapter,
  HederaWalletPaymentResult,
} from "./hederaWalletAdapter";
import {
  getHederaChainId,
  getHederaLedgerId,
  getExternalHederaNetwork,
  getWalletConnectMetadataUrl,
  getWalletConnectProjectId,
  hederaSignerAccountId,
} from "./hederaWalletConfig";

let adapterInstance: HederaWalletAdapter | null = null;

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeAccountId(value: unknown): string | null {
  const raw = cleanString(value);

  if (!raw) return null;

  const withoutPrefix = raw.includes(":") ? raw.split(":").at(-1) ?? raw : raw;
  const withoutChecksum = withoutPrefix.split("-")[0] ?? withoutPrefix;

  if (/^0\.0\.\d+$/.test(withoutChecksum)) {
    return withoutChecksum;
  }

  return null;
}

function normalizeTransactionId(value: unknown): string | null {
  const raw = cleanString(value);

  if (!raw) return null;

  const withoutPrefix = raw.includes(":") ? raw.split(":").at(-1) ?? raw : raw;

  const atMatch = withoutPrefix.match(/^(0\.0\.\d+)@(\d{1,20})\.(\d{1,9})$/);
  if (atMatch) {
    return `${atMatch[1]}@${atMatch[2]}.${atMatch[3]}`;
  }

  const dashMatch = withoutPrefix.match(/^(0\.0\.\d+)-(\d{1,20})-(\d{1,9})$/);
  if (dashMatch) {
    return `${dashMatch[1]}@${dashMatch[2]}.${dashMatch[3]}`;
  }

  return null;
}

function transactionIdFromWalletResult(value: unknown): string | null {
  const direct = normalizeTransactionId(value);

  if (direct) return direct;

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = transactionIdFromWalletResult(item);

      if (nested) return nested;
    }

    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  return (
    normalizeTransactionId(record.transactionId) ??
    normalizeTransactionId(record.transaction_id) ??
    normalizeTransactionId(record.txId) ??
    normalizeTransactionId(record.id) ??
    transactionIdFromWalletResult(record.result) ??
    transactionIdFromWalletResult(record.response)
  );
}

function assertRequirementMatchesNetwork(
  requirement: HederaExactPaymentRequirement,
  network: string,
): void {
  if (requirement.network !== network) {
    throw new Error(`PAYMENT_NETWORK_MISMATCH:${requirement.network}`);
  }

  if (requirement.asset !== "HBAR") {
    throw new Error("UNSUPPORTED_PAYMENT_ASSET");
  }

  if (requirement.kind !== "hedera_hbar_transfer") {
    throw new Error("UNSUPPORTED_PAYMENT_KIND");
  }

  if (!/^0\.0\.\d+$/.test(requirement.pay_to)) {
    throw new Error("INVALID_PAYMENT_RECIPIENT");
  }

  if (!Number.isSafeInteger(requirement.amount_minor) || requirement.amount_minor <= 0) {
    throw new Error("INVALID_PAYMENT_AMOUNT_MINOR");
  }

  if (!requirement.memo.trim()) {
    throw new Error("PAYMENT_MEMO_REQUIRED");
  }
}

async function createDAppConnectorWallet(): Promise<DAppConnector> {
  const projectId = getWalletConnectProjectId();
  const network = getExternalHederaNetwork();
  const ledgerId = getHederaLedgerId(network);
  const chainId = getHederaChainId(network);
  const metadataUrl = getWalletConnectMetadataUrl();

  console.log("walletconnect init", {
    projectIdPresent: Boolean(projectId),
    network,
    ledgerId: ledgerId.toString(),
    chainId,
    metadataUrl,
    origin: window.location.origin,
  });

  const metadata = {
    name: "Vera Anchor Agent",
    description: "Paid Vera Anchor proof export flow",
    url: metadataUrl,
    icons: [`${metadataUrl}/favicon.ico`],
  };

  const connector = new DAppConnector(
    metadata,
    ledgerId,
    projectId,
    Object.values(HederaJsonRpcMethod),
    [
      HederaSessionEvent.ChainChanged,
      HederaSessionEvent.AccountsChanged,
    ],
    [chainId],
    "error",
  );

  await connector.init({ logger: "error" });

  return connector;
}

function getConnectedAccountId(connector: DAppConnector): string | null {
  for (const signer of connector.signers) {
    const accountId = normalizeAccountId(signer.getAccountId().toString());

    if (accountId) return accountId;
  }

  return null;
}

export function createHashPackWalletConnectAdapter(): HederaWalletAdapter {
  if (adapterInstance) return adapterInstance;

  let connector: DAppConnector | null = null;
  let connectedAccountId: string | null = null;

  adapterInstance = {
    isAvailable() {
      try {
        return Boolean(getWalletConnectProjectId());
      } catch {
        return false;
      }
    },

    async connect() {
      if (!connector) {
        connector = await createDAppConnectorWallet();
      }

      if (!connectedAccountId) {
        await connector.openModal(undefined, true);
        connectedAccountId = getConnectedAccountId(connector);
      }

      if (!connectedAccountId) {
        throw new Error("HEDERA_WALLET_ACCOUNT_NOT_CONNECTED");
      }

      return {
        accountId: connectedAccountId,
      };
    },

    async pay(
      requirement: HederaExactPaymentRequirement,
    ): Promise<HederaWalletPaymentResult> {
      const network = getExternalHederaNetwork();

      assertRequirementMatchesNetwork(requirement, network);

      if (!connector) {
        throw new Error("HEDERA_WALLET_NOT_CONNECTED");
      }

      if (!connectedAccountId) {
        throw new Error("HEDERA_WALLET_ACCOUNT_NOT_CONNECTED");
      }

      const payer = AccountId.fromString(connectedAccountId);
      const recipient = AccountId.fromString(requirement.pay_to);
      const tinybars = requirement.amount_minor;

      const transaction = new TransferTransaction()
        .addHbarTransfer(payer, Hbar.fromTinybars(-tinybars))
        .addHbarTransfer(recipient, Hbar.fromTinybars(tinybars))
        .setTransactionMemo(requirement.memo);

      const walletResult = await connector.signAndExecuteTransaction({
        signerAccountId: hederaSignerAccountId(network, connectedAccountId),
        transactionList: transactionToBase64String(transaction),
      });

      console.log("wallet payment submitted", {
        payer: connectedAccountId,
        walletResult,
      });

      const transactionIdString = transactionIdFromWalletResult(walletResult);

      if (!transactionIdString) {
        throw new Error("HEDERA_WALLET_PAYMENT_TRANSACTION_ID_MISSING");
      }

      return {
        transactionId: transactionIdString,
        payerAccountId: connectedAccountId,
      };
    },
  };

  return adapterInstance;
}