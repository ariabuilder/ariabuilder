export type ConditionResult = true | false | "unknown";

export type ConditionValueType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "array"
  | "object"
  | "unknown";

export type ConditionExecutionPlane =
  | "build"
  | "request"
  | "editor"
  | "client";

export type ConditionSourceRef = {
  provider: string;
  path: string[];
};

export type ConditionRule = {
  id: string;
  source: ConditionSourceRef;
  operator: string;
  value?: unknown;
};

export type ConditionGroup = {
  id: string;
  /** Every rule must pass. */
  rules: ConditionRule[];
};

export type ConditionSet = {
  version: 1;
  /** At least one group must pass. */
  groups: ConditionGroup[];
};

export type ConditionalValue<T> = {
  version: 1;
  /** First matching case wins. */
  cases: Array<{ id: string; when: ConditionSet; value: T }>;
  fallback: T;
};

export type ConditionControlRule = {
  visibleWhen?: ConditionSet;
  enabledWhen?: ConditionSet;
};

export type ComponentControlMetadata = {
  version: 1;
  fields: Record<string, ConditionControlRule>;
};

export type ConditionSourceOption = {
  source: ConditionSourceRef;
  label: string;
  group: "Component" | "Content" | "Page" | "Site" | "Visitor" | "Browser";
  valueType: ConditionValueType;
  execution: ConditionExecutionPlane;
  options?: Array<{ label: string; value: unknown }>;
  description?: string;
};

export type ConditionEvaluationContext = {
  /** Values are grouped by provider id and never executed by the evaluator. */
  providers: Record<string, unknown>;
};

export type ConditionValidationIssue = {
  path: Array<string | number>;
  message: string;
};

let nextConditionId = 1;

export function allocConditionId(prefix: "group" | "rule" | "case" = "rule"): string {
  return `${prefix}-${nextConditionId++}`;
}

export function emptyConditionSet(): ConditionSet {
  return { version: 1, groups: [] };
}

function cloneConditionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneConditionValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneConditionValue(entry)]),
    );
  }
  return value;
}

/**
 * Copies the static condition contract without relying on structuredClone.
 * Vue and other UI frameworks may wrap this data in proxies, which are not
 * structured-cloneable even though every stored condition value is static.
 */
export function cloneConditionSet(condition: ConditionSet): ConditionSet {
  return {
    version: 1,
    groups: condition.groups.map((group) => ({
      id: group.id,
      rules: group.rules.map((rule) => ({
        id: rule.id,
        source: {
          provider: rule.source.provider,
          path: [...rule.source.path],
        },
        operator: rule.operator,
        ...("value" in rule ? { value: cloneConditionValue(rule.value) } : {}),
      })),
    })),
  };
}
