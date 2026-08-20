import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  buildRedirectCreateFields,
  buildRedirectUpdateFields,
  flattenRedirectChainTarget,
  normalizeRedirectPath,
  parseRedirectCsv,
  parseRedirectRule,
  RedirectRuleSchema,
  validateRedirectRule,
  type CreateRedirectInput,
  type ImportRedirectsCsvResponse,
  type RedirectRule,
  type RedirectTarget,
  type UpdateRedirectInput,
} from "../shared/redirects";
import {
  canonicalDirectory,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";
import { readSiteSettings } from "./siteSettings";
import { syncRedirectsInjection } from "./redirectsInjection";
import { syncSnippetsInjection } from "./snippetsInjection";
import { scanProject } from "./workspace";

const REDIRECTS_REL = path.join(".aria", "redirects.json");

function redirectsPath(root: string): string {
  return resolveWithinRoot(root, path.join(root, REDIRECTS_REL), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `redirect-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeStoredRules(raw: unknown): RedirectRule[] {
  if (!Array.isArray(raw)) return [];
  const out: RedirectRule[] = [];
  for (const item of raw) {
    try {
      out.push(parseRedirectRule(item));
    } catch {
      // skip invalid rows
    }
  }
  return out;
}

export function readRedirects(projectPath: string): RedirectRule[] {
  const root = canonicalDirectory(projectPath);
  const file = redirectsPath(root);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (Array.isArray(parsed)) return normalizeStoredRules(parsed);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { redirects?: unknown }).redirects)
    ) {
      return normalizeStoredRules((parsed as { redirects: unknown[] }).redirects);
    }
  } catch {
    return [];
  }
  return [];
}

function writeRedirectsFile(root: string, rules: readonly RedirectRule[]): void {
  const file = redirectsPath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  const normalized = rules.map((rule) => RedirectRuleSchema.parse(rule));
  writeTextFileAtomic(file, `${JSON.stringify(normalized, null, 2)}\n`);
}

function bake(root: string, rules: readonly RedirectRule[]): void {
  const settings = readSiteSettings(root);
  // Redirects unify imports snippets-middleware — ensure it exists first.
  syncSnippetsInjection(root, settings.snippets ?? [], settings.analytics, settings.localization, settings.siteUrl);
  syncRedirectsInjection(root, settings, rules);
}

export function listRedirects(
  projectPath: string,
  options?: { includeDisabled?: boolean },
): RedirectRule[] {
  const rules = readRedirects(projectPath);
  if (options?.includeDisabled === false) {
    return rules.filter((rule) => rule.enabled);
  }
  return rules;
}

export async function loadLiveRedirectPaths(
  projectPath: string,
): Promise<Set<string>> {
  const scan = await scanProject(projectPath);
  const paths = new Set<string>(["/"]);
  for (const page of scan.pages) {
    const route = normalizeRedirectPath(page.route || "/");
    paths.add(route);
  }
  return paths;
}

export async function listRedirectTargets(
  projectPath: string,
): Promise<RedirectTarget[]> {
  const scan = await scanProject(projectPath);
  const byPath = new Map<string, RedirectTarget>();

  byPath.set("/", {
    id: "page:/",
    kind: "page",
    title: "Home",
    path: "/",
  });

  for (const page of scan.pages) {
    const route = normalizeRedirectPath(page.route || "/");
    if (byPath.has(route)) continue;
    byPath.set(route, {
      id: `page:${page.file}`,
      kind: "page",
      title: page.title?.trim() || route,
      path: route,
    });
  }

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export async function createRedirect(
  projectPath: string,
  input: CreateRedirectInput,
): Promise<RedirectRule> {
  const root = canonicalDirectory(projectPath);
  const existing = readRedirects(root);
  const livePaths = await loadLiveRedirectPaths(root);
  const candidate = {
    fromPath: input.fromPath,
    toPath: input.toPath,
    statusCode: input.statusCode ?? 301,
    enabled: input.enabled ?? true,
  };
  const errors = validateRedirectRule(candidate, {
    existingRules: existing,
    livePaths,
  });
  if (errors.length > 0) {
    throw new Error(errors[0]?.message ?? "Invalid redirect");
  }

  const created = buildRedirectCreateFields(input, createId());
  const next = [...existing, created];
  writeRedirectsFile(root, next);
  bake(root, next);
  return created;
}

export async function updateRedirect(
  projectPath: string,
  input: UpdateRedirectInput,
): Promise<RedirectRule> {
  const root = canonicalDirectory(projectPath);
  const existing = readRedirects(root);
  const current = existing.find((rule) => rule.id === input.id);
  if (!current) {
    throw new Error("Redirect not found");
  }

  const updated = buildRedirectUpdateFields(current, input);
  const livePaths = await loadLiveRedirectPaths(root);
  const disableOnly =
    input.enabled === false &&
    input.fromPath === undefined &&
    input.toPath === undefined &&
    input.statusCode === undefined &&
    input.note === undefined;

  const errors = validateRedirectRule(
    updated,
    { existingRules: existing, livePaths },
    {
      excludeId: input.id,
      allowDisabledInvalid: disableOnly,
    },
  );
  if (errors.length > 0) {
    throw new Error(errors[0]?.message ?? "Invalid redirect");
  }

  const next = existing.map((rule) =>
    rule.id === input.id ? updated : rule,
  );
  writeRedirectsFile(root, next);
  bake(root, next);
  return updated;
}

export async function deleteRedirect(
  projectPath: string,
  id: string,
): Promise<{ ok: true }> {
  const root = canonicalDirectory(projectPath);
  const existing = readRedirects(root);
  if (!existing.some((rule) => rule.id === id)) {
    throw new Error("Redirect not found");
  }
  const next = existing.filter((rule) => rule.id !== id);
  writeRedirectsFile(root, next);
  bake(root, next);
  return { ok: true };
}

export async function flattenRedirectChain(
  projectPath: string,
  id: string,
): Promise<RedirectRule> {
  const root = canonicalDirectory(projectPath);
  const existing = readRedirects(root);
  const current = existing.find((rule) => rule.id === id);
  if (!current) {
    throw new Error("Redirect not found");
  }

  const flattened = flattenRedirectChainTarget(current.fromPath, existing);
  if (!flattened) {
    throw new Error("Unable to flatten redirect chain.");
  }

  const updated: RedirectRule = {
    ...current,
    toPath: flattened,
    updatedAt: new Date().toISOString(),
  };
  const next = existing.map((rule) => (rule.id === id ? updated : rule));
  writeRedirectsFile(root, next);
  bake(root, next);
  return updated;
}

export async function importRedirectsCsv(
  projectPath: string,
  csv: string,
  replaceExisting = false,
): Promise<ImportRedirectsCsvResponse> {
  const root = canonicalDirectory(projectPath);
  let existing = readRedirects(root);
  const livePaths = await loadLiveRedirectPaths(root);

  if (replaceExisting) {
    existing = [];
  }

  const parsed = parseRedirectCsv(csv);
  const errors = [...parsed.errors];
  let imported = 0;
  let skipped = parsed.skipped;

  for (const row of parsed.rows) {
    const candidate = {
      fromPath: row.fromPath,
      toPath: row.toPath,
      statusCode: row.statusCode,
      enabled: true,
    };
    const validationErrors = validateRedirectRule(candidate, {
      existingRules: existing,
      livePaths,
    });
    if (validationErrors.length > 0) {
      errors.push(
        `Line ${row.lineNumber}: ${validationErrors[0]?.message ?? "Invalid redirect"}`,
      );
      skipped += 1;
      continue;
    }

    const created = buildRedirectCreateFields(candidate, createId());
    existing = [...existing, created];
    imported += 1;
  }

  writeRedirectsFile(root, existing);
  bake(root, existing);

  return { imported, skipped, errors };
}

/** Re-bake middleware from disk (e.g. trailing-slash policy change / runtime start). */
export function syncRedirectsFromDisk(projectPath: string): void {
  const root = canonicalDirectory(projectPath);
  bake(root, readRedirects(root));
}
