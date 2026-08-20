import {
  compileConditionSetToAstro,
  evaluateConditionalValue,
  isConditionSet,
  validateConditionSet,
  type ConditionEvaluationContext,
  type ConditionalValue,
} from "../conditions";
import type { PropValue } from "./types";
import { locateAtPath, type MutateResult } from "./mutate";
import type { AstroDocumentModel, EditableNode } from "./types";

const MANAGED_VALUE_PREFIX = "/* @aria-conditional-value:v1:";

export type ComposerConditionalValue = ConditionalValue<PropValue>;

function isPropValue(value: unknown): value is PropValue {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  const candidate = value as Partial<PropValue>;
  if (candidate.type === "bare") return true;
  return ["string", "expr", "spread", "shorthand", "template-literal"].includes(String(candidate.type))
    && typeof (candidate as { value?: unknown }).value === "string";
}

function compilePropValue(value: PropValue): string | null {
  switch (value.type) {
    case "bare": return "true";
    case "string": return JSON.stringify(value.value);
    case "expr": return value.value.trim() || null;
    case "template-literal": return `\`${value.value.replace(/`/g, "\\`")}\``;
    default: return null;
  }
}

export function validateComposerConditionalValue(value: ComposerConditionalValue): string[] {
  const issues: string[] = [];
  if (value.version !== 1) issues.push("This conditional value version is not supported.");
  if (!value.cases.length) issues.push("Add at least one case.");
  if (!isPropValue(value.fallback) || compilePropValue(value.fallback) == null) {
    issues.push("Choose a supported Otherwise value.");
  }
  const ids = new Set<string>();
  for (const candidate of value.cases) {
    if (!candidate.id || ids.has(candidate.id)) issues.push("Each case needs a unique ID.");
    ids.add(candidate.id);
    issues.push(...validateConditionSet(candidate.when).map((issue) => issue.message));
    if (!isPropValue(candidate.value) || compilePropValue(candidate.value) == null) {
      issues.push("Choose a supported value for every case.");
    }
  }
  return issues;
}

export function managedConditionalPropExpression(value: ComposerConditionalValue): string | null {
  if (validateComposerConditionalValue(value).length) return null;
  const branches: string[] = [];
  for (const candidate of value.cases) {
    const condition = compileConditionSetToAstro(candidate.when);
    const result = compilePropValue(candidate.value);
    if (!condition || result == null) return null;
    branches.push(`(${condition}) ? (${result}) : `);
  }
  const fallback = compilePropValue(value.fallback);
  if (fallback == null) return null;
  return `${MANAGED_VALUE_PREFIX}${encodeURIComponent(JSON.stringify(value))} */ ${branches.join("")}(${fallback})`;
}

export function conditionalPropValue(value: ComposerConditionalValue): PropValue | null {
  const expression = managedConditionalPropExpression(value);
  return expression ? { type: "expr", value: expression } : null;
}

export function parseManagedConditionalPropValue(value: PropValue | undefined): ComposerConditionalValue | null {
  if (value?.type !== "expr") return null;
  const trimmed = value.value.trim();
  if (!trimmed.startsWith(MANAGED_VALUE_PREFIX)) return null;
  const end = trimmed.indexOf(" */", MANAGED_VALUE_PREFIX.length);
  if (end < 0) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(trimmed.slice(MANAGED_VALUE_PREFIX.length, end))) as Partial<ComposerConditionalValue>;
    if (parsed.version !== 1 || !Array.isArray(parsed.cases) || !isPropValue(parsed.fallback)) return null;
    const conditional: ComposerConditionalValue = {
      version: 1,
      cases: parsed.cases.map((candidate) => {
        if (!candidate || typeof candidate !== "object") throw new Error("Invalid case");
        const entry = candidate as { id?: unknown; when?: unknown; value?: unknown };
        if (typeof entry.id !== "string" || !isConditionSet(entry.when) || !isPropValue(entry.value)) throw new Error("Invalid case");
        return { id: entry.id, when: entry.when, value: entry.value };
      }),
      fallback: parsed.fallback,
    };
    return validateComposerConditionalValue(conditional).length ? null : conditional;
  } catch {
    return null;
  }
}

export function evaluateComposerConditionalValue(
  value: ComposerConditionalValue,
  context: ConditionEvaluationContext,
) {
  return evaluateConditionalValue(value, context);
}

export function textNodePropValue(node: EditableNode | null | undefined): PropValue | null {
  if (node?.kind === "text") return { type: "string", value: node.value };
  if (node?.kind === "expr") return { type: "expr", value: node.value.replace(/^\{([\s\S]*)\}$/, "$1") };
  return null;
}

/** Replace a text/expression node while retaining its Composer identity. */
export function setConditionalTextValueAtPath(
  model: AstroDocumentModel,
  path: string,
  value: PropValue,
): MutateResult {
  const location = locateAtPath(model.nodes, path);
  if (!location || (location.node.kind !== "text" && location.node.kind !== "expr")) {
    return { ok: false, selectPath: path, reason: "Choose a text or expression node." };
  }
  const base = { id: location.node.id, sourceRange: location.node.sourceRange };
  if (value.type === "string") {
    location.list[location.index] = { ...base, kind: "text", value: value.value };
  } else if (value.type === "expr") {
    location.list[location.index] = { ...base, kind: "expr", value: `{${value.value}}` };
  } else if (value.type === "template-literal") {
    location.list[location.index] = { ...base, kind: "expr", value: `{\`${value.value}\`}` };
  } else {
    return { ok: false, selectPath: path, reason: "Choose a text-compatible value." };
  }
  return { ok: true, selectPath: path };
}
