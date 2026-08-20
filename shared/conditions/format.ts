import { conditionOperator } from "./operators";
import type { ConditionSet, ConditionSourceOption } from "./types";

function displayValue(value: unknown): string {
  if (typeof value === "string") return value || "empty text";
  if (value === true) return "On";
  if (value === false) return "Off";
  if (value == null) return "empty";
  return String(value);
}

export function formatConditionSet(
  condition: ConditionSet | undefined,
  sources: readonly ConditionSourceOption[] = [],
): string {
  if (!condition || condition.groups.length === 0) return "Always shown";
  const sourceLabel = (provider: string, path: readonly string[]) =>
    sources.find((source) => source.source.provider === provider
      && source.source.path.join(".") === path.join("."))?.label
      ?? path.at(-1)
      ?? provider;
  return condition.groups.map((group) => group.rules.map((rule) => {
    const operator = conditionOperator(rule.operator);
    const beginning = `${sourceLabel(rule.source.provider, rule.source.path)} ${operator?.label ?? rule.operator}`;
    return operator?.needsValue ? `${beginning} ${displayValue(rule.value)}` : beginning;
  }).join(" and ")).join(" or ");
}

