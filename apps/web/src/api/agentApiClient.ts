const DEFAULT_AGENT_API_BASE_URL = import.meta.env.DEV
  ? "http://localhost:5001"
  : "https://agentapi.veraanchor.com";

function cleanAgentApiBaseUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  const base = raw || DEFAULT_AGENT_API_BASE_URL;

  if (!/^https?:\/\//i.test(base)) {
    throw new Error("VITE_AGENT_API_BASE_URL_MUST_BE_ABSOLUTE");
  }

  return base.replace(/\/+$/g, "");
}

export const AGENT_API_BASE_URL = cleanAgentApiBaseUrl(
  import.meta.env.VITE_AGENT_API_BASE_URL,
);

export function agentApiUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error("AGENT_API_PATH_MUST_BE_ABSOLUTE");
  }

  return `${AGENT_API_BASE_URL}${path}`;
}