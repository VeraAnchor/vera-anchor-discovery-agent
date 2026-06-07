import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Fingerprint,
  ShieldCheck,
  Waypoints,
  XCircle,
} from "lucide-react";

import {
  buildVeraSubjectHref,
  type AgentSubjectType,
  type ExplorerAgentEvidenceItem,
  type ExplorerAgentQueryResult,
} from "@/api/explorerAgent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import GlassCard from "@/components/ui/glass-card";

type SelectedSubject = Readonly<{
  subjectType: AgentSubjectType;
  subjectId: string;
}>;

type Props = Readonly<{
  selected: SelectedSubject;
  result: ExplorerAgentQueryResult | null;
}>;

function shortMiddle(value: unknown, head = 22, tail = 14): string {
  const s = String(value ?? "").trim();

  if (!s) return "not available";
  if (s.length <= head + tail + 3) return s;

  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function selectedEvidenceItem(
  result: ExplorerAgentQueryResult | null,
  selected: SelectedSubject,
): ExplorerAgentEvidenceItem | null {
  if (!result) return null;

  return (
    result.evidence_items.find(
      (item) =>
        item.subject_type === selected.subjectType &&
        item.subject_id === selected.subjectId,
    ) ?? null
  );
}

function verifierHref(
  selected: SelectedSubject,
  item: ExplorerAgentEvidenceItem | null,
): string | null {
  return buildVeraSubjectHref({
    subjectType: selected.subjectType,
    subjectId: selected.subjectId,
  });
}

function DetailRow({
  label,
  value,
  mono = false,
}: Readonly<{
  label: string;
  value: string | number | null;
  mono?: boolean;
}>) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/25 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={[
          "mt-1 break-all text-sm font-semibold text-foreground/90",
          mono ? "font-mono text-xs leading-5" : "",
        ].join(" ")}
      >
        {value ?? "not available"}
      </div>
    </div>
  );
}

export function ProofChainInspector({ selected, result }: Props) {
  const item = selectedEvidenceItem(result, selected);
  const verification = result?.verification ?? null;
  const href = verifierHref(selected, item);

  const hcsTransactionId =
    verification?.transaction_id ??
    item?.hcs_transaction_id ??
    (selected.subjectType === "hcs_transaction" ? selected.subjectId : null);

  const hcsTopicId = verification?.topic_id ?? item?.hcs_topic_id ?? null;

  return (
    <GlassCard tone="glass" className="overflow-hidden border-cyan-500/20 p-0">
      <div className="border-b border-border/60 bg-background/20 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-3">
              <Waypoints className="h-5 w-5 text-cyan-100" />
            </div>

            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100">
                Hedera proof chain inspector
              </div>
              <div className="mt-2 text-2xl font-black tracking-tight text-foreground">
                Evidence, HCS receipt, and Mirror metadata.
              </div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                This panel exposes the structured verification data behind the
                agent answer so reviewers can inspect the proof path without
                parsing prose.
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {verification ? (
              <Badge variant={verification.verified ? "success" : "warn"}>
                {verification.verified ? "HCS verified" : "HCS not verified"}
              </Badge>
            ) : (
              <Badge variant="muted">No verification yet</Badge>
            )}

            {verification?.transaction_result ? (
              <Badge
                variant={
                  verification.transaction_result === "SUCCESS"
                    ? "success"
                    : "warn"
                }
              >
                {verification.transaction_result}
              </Badge>
            ) : null}

            <Badge variant="outline">{selected.subjectType}</Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="border-b border-border/60 p-5 xl:border-b-0 xl:border-r">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Fingerprint className="h-3.5 w-3.5" />
            Selected evidence
          </div>

          <div className="mt-4 grid gap-3">
            <DetailRow label="Subject type" value={selected.subjectType} />
            <DetailRow
              label="Subject ID"
              value={shortMiddle(selected.subjectId, 28, 18)}
              mono
            />
            <DetailRow label="Title" value={item?.title ?? "not loaded yet"} />
            <DetailRow
              label="Network"
              value={item?.network ?? "not available"}
            />
            <DetailRow
              label="HCS transaction"
              value={shortMiddle(hcsTransactionId, 28, 18)}
              mono
            />
            <DetailRow label="HCS topic" value={hcsTopicId} mono />
          </div>

          {href ? (
            <Button asChild variant="brandOutline" size="sm" className="mt-4">
              <a href={href} target="_blank" rel="noreferrer">
                Open verifier
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          ) : null}
        </div>

        <div className="p-5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Mirror / HCS receipt metadata
          </div>

          {verification ? (
            <div className="mt-4 grid gap-3">
              <div
                className={[
                  "rounded-2xl border p-4",
                  verification.verified
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : "border-amber-500/30 bg-amber-500/10",
                ].join(" ")}
              >
                <div className="flex items-start gap-3">
                  {verification.verified ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-200" />
                  ) : (
                    <XCircle className="mt-0.5 h-5 w-5 text-amber-100" />
                  )}
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {verification.verified
                        ? "Receipt verification passed"
                        : "Receipt verification did not fully pass"}
                    </div>
                    <div className="mt-1 text-sm leading-6 text-muted-foreground">
                      Verification level: {verification.verification_level}.
                      Encrypted payload content is not decrypted by this agent flow.
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <DetailRow
                  label="Transaction ID"
                  value={shortMiddle(verification.transaction_id, 28, 18)}
                  mono
                />
                <DetailRow
                  label="Topic ID"
                  value={verification.topic_id}
                  mono
                />
                <DetailRow
                  label="Consensus timestamp"
                  value={verification.consensus_timestamp}
                  mono
                />
                <DetailRow
                  label="Sequence number"
                  value={verification.sequence_number}
                />
                <DetailRow
                  label="Payer account"
                  value={verification.payer_account_id}
                  mono
                />
                <DetailRow
                  label="Transaction result"
                  value={verification.transaction_result}
                />
              </div>

              <DetailRow
                label="Running hash"
                value={shortMiddle(verification.running_hash, 34, 24)}
                mono
              />

              {verification.warnings.length > 0 ? (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-100" />
                    <div className="space-y-1 text-sm text-muted-foreground">
                      {verification.warnings.map((warning) => (
                        <div key={warning}>{warning}</div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-border/60 bg-background/25 p-5">
              <div className="text-sm font-semibold text-foreground">
                No structured HCS verification loaded yet.
              </div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                Run “Explain selected” for an evidence record with an HCS
                transaction, or use “Verify HCS” with a transaction ID. The
                inspector will populate from the agent response.
              </div>
            </div>
          )}
        </div>
      </div>
    </GlassCard>
  );
}