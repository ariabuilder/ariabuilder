/**
 * Class attribute helpers for the Design inspector.
 * Source of truth remains the Astro `class` / `class:list` prop on the node.
 */

import type { PropValue } from "./types";

/** Split a class string into tokens (whitespace-separated). */
export function splitClassNames(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Join class tokens with a single space; empty → "". */
export function joinClassNames(names: readonly string[]): string {
  return names.filter(Boolean).join(" ");
}

/** Add a class if missing (idempotent). */
export function addClassName(
  names: readonly string[],
  next: string,
): string[] {
  const token = next.trim();
  if (!token) return [...names];
  if (names.includes(token)) return [...names];
  return [...names, token];
}

/** Remove all occurrences of a class token. */
export function removeClassName(
  names: readonly string[],
  target: string,
): string[] {
  return names.filter((n) => n !== target);
}

/**
 * Classes present in the live DOM but not in the source class string
 * (typical when `class` is an expression / class:list).
 */
export function diffRenderedClasses(
  sourceNames: readonly string[],
  renderedNames: readonly string[],
): { source: string[]; renderedOnly: string[] } {
  const sourceSet = new Set(sourceNames);
  const renderedOnly: string[] = [];
  const seen = new Set<string>();
  for (const name of renderedNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (!sourceSet.has(name)) renderedOnly.push(name);
  }
  return { source: [...sourceNames], renderedOnly };
}

/** Append a static token while preserving a dynamic `class:list` expression. */
export function appendClassListToken(
  value: PropValue | undefined,
  tokenRaw: string,
): PropValue | undefined {
  const token = tokenRaw.trim();
  if (!token) return value;
  if (!value) return { type: "expr", value: `[${JSON.stringify(token)}]` };
  if (value.type === "string") {
    return { type: "string", value: joinClassNames(addClassName(splitClassNames(value.value), token)) };
  }
  if (value.type !== "expr") return value;
  const expr = value.value.trim();
  if (new RegExp(`["']${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(expr)) {
    return value;
  }
  if (expr.startsWith("[") && expr.endsWith("]")) {
    const body = expr.slice(1, -1).trim();
    return {
      type: "expr",
      value: `[${body}${body ? ", " : ""}${JSON.stringify(token)}]`,
    };
  }
  return { type: "expr", value: `[${expr}, ${JSON.stringify(token)}]` };
}

/** Read only literal string tokens from class:list; dynamic entries stay opaque. */
export function staticClassListTokens(value: PropValue | undefined): string[] {
  if (!value) return [];
  if (value.type === "string") return splitClassNames(value.value);
  if (value.type !== "expr") return [];
  const tokens: string[] = [];
  const seen = new Set<string>();
  const stringLiteral = /(["'])(.*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = stringLiteral.exec(value.value))) {
    for (const token of splitClassNames(match[2] ?? "")) {
      if (!seen.has(token)) {
        seen.add(token);
        tokens.push(token);
      }
    }
  }
  return tokens;
}

/**
 * Remove owned literal tokens while preserving dynamic class:list entries.
 * Returns `safe: false` when the expression is not an array we can rewrite
 * without changing its meaning.
 */
export function removeClassListTokens(
  value: PropValue | undefined,
  shouldRemove: (token: string) => boolean,
): { value: PropValue | undefined; safe: boolean } {
  if (!value) return { value, safe: true };
  if (value.type === "string") {
    const next = splitClassNames(value.value).filter((token) => !shouldRemove(token));
    return {
      value: next.length ? { type: "string", value: joinClassNames(next) } : undefined,
      safe: true,
    };
  }
  if (value.type !== "expr") return { value, safe: false };
  const expr = value.value.trim();
  if (!expr.startsWith("[") || !expr.endsWith("]")) {
    return { value, safe: false };
  }
  const rewritten = expr.replace(/(["'])(.*?)\1/g, (literal, quote: string, body: string) => {
    const next = splitClassNames(body).filter((token) => !shouldRemove(token));
    if (next.length === splitClassNames(body).length) return literal;
    return `${quote}${joinClassNames(next)}${quote}`;
  });
  return { value: { type: "expr", value: rewritten }, safe: true };
}
