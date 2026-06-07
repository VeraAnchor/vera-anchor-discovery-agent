import { useState } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ExternalLink,
  Fingerprint,
  LockKeyhole,
  MessageSquareCode,
  ShieldCheck,
  WalletCards,
  Waypoints,
} from "lucide-react";

import {
  buildVeraSubjectHref,
  type AgentSubjectType,
  type ExplorerAgentQueryResult,
} from "@/api/explorerAgent";
import { AgentQueryPanel } from "@/components/AgentQueryPanel";
import { ProofExportPaymentPanel } from "@/components/ProofExportPaymentPanel";
import { ProofChainInspector } from "@/components/ProofChainInspector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import GlassCard from "@/components/ui/glass-card";
import PageContainer from "@/components/ui/page-container";
import { createHashPackWalletConnectAdapter } from "@/wallet/hashpackWalletConnectAdapter";

const wallet = createHashPackWalletConnectAdapter();

const DEFAULT_SUBJECT = {
  subjectType: "cipher_result" as AgentSubjectType,
  subjectId: "e2c6f0a0-0359-5093-8551-2d76a5463dc0",
};

function shortMiddle(value: unknown, head = 26, tail = 18): string {
  const s = String(value ?? "").trim();

  if (!s) return "not selected";
  if (s.length <= head + tail + 3) return s;

  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function TrustTile({
  icon: Icon,
  label,
  value,
}: Readonly<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}>) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/25 px-4 py-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function DemoStep({
  n,
  title,
  body,
}: Readonly<{
  n: string;
  title: string;
  body: string;
}>) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/25 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-cyan-400/35 bg-cyan-500/10 text-xs font-black text-cyan-100">
          {n}
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-sm leading-6 text-muted-foreground">
            {body}
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [selectedSubject, setSelectedSubject] = useState(DEFAULT_SUBJECT);
  const [lastAgentResult, setLastAgentResult] = useState<ExplorerAgentQueryResult | null>(null);
  const [hasUserSelectedSubject, setHasUserSelectedSubject] = useState(false);
  function handleSelectSubject(subject: typeof DEFAULT_SUBJECT) {
    setSelectedSubject(subject);
    setHasUserSelectedSubject(true);
  }

  const verifierHref = buildVeraSubjectHref({
    subjectType: selectedSubject.subjectType,
    subjectId: selectedSubject.subjectId,
  });

  return (
    <PageContainer maxWidth="7xl" backdropOpacity={0.42}>
      <header className="flex flex-col gap-4 rounded-3xl border border-border/60 bg-card/30 p-4 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-500/10">
            <span className="absolute h-7 w-7 rounded-full bg-cyan-400/20 blur-md" />
            <Bot className="relative h-5 w-5 text-cyan-100" />
          </div>

          <div>
            <div className="text-sm font-black tracking-tight text-foreground">
              Vera Discovery Agent
            </div>
            <div className="text-xs text-muted-foreground">
              Query, verify, and export proof bundles
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">Hedera testnet</Badge>
          <Badge variant="success">Mirror verified</Badge>
          <Badge variant="outline">HashPack WalletConnect</Badge>
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1.02fr_0.98fr] lg:items-start">
        <div className="space-y-6">
          <GlassCard
            tone="glass"
            className="relative overflow-hidden border-cyan-500/20 p-6 md:p-8"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.14),transparent_40%)]" />

            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                <ShieldCheck className="h-3.5 w-3.5" />
                Interactive proof agent
              </div>

              <h1 className="mt-5 max-w-3xl text-balance text-4xl font-black tracking-tight text-foreground md:text-6xl">
                Search evidence, explain proof chains, and export reviewer-ready
                bundles.
              </h1>

              <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
                Use the free agent to inspect public CIPHER, SAGE, dataset, and HCS
                records. Pay with external HBAR only when you want a deterministic
                proof export.
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button
                  asChild
                  variant="brand"
                  size="lg"
                  className="justify-center shadow-[0_0_34px_rgba(34,211,238,0.20)]"
                >
                  <a href="#agent-query">
                    Ask the agent
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </Button>

                <Button
                  asChild
                  variant="brandOutline"
                  size="lg"
                  className="justify-center"
                >
                  <a href={verifierHref} target="_blank" rel="noreferrer">
                    Open selected verifier
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>

              <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <TrustTile icon={WalletCards} label="Payment" value="0.25 HBAR" />
                <TrustTile
                  icon={MessageSquareCode}
                  label="Agent"
                  value="Search + verify"
                />
                <TrustTile
                  icon={Fingerprint}
                  label="Export"
                  value="SHA3-512 bundle"
                />
                <TrustTile
                  icon={Waypoints}
                  label="Evidence"
                  value={selectedSubject.subjectType}
                />
              </div>
            </div>
          </GlassCard>
        </div>

        <GlassCard tone="glass" className="border-border/70 p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Product loop
          </div>

          <div className="mt-3 text-xl font-black tracking-tight text-foreground">
            Free inspection, paid export.
          </div>

          <div className="mt-3 space-y-3">
            {[
              {
                icon: MessageSquareCode,
                title: "Ask or search",
                body: "Find CIPHER results, SAGE results, datasets, HCS references, or proof-card records.",
              },
              {
                icon: Waypoints,
                title: "Select evidence",
                body: "Choose a normalized public evidence record from the agent response.",
              },
              {
                icon: WalletCards,
                title: "Pay only for export",
                body: "Wallet payment is required only when generating the durable proof bundle.",
              },
              {
                icon: LockKeyhole,
                title: "No private keys",
                body: "Wallet signing remains external. The agent backend never accepts private keys.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-2xl border border-border/60 bg-background/25 p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-xl border border-border/60 bg-muted/20 p-2">
                    <Icon className="h-4 w-4 text-foreground/80" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground/90">
                      {title}
                    </div>
                    <div className="mt-1 text-sm leading-6 text-muted-foreground">
                      {body}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </section>

      <section className="grid gap-6">
        <GlassCard tone="subtle" className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            How this paid agent works
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <DemoStep
              n="01"
              title="Search public evidence"
              body="Ask a plain-language question or run the demo path. The agent returns normalized evidence cards."
            />
            <DemoStep
              n="02"
              title="Verify the proof chain"
              body="The agent explains the selected evidence and verifies HCS receipt metadata."
            />
            <DemoStep
              n="03"
              title="Pay to export"
              body="HashPack HBAR payment triggers the proof-bundle export after Mirror verification."
            />
          </div>
        </GlassCard>

        <GlassCard tone="subtle" className="p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-200" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">
                Selected export target
              </div>
              <div
                className="mt-1 break-all font-mono text-xs leading-5 text-muted-foreground"
                title={`${selectedSubject.subjectType}:${selectedSubject.subjectId}`}
              >
                {hasUserSelectedSubject
                  ? `${selectedSubject.subjectType}:${shortMiddle(selectedSubject.subjectId)}`
                  : "No evidence selected yet. Run a search or demo path."}
              </div>
            </div>
          </div>
        </GlassCard>
      </section>

      <section id="agent-query">
        <AgentQueryPanel
          selected={selectedSubject}
          onSelectSubject={handleSelectSubject}
          onResult={setLastAgentResult}
        />
      </section>

      <section id="proof-chain">
        <ProofChainInspector
          selected={selectedSubject}
          result={lastAgentResult}
        />
      </section>

      <section id="proof-export">
        <ProofExportPaymentPanel
          key={`${selectedSubject.subjectType}:${selectedSubject.subjectId}`}
          subjectType={selectedSubject.subjectType}
          subjectId={selectedSubject.subjectId}
          wallet={wallet}
        />
      </section>
    </PageContainer>
  );
}

export default App;