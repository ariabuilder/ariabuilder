import { evaluateConditionOperator } from "./operators";
import type {
  ConditionEvaluationContext,
  ConditionResult,
  ConditionRule,
  ConditionSet,
  ConditionalValue,
} from "./types";

export type ResolvedConditionSource = {
  present: boolean;
  value: unknown;
};

export function resolveConditionSource(
  context: ConditionEvaluationContext,
  provider: string,
  path: readonly string[],
): ResolvedConditionSource {
  if (!Object.prototype.hasOwnProperty.call(context.providers, provider)) {
    return { present: false, value: undefined };
  }
  let current = context.providers[provider];
  if (path.length === 0) return { present: true, value: current };
  for (const segment of path) {
    if (current == null || (typeof current !== "object" && typeof current !== "function")) {
      return { present: false, value: undefined };
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return { present: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { present: true, value: current };
}

export function evaluateConditionRule(
  rule: ConditionRule,
  context: ConditionEvaluationContext,
): ConditionResult {
  const resolved = resolveConditionSource(
    context,
    rule.source.provider,
    rule.source.path,
  );
  return evaluateConditionOperator(
    rule.operator,
    resolved.value,
    rule.value,
    resolved.present,
  );
}

export function evaluateConditionSet(
  condition: ConditionSet | undefined,
  context: ConditionEvaluationContext,
): ConditionResult {
  if (!condition || condition.groups.length === 0) return true;
  let unknown = false;
  for (const group of condition.groups) {
    if (group.rules.length === 0) {
      unknown = true;
      continue;
    }
    let groupUnknown = false;
    let groupFailed = false;
    for (const rule of group.rules) {
      const result = evaluateConditionRule(rule, context);
      if (result === false) {
        groupFailed = true;
        break;
      }
      if (result === "unknown") groupUnknown = true;
    }
    if (!groupFailed && !groupUnknown) return true;
    if (!groupFailed && groupUnknown) unknown = true;
  }
  return unknown ? "unknown" : false;
}

export function evaluateConditionalValue<T>(
  conditional: ConditionalValue<T>,
  context: ConditionEvaluationContext,
): { value: T; caseId: string | null; result: ConditionResult } {
  let unknown = false;
  for (const candidate of conditional.cases) {
    const result = evaluateConditionSet(candidate.when, context);
    if (result === true) return { value: candidate.value, caseId: candidate.id, result };
    if (result === "unknown") unknown = true;
  }
  return {
    value: conditional.fallback,
    caseId: null,
    result: unknown ? "unknown" : false,
  };
}

