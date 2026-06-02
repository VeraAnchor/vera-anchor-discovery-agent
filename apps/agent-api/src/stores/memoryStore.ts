import type { AgentActionRecord, AgentReceiptRecord } from "../types.js";

type MemoryStore = {
  actions: Map<string, AgentActionRecord>;
  receipts: Map<string, AgentReceiptRecord>;
};

export const store: MemoryStore = {
  actions: new Map<string, AgentActionRecord>(),
  receipts: new Map<string, AgentReceiptRecord>(),
};

export function getAction(actionId: string): AgentActionRecord | null {
  return store.actions.get(actionId) ?? null;
}

export function saveAction(action: AgentActionRecord): AgentActionRecord {
  store.actions.set(action.id, Object.freeze({ ...action }));
  return action;
}

export function hasPaymentTransaction(paymentTransactionId: string): boolean {
  const tx = String(paymentTransactionId || "").trim();
  if (!tx) return false;

  for (const action of store.actions.values()) {
    if (action.payment_transaction_id === tx) return true;
  }

  return false;
}

export function saveReceipt(receipt: AgentReceiptRecord): AgentReceiptRecord {
  store.receipts.set(receipt.id, Object.freeze({ ...receipt }));
  return receipt;
}

export function getReceipt(receiptId: string): AgentReceiptRecord | null {
  return store.receipts.get(receiptId) ?? null;
}