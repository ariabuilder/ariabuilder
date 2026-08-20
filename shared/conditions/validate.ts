import { conditionOperator } from "./operators";
import type {
  ComponentControlMetadata,
  ConditionSet,
  ConditionValidationIssue,
} from "./types";

export function validateConditionSet(condition: ConditionSet): ConditionValidationIssue[] {
  const issues: ConditionValidationIssue[] = [];
  if (condition.version !== 1) {
    issues.push({ path: ["version"], message: "This condition version is not supported." });
  }
  const ids = new Set<string>();
  condition.groups.forEach((group, groupIndex) => {
    if (!group.id || ids.has(group.id)) {
      issues.push({ path: ["groups", groupIndex, "id"], message: "Use a unique group ID." });
    }
    ids.add(group.id);
    if (group.rules.length === 0) {
      issues.push({ path: ["groups", groupIndex, "rules"], message: "Add a rule or remove this alternative." });
    }
    group.rules.forEach((rule, ruleIndex) => {
      if (!rule.id || ids.has(rule.id)) {
        issues.push({ path: ["groups", groupIndex, "rules", ruleIndex, "id"], message: "Use a unique rule ID." });
      }
      ids.add(rule.id);
      if (!rule.source.provider) {
        issues.push({ path: ["groups", groupIndex, "rules", ruleIndex, "source"], message: "Choose what to check." });
      }
      const operator = conditionOperator(rule.operator);
      if (!operator) {
        issues.push({ path: ["groups", groupIndex, "rules", ruleIndex, "operator"], message: "Choose a supported comparison." });
      } else if (operator.needsValue && rule.value === undefined) {
        issues.push({ path: ["groups", groupIndex, "rules", ruleIndex, "value"], message: "Enter a value to compare." });
      }
    });
  });
  return issues;
}

function referencedComponentFields(condition: ConditionSet | undefined): string[] {
  if (!condition) return [];
  return condition.groups.flatMap((group) => group.rules)
    .filter((rule) => rule.source.provider === "component" && rule.source.path.length > 0)
    .map((rule) => rule.source.path[0]!)
    .filter(Boolean);
}

export function validateComponentControlMetadata(
  metadata: ComponentControlMetadata,
): ConditionValidationIssue[] {
  const issues: ConditionValidationIssue[] = [];
  const edges = new Map<string, string[]>();
  for (const [field, control] of Object.entries(metadata.fields)) {
    const dependencies = [
      ...referencedComponentFields(control.visibleWhen),
      ...referencedComponentFields(control.enabledWhen),
    ];
    edges.set(field, Array.from(new Set(dependencies)));
    if (dependencies.includes(field)) {
      issues.push({ path: ["fields", field], message: `${field} cannot depend on itself.` });
    }
    if (control.visibleWhen) issues.push(...validateConditionSet(control.visibleWhen).map((issue) => ({ ...issue, path: ["fields", field, "visibleWhen", ...issue.path] })));
    if (control.enabledWhen) issues.push(...validateConditionSet(control.enabledWhen).map((issue) => ({ ...issue, path: ["fields", field, "enabledWhen", ...issue.path] })));
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (field: string, trail: string[]) => {
    if (visiting.has(field)) {
      const start = trail.indexOf(field);
      const cycle = [...trail.slice(Math.max(0, start)), field];
      issues.push({ path: ["fields", field], message: `Remove the dependency cycle: ${cycle.join(" → ")}.` });
      return;
    }
    if (visited.has(field)) return;
    visiting.add(field);
    for (const dependency of edges.get(field) ?? []) {
      if (edges.has(dependency)) walk(dependency, [...trail, field]);
    }
    visiting.delete(field);
    visited.add(field);
  };
  for (const field of edges.keys()) walk(field, []);
  return issues;
}

export function isConditionSet(value: unknown): value is ConditionSet {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ConditionSet>;
  if (candidate.version !== 1 || !Array.isArray(candidate.groups)) return false;
  return candidate.groups.every((group) => Boolean(
    group && typeof group === "object" && typeof group.id === "string" && Array.isArray(group.rules)
      && group.rules.every((rule) => Boolean(
        rule && typeof rule === "object" && typeof rule.id === "string"
          && typeof rule.operator === "string" && rule.source && typeof rule.source.provider === "string"
          && Array.isArray(rule.source.path) && rule.source.path.every((part) => typeof part === "string"),
      )),
  ));
}

