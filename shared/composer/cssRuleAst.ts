/** Minimal lossless CSS rule tree for class-state edits without executing project code. */

import { parseStyleAttr, serializeStyleAttr } from "./styleAttr";

export type CssRuleRecord = {
  selector: string;
  ruleStart: number;
  ruleEnd: number;
  bodyStart: number;
  bodyEnd: number;
  atRules: string[];
  atRuleRanges: Array<{ ruleStart: number; ruleEnd: number; bodyStart: number; bodyEnd: number }>;
};

export type ClassRuleState = {
  /** Legacy bare pseudo name. Prefer selectorSuffix for new call sites. */
  pseudo?: string;
  /** Validated suffix appended to the class selector, e.g. `:hover` or `::before`. */
  selectorSuffix?: string;
  minWidthPx?: number;
};

/**
 * Normalize a selector suffix without allowing a caller to escape the exact
 * class selector being edited. Top-level commas, combinators, braces, and
 * at-rules are rejected because they could turn one edit into multiple rules.
 */
export function normalizeClassSelectorSuffix(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "default" || trimmed === "base") return "";
  const suffix = trimmed.startsWith(":") ? trimmed : `:${trimmed}`;
  if (/[{};@\\]/.test(suffix) || /[\r\n]/.test(suffix)) return null;

  let depth = 0;
  let quote: "\"" | "'" | null = null;
  for (let index = 0; index < suffix.length; index += 1) {
    const char = suffix[index]!;
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")" && --depth < 0) return null;
    else if (char === "," && depth === 0) return null;
  }
  if (quote || depth !== 0) return null;

  let cursor = 0;
  while (cursor < suffix.length) {
    if (suffix[cursor] !== ":") return null;
    cursor += suffix[cursor + 1] === ":" ? 2 : 1;
    const name = suffix.slice(cursor).match(/^[a-zA-Z-][\w-]*/)?.[0];
    if (!name) return null;
    cursor += name.length;
    if (suffix[cursor] !== "(") continue;
    let functionDepth = 1;
    let functionQuote: "\"" | "'" | null = null;
    cursor += 1;
    while (cursor < suffix.length && functionDepth > 0) {
      const char = suffix[cursor]!;
      if (functionQuote) {
        if (char === "\\") cursor += 1;
        else if (char === functionQuote) functionQuote = null;
      } else if (char === "\"" || char === "'") functionQuote = char;
      else if (char === "(") functionDepth += 1;
      else if (char === ")") functionDepth -= 1;
      cursor += 1;
    }
    if (functionDepth !== 0 || functionQuote) return null;
  }
  return suffix;
}

function skipComment(css: string, index: number): number {
  if (css[index] !== "/" || css[index + 1] !== "*") return index;
  const end = css.indexOf("*/", index + 2);
  return end < 0 ? css.length : end + 2;
}

function skipString(css: string, index: number): number {
  const quote = css[index];
  if (quote !== '"' && quote !== "'") return index;
  let cursor = index + 1;
  while (cursor < css.length) {
    if (css[cursor] === "\\") cursor += 2;
    else if (css[cursor] === quote) return cursor + 1;
    else cursor += 1;
  }
  return css.length;
}

function matchingBrace(css: string, open: number, limit: number): number {
  let depth = 0;
  for (let cursor = open; cursor < limit; cursor += 1) {
    const comment = skipComment(css, cursor);
    if (comment !== cursor) {
      cursor = comment - 1;
      continue;
    }
    const string = skipString(css, cursor);
    if (string !== cursor) {
      cursor = string - 1;
      continue;
    }
    if (css[cursor] === "{") depth += 1;
    else if (css[cursor] === "}" && --depth === 0) return cursor;
  }
  return -1;
}

function parseRange(
  css: string,
  start: number,
  end: number,
  atRules: string[],
  atRuleRanges: CssRuleRecord["atRuleRanges"],
  out: CssRuleRecord[],
) {
  let cursor = start;
  while (cursor < end) {
    while (cursor < end && /\s/.test(css[cursor]!)) cursor += 1;
    const comment = skipComment(css, cursor);
    if (comment !== cursor) {
      cursor = comment;
      continue;
    }
    if (cursor >= end) break;
    const preludeStart = cursor;
    let open = -1;
    while (cursor < end) {
      const nextComment = skipComment(css, cursor);
      if (nextComment !== cursor) {
        cursor = nextComment;
        continue;
      }
      const nextString = skipString(css, cursor);
      if (nextString !== cursor) {
        cursor = nextString;
        continue;
      }
      if (css[cursor] === ";") {
        cursor += 1;
        break;
      }
      if (css[cursor] === "{") {
        open = cursor;
        break;
      }
      if (css[cursor] === "}") return;
      cursor += 1;
    }
    if (open < 0) continue;
    const close = matchingBrace(css, open, end);
    if (close < 0) return;
    const prelude = css.slice(preludeStart, open).trim();
    if (prelude.startsWith("@")) {
      parseRange(css, open + 1, close, [...atRules, prelude], [
        ...atRuleRanges,
        { ruleStart: preludeStart, ruleEnd: close + 1, bodyStart: open + 1, bodyEnd: close },
      ], out);
    } else if (prelude) {
      out.push({
        selector: prelude,
        ruleStart: preludeStart,
        ruleEnd: close + 1,
        bodyStart: open + 1,
        bodyEnd: close,
        atRules: [...atRules],
        atRuleRanges: [...atRuleRanges],
      });
    }
    cursor = close + 1;
  }
}

export function parseCssRuleTree(css: string): CssRuleRecord[] {
  const out: CssRuleRecord[] = [];
  parseRange(css, 0, css.length, [], [], out);
  return out;
}

/** Rebuild every base, pseudo, and at-rule block for one exact class selector. */
export function extractClassRuleCss(css: string, name: string): string {
  const base = `.${name}`;
  return parseCssRuleTree(css)
    .filter((rule) => {
      if (rule.selector === base) return true;
      if (!rule.selector.startsWith(base)) return false;
      const suffix = rule.selector.slice(base.length);
      return normalizeClassSelectorSuffix(suffix) === suffix;
    })
    .map((rule) => {
      let block = `${rule.selector} {${css.slice(rule.bodyStart, rule.bodyEnd)}}`;
      for (const atRule of [...rule.atRules].reverse()) {
        block = `${atRule} {\n${block}\n}`;
      }
      return block.trim();
    })
    .join("\n\n");
}

function stateSelector(name: string, state: ClassRuleState): string {
  const requested = state.selectorSuffix ?? state.pseudo;
  const suffix = normalizeClassSelectorSuffix(requested);
  if (suffix == null) throw new Error("Invalid class selector suffix");
  return `.${name}${suffix}`;
}

function matchesState(rule: CssRuleRecord, state: ClassRuleState): boolean {
  const media = rule.atRules.find((entry) => /^@media\b/i.test(entry));
  if (state.minWidthPx == null) return !media;
  return Boolean(
    media?.match(/min-width\s*:\s*([\d.]+)px/i)?.[1] &&
      Number(media.match(/min-width\s*:\s*([\d.]+)px/i)![1]) ===
        state.minWidthPx,
  );
}

export function readClassDeclarations(
  css: string,
  name: string,
  state: ClassRuleState = {},
): string {
  const selector = stateSelector(name, state);
  const match = parseCssRuleTree(css)
    .filter((rule) => rule.selector === selector && matchesState(rule, state))
    .at(-1);
  return match ? css.slice(match.bodyStart, match.bodyEnd).trim() : "";
}

/** Keep framework `@apply` directives when property controls rewrite declarations. */
export function preserveClassApplyDirectives(current: string, next: string): string {
  const directives = new Set<string>();
  for (const source of [current, next]) {
    for (const match of source.matchAll(/@apply\s+[^;{}]+;/g)) {
      directives.add(match[0].trim());
    }
  }
  const declarations = next.replace(/@apply\s+[^;{}]+;/g, "").trim();
  return [...directives, declarations].filter(Boolean).join("\n");
}

function stripApplyDirectives(value: string): string {
  return value.replace(/@apply\s+[^;{}]+;/g, "");
}

/**
 * Patch a class body: incoming declarations overwrite, listed keys are removed,
 * and properties only present on the current rule are kept.
 */
export function patchClassDeclarations(
  current: string,
  next: string,
  deletedKeys: readonly string[] = [],
): string {
  const merged = {
    ...parseStyleAttr(stripApplyDirectives(current)),
    ...parseStyleAttr(stripApplyDirectives(next)),
  };
  for (const key of deletedKeys) delete merged[key.toLowerCase()];
  return serializeStyleAttr(merged);
}

function formatBody(declarations: string, indent: string): string {
  const lines = declarations
    .split(";")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `${indent}${line};`);
  return lines.length ? `\n${lines.join("\n")}\n${indent.slice(2)}` : "\n";
}

function removeRuleAndEmptyAncestors(css: string, match: CssRuleRecord): string {
  let next = `${css.slice(0, match.ruleStart)}${css.slice(match.ruleEnd)}`;
  let removedLength = match.ruleEnd - match.ruleStart;
  for (const range of [...match.atRuleRanges].reverse()) {
    const adjustedEnd = range.ruleEnd - removedLength;
    const body = next.slice(range.bodyStart, adjustedEnd - 1);
    if (body.trim()) break;
    next = `${next.slice(0, range.ruleStart)}${next.slice(adjustedEnd)}`;
    removedLength += adjustedEnd - range.ruleStart;
  }
  return next;
}

export function writeClassDeclarations(
  css: string,
  name: string,
  declarations: string,
  state: ClassRuleState = {},
): string {
  const selector = stateSelector(name, state);
  const match = parseCssRuleTree(css)
    .filter((rule) => rule.selector === selector && matchesState(rule, state))
    .at(-1);
  if (match) {
    if (!declarations.trim()) {
      return removeRuleAndEmptyAncestors(css, match);
    }
    const indent = state.minWidthPx == null ? "  " : "    ";
    return (
      css.slice(0, match.bodyStart) +
      formatBody(declarations, indent) +
      css.slice(match.bodyEnd)
    );
  }
  const trimmed = css.replace(/\s+$/, "");
  const rule = `${selector} {${formatBody(declarations, "  ")}}`;
  const addition = state.minWidthPx == null
    ? rule
    : `@media (min-width: ${state.minWidthPx}px) {\n  ${selector} {${formatBody(declarations, "    ")}  }\n}`;
  return `${trimmed}${trimmed ? "\n\n" : ""}${addition}\n`;
}
