import { conditionOperator } from "./operators";
import type { ConditionRule, ConditionSet } from "./types";
import { isConditionSet, validateConditionSet } from "./validate";

const MANAGED_PREFIX = "/* @aria-condition:v1:";

function propertyAccess(base: string, path: readonly string[]): string {
  return path.reduce((expression, part) => `${expression}?.[${JSON.stringify(part)}]`, base);
}

function sourceExpression(rule: ConditionRule): string | null {
  const path = rule.source.path;
  switch (rule.source.provider) {
    case "component": return propertyAccess("Astro.props", path);
    case "locale": return path.length ? propertyAccess("Astro.currentLocale", path) : "Astro.currentLocale";
    case "route": return propertyAccess("Astro.url", path.length ? path : ["pathname"]);
    case "site": return propertyAccess("Astro.site", path);
    case "request": return propertyAccess("Astro.request", path);
    case "visitor": return propertyAccess("Astro.locals", ["visitor", ...path]);
    case "page":
    case "project":
    case "cms": {
      const [binding, ...rest] = path;
      if (!binding || !/^[A-Za-z_$][\w$]*$/.test(binding)) return null;
      return propertyAccess(binding, rest);
    }
    case "time": return path[0] === "today" ? "new Date().toISOString().slice(0, 10)" : "new Date().toISOString()";
    default: return null;
  }
}

function valueExpression(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "undefined" : serialized;
}

function compileRule(rule: ConditionRule): string | null {
  const source = sourceExpression(rule);
  const operator = conditionOperator(rule.operator);
  if (!source || !operator) return null;
  const value = valueExpression(rule.value);
  switch (rule.operator) {
    case "equals": return `${source} === ${value}`;
    case "not-equals": return `${source} !== ${value}`;
    case "contains": return `${source}?.includes?.(${value}) === true`;
    case "not-contains": return `${source}?.includes?.(${value}) !== true`;
    case "starts-with": return `typeof ${source} === "string" && ${source}.startsWith(${value})`;
    case "ends-with": return `typeof ${source} === "string" && ${source}.endsWith(${value})`;
    case "is-empty": return `((typeof ${source} === "string" || Array.isArray(${source})) && ${source}.length === 0) || (${source} && typeof ${source} === "object" && !Array.isArray(${source}) && Object.keys(${source}).length === 0)`;
    case "is-not-empty": return `((typeof ${source} === "string" || Array.isArray(${source})) && ${source}.length > 0) || (${source} && typeof ${source} === "object" && !Array.isArray(${source}) && Object.keys(${source}).length > 0)`;
    case "is-set": return `${source} !== undefined`;
    case "is-not-set": return `${source} === undefined`;
    case "greater-than": return `${source} > ${value}`;
    case "less-than": return `${source} < ${value}`;
    case "at-least": return `${source} >= ${value}`;
    case "at-most": return `${source} <= ${value}`;
    case "before": return `new Date(${source}).getTime() < new Date(${value}).getTime()`;
    case "after": return `new Date(${source}).getTime() > new Date(${value}).getTime()`;
    case "on-or-before": return `new Date(${source}).getTime() <= new Date(${value}).getTime()`;
    case "on-or-after": return `new Date(${source}).getTime() >= new Date(${value}).getTime()`;
    default: return null;
  }
}

export function compileConditionSetToAstro(condition: ConditionSet): string | null {
  if (condition.groups.length === 0 || validateConditionSet(condition).length > 0) return null;
  const groups: string[] = [];
  for (const group of condition.groups) {
    const rules = group.rules.map(compileRule);
    if (rules.some((rule) => rule == null)) return null;
    groups.push(`(${rules.join(" && ")})`);
  }
  return groups.join(" || ");
}

export function managedConditionExpression(condition: ConditionSet): string | null {
  const expression = compileConditionSetToAstro(condition);
  if (!expression) return null;
  const metadata = encodeURIComponent(JSON.stringify(condition));
  return `${MANAGED_PREFIX}${metadata} */ ${expression}`;
}

export function parseManagedConditionExpression(test: string): ConditionSet | null {
  const trimmed = test.trim();
  if (!trimmed.startsWith(MANAGED_PREFIX)) return null;
  const end = trimmed.indexOf(" */", MANAGED_PREFIX.length);
  if (end < 0) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(trimmed.slice(MANAGED_PREFIX.length, end)));
    return isConditionSet(parsed) && validateConditionSet(parsed).length === 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function isManagedConditionExpression(test: string): boolean {
  return parseManagedConditionExpression(test) !== null;
}
