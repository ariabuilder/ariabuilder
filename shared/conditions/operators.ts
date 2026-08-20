import type { ConditionResult, ConditionValueType } from "./types";

export type ConditionOperatorDefinition = {
  id: string;
  label: string;
  valueLabel?: string;
  needsValue: boolean;
  types: ConditionValueType[];
};

const ALL_TYPES: ConditionValueType[] = [
  "string", "number", "boolean", "date", "array", "object", "unknown",
];
const EMPTY_TYPES: ConditionValueType[] = ["string", "array", "object", "unknown"];

export const CONDITION_OPERATORS: ConditionOperatorDefinition[] = [
  { id: "equals", label: "is", valueLabel: "Value", needsValue: true, types: ALL_TYPES },
  { id: "not-equals", label: "is not", valueLabel: "Value", needsValue: true, types: ALL_TYPES },
  { id: "contains", label: "contains", valueLabel: "Value", needsValue: true, types: ["string", "array", "unknown"] },
  { id: "not-contains", label: "does not contain", valueLabel: "Value", needsValue: true, types: ["string", "array", "unknown"] },
  { id: "starts-with", label: "starts with", valueLabel: "Value", needsValue: true, types: ["string", "unknown"] },
  { id: "ends-with", label: "ends with", valueLabel: "Value", needsValue: true, types: ["string", "unknown"] },
  { id: "is-empty", label: "is empty", needsValue: false, types: EMPTY_TYPES },
  { id: "is-not-empty", label: "is not empty", needsValue: false, types: EMPTY_TYPES },
  { id: "is-set", label: "is set", needsValue: false, types: ALL_TYPES },
  { id: "is-not-set", label: "is not set", needsValue: false, types: ALL_TYPES },
  { id: "greater-than", label: "is greater than", valueLabel: "Number", needsValue: true, types: ["number", "unknown"] },
  { id: "less-than", label: "is less than", valueLabel: "Number", needsValue: true, types: ["number", "unknown"] },
  { id: "at-least", label: "is at least", valueLabel: "Number", needsValue: true, types: ["number", "unknown"] },
  { id: "at-most", label: "is at most", valueLabel: "Number", needsValue: true, types: ["number", "unknown"] },
  { id: "before", label: "is before", valueLabel: "Date", needsValue: true, types: ["date", "string", "unknown"] },
  { id: "after", label: "is after", valueLabel: "Date", needsValue: true, types: ["date", "string", "unknown"] },
  { id: "on-or-before", label: "is on or before", valueLabel: "Date", needsValue: true, types: ["date", "unknown"] },
  { id: "on-or-after", label: "is on or after", valueLabel: "Date", needsValue: true, types: ["date", "unknown"] },
];

export function conditionOperator(id: string): ConditionOperatorDefinition | null {
  return CONDITION_OPERATORS.find((operator) => operator.id === id) ?? null;
}

export function conditionOperatorsForType(type: ConditionValueType): ConditionOperatorDefinition[] {
  return CONDITION_OPERATORS.filter((operator) => operator.types.includes(type));
}

function emptySize(value: unknown): number | null {
  if (typeof value === "string" || Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return null;
}

function comparableDate(value: unknown): number | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function evaluateConditionOperator(
  operator: string,
  actual: unknown,
  expected: unknown,
  present = true,
): ConditionResult {
  if (operator === "is-set") return present ? actual !== undefined : "unknown";
  if (operator === "is-not-set") return present ? actual === undefined : "unknown";
  if (!present) return "unknown";
  switch (operator) {
    case "equals": return actual === expected;
    case "not-equals": return actual !== expected;
    case "contains":
      if (typeof actual === "string") return typeof expected === "string" ? actual.includes(expected) : false;
      if (Array.isArray(actual)) return actual.includes(expected);
      return "unknown";
    case "not-contains": {
      const result = evaluateConditionOperator("contains", actual, expected, present);
      return result === "unknown" ? result : !result;
    }
    case "starts-with": return typeof actual === "string" && typeof expected === "string" ? actual.startsWith(expected) : "unknown";
    case "ends-with": return typeof actual === "string" && typeof expected === "string" ? actual.endsWith(expected) : "unknown";
    case "is-empty": {
      const size = emptySize(actual);
      return size == null ? false : size === 0;
    }
    case "is-not-empty": {
      const size = emptySize(actual);
      return size == null ? false : size > 0;
    }
    case "greater-than":
      return typeof actual === "number" && typeof expected === "number" ? actual > expected : "unknown";
    case "less-than":
      return typeof actual === "number" && typeof expected === "number" ? actual < expected : "unknown";
    case "at-least":
      return typeof actual === "number" && typeof expected === "number" ? actual >= expected : "unknown";
    case "at-most":
      return typeof actual === "number" && typeof expected === "number" ? actual <= expected : "unknown";
    case "before":
    case "after":
    case "on-or-before":
    case "on-or-after": {
      const left = comparableDate(actual);
      const right = comparableDate(expected);
      if (left == null || right == null) return "unknown";
      if (operator === "before") return left < right;
      if (operator === "after") return left > right;
      return operator === "on-or-before" ? left <= right : left >= right;
    }
    default: return "unknown";
  }
}
