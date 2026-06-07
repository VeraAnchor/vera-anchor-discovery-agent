import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  ExternalLink,
  Fingerprint,
  Loader2,
  SearchCheck,
  ShieldCheck,
  Waypoints,
} from "lucide-react";

import {
  buildVeraEvidenceHref,
  queryExplorerAgent,
  subjectFromAgentSource,
  subjectFromEvidenceItem,
  type AgentSubjectType,
  type ExplorerAgentEvidenceItem,
  type ExplorerAgentMode,
  type ExplorerAgentQueryResult,
  type ExplorerAgentSource,
  type ExplorerAgentSort,
  type ExplorerAgentTimeWindow,
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
  onSelectSubject: (subject: SelectedSubject) => void;
  onResult?: (result: ExplorerAgentQueryResult) => void;
}>;

type ExampleQuery = Readonly<{
  label: string;
  question: string;
  mode: ExplorerAgentMode;
  sort?: ExplorerAgentSort;
  timeWindow?: ExplorerAgentTimeWindow;
  datasetKey?: string;
  verifiedOnly?: boolean;
  anchoredOnly?: boolean;
}>;

const DEMO_SUBJECT: SelectedSubject = {
  subjectType: "cipher_result",
  subjectId: "e2c6f0a0-0359-5093-8551-2d76a5463dc0",
};

const EXAMPLES: readonly ExampleQuery[] = [
  {
    label: "Latest CIPHER",
    question: "Find latest CIPHER results",
    mode: "search",
    sort: "latest",
  },
  {
    label: "Today's SAGE",
    question: "Find today's SAGE results",
    mode: "search",
    timeWindow: "today",
  },
  {
    label: "Anchored datasets",
    question: "Find anchored datasets for human cerebellum",
    mode: "search",
    anchoredOnly: true,
  },
  {
    label: "Mirror verified CIPHER",
    question: "Find mirror verified CIPHER results",
    mode: "search",
    verifiedOnly: true,
  },
  {
    label: "Top scored CIPHER",
    question: "Find highest scoring CIPHER results",
    mode: "search",
    sort: "highest_score",
  },
  {
    
    label: "Search glioblastoma evidence",
    question: "Find evidence for glioblastoma",
    mode: "search",
  },
  {
    label: "Find SAGE results for human cerebellum",
    question: "Find SAGE results for human cerebellum",
    mode: "search",
  },
  {
    label: "Explain selected",
    question: "Explain this proof record",
    mode: "explain_selected",
  },
  {
    label: "What can you do?",
    question: "What can you do?",
    mode: "capabilities",
  },
];

function sourceTitle(source: ExplorerAgentSource): string {
  const label = String(source.label ?? "").trim();
  if (label) return label;
  return source.ref;
}

function sourceBadge(source: ExplorerAgentSource): string {
  const subject = subjectFromAgentSource(source);
  return subject?.subjectType ?? source.kind;
}

function modeLabel(mode: ExplorerAgentMode): string {
  switch (mode) {
    case "search":
      return "Search evidence";
    case "explain_selected":
      return "Explain selected";
    case "verify_hcs":
      return "Verify HCS";
    case "capabilities":
      return "Capabilities";
  }
}

function shortMiddle(value: unknown, head = 18, tail = 12): string {
  const s = String(value ?? "").trim();

  if (!s) return "none";
  if (s.length <= head + tail + 3) return s;

  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function evidenceHref(item: ExplorerAgentEvidenceItem): string | null {
  return buildVeraEvidenceHref(item);
}

function EvidenceItemCard({
  item,
  selected,
  onSelect,
}: Readonly<{
  item: ExplorerAgentEvidenceItem;
  selected: boolean;
  onSelect: () => void;
}>) {
  const href = evidenceHref(item);

  return (
    <div
      className={[
        "rounded-2xl border p-4 transition",
        selected
          ? "border-emerald-500/35 bg-emerald-500/10"
          : "border-border/60 bg-background/25 hover:bg-muted/15",
      ].join(" ")}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={selected ? "success" : "outline"}>
              {item.subject_type}
            </Badge>
            <Badge variant="outline">{item.network}</Badge>
            {item.hcs_transaction_id ? (
              <Badge variant="success">HCS anchor</Badge>
            ) : (
              <Badge variant="muted">No HCS tx</Badge>
            )}
            {selected ? <Badge variant="success">selected</Badge> : null}
          </div>

          <div className="mt-3 text-base font-black tracking-tight text-foreground">
            {item.title}
          </div>

          <div className="mt-2 text-sm leading-6 text-muted-foreground">
            {item.summary}
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-background/25 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Subject ID
              </div>
              <div className="mt-1 break-all font-mono text-xs text-foreground/80">
                {shortMiddle(item.subject_id, 22, 14)}
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/25 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                HCS transaction
              </div>
              <div className="mt-1 break-all font-mono text-xs text-foreground/80">
                {shortMiddle(item.hcs_transaction_id, 22, 14)}
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/25 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                HCS topic
              </div>
              <div className="mt-1 break-all font-mono text-xs text-foreground/80">
                {item.hcs_topic_id ?? "none"}
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/25 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Proof card
              </div>
              <div className="mt-1 break-all font-mono text-xs text-foreground/80">
                {item.proof_card_url ? "available" : "none"}
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {href ? (
            <Button asChild variant="brandOutline" size="sm">
              <a href={href} target="_blank" rel="noreferrer">
                Open
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          ) : null}

          <Button
            type="button"
            variant={selected ? "success" : "brand"}
            size="sm"
            onClick={onSelect}
          >
            Use for export
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AgentQueryPanel({ 
  selected,
  onSelectSubject,
  onResult, 
}: Props) {
  const [mode, setMode] = useState<ExplorerAgentMode>("search");
  const [question, setQuestion] = useState("Find evidence for glioblastoma");
  const [subjectType, setSubjectType] = useState<AgentSubjectType>(
    selected.subjectType,
  );
  const [subjectId, setSubjectId] = useState(selected.subjectId);
  const [hcsTransactionId, setHcsTransactionId] = useState("");
  const [hcsTopicId, setHcsTopicId] = useState("");
  const [sort, setSort] = useState<ExplorerAgentSort>("relevance");
  const [timeWindow, setTimeWindow] =
    useState<ExplorerAgentTimeWindow>("any");
  const [datasetKey, setDatasetKey] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [anchoredOnly, setAnchoredOnly] = useState(false);
  const [result, setResult] = useState<ExplorerAgentQueryResult | null>(null);
  const [status, setStatus] = useState<"idle" | "querying" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  const selectableEvidenceItems = useMemo(() => {
    return (result?.evidence_items ?? []).map((item) => ({
      item,
      subject: subjectFromEvidenceItem(item),
    }));
  }, [result?.evidence_items]);

  const selectableSources = useMemo(() => {
    return (result?.sources ?? [])
      .map((source) => ({
        source,
        subject: subjectFromAgentSource(source),
      }))
      .filter(
        (item): item is { source: ExplorerAgentSource; subject: SelectedSubject } =>
          Boolean(item.subject),
      );
  }, [result?.sources]);

  function buildRequest(input: {
    question: string;
    mode: ExplorerAgentMode;
    subjectType: AgentSubjectType;
    subjectId: string;
    hcsTransactionId: string;
    hcsTopicId: string;
    sort: ExplorerAgentSort;
    timeWindow: ExplorerAgentTimeWindow;
    datasetKey: string;
    verifiedOnly: boolean;
    anchoredOnly: boolean;
  }) {
    const queryModifiers = {
      sort: input.sort,
      timeWindow: input.timeWindow,
      datasetKey: input.datasetKey.trim() || null,
      verifiedOnly: input.verifiedOnly,
      anchoredOnly: input.anchoredOnly,
    };

    if (input.mode === "search") {
      return {
        question: input.question,
        mode: input.mode,
        subjectType: null,
        subjectId: null,
        hcsTransactionId: null,
        hcsTopicId: null,
        limit: 8,
        ...queryModifiers,
      };
    }

    if (input.mode === "explain_selected") {
      return {
        question: input.question,
        mode: input.mode,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        hcsTransactionId: null,
        hcsTopicId: null,
        limit: 8,
        ...queryModifiers,
      };
    }

    if (input.mode === "verify_hcs") {
      return {
        question: input.question,
        mode: input.mode,
        subjectType: null,
        subjectId: null,
        hcsTransactionId: input.hcsTransactionId.trim() || input.subjectId,
        hcsTopicId: input.hcsTopicId.trim() || null,
        limit: 8,
        ...queryModifiers,
      };
    }

    return {
      question: input.question,
      mode: input.mode,
      subjectType: null,
      subjectId: null,
      hcsTransactionId: null,
      hcsTopicId: null,
      limit: 8,
      ...queryModifiers,
    };
  }

  async function runQuery(
    nextQuestion = question,
    nextMode = mode,
    nextSubjectType = subjectType,
    nextSubjectId = subjectId,
    modifiers: {
      sort: ExplorerAgentSort;
      timeWindow: ExplorerAgentTimeWindow;
      datasetKey: string;
      verifiedOnly: boolean;
      anchoredOnly: boolean;
    } = {
      sort,
      timeWindow,
      datasetKey,
      verifiedOnly,
      anchoredOnly,
    },
  ) {
    const q = nextQuestion.trim();

    if (!q) {
      setError("Question is required.");
      return;
    }

    setError(null);
    setStatus("querying");

    try {
      const completed = await queryExplorerAgent(
        buildRequest({
          question: q,
          mode: nextMode,
          subjectType: nextSubjectType,
          subjectId: nextSubjectId,
          hcsTransactionId,
          hcsTopicId,
          sort: modifiers.sort,
          timeWindow: modifiers.timeWindow,
          datasetKey: modifiers.datasetKey,
          verifiedOnly: modifiers.verifiedOnly,
          anchoredOnly: modifiers.anchoredOnly,
        }),
      );

      setResult(completed);
      onResult?.(completed);
      setStatus("idle");

      const firstEvidenceSubject = completed.evidence_items
        .map(subjectFromEvidenceItem)
        .find(Boolean);

      const firstSourceSubject = completed.sources
        .map(subjectFromAgentSource)
        .find(Boolean);

      const firstSubject = firstEvidenceSubject ?? firstSourceSubject;

      if (firstSubject) {
        useSource(firstSubject);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "AGENT_QUERY_FAILED");
      setStatus("failed");
    }
  }

  function useSource(subject: SelectedSubject) {
    onSelectSubject(subject);
    setSubjectType(subject.subjectType);
    setSubjectId(subject.subjectId);

    if (subject.subjectType === "hcs_transaction") {
      setHcsTransactionId(subject.subjectId);
    }
  }

  function applyExample(example: ExampleQuery) {
    setQuestion(example.question);
    setMode(example.mode);
    setSort(example.sort ?? "relevance");
    setTimeWindow(example.timeWindow ?? "any");
    setDatasetKey(example.datasetKey ?? "");
    setVerifiedOnly(Boolean(example.verifiedOnly));
    setAnchoredOnly(Boolean(example.anchoredOnly));

    void runQuery(
      example.question,
      example.mode,
      subjectType,
      subjectId,
      {
        sort: example.sort ?? "relevance",
        timeWindow: example.timeWindow ?? "any",
        datasetKey: example.datasetKey ?? "",
        verifiedOnly: Boolean(example.verifiedOnly),
        anchoredOnly: Boolean(example.anchoredOnly),
      },
    );
  }

  function runGoldenPath() {
    const q = "Explain this proof record";

    setMode("explain_selected");
    setQuestion(q);
    setSubjectType(DEMO_SUBJECT.subjectType);
    setSubjectId(DEMO_SUBJECT.subjectId);
    useSource(DEMO_SUBJECT);

    void runQuery(
      q,
      "explain_selected",
      DEMO_SUBJECT.subjectType,
      DEMO_SUBJECT.subjectId,
    );
  }

  return (
    <GlassCard tone="glass" className="overflow-hidden border-cyan-500/20 p-0">
      <div className="grid gap-0 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="border-b border-border/60 bg-background/20 p-5 lg:border-b-0 lg:border-r">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-3">
              <Bot className="h-5 w-5 text-cyan-100" />
            </div>

            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-cyan-100">
                Interactive explorer agent
              </div>
              <div className="mt-2 text-2xl font-black tracking-tight text-foreground">
                Ask, search, preview, then export.
              </div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                Use the free agent path to find CIPHER results, SAGE results,
                datasets, proof cards, or HCS transactions before creating a paid export.
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.06] p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 p-2">
                <Fingerprint className="h-4 w-4 text-cyan-100" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Judge-friendly demo path
                </div>
                <div className="mt-1 text-sm leading-6 text-muted-foreground">
                  Runs the known CIPHER proof-chain explanation so the HCS verification
                  and paid export path are immediately visible.
                </div>
              </div>
            </div>

            <Button
              type="button"
              variant="brandOutline"
              size="sm"
              onClick={runGoldenPath}
              className="justify-center"
            >
              Run demo path
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Agent mode
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(["search", "explain_selected", "verify_hcs", "capabilities"] as const).map(
                  (item) => {
                    const active = mode === item;

                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setMode(item)}
                        className={[
                          "rounded-2xl border px-3 py-2 text-left text-xs font-semibold transition",
                          active
                            ? "border-cyan-400/45 bg-cyan-500/15 text-cyan-50"
                            : "border-border/60 bg-background/25 text-foreground/80 hover:bg-muted/20",
                        ].join(" ")}
                      >
                        {modeLabel(item)}
                      </button>
                    );
                  },
                )}
              </div>
            </div>

            <label className="block">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Question
              </div>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={5}
                className="w-full resize-y rounded-2xl border border-border/70 bg-background/35 px-3 py-3 text-sm leading-6 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/70"
                placeholder="Ask about CIPHER, SAGE, datasets, proof chains, or HCS transactions..."
              />
            </label>

            <div className="grid gap-3 md:grid-cols-[0.7fr_1.3fr]">
              <label className="block">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Subject type
                </div>
                <select
                  value={subjectType}
                  onChange={(event) =>
                    setSubjectType(event.target.value as AgentSubjectType)
                  }
                  disabled={mode === "search" || mode === "capabilities" || mode === "verify_hcs"}
                  className="h-11 w-full rounded-xl border border-border/70 bg-background/35 px-3 text-sm text-foreground outline-none focus:border-primary/70 disabled:opacity-60"
                >
                  <option value="cipher_result">cipher_result</option>
                  <option value="sage_result">sage_result</option>
                  <option value="dataset">dataset</option>
                  <option value="hcs_transaction">hcs_transaction</option>
                  <option value="proof_card">proof_card</option>
                </select>
              </label>

              <label className="block">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Subject ID
                </div>
                <input
                  value={subjectId}
                  onChange={(event) => setSubjectId(event.target.value)}
                  disabled={mode === "search" || mode === "capabilities"}
                  className="h-11 w-full rounded-xl border border-border/70 bg-background/35 px-3 font-mono text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/70 disabled:opacity-60"
                  placeholder="Evidence record ID"
                />
              </label>
            </div>

            {mode === "search" ? (
              <div className="rounded-2xl border border-border/60 bg-background/25 p-3 text-xs leading-5 text-muted-foreground">
                Search mode is open-ended. The agent infers CIPHER, SAGE,
                dataset, HCS, or broad evidence search from the question. Domain
                terms such as brain, glioblastoma, cerebellum, spatial, donor IDs,
                dataset keys, and disease names remain dynamic search terms.
              </div>
            ) : null}

            {mode === "verify_hcs" ? (
              <div className="grid gap-3 md:grid-cols-[1.3fr_0.7fr]">
                <label className="block">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    HCS transaction ID
                  </div>
                  <input
                    value={hcsTransactionId}
                    onChange={(event) => setHcsTransactionId(event.target.value)}
                    className="h-11 w-full rounded-xl border border-border/70 bg-background/35 px-3 font-mono text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/70"
                    placeholder="0.0.xxxxx@seconds.nanos"
                  />
                </label>

                <label className="block">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    HCS topic ID
                  </div>
                  <input
                    value={hcsTopicId}
                    onChange={(event) => setHcsTopicId(event.target.value)}
                    className="h-11 w-full rounded-xl border border-border/70 bg-background/35 px-3 font-mono text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary/70"
                    placeholder="0.0.xxxxx"
                  />
                </label>
              </div>
            ) : null}

            <Button
              type="button"
              variant="brand"
              size="lg"
              disabled={status === "querying"}
              onClick={() => void runQuery()}
              className="w-full justify-center shadow-[0_0_30px_rgba(34,211,238,0.18)]"
            >
              {status === "querying" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SearchCheck className="h-4 w-4" />
              )}
              {status === "querying" ? "Querying agent..." : "Run agent query"}
            </Button>

            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  onClick={() => applyExample(example)}
                  className="rounded-full border border-border/70 bg-background/35 px-3 py-1 text-[11px] font-semibold text-foreground/85 transition hover:bg-muted/25"
                >
                  {example.label}
                </button>
              ))}
            </div>

            {error ? (
              <div className="rounded-2xl border border-destructive/50 bg-destructive/10 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-red-200" />
                  <div className="break-all text-sm text-muted-foreground">
                    {error}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-border/60 bg-background/20 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Query modifiers
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
                  Sort
                  <select
                    value={sort}
                    onChange={(event) =>
                      setSort(event.target.value as ExplorerAgentSort)
                    }
                    className="rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-sm text-foreground outline-none transition focus:border-cyan-400/60"
                  >
                    <option value="relevance">Relevance</option>
                    <option value="latest">Latest</option>
                    <option value="highest_score">Highest score</option>
                  </select>
                </label>

                <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
                  Time window
                  <select
                    value={timeWindow}
                    onChange={(event) =>
                      setTimeWindow(event.target.value as ExplorerAgentTimeWindow)
                    }
                    className="rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-sm text-foreground outline-none transition focus:border-cyan-400/60"
                  >
                    <option value="any">Any</option>
                    <option value="today">Today</option>
                    <option value="last_24h">Last 24h</option>
                    <option value="last_7d">Last 7d</option>
                    <option value="last_30d">Last 30d</option>
                  </select>
                </label>
              </div>

              <label className="mt-3 grid gap-1 text-xs font-semibold text-muted-foreground">
                Dataset key
                <input
                  value={datasetKey}
                  onChange={(event) => setDatasetKey(event.target.value)}
                  placeholder="Optional dataset key for score-aware search"
                  className="rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-cyan-400/60"
                />
              </label>

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <label className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/25 px-3 py-2 text-sm font-semibold text-foreground/90">
                  <input
                    type="checkbox"
                    checked={anchoredOnly}
                    onChange={(event) => setAnchoredOnly(event.target.checked)}
                    className="h-4 w-4"
                  />
                  Anchored only
                </label>

                <label className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/25 px-3 py-2 text-sm font-semibold text-foreground/90">
                  <input
                    type="checkbox"
                    checked={verifiedOnly}
                    onChange={(event) => setVerifiedOnly(event.target.checked)}
                    className="h-4 w-4"
                  />
                  Verified only
                </label>
              </div>
            </div>
        </div>

        <div className="p-5">
          {result ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={result.confidence === "high" ? "success" : "info"}>
                  confidence: {result.confidence}
                </Badge>
                <Badge variant="outline">{result.intent}</Badge>
                <Badge variant="outline">{result.sources.length} sources</Badge>
                <Badge variant="outline">
                  {result.evidence_items.length} evidence items
                </Badge>
                <Badge variant="outline">{result.tools.length} tools</Badge>
              </div>

              <div className="rounded-3xl border border-border/60 bg-background/25 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Agent answer
                </div>
                <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground/90">
                  {result.answer}
                </div>
              </div>

              {selectableEvidenceItems.length > 0 ? (
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Waypoints className="h-3.5 w-3.5" />
                    Select evidence for paid export
                  </div>

                  <div className="mt-3 grid gap-3">
                    {selectableEvidenceItems.map(({ item, subject }) => {
                      const selectedNow =
                        selected.subjectType === subject.subjectType &&
                        selected.subjectId === subject.subjectId;

                      return (
                        <EvidenceItemCard
                          key={`${subject.subjectType}:${subject.subjectId}`}
                          item={item}
                          selected={selectedNow}
                          onSelect={() => useSource(subject)}
                        />
                      );
                    })}
                  </div>
                </div>
              ) : selectableSources.length > 0 ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Select evidence for paid export
                  </div>

                  <div className="mt-3 grid gap-3">
                    {selectableSources.map(({ source, subject }) => {
                      const selectedNow =
                        selected.subjectType === subject.subjectType &&
                        selected.subjectId === subject.subjectId;

                      return (
                        <div
                          key={`${subject.subjectType}:${subject.subjectId}`}
                          className={[
                            "rounded-2xl border p-4 transition",
                            selectedNow
                              ? "border-emerald-500/35 bg-emerald-500/10"
                              : "border-border/60 bg-background/25 hover:bg-muted/15",
                          ].join(" ")}
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={selectedNow ? "success" : "outline"}>
                                  {sourceBadge(source)}
                                </Badge>
                                {selectedNow ? (
                                  <Badge variant="success">selected</Badge>
                                ) : null}
                              </div>

                              <div className="mt-2 break-all text-sm font-semibold text-foreground">
                                {sourceTitle(source)}
                              </div>
                              <div className="mt-1 break-all font-mono text-xs leading-5 text-muted-foreground">
                                {subject.subjectId}
                              </div>
                            </div>

                            <div className="flex shrink-0 gap-2">
                              {source.href ? (
                                <Button asChild variant="brandOutline" size="sm">
                                  <a
                                    href={source.href}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                </Button>
                              ) : null}

                              <Button
                                type="button"
                                variant={selectedNow ? "success" : "brand"}
                                size="sm"
                                onClick={() => useSource(subject)}
                              >
                                Use for export
                                <ArrowRight className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {result.warnings.length > 0 ? (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-100" />
                    <div className="space-y-1 text-sm text-muted-foreground">
                      {result.warnings.map((warning) => (
                        <div key={warning}>{warning}</div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border border-border/60 bg-background/25 p-4">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Tools used
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {result.tools.length > 0 ? (
                    result.tools.map((tool) => (
                      <Badge
                        key={`${tool.tool_name}:${tool.audit_id ?? "none"}`}
                        variant={tool.status === "completed" ? "outline" : "warn"}
                      >
                        {tool.tool_name}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      No tool trace returned.
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[32rem] items-center justify-center rounded-3xl border border-border/60 bg-background/20 p-8 text-center">
              <div className="max-w-md">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10">
                  <Bot className="h-6 w-6 text-cyan-100" />
                </div>
                <div className="mt-4 text-lg font-semibold text-foreground">
                  Start with a free agent query
                </div>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">
                  Search records, explain a proof chain, or verify an HCS transaction.
                  Then select a record for paid proof export.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </GlassCard>
  );
}