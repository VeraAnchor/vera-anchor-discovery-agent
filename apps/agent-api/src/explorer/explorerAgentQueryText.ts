// apps/agent-api/src/explorer/explorerAgentQueryText.ts

export type ExplorerQueryTextOptions = Readonly<{
  stripPatterns?: readonly RegExp[];
  extraStopWords?: ReadonlySet<string>;
}>;

export type ExplorerTextMatchResult = Readonly<{
  matched: boolean;
  matchedCount: number;
  requiredCount: number;
  tokenCount: number;
  matchedTokens: readonly string[];
  missingTokens: readonly string[];
}>;

const BASE_STOP_WORDS = new Set([
  "a",
  "about",
  "above",
  "across",
  "after",
  "again",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "around",
  "as",
  "at",
  "be",
  "been",
  "being",
  "below",
  "between",
  "both",
  "bring",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "for",
  "from",
  "get",
  "give",
  "go",
  "had",
  "has",
  "have",
  "having",
  "help",
  "here",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "kind",
  "let",
  "like",
  "look",
  "lookup",
  "me",
  "more",
  "need",
  "needs",
  "not",
  "of",
  "on",
  "or",
  "please",
  "show",
  "some",
  "something",
  "that",
  "the",
  "their",
  "there",
  "these",
  "this",
  "those",
  "to",
  "try",
  "up",
  "us",
  "want",
  "wants",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "you",
  "your",
]);

const ROUTING_STOP_WORDS = new Set([
  "agent",
  "anchor",
  "anchored",
  "anchors",
  "best",
  "bundle",
  "bundles",
  "card",
  "cards",
  "compute",
  "data",
  "dataset",
  "datasets",
  "details",
  "download",
  "evidence",
  "export",
  "find",
  "hcs",
  "hedera",
  "info",
  "information",
  "latest",
  "mirror",
  "new",
  "newest",
  "only",
  "preview",
  "proof",
  "proofcard",
  "public",
  "ranked",
  "recent",
  "record",
  "records",
  "related",
  "report",
  "result",
  "results",
  "review",
  "run",
  "runs",
  "search",
  "select",
  "strong",
  "strongest",
  "summarize",
  "top",
  "transaction",
  "transactions",
  "trust",
  "trusted",
  "trustworthy",
  "tx",
  "txs",
  "verifiable",
  "verification",
  "verified",
  "verify",
]);

const PRESERVE_IDENTIFIER_RE =
  /^(?:[a-z0-9][a-z0-9._:/-]{2,}|0\.0\.\d+|\d+\.\d+\.\d+@\d+\.\d+)$/i;

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const s = value.trim();
    if (!s || seen.has(s)) continue;

    seen.add(s);
    out.push(s);
  }

  return out;
}

export function normalizeExplorerText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripPatterns(value: string, patterns: readonly RegExp[]): string {
  return patterns.reduce((acc, pattern) => acc.replace(pattern, " "), value);
}

function rawTokens(value: string): string[] {
  return normalizeExplorerText(value)
    .split(/[^a-z0-9@./:-]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function looksLikeNumericIdentifier(token: string): boolean {
  return /^\d+$/.test(token) || /^\d+\.\d+\.\d+$/.test(token);
}

function singularCandidate(token: string): string | null {
  if (token.length < 5) return null;
  if (token.endsWith("ss")) return null;

  if (token.endsWith("ies") && token.length > 5) {
    return `${token.slice(0, -3)}y`;
  }

  if (
    token.endsWith("ches") ||
    token.endsWith("shes") ||
    token.endsWith("xes") ||
    token.endsWith("zes")
  ) {
    return token.slice(0, -2);
  }

  if (token.endsWith("ses") && token.length > 5) {
    return token.slice(0, -2);
  }

  if (token.endsWith("s") && !token.endsWith("us") && !token.endsWith("is")) {
    return token.slice(0, -1);
  }

  return null;
}

function lightStemCandidate(token: string): string | null {
  if (token.length < 7) return null;

  if (token.endsWith("ing") && token.length > 7) {
    return token.slice(0, -3);
  }

  if (token.endsWith("ed") && token.length > 6) {
    return token.slice(0, -2);
  }

  if (token.endsWith("al") && token.length > 7) {
    return token.slice(0, -2);
  }

  return null;
}

function canonicalToken(token: string): string {
  const cleaned = token
    .replace(/^['".:-]+/g, "")
    .replace(/['".:-]+$/g, "")
    .trim();

  if (!cleaned) return "";

  const singular = singularCandidate(cleaned);
  return singular ?? cleaned;
}

export function explorerTokenVariants(tokenRaw: string): string[] {
  const token = canonicalToken(normalizeExplorerText(tokenRaw));

  if (!token) return [];

  const variants = [token];

  const singular = singularCandidate(token);
  if (singular) variants.push(singular);

  const stem = lightStemCandidate(token);
  if (stem) variants.push(stem);

  return unique(variants);
}

export function tokenizeExplorerQuery(
  value: string,
  options: ExplorerQueryTextOptions = {},
): string[] {
  const stripped = stripPatterns(value, options.stripPatterns ?? []);
  const extraStopWords = options.extraStopWords ?? new Set<string>();

  return unique(
    rawTokens(stripped)
      .map(canonicalToken)
      .filter(Boolean)
      .filter((token) => {
        if (PRESERVE_IDENTIFIER_RE.test(token) && token.includes(".")) return true;
        return !looksLikeNumericIdentifier(token);
      })
      .filter((token) => !BASE_STOP_WORDS.has(token))
      .filter((token) => !ROUTING_STOP_WORDS.has(token))
      .filter((token) => !extraStopWords.has(token)),
  );
}

export function compileExplorerSearchText(
  value: string,
  options: ExplorerQueryTextOptions = {},
): string {
  return tokenizeExplorerQuery(value, options).join(" ");
}

export function expandExplorerSearchTexts(
  value: string,
  options: ExplorerQueryTextOptions = {},
): string[] {
  const tokens = tokenizeExplorerQuery(value, options);

  if (tokens.length === 0) {
    return [];
  }

  const canonical = tokens.join(" ");
  const variants = unique(tokens.flatMap((token) => explorerTokenVariants(token)));
  const variantPhrase = variants.join(" ");

  const candidates: string[] = [
    canonical,
    variantPhrase,
  ];

  for (let size = Math.min(3, tokens.length); size >= 2; size -= 1) {
    for (let i = 0; i <= tokens.length - size; i += 1) {
      candidates.push(tokens.slice(i, i + size).join(" "));
    }
  }

  candidates.push(...variants);

  return unique(candidates).slice(0, 8);
}

export function textMatchesExplorerToken(
  haystackRaw: string,
  tokenRaw: string,
): boolean {
  const haystack = normalizeExplorerText(haystackRaw);
  const haystackTokens = rawTokens(haystack).map(canonicalToken);
  const variants = explorerTokenVariants(tokenRaw);

  return variants.some((variant) => {
    if (haystack.includes(variant)) return true;
    return haystackTokens.includes(variant);
  });
}

export function matchExplorerQueryText(input: {
  haystack: string;
  query: string;
  minimumRatio?: number;
}): ExplorerTextMatchResult {
  const tokens = tokenizeExplorerQuery(input.query);

  if (tokens.length === 0) {
    return Object.freeze({
      matched: true,
      matchedCount: 0,
      requiredCount: 0,
      tokenCount: 0,
      matchedTokens: Object.freeze([]),
      missingTokens: Object.freeze([]),
    });
  }

  const matchedTokens: string[] = [];
  const missingTokens: string[] = [];

  for (const token of tokens) {
    if (textMatchesExplorerToken(input.haystack, token)) {
      matchedTokens.push(token);
    } else {
      missingTokens.push(token);
    }
  }

  const minimumRatio = input.minimumRatio ?? 0.67;
  const requiredCount =
    tokens.length <= 2
      ? tokens.length
      : Math.max(1, Math.ceil(tokens.length * minimumRatio));

  return Object.freeze({
    matched: matchedTokens.length >= requiredCount,
    matchedCount: matchedTokens.length,
    requiredCount,
    tokenCount: tokens.length,
    matchedTokens: Object.freeze(matchedTokens),
    missingTokens: Object.freeze(missingTokens),
  });
}

export function textMatchesExplorerQuery(input: {
  haystack: string;
  query: string;
  minimumRatio?: number;
}): boolean {
  return matchExplorerQueryText(input).matched;
}