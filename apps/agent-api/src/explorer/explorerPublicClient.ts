// apps/agent-api/src/explorer/explorerPublicClient.ts

import { config } from "../config.js";

export type ExplorerQueryParams = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

export class ExplorerPublicClientError extends Error {
  readonly status: number;
  readonly upstreamStatus: number | null;

  constructor(
    message: string,
    input: { status: number; upstreamStatus?: number | null },
  ) {
    super(message);
    this.name = "ExplorerPublicClientError";
    this.status = input.status;
    this.upstreamStatus = input.upstreamStatus ?? null;
  }
}

const ALLOWED_PATH_PREFIXES = [
  "/sage/",
  "/cipher/",
  "/datasets",
  "/health",
  "/hcs/",
  "/run-scores/",
] as const;

function assertSafePath(path: string): void {
  if (!path.startsWith("/")) {
    throw new ExplorerPublicClientError("EXPLORER_API_PATH_MUST_BE_ABSOLUTE", {
      status: 500,
    });
  }

  if (path.includes("..") || path.includes("\\") || path.includes("//")) {
    throw new ExplorerPublicClientError("EXPLORER_API_PATH_UNSAFE", {
      status: 500,
    });
  }

  if (
    !ALLOWED_PATH_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(prefix),
    )
  ) {
    throw new ExplorerPublicClientError("EXPLORER_API_PATH_NOT_ALLOWLISTED", {
      status: 500,
    });
  }
}

export function encodePathSegment(value: string): string {
  const s = String(value ?? "").trim();

  if (!s) {
    throw new ExplorerPublicClientError("EXPLORER_API_PATH_SEGMENT_REQUIRED", {
      status: 400,
    });
  }

  if (s.length > 512) {
    throw new ExplorerPublicClientError("EXPLORER_API_PATH_SEGMENT_TOO_LONG", {
      status: 400,
    });
  }

  if (/[\u0000-\u001f\u007f]/.test(s)) {
    throw new ExplorerPublicClientError(
      "EXPLORER_API_PATH_SEGMENT_CONTAINS_CONTROL_CHARACTERS",
      {
        status: 400,
      },
    );
  }

  return encodeURIComponent(s);
}

function buildExplorerUrl(path: string, query?: ExplorerQueryParams): URL {
  assertSafePath(path);

  const base = new URL(config.veraPublicApiBaseUrl);

  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new ExplorerPublicClientError(
      "EXPLORER_API_BASE_URL_PROTOCOL_INVALID",
      {
        status: 500,
      },
    );
  }

  const basePath = base.pathname.replace(/\/+$/g, "");
  base.pathname = `${basePath}${path}`;

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    base.searchParams.set(key, String(value));
  }

  return base;
}

async function readJsonWithCap(response: Response): Promise<unknown> {
  const body = response.body;

  if (!body) {
    return null;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    if (value) {
      total += value.byteLength;

      if (total > config.explorerApiMaxResponseBytes) {
        await reader.cancel();

        throw new ExplorerPublicClientError("EXPLORER_API_RESPONSE_TOO_LARGE", {
          status: 502,
          upstreamStatus: response.status,
        });
      }

      chunks.push(value);
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(merged);

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ExplorerPublicClientError("EXPLORER_API_INVALID_JSON", {
      status: 502,
      upstreamStatus: response.status,
    });
  }
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": config.explorerApiUserAgent,
  };

  if (config.explorerApiKey) {
    headers["x-api-key"] = config.explorerApiKey;
  }

  return headers;
}

export async function getExplorerJson(
  path: string,
  query?: ExplorerQueryParams,
): Promise<unknown | null> {
  if (!config.explorerLiveEvidenceEnabled) {
    return null;
  }

  const url = buildExplorerUrl(path, query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.explorerApiTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: buildHeaders(),
      redirect: "error",
      signal: controller.signal,
    });

    if (response.status === 404) {
      return null;
    }

    if (response.status === 429) {
      throw new ExplorerPublicClientError("EXPLORER_API_RATE_LIMITED", {
        status: 503,
        upstreamStatus: response.status,
      });
    }

    if (!response.ok) {
      throw new ExplorerPublicClientError("EXPLORER_API_REQUEST_FAILED", {
        status: 502,
        upstreamStatus: response.status,
      });
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.toLowerCase().includes("application/json")) {
      throw new ExplorerPublicClientError(
        [
          "EXPLORER_API_UNEXPECTED_CONTENT_TYPE",
          `upstream_status=${response.status}`,
          `content_type=${contentType || "none"}`,
          `url=${url.origin}${url.pathname}`,
        ].join(":"),
        {
          status: 502,
          upstreamStatus: response.status,
        },
      );
    }

    return readJsonWithCap(response);
  } catch (err) {
    if (err instanceof ExplorerPublicClientError) {
      throw err;
    }

    if ((err as { name?: string })?.name === "AbortError") {
      throw new ExplorerPublicClientError("EXPLORER_API_TIMEOUT", {
        status: 504,
      });
    }

    throw new ExplorerPublicClientError("EXPLORER_API_UNAVAILABLE", {
      status: 502,
    });
  } finally {
    clearTimeout(timeout);
  }
}