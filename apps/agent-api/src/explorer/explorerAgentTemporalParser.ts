// apps/agent-api/src/explorer/explorerAgentTemporalParser.ts

import type {
  ExplorerAgentConfidence,
  ExplorerAgentTemporalRange,
} from "./explorerAgentTypes.js";

export type ParsedExplorerTemporalRange = Readonly<{
  range: ExplorerAgentTemporalRange | null;
  searchQuestion: string;
}>;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const ISO_DATE_RE = /\b(20\d{2}|19\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/;
const US_DATE_RE = /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/((?:20|19)\d{2})\b/;
const MONTH_DATE_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+([0-3]?\d)(?:st|nd|rd|th)?(?:,\s*((?:20|19)\d{2}))?\b/i;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function utcDateOnly(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: Date, days: number): Date {
  const d = utcDateOnly(value);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function startOfToday(now: Date): Date {
  return utcDateOnly(now);
}

function dateRange(input: {
  startDate: string | null;
  endDate: string | null;
  label: string;
  sourceText: string;
  confidence?: ExplorerAgentConfidence;
}): ExplorerAgentTemporalRange {
  return Object.freeze({
    startDate: input.startDate,
    endDate: input.endDate,
    label: input.label,
    sourceText: input.sourceText.trim(),
    confidence: input.confidence ?? "high",
    timezone: "UTC",
  });
}

function parseDateLiteral(raw: string, now: Date): string | null {
  const value = raw.trim();

  const iso = value.match(ISO_DATE_RE);
  if (iso) return iso[0];

  const us = value.match(US_DATE_RE);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = Number(us[3]);

    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const named = value.match(MONTH_DATE_RE);
  if (named) {
    const month = MONTHS[named[1].toLowerCase().replace(".", "")];
    const day = Number(named[2]);
    const year = named[3] ? Number(named[3]) : now.getUTCFullYear();

    if (!month || day < 1 || day > 31) return null;

    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  return null;
}

function dateLiteralPattern(): string {
  return [
    String.raw`(?:20\d{2}|19\d{2})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])`,
    String.raw`(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/(?:(?:20|19)\d{2})`,
    String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+[0-3]?\d(?:st|nd|rd|th)?(?:,\s*(?:20|19)\d{2})?`,
  ].join("|");
}

function normalizeQuestion(value: string): string {
  return value
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function removeSourceText(question: string, sourceText: string): string {
  if (!sourceText.trim()) return question;

  return question
    .replace(sourceText, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsed(
  question: string,
  range: ExplorerAgentTemporalRange | null,
): ParsedExplorerTemporalRange {
  return Object.freeze({
    range,
    searchQuestion: range ? removeSourceText(question, range.sourceText) : question,
  });
}

export function parseExplorerAgentTemporalRange(
  questionRaw: string,
  nowRaw = new Date(),
): ParsedExplorerTemporalRange {
  const question = normalizeQuestion(questionRaw);
  const lower = question.toLowerCase();
  const now = startOfToday(nowRaw);
  const literal = dateLiteralPattern();

  const between = new RegExp(
    String.raw`\b(?:between|from)\s+(${literal})\s+(?:and|to|through|-)\s+(${literal})\b`,
    "i",
  ).exec(question);

  if (between) {
    const start = parseDateLiteral(between[1], now);
    const end = parseDateLiteral(between[2], now);

    if (start && end) {
      return parsed(
        question,
        dateRange({
          startDate: start <= end ? start : end,
          endDate: start <= end ? end : start,
          label: `${start <= end ? start : end} to ${start <= end ? end : start}`,
          sourceText: between[0],
        }),
      );
    }
  }

  const since = new RegExp(String.raw`\b(?:since|after)\s+(${literal})\b`, "i").exec(question);
  if (since) {
    const start = parseDateLiteral(since[1], now);

    if (start) {
      return parsed(
        question,
        dateRange({
          startDate: start,
          endDate: null,
          label: `${since[0].toLowerCase().startsWith("after") ? "after" : "since"} ${start}`,
          sourceText: since[0],
        }),
      );
    }
  }

  const before = new RegExp(String.raw`\b(?:before|until|through)\s+(${literal})\b`, "i").exec(question);
  if (before) {
    const end = parseDateLiteral(before[1], now);

    if (end) {
      return parsed(
        question,
        dateRange({
          startDate: null,
          endDate: end,
          label: `before ${end}`,
          sourceText: before[0],
        }),
      );
    }
  }

  const onDate = new RegExp(String.raw`\b(?:on|for|from)\s+(${literal})\b`, "i").exec(question);
  if (onDate) {
    const date = parseDateLiteral(onDate[1], now);

    if (date) {
      return parsed(
        question,
        dateRange({
          startDate: date,
          endDate: date,
          label: date,
          sourceText: onDate[0],
        }),
      );
    }
  }

  const daysAgo = /\b(?:from\s+)?(\d{1,3})\s+(day|days|week|weeks|month|months)\s+ago\b/i.exec(question);
  if (daysAgo) {
    const count = Number(daysAgo[1]);
    const unit = daysAgo[2].toLowerCase();
    const days =
      unit.startsWith("day") ? count :
      unit.startsWith("week") ? count * 7 :
      count * 30;

    const d = isoDate(addUtcDays(now, -days));

    return parsed(
      question,
      dateRange({
        startDate: d,
        endDate: d,
        label: `${count} ${unit} ago`,
        sourceText: daysAgo[0],
      }),
    );
  }

  const rolling = /\b(?:last|past|previous)\s+(\d{1,3})\s+(day|days|week|weeks|month|months)\b/i.exec(question);
  if (rolling) {
    const count = Number(rolling[1]);
    const unit = rolling[2].toLowerCase();
    const days =
      unit.startsWith("day") ? count :
      unit.startsWith("week") ? count * 7 :
      count * 30;

    return parsed(
      question,
      dateRange({
        startDate: isoDate(addUtcDays(now, -Math.max(0, days - 1))),
        endDate: isoDate(now),
        label: `past ${count} ${unit}`,
        sourceText: rolling[0],
      }),
    );
  }

  const namedRolling = /\b(?:last|past|previous)\s+(day|week|month)\b/i.exec(question);
  if (namedRolling) {
    const unit = namedRolling[1].toLowerCase();
    const days = unit === "day" ? 1 : unit === "week" ? 7 : 30;

    return parsed(
      question,
      dateRange({
        startDate: isoDate(addUtcDays(now, -Math.max(0, days - 1))),
        endDate: isoDate(now),
        label: `past ${unit}`,
        sourceText: namedRolling[0],
      }),
    );
  }

  if (/\btoday\b/i.test(lower)) {
    const sourceText = question.match(/\btoday\b/i)?.[0] ?? "today";
    const d = isoDate(now);

    return parsed(
      question,
      dateRange({
        startDate: d,
        endDate: d,
        label: "today",
        sourceText,
      }),
    );
  }

  if (/\byesterday(?:'s)?\b/i.test(lower)) {
    const sourceText = question.match(/\byesterday(?:'s)?\b/i)?.[0] ?? "yesterday";
    const d = isoDate(addUtcDays(now, -1));

    return parsed(
      question,
      dateRange({
        startDate: d,
        endDate: d,
        label: "yesterday",
        sourceText,
      }),
    );
  }

  return parsed(question, null);
}