import { config } from "../config.js";
import { hasPaymentTransaction } from "../stores/memoryStore.js";
import type { AgentActionRecord, PaymentVerification } from "../types.js";
import { assertActionPayable } from "./quoteService.js";

export type PaymentVerificationInput = Readonly<{
  action: AgentActionRecord | null;
  paymentTransactionId: string;
  payerAccountId?: string;
}>;

export type PaymentVerificationResult =
  | Readonly<{
      ok: true;
      payment: PaymentVerification;
    }>
  | Readonly<{
      ok: false;
      code: string;
      status: number;
    }>;

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function looksLikeHederaTransactionId(value: string): boolean {
  // Accepts the common transaction timestamp shape used throughout VA/Hedera flows:
  // 0.0.12345@1234567890.000000001
  return /^0\.0\.\d+@\d+\.\d{1,9}$/.test(value);
}

export async function verifyPaymentForAction(
  input: PaymentVerificationInput
): Promise<PaymentVerificationResult> {
  let action: AgentActionRecord;

  try {
    action = assertActionPayable(input.action);
  } catch (err) {
    const e = err as Error & { status?: number };

    return {
      ok: false,
      code: e.message || "ACTION_NOT_PAYABLE",
      status: e.status || 400,
    };
  }

  const paymentTransactionId = cleanString(input.paymentTransactionId);
  const payerAccountId = cleanString(input.payerAccountId);

  if (!paymentTransactionId) {
    return {
      ok: false,
      code: "PAYMENT_TRANSACTION_ID_REQUIRED",
      status: 400,
    };
  }

  if (hasPaymentTransaction(paymentTransactionId)) {
    return {
      ok: false,
      code: "PAYMENT_TRANSACTION_ALREADY_USED",
      status: 409,
    };
  }

  if (config.demoPaymentMode) {
    if (!looksLikeHederaTransactionId(paymentTransactionId)) {
      return {
        ok: false,
        code: "INVALID_DEMO_PAYMENT_TRANSACTION_ID",
        status: 400,
      };
    }

    return {
      ok: true,
      payment: {
        transaction_id: paymentTransactionId,
        payer_account_id: payerAccountId || null,
        amount: action.quote_amount,
        token: action.quote_token,
        network: action.network,
        recipient_account_id: action.recipient_account_id,
        verified_mode: "demo",
      },
    };
  }

  /*
   * Real verification placeholder.
   *
   * This should later verify against Hedera mirror / Agent Kit / x402 facilitator:
   * - transaction exists
   * - transaction is final
   * - network matches quote
   * - recipient matches quote recipient_account_id
   * - amount >= quote_amount
   * - token/currency matches quote_token
   * - memo or facilitator metadata binds to action.id / action.input_hash
   * - transaction has not been reused
   */
  return {
    ok: false,
    code: "REAL_PAYMENT_VERIFICATION_NOT_IMPLEMENTED",
    status: 501,
  };
}