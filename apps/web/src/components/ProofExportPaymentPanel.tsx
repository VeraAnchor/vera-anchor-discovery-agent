import { useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  Loader2,
  ReceiptText,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import {
  createProofExportQuote,
  executePaidAction,
  type ExecutePaidActionResult,
  type ProofExportQuote,
} from "@/api/paidProofExports";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import GlassCard from "@/components/ui/glass-card";
import {
  createUnavailableWalletAdapter,
  type HederaWalletAdapter,
} from "@/wallet/hederaWalletAdapter";

type SubjectType =
  | "cipher_result"
  | "sage_result"
  | "dataset"
  | "hcs_transaction"
  | "proof_card";

type Props = Readonly<{
  subjectType: SubjectType;
  subjectId: string;
  wallet?: HederaWalletAdapter;
  onCompleted?: (result: ExecutePaidActionResult) => void;
}>;

type Status =
  | "idle"
  | "quoting"
  | "quoted"
  | "paying"
  | "executing"
  | "completed"
  | "failed";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isMirrorPendingError(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.message === "PAYMENT_TRANSACTION_NOT_FOUND_ON_MIRROR"
  );
}

function shortMiddle(value: unknown, head = 14, tail = 10): string {
  const s = String(value ?? "").trim();
  if (!s) return "—";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function statusLabel(status: Status): string {
  switch (status) {
    case "idle":
      return "Ready";
    case "quoting":
      return "Creating quote";
    case "quoted":
      return "Quote ready";
    case "paying":
      return "Wallet payment";
    case "executing":
      return "Mirror verification";
    case "completed":
      return "Export complete";
    case "failed":
      return "Action failed";
  }
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

function FieldRow({
  label,
  value,
  mono = false,
  copyable = false,
}: Readonly<{
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
}>) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/25 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>

        {copyable && value ? (
          <button
            type="button"
            onClick={() => void copyText(value)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-100 transition hover:text-cyan-50"
          >
            <Copy className="h-3 w-3" />
            Copy
          </button>
        ) : null}
      </div>

      <div
        className={[
          "mt-2 break-all text-sm font-semibold text-foreground/90",
          mono ? "font-mono" : "",
        ].join(" ")}
        title={value}
      >
        {value || "—"}
      </div>
    </div>
  );
}

function receiptIdFromResult(result: ExecutePaidActionResult): string | null {
  const receipt = result.receipt;

  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return null;
  }

  const id = (receipt as Record<string, unknown>).id;

  if (typeof id !== "string") return null;

  return id.trim() || null;
}

function PaymentStepRail({ status }: Readonly<{ status: Status }>) {
  const quoteDone =
    status === "quoted" ||
    status === "paying" ||
    status === "executing" ||
    status === "completed";
  const paymentDone = status === "executing" || status === "completed";
  const exportDone = status === "completed";

  const steps = [
    { label: "Quote", done: quoteDone },
    { label: "Pay", done: paymentDone },
    { label: "Verify", done: exportDone },
    { label: "Export", done: exportDone },
  ];

  return (
    <div className="mt-5 grid gap-2 sm:grid-cols-4">
      {steps.map((step, index) => (
        <div
          key={step.label}
          className={[
            "rounded-xl border px-3 py-2 text-center text-xs font-semibold",
            step.done
              ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100"
              : "border-border/60 bg-background/25 text-muted-foreground",
          ].join(" ")}
        >
          {index + 1}. {step.label}
        </div>
      ))}
    </div>
  );
}

export function ProofExportPaymentPanel({
  subjectType,
  subjectId,
  wallet = createUnavailableWalletAdapter(),
  onCompleted,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [quote, setQuote] = useState<ProofExportQuote | null>(null);
  const [paymentTransactionId, setPaymentTransactionId] = useState("");
  const [payerAccountId, setPayerAccountId] = useState("");
  const [result, setResult] = useState<ExecutePaidActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = quote?.payment_requirements.selected ?? null;
  const busy = status === "quoting" || status === "paying" || status === "executing";

  const expiresAt = useMemo(() => {
    if (!selected?.expires_at) return null;
    return new Date(selected.expires_at).toLocaleString();
  }, [selected?.expires_at]);

  async function handleCreateQuote() {
    setError(null);
    setStatus("quoting");

    try {
      const nextQuote = await createProofExportQuote({
        subjectType,
        subjectId,
        idempotencyKey: `proof-export:${subjectType}:${subjectId}:${uuidv4()}`,
      });

      setQuote(nextQuote);
      setPaymentTransactionId("");
      setPayerAccountId("");
      setResult(null);
      setStatus("quoted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "QUOTE_FAILED");
      setStatus("failed");
    }
  }

  async function handleWalletPay() {
    if (!selected) return;

    setError(null);
    setStatus("paying");

    try {
      const connection = await wallet.connect();
      const payment = await wallet.pay(selected);

      setPaymentTransactionId(payment.transactionId);
      setPayerAccountId(payment.payerAccountId ?? connection.accountId ?? "");
      setStatus("quoted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "WALLET_PAYMENT_FAILED");
      setStatus("quoted");
    }
  }

  async function handleExecute() {
    if (!quote) return;

    const txId = paymentTransactionId.trim();

    if (!txId) {
      setError("Payment transaction ID is required.");
      return;
    }

    setError(null);
    setStatus("executing");

    try {
      let completed: ExecutePaidActionResult | null = null;
      const delaysMs = [0, 1_500, 3_000, 6_000, 10_000];

      for (const delayMs of delaysMs) {
        if (delayMs > 0) {
          await sleep(delayMs);
        }

        try {
          completed = await executePaidAction({
            actionId: quote.action_id,
            paymentTransactionId: txId,
            payerAccountId: payerAccountId.trim() || null,
          });
          break;
        } catch (err) {
          if (!isMirrorPendingError(err) || delayMs === delaysMs.at(-1)) {
            throw err;
          }
        }
      }

      if (!completed) {
        throw new Error("EXECUTION_FAILED");
      }

      setResult(completed);
      setStatus("completed");
      onCompleted?.(completed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "EXECUTION_FAILED");
      setStatus("quoted");
    }
  }

  return (
    <GlassCard tone="glass" className="overflow-hidden border-cyan-500/20 p-0">
      <div className="grid gap-0 xl:grid-cols-[0.92fr_1.08fr]">
        <div className="border-b border-border/60 bg-background/20 p-5 md:p-6 xl:border-b-0 xl:border-r">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-3">
              <ReceiptText className="h-5 w-5 text-cyan-100" />
            </div>

            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100">
                Agent payment flow
              </div>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-foreground">
                Generate proof bundle
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                This paid action generates a deterministic proof bundle. The export
                is not created until the HBAR transaction is verified on Hedera
                Mirror Node.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Badge variant={status === "completed" ? "success" : "info"}>
              {statusLabel(status)}
            </Badge>
            <Badge variant="outline">{subjectType}</Badge>
            <Badge variant="outline">x402-style exact payment</Badge>
          </div>

          <PaymentStepRail status={status} />

          <div className="mt-5 rounded-2xl border border-border/60 bg-muted/10 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Subject
            </div>
            <div className="mt-2 break-all font-mono text-xs leading-5 text-foreground/85">
              {subjectId}
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            {!quote ? (
              <Button
                type="button"
                variant="brand"
                size="lg"
                disabled={status === "quoting"}
                onClick={handleCreateQuote}
                className="w-full justify-center shadow-[0_0_30px_rgba(34,211,238,0.18)]"
              >
                {status === "quoting" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                {status === "quoting" ? "Creating quote..." : "Generate quote"}
              </Button>
            ) : null}

            {selected && wallet.isAvailable() ? (
              <Button
                type="button"
                variant="brand"
                size="lg"
                disabled={status === "paying" || status === "executing"}
                onClick={handleWalletPay}
                className="w-full justify-center shadow-[0_0_30px_rgba(34,211,238,0.18)]"
              >
                {status === "paying" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <WalletCards className="h-4 w-4" />
                )}
                {status === "paying" ? "Waiting for wallet..." : "Pay with wallet"}
              </Button>
            ) : null}

            {selected ? (
              <Button
                type="button"
                variant="brandOutline"
                size="lg"
                disabled={status === "executing"}
                onClick={handleExecute}
                className="w-full justify-center"
              >
                {status === "executing" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileCheck2 className="h-4 w-4" />
                )}
                {status === "executing"
                  ? "Checking Mirror Node..."
                  : "Verify payment and generate bundle"}
              </Button>
            ) : null}
          </div>

          {error ? (
            <div
              role="alert"
              className="mt-5 rounded-2xl border border-destructive/50 bg-destructive/10 p-4"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-red-200" />
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Payment/export failed
                  </div>
                  <div className="mt-1 break-all text-sm text-muted-foreground">
                    {error}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="p-5 md:p-6">
          {selected ? (
            <div className="space-y-5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Payment requirement
                </div>
                <div className="mt-2 text-lg font-semibold text-foreground">
                  Exact HBAR transfer
                </div>
                <div className="mt-1 text-sm leading-6 text-muted-foreground">
                  Pay the exact requirement below. The memo must match exactly.
                  The backend verifies recipient, amount, payer, memo, network,
                  and transaction status before execution.
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <FieldRow label="Network" value={selected.network} />
                <FieldRow label="Amount" value={`${selected.amount} ${selected.asset}`} />
                <FieldRow label="Recipient" value={selected.pay_to} mono copyable />
                <FieldRow label="Expires" value={expiresAt ?? selected.expires_at} />
              </div>

              <FieldRow label="Memo" value={selected.memo} mono copyable />

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Payment transaction ID
                  </div>
                  <input
                    value={paymentTransactionId}
                    onChange={(event) => setPaymentTransactionId(event.target.value)}
                    placeholder="0.0.xxxxx@seconds.nanos"
                    className="h-11 w-full rounded-xl border border-border/70 bg-background/35 px-3 font-mono text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/70"
                  />
                </label>

                <label className="block">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Payer account ID
                  </div>
                  <input
                    value={payerAccountId}
                    onChange={(event) => setPayerAccountId(event.target.value)}
                    placeholder="0.0.xxxxx"
                    className="h-11 w-full rounded-xl border border-border/70 bg-background/35 px-3 font-mono text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/70"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[28rem] items-center justify-center rounded-3xl border border-border/60 bg-background/20 p-8 text-center">
              <div className="max-w-md">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10">
                  <WalletCards className="h-6 w-6 text-cyan-100" />
                </div>
                <div className="mt-4 text-lg font-semibold text-foreground">
                  Create a quote to begin
                </div>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">
                  The agent will return an exact Hedera payment requirement before
                  any wallet interaction begins.
                </div>
              </div>
            </div>
          )}

          {result ? (
            <div className="mt-6 rounded-3xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-200" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-lg font-black tracking-tight text-emerald-100">
                    Proof export complete
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="success">Payment verified on Mirror Node</Badge>
                    <Badge variant="outline">Deterministic proof bundle</Badge>
                  </div>

                  <div className="mt-1 text-sm leading-6 text-muted-foreground">
                    Payment verified. Deterministic proof bundle generated.
                  </div>

                  <div className="mt-4 grid gap-3">
                    <FieldRow label="Action" value={result.action_id} mono copyable />
                    <FieldRow
                      label="Payment"
                      value={result.payment_id ?? "none"}
                      mono
                      copyable={Boolean(result.payment_id)}
                    />
                     <FieldRow
                      label="Receipt"
                      value={receiptIdFromResult(result) ?? "not available"}
                      mono
                      copyable={Boolean(receiptIdFromResult(result))}
                    />
                    <FieldRow
                      label="Proof bundle hash"
                      value={result.proof_bundle_hash}
                      mono
                      copyable
                    />
                    <FieldRow
                      label="Proof card hash"
                      value={result.proof_card_hash ?? "not available"}
                      mono
                      copyable={Boolean(result.proof_card_hash)}
                    />
                  </div>

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <Button asChild variant="success" size="sm">
                      <a href={result.verify_url} target="_blank" rel="noreferrer">
                        Open public verification
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>

                    <Button
                      type="button"
                      variant="brandOutline"
                      size="sm"
                      onClick={() => void copyText(result.proof_bundle_hash)}
                    >
                      <Fingerprint className="h-3.5 w-3.5" />
                      Copy bundle hash
                    </Button>
                  </div>

                  <div className="mt-4 rounded-2xl border border-border/60 bg-background/25 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Bundle preview
                    </div>
                    <div className="mt-2 font-mono text-xs leading-5 text-foreground/80">
                      {shortMiddle(result.proof_bundle_hash, 28, 18)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {busy ? (
            <div className="mt-6 rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.05] p-4">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-cyan-100" />
                Working through the payment/export flow. Keep this tab open.
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </GlassCard>
  );
}