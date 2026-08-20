import type { RedirectRule } from "./schemas";
import {
  isProtectedRedirectPath,
  isUnsafeRedirectDestination,
  normalizeRedirectPath,
} from "./paths";

export interface RedirectValidationContext {
  existingRules: readonly RedirectRule[];
  livePaths: ReadonlySet<string>;
  siteUrl?: string;
}

export interface RedirectValidationError {
  field: "fromPath" | "toPath" | "general";
  message: string;
}

export function validateRedirectRule(
  rule: Pick<RedirectRule, "fromPath" | "toPath" | "statusCode" | "enabled">,
  context: RedirectValidationContext,
  options?: { excludeId?: string; allowDisabledInvalid?: boolean },
): RedirectValidationError[] {
  const errors: RedirectValidationError[] = [];
  const fromPath = normalizeRedirectPath(rule.fromPath);
  const toPath = normalizeRedirectPath(rule.toPath);

  if (!rule.enabled && options?.allowDisabledInvalid) {
    return errors;
  }

  if (isUnsafeRedirectDestination(rule.toPath)) {
    errors.push({
      field: "toPath",
      message: "External and unsafe redirect destinations are not allowed.",
    });
  }

  if (isProtectedRedirectPath(fromPath)) {
    errors.push({
      field: "fromPath",
      message: "This path cannot be redirected.",
    });
  }

  if (
    !isUnsafeRedirectDestination(rule.toPath) &&
    isProtectedRedirectPath(toPath)
  ) {
    errors.push({
      field: "toPath",
      message: "Redirects cannot target protected system paths.",
    });
  }

  if (fromPath === toPath) {
    errors.push({
      field: "toPath",
      message: "Redirect source and destination cannot be the same.",
    });
  }

  if (rule.enabled) {
    for (const existing of context.existingRules) {
      if (options?.excludeId && existing.id === options.excludeId) {
        continue;
      }
      if (existing.enabled && existing.fromPath === fromPath) {
        errors.push({
          field: "fromPath",
          message: "A redirect already exists for this path.",
        });
      }
      if (
        existing.enabled &&
        existing.toPath === fromPath &&
        existing.fromPath === toPath
      ) {
        errors.push({
          field: "general",
          message: "This redirect would create a loop.",
        });
      }
    }
  }

  const isExternal = /^https?:\/\//i.test(toPath);
  if (isExternal) {
    errors.push({
      field: "toPath",
      message: "External redirect destinations are not allowed.",
    });
  }

  if (!isExternal && !context.livePaths.has(toPath) && toPath !== "/") {
    errors.push({
      field: "toPath",
      message: "Destination path does not match a known page route.",
    });
  }

  // Hard block — demo copy said "confirm" but there is no confirm UX.
  if (
    !isExternal &&
    context.livePaths.has(fromPath) &&
    !rule.fromPath.includes("*") &&
    !context.existingRules.some(
      (existing) =>
        existing.enabled &&
        existing.fromPath === fromPath &&
        existing.id !== options?.excludeId,
    )
  ) {
    errors.push({
      field: "fromPath",
      message:
        "This path matches a live page route and cannot be used as a redirect source.",
    });
  }

  return errors;
}

/**
 * Walk exact enabled fromPath hops only (wildcards are not chain steps).
 * Returns null on cycle or when there is no further hop.
 */
export function suggestFlattenedTarget(
  fromPath: string,
  rules: readonly RedirectRule[],
): string | null {
  const normalizedFrom = normalizeRedirectPath(fromPath);
  let current = normalizedFrom;
  const visited = new Set<string>([current]);

  for (let step = 0; step < rules.length + 1; step += 1) {
    const match = rules.find(
      (rule) => rule.enabled && rule.fromPath === current,
    );
    if (!match) {
      break;
    }
    current = normalizeRedirectPath(match.toPath);
    if (visited.has(current)) {
      return null;
    }
    visited.add(current);
  }

  return current !== normalizedFrom ? current : null;
}
