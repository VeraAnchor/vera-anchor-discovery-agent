// apps/agent-api/src/explorer/explorerAgentQuantityParser.ts

import type { ExplorerAgentConfidence } from "./explorerAgentTypes.js";

export type ExplorerAgentQuantityConstraint = Readonly<{
  limit: number | null;
  sourceText: string;
  confidence: ExplorerAgentConfidence;
}>;

export type ParsedExplorerQuantityConstraint = Readonly<{
  quantity: ExplorerAgentQuantityConstraint | null;
  searchQuestion: string;
}>;

const MAX_COMPILED_LIMIT = 25;

const NUMBER_WORDS: Record<string, number> = {
  single: 1,
  one: 1,
  couple: 2,
  two: 2,
  few: 3,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  several: 7,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  dozen: 12, 
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  twentyfive: 25,
  "twenty-five": 25,
};

function normalizeQuestion(value: string): string {
  return value
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function clampLimit(value: number): number {
  return Math.max(1, Math.min(MAX_COMPILED_LIMIT, Math.trunc(value)));
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
  quantity: ExplorerAgentQuantityConstraint | null,
): ParsedExplorerQuantityConstraint {
  return Object.freeze({
    quantity,
    searchQuestion: quantity
      ? removeSourceText(question, quantity.sourceText)
      : question,
  });
}

function quantity(
  limit: number,
  sourceText: string,
  confidence: ExplorerAgentConfidence = "high",
): ExplorerAgentQuantityConstraint {
  return Object.freeze({
    limit: clampLimit(limit),
    sourceText: sourceText.trim(),
    confidence,
  });
}

function numberWordValue(value: string): number | null {
  const normalized = value.toLowerCase().replace(/\s+/g, "-");
  return NUMBER_WORDS[normalized] ?? NUMBER_WORDS[normalized.replace("-", "")] ?? null;
}

export function parseExplorerAgentQuantityConstraint(
  questionRaw: string,
): ParsedExplorerQuantityConstraint {
  const question = normalizeQuestion(questionRaw);

  const numeric = /\b(?:top|first|latest|last|next|show|list|give(?:\s+me)?|find|get|return)\s+(\d{1,3})\b/i.exec(question);
  if (numeric) {
    return parsed(question, quantity(Number(numeric[1]), numeric[0]));
  }

  const wordPattern = Object.keys(NUMBER_WORDS)
    .sort((a, b) => b.length - a.length)
    .map((word) => word.replace("-", String.raw`[-\s]`))
    .join("|");

  const word = new RegExp(
    String.raw`\b(?:top|first|latest|last|next|show|list|give(?:\s+me)?|find|get|return)\s+(${wordPattern})\b`,
    "i",
  ).exec(question);

  if (word) {
    const value = numberWordValue(word[1]);
    if (value !== null) {
      return parsed(question, quantity(value, word[0]));
    }
  }

  const few = /\b(?:a few|some|several)\b/i.exec(question);
  if (few) {
    return parsed(question, quantity(3, few[0], "medium"));
  }

  const more = /\b(?:show\s+more|load\s+more|more)\b/i.exec(question);
  if (more) {
    return parsed(question, quantity(5, more[0], "medium"));
  }

  return parsed(question, null);
}