// apps/agent-api/src/explorer/explorerAgentRuntimeLimits.ts

export type ExplorerAgentRuntimeLimits = Readonly<{
  maxRetrievalSteps: number;
  maxSearchSteps: number;
  perStepTimeoutMs: number;
  totalTimeoutMs: number;
  allowLocalDemoFallback: boolean;
}>;

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function envInt(name: string, fallback: number, input: {
  min: number;
  max: number;
}): number {
  const raw = cleanString(process.env[name]);

  if (!raw) return fallback;

  const n = Number(raw);

  if (!Number.isFinite(n)) return fallback;

  return Math.max(input.min, Math.min(input.max, Math.trunc(n)));
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = cleanString(process.env[name]).toLowerCase();

  if (!raw) return fallback;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;

  return fallback;
}

export function getExplorerAgentRuntimeLimits(): ExplorerAgentRuntimeLimits {
  const productionDefault = process.env.NODE_ENV === "production";

  return Object.freeze({
    maxRetrievalSteps: envInt("EXPLORER_AGENT_MAX_RETRIEVAL_STEPS", 8, {
      min: 1,
      max: 16,
    }),
    maxSearchSteps: envInt("EXPLORER_AGENT_MAX_SEARCH_STEPS", 6, {
      min: 1,
      max: 12,
    }),
    perStepTimeoutMs: envInt("EXPLORER_AGENT_STEP_TIMEOUT_MS", 3500, {
      min: 250,
      max: 15000,
    }),
    totalTimeoutMs: envInt("EXPLORER_AGENT_TOTAL_TIMEOUT_MS", 10000, {
      min: 1000,
      max: 30000,
    }),
    allowLocalDemoFallback: envBool(
      "EXPLORER_AGENT_ALLOW_LOCAL_DEMO_FALLBACK",
      !productionDefault,
    ),
  });
}