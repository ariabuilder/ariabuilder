import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { dialog, type BrowserWindow } from "./electron-api";
import { discoverProjectFavicon } from "./faviconDiscover";
import {
  canonicalDirectory,
  canonicalPathAllowMissing,
  copyFileTracked,
  isPathInside,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";
import type { SiteSettings } from "../shared/types";
import type {
  AnalyticsProviderId,
  AnalyticsSettings,
  CodeSnippet,
  CodeSnippetPlacement,
  ComponentGroupingState,
  ComponentGroup,
  MediaGroupingState,
  MediaGroup,
  DiscoverySettings,
  SeoManagementState,
  SeoSourceScanResult,
} from "../shared/types";
import { ANALYTICS_PROVIDER_IDS } from "../shared/types";
import {
  DEFAULT_DISCOVERY_SETTINGS,
  parseDiscoverySettings,
  mergeDiscoverySettings,
} from "../shared/crawl";
import {
  parseAgentSettings,
  type AgentSettings,
} from "../shared/agent";
import {
  DEFAULT_CONTENT_LOCALIZATION,
  assertContentLocalization,
  parseContentLocalization,
  type ContentLocalizationSettings,
} from "../shared/localization";
import { syncSnippetsInjection } from "./snippetsInjection";
import { syncManagedSeoAndDiscovery } from "./seoSync";
import { readRedirects } from "./redirects";
import { syncRedirectsInjection } from "./redirectsInjection";

export type {
  SiteSettings,
  AnalyticsSettings,
  AnalyticsProviderId,
  CodeSnippet,
  CodeSnippetPlacement,
  ComponentGroupingState,
  ComponentGroup,
  MediaGroupingState,
  MediaGroup,
  DiscoverySettings,
  SeoManagementState,
  SeoSourceScanResult,
} from "../shared/types";

const CODE_SNIPPET_PLACEMENTS = new Set<CodeSnippetPlacement>([
  "header",
  "body",
  "footer",
]);

const MAX_SNIPPETS = 100;
const MAX_SNIPPET_ID = 128;
const MAX_SNIPPET_NAME = 200;
const MAX_SNIPPET_CODE = 50_000;
const MAX_ANALYTICS_FIELD_VALUE = 2_048;

const ANALYTICS_PROVIDER_ID_SET = new Set<string>(ANALYTICS_PROVIDER_IDS);

export const DEFAULT_ANALYTICS_SETTINGS: AnalyticsSettings = {
  version: 1,
  activeProviders: [],
  providers: {},
};

const LEGACY_CUSTOM_CODE_KEYS = [
  "customHeadCode",
  "customBodyCode",
  "customFooterCode",
] as const;

export const DEFAULT_SITE_TIME_ZONE = "UTC";

const EMPTY_SETTINGS: SiteSettings = {
  siteName: "",
  siteDescription: "",
  siteUrl: "",
  timeZone: DEFAULT_SITE_TIME_ZONE,
  favicon: "",
  discovery: { ...DEFAULT_DISCOVERY_SETTINGS },
  seoManagement: { status: "unmanaged" },
  localization: {
    content: parseContentLocalization(DEFAULT_CONTENT_LOCALIZATION),
  },
};

/** Site-settings JSON can include custom discovery artifacts (up to ~1MB). */
const MAX_SETTINGS_FILE_BYTES = 2 * 1024 * 1024;

const EMPTY_GROUPING: ComponentGroupingState = {
  groups: [],
  assignments: {},
};

const EMPTY_MEDIA_GROUPING: MediaGroupingState = {
  groups: [],
  assignments: {},
};

function settingsPath(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  const ariaDir = resolveWithinRoot(root, path.join(root, ".aria"), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  return resolveWithinRoot(root, path.join(ariaDir, "site-settings.json"), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

function normalizeComponentGrouping(raw: unknown): ComponentGroupingState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_GROUPING, assignments: {} };
  const o = raw as Record<string, unknown>;
  const groups: ComponentGroup[] = [];
  if (Array.isArray(o.groups)) {
    for (const item of o.groups) {
      if (!item || typeof item !== "object") continue;
      const g = item as Record<string, unknown>;
      const id = typeof g.id === "string" ? g.id.trim() : "";
      const name = typeof g.name === "string" ? g.name.trim() : "";
      if (!id || !name) continue;
      if (id.length > 128 || name.length > 200) continue;
      groups.push({ id, name });
    }
  }
  const assignments: Record<string, string> = {};
  if (o.assignments && typeof o.assignments === "object" && !Array.isArray(o.assignments)) {
    for (const [key, value] of Object.entries(
      o.assignments as Record<string, unknown>,
    )) {
      if (typeof key !== "string" || typeof value !== "string") continue;
      const id = key.trim();
      const groupId = value.trim();
      if (!id || !groupId) continue;
      if (id.length > 1024 || groupId.length > 128) continue;
      assignments[id] = groupId;
    }
  }
  if (groups.length > 500) {
    throw new Error("Too many component groups");
  }
  if (Object.keys(assignments).length > 10_000) {
    throw new Error("Too many component assignments");
  }
  return { groups, assignments };
}

function normalizeMediaGrouping(raw: unknown): MediaGroupingState {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_MEDIA_GROUPING, assignments: {} };
  }
  const o = raw as Record<string, unknown>;
  const groups: MediaGroup[] = [];
  if (Array.isArray(o.groups)) {
    for (const item of o.groups) {
      if (!item || typeof item !== "object") continue;
      const g = item as Record<string, unknown>;
      const id = typeof g.id === "string" ? g.id.trim() : "";
      const name = typeof g.name === "string" ? g.name.trim() : "";
      if (!id || !name) continue;
      if (id.length > 128 || name.length > 200) continue;
      groups.push({ id, name });
    }
  }
  const assignments: Record<string, string> = {};
  if (
    o.assignments &&
    typeof o.assignments === "object" &&
    !Array.isArray(o.assignments)
  ) {
    for (const [key, value] of Object.entries(
      o.assignments as Record<string, unknown>,
    )) {
      if (typeof key !== "string" || typeof value !== "string") continue;
      const id = key.trim();
      const groupId = value.trim();
      if (!id || !groupId) continue;
      if (id.length > 1024 || groupId.length > 128) continue;
      assignments[id] = groupId;
    }
  }
  if (groups.length > 500) {
    throw new Error("Too many media groups");
  }
  if (Object.keys(assignments).length > 10_000) {
    throw new Error("Too many media assignments");
  }
  return { groups, assignments };
}

function isCodeSnippetPlacement(value: unknown): value is CodeSnippetPlacement {
  return typeof value === "string" && CODE_SNIPPET_PLACEMENTS.has(value as CodeSnippetPlacement);
}

function normalizeSnippets(raw: unknown): CodeSnippet[] {
  if (!Array.isArray(raw)) return [];
  const snippets: CodeSnippet[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const code = typeof o.code === "string" ? o.code : "";
    if (!id || !isCodeSnippetPlacement(o.placement)) continue;
    if (id.length > MAX_SNIPPET_ID || name.length > MAX_SNIPPET_NAME) continue;
    if (code.length > MAX_SNIPPET_CODE) continue;
    snippets.push({
      id,
      name,
      placement: o.placement,
      code,
      enabled: o.enabled !== false,
    });
    if (snippets.length >= MAX_SNIPPETS) break;
  }
  return snippets;
}

/** Convert aria-demo customHead/Body/FooterCode into snippets when no snippets key yet. */
function migrateLegacyCustomCode(
  o: Record<string, unknown>,
): CodeSnippet[] | undefined {
  if ("snippets" in o) return undefined;
  const pairs: Array<{
    key: (typeof LEGACY_CUSTOM_CODE_KEYS)[number];
    placement: CodeSnippetPlacement;
    name: string;
  }> = [
    { key: "customHeadCode", placement: "header", name: "Header code" },
    { key: "customBodyCode", placement: "body", name: "Body code" },
    { key: "customFooterCode", placement: "footer", name: "Footer code" },
  ];
  const snippets: CodeSnippet[] = [];
  for (const { key, placement, name } of pairs) {
    const code = typeof o[key] === "string" ? o[key] : "";
    if (!code.trim()) continue;
    snippets.push({
      id: `legacy-${placement}`,
      name,
      placement,
      code: code.slice(0, MAX_SNIPPET_CODE),
      enabled: true,
    });
  }
  return snippets.length > 0 ? snippets : undefined;
}

function normalizeOptionalString(
  value: unknown,
  max: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function normalizeSeoManagement(raw: unknown): SeoManagementState {
  if (!raw || typeof raw !== "object") return { status: "unmanaged" };
  const o = raw as Record<string, unknown>;
  const status = o.status === "managed" ? "managed" : "unmanaged";
  const state: SeoManagementState = { status };
  if (typeof o.detectedAt === "string") state.detectedAt = o.detectedAt;
  if (typeof o.managedAt === "string") state.managedAt = o.managedAt;
  if (o.lastScan && typeof o.lastScan === "object") {
    state.lastScan = o.lastScan as SeoSourceScanResult;
  }
  return state;
}

function normalizeDiscovery(raw: unknown): DiscoverySettings {
  try {
    return parseDiscoverySettings(raw ?? {});
  } catch {
    return { ...DEFAULT_DISCOVERY_SETTINGS };
  }
}

function isAnalyticsProviderId(value: unknown): value is AnalyticsProviderId {
  return typeof value === "string" && ANALYTICS_PROVIDER_ID_SET.has(value);
}

function normalizeAnalyticsProviderFields(
  raw: unknown,
): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || !key.trim()) continue;
    if (typeof value !== "string") continue;
    if (value.length > MAX_ANALYTICS_FIELD_VALUE) continue;
    out[key] = value;
  }
  return out;
}

export function normalizeAnalyticsSettings(raw: unknown): AnalyticsSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      version: 1,
      activeProviders: [],
      providers: {},
    };
  }
  const o = raw as Record<string, unknown>;
  const providersRaw =
    o.providers && typeof o.providers === "object" && !Array.isArray(o.providers)
      ? (o.providers as Record<string, unknown>)
      : {};
  const providers: AnalyticsSettings["providers"] = {};
  for (const [id, fields] of Object.entries(providersRaw)) {
    if (!isAnalyticsProviderId(id)) continue;
    providers[id] = normalizeAnalyticsProviderFields(fields);
  }

  const activeRaw = Array.isArray(o.activeProviders) ? o.activeProviders : [];
  const activeProviders: AnalyticsProviderId[] = [];
  for (const id of activeRaw) {
    if (!isAnalyticsProviderId(id)) continue;
    if (activeProviders.includes(id)) continue;
    // Ensure active providers always have a providers entry.
    if (!(id in providers)) providers[id] = {};
    activeProviders.push(id);
  }

  return {
    version: 1,
    activeProviders,
    providers,
  };
}

function normalizeSettings(raw: unknown): SiteSettings {
  if (!raw || typeof raw !== "object") {
    return {
      ...EMPTY_SETTINGS,
      discovery: { ...DEFAULT_DISCOVERY_SETTINGS },
      seoManagement: { status: "unmanaged" },
      analytics: { ...DEFAULT_ANALYTICS_SETTINGS, providers: {} },
    };
  }
  const o = raw as Record<string, unknown>;
  const timeZone =
    typeof o.timeZone === "string" && o.timeZone.trim()
      ? o.timeZone.trim()
      : DEFAULT_SITE_TIME_ZONE;
  const settings: SiteSettings = {
    siteName: typeof o.siteName === "string" ? o.siteName : "",
    siteDescription:
      typeof o.siteDescription === "string" ? o.siteDescription : "",
    siteUrl: typeof o.siteUrl === "string" ? o.siteUrl : "",
    timeZone,
    favicon: typeof o.favicon === "string" ? o.favicon : "",
    seoTitle: normalizeOptionalString(o.seoTitle, 200),
    seoDescription: normalizeOptionalString(o.seoDescription, 2_000),
    seoKeywords: normalizeOptionalString(o.seoKeywords, 500),
    ogImage: normalizeOptionalString(o.ogImage, 2_048),
    twitterCard: normalizeOptionalString(o.twitterCard, 64),
    customDomain: normalizeOptionalString(o.customDomain, 256),
    discovery: normalizeDiscovery(o.discovery),
    seoManagement: normalizeSeoManagement(o.seoManagement),
    analytics: normalizeAnalyticsSettings(o.analytics),
    localization: {
      content: parseContentLocalization(
        o.localization && typeof o.localization === "object"
          ? (o.localization as Record<string, unknown>).content
          : undefined,
      ),
    },
  };
  if ("componentGrouping" in o) {
    settings.componentGrouping = normalizeComponentGrouping(o.componentGrouping);
  }
  if ("mediaGrouping" in o) {
    settings.mediaGrouping = normalizeMediaGrouping(o.mediaGrouping);
  }
  if ("snippets" in o) {
    settings.snippets = normalizeSnippets(o.snippets);
  } else {
    const migrated = migrateLegacyCustomCode(o);
    if (migrated) settings.snippets = migrated;
  }
  if ("agent" in o) {
    settings.agent = parseAgentSettings(o.agent);
  }
  return settings;
}

function readRawSettingsObject(projectPath: string): Record<string, unknown> {
  const file = settingsPath(projectPath);
  if (!existsSync(file)) return {};
  try {
    if (!statSync(file).isFile() || statSync(file).size > MAX_SETTINGS_FILE_BYTES) {
      throw new Error("settings file is too large or is not a file");
    }
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Site settings could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function writeRawSettingsObject(
  projectPath: string,
  next: Record<string, unknown>,
): void {
  const root = canonicalDirectory(projectPath);
  const dir = resolveWithinRoot(root, path.join(root, ".aria"), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  mkdirSync(dir, { recursive: true });
  writeTextFileAtomic(settingsPath(root), `${JSON.stringify(next, null, 2)}\n`);
}

export function readSiteSettings(projectPath: string): SiteSettings {
  const file = settingsPath(projectPath);
  let settings: SiteSettings = { ...EMPTY_SETTINGS };

  if (existsSync(file)) {
    try {
      if (!statSync(file).isFile() || statSync(file).size > MAX_SETTINGS_FILE_BYTES) {
        throw new Error("settings file is too large or is not a file");
      }
      settings = normalizeSettings(JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      throw new Error(
        `Site settings could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // If unset or the stored file is missing, surface favicon from layouts/pages/public.
  const stored = settings.favicon.trim();
  const storedResolves = stored ? !!resolveFaviconAsset(projectPath, stored) : false;
  if (!stored || !storedResolves) {
    const discovered = discoverProjectFavicon(projectPath);
    if (discovered) {
      settings = { ...settings, favicon: discovered };
    }
  }

  return settings;
}

/**
 * Persist agent-only settings without regenerating site output artifacts.
 *
 * Provider catalog reconciliation can happen while the Agent settings surface
 * is mounting. Routing that write through writeSiteSettings() also rewrites
 * snippets, redirects, and SEO middleware, which wakes the project watcher and
 * can interrupt an unrelated workspace navigation.
 */
export function writeAgentSettings(
  projectPath: string,
  next: unknown,
): AgentSettings {
  const agent = parseAgentSettings(next);
  const existing = readRawSettingsObject(projectPath);
  writeRawSettingsObject(projectPath, {
    ...existing,
    agent,
  });
  return agent;
}

export function readComponentGrouping(
  projectPath: string,
): ComponentGroupingState {
  const raw = readRawSettingsObject(projectPath);
  return normalizeComponentGrouping(raw.componentGrouping);
}

export function writeComponentGrouping(
  projectPath: string,
  next: unknown,
): ComponentGroupingState {
  const grouping = normalizeComponentGrouping(next);
  const raw = readRawSettingsObject(projectPath);
  const normalized = normalizeSettings({
    ...raw,
    componentGrouping: grouping,
  });
  // Preserve identity fields + grouping; avoid dropping unknown keys from disk.
  writeRawSettingsObject(projectPath, {
    ...raw,
    siteName: normalized.siteName,
    siteDescription: normalized.siteDescription,
    siteUrl: normalized.siteUrl,
    timeZone: normalized.timeZone,
    favicon: normalized.favicon,
    componentGrouping: grouping,
    ...(normalized.mediaGrouping
      ? { mediaGrouping: normalized.mediaGrouping }
      : "mediaGrouping" in raw
        ? { mediaGrouping: normalizeMediaGrouping(raw.mediaGrouping) }
        : {}),
  });
  return grouping;
}

export function readMediaGrouping(projectPath: string): MediaGroupingState {
  const raw = readRawSettingsObject(projectPath);
  return normalizeMediaGrouping(raw.mediaGrouping);
}

export function writeMediaGrouping(
  projectPath: string,
  next: unknown,
): MediaGroupingState {
  const grouping = normalizeMediaGrouping(next);
  const raw = readRawSettingsObject(projectPath);
  const normalized = normalizeSettings({
    ...raw,
    mediaGrouping: grouping,
  });
  writeRawSettingsObject(projectPath, {
    ...raw,
    siteName: normalized.siteName,
    siteDescription: normalized.siteDescription,
    siteUrl: normalized.siteUrl,
    timeZone: normalized.timeZone,
    favicon: normalized.favicon,
    mediaGrouping: grouping,
    ...(normalized.componentGrouping
      ? { componentGrouping: normalized.componentGrouping }
      : "componentGrouping" in raw
        ? {
            componentGrouping: normalizeComponentGrouping(
              raw.componentGrouping,
            ),
          }
        : {}),
  });
  return grouping;
}

export function writeSiteSettings(
  projectPath: string,
  next: SiteSettings,
  options: { replaceLocalization?: boolean } = {},
): SiteSettings {
  const root = canonicalDirectory(projectPath);
  if (!next || typeof next !== "object") throw new Error("Invalid site settings");
  const raw = next as Record<string, unknown>;
  const normalized = normalizeSettings(next);
  for (const [key, max] of [
    ["siteName", 200],
    ["siteDescription", 2_000],
    ["siteUrl", 2_048],
    ["timeZone", 128],
    ["favicon", 2_048],
  ] as const) {
    const value = raw[key];
    if (typeof value !== "string" || value.length > max) {
      throw new Error(`Invalid site setting: ${key}`);
    }
  }
  for (const [key, max] of [
    ["seoTitle", 200],
    ["seoDescription", 2_000],
    ["seoKeywords", 500],
    ["ogImage", 2_048],
    ["twitterCard", 64],
    ["customDomain", 256],
  ] as const) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || value.length > max) {
      throw new Error(`Invalid site setting: ${key}`);
    }
  }
  if (normalized.siteUrl.trim()) {
    let url: URL;
    try {
      url = new URL(normalized.siteUrl.trim());
    } catch {
      throw new Error("Site URL must be a valid http(s) URL");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Site URL must be a valid http(s) URL");
    }
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized.timeZone.trim() });
  } catch {
    throw new Error("Invalid time zone");
  }
  const dir = resolveWithinRoot(root, path.join(root, ".aria"), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  mkdirSync(dir, { recursive: true });
  const existing = readRawSettingsObject(root);
  const existingNormalized = normalizeSettings(existing);
  const includes = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(raw, key);
  const payload: Record<string, unknown> = {
    ...existing,
    siteName: normalized.siteName,
    siteDescription: normalized.siteDescription,
    siteUrl: normalized.siteUrl,
    timeZone: normalized.timeZone,
    favicon: normalized.favicon,
    seoTitle: includes("seoTitle")
      ? normalized.seoTitle ?? ""
      : existingNormalized.seoTitle ?? "",
    seoDescription: includes("seoDescription")
      ? normalized.seoDescription ?? ""
      : existingNormalized.seoDescription ?? "",
    seoKeywords: includes("seoKeywords")
      ? normalized.seoKeywords ?? ""
      : existingNormalized.seoKeywords ?? "",
    ogImage: includes("ogImage")
      ? normalized.ogImage ?? ""
      : existingNormalized.ogImage ?? "",
    twitterCard: includes("twitterCard")
      ? normalized.twitterCard ?? ""
      : existingNormalized.twitterCard ?? "",
    customDomain: includes("customDomain")
      ? normalized.customDomain ?? ""
      : existingNormalized.customDomain ?? "",
    discovery: includes("discovery")
      ? normalized.discovery ?? { ...DEFAULT_DISCOVERY_SETTINGS }
      : existingNormalized.discovery ?? { ...DEFAULT_DISCOVERY_SETTINGS },
    seoManagement: includes("seoManagement")
      ? normalized.seoManagement ?? ({ status: "unmanaged" } satisfies SeoManagementState)
      : existingNormalized.seoManagement ?? ({ status: "unmanaged" } satisfies SeoManagementState),
    localization: options.replaceLocalization || (!("localization" in existing) && includes("localization"))
      ? {
          content: assertContentLocalization(
            raw.localization && typeof raw.localization === "object"
              ? (raw.localization as Record<string, unknown>).content
              : undefined,
          ),
        }
      : existing.localization && typeof existing.localization === "object"
        ? existing.localization
        : existingNormalized.localization ?? {
            content: parseContentLocalization(DEFAULT_CONTENT_LOCALIZATION),
          },
  };
  // Preserve grouping unless the caller explicitly includes it.
  if (next.componentGrouping !== undefined) {
    payload.componentGrouping = normalizeComponentGrouping(next.componentGrouping);
  } else if (existing.componentGrouping !== undefined) {
    payload.componentGrouping = existing.componentGrouping;
  }
  // Preserve media grouping written by Media surface.
  if (next.mediaGrouping !== undefined) {
    payload.mediaGrouping = normalizeMediaGrouping(next.mediaGrouping);
  } else if (existing.mediaGrouping !== undefined) {
    payload.mediaGrouping = existing.mediaGrouping;
  }
  // Preserve snippets unless the caller explicitly includes them.
  if (next.snippets !== undefined) {
    payload.snippets = normalizeSnippets(next.snippets);
    // Converge away from aria-demo's three fixed custom-code fields.
    for (const key of LEGACY_CUSTOM_CODE_KEYS) {
      delete payload[key];
    }
  } else if (existing.snippets !== undefined) {
    payload.snippets = normalizeSnippets(existing.snippets);
  }
  // Preserve analytics unless the caller explicitly includes them.
  if (next.analytics !== undefined) {
    payload.analytics = normalizeAnalyticsSettings(next.analytics);
  } else if (existing.analytics !== undefined) {
    payload.analytics = normalizeAnalyticsSettings(existing.analytics);
  } else {
    payload.analytics = {
      version: 1,
      activeProviders: [],
      providers: {},
    };
  }
  // Preserve agent settings unless the caller explicitly includes them.
  if (next.agent !== undefined) {
    payload.agent = parseAgentSettings(next.agent);
  } else if (existing.agent !== undefined) {
    payload.agent = parseAgentSettings(existing.agent);
  }
  // Discovery / SEO management: use caller value when present, else preserve.
  if (next.discovery !== undefined) {
    payload.discovery = normalizeDiscovery(next.discovery);
  }
  if (next.seoManagement !== undefined) {
    payload.seoManagement = normalizeSeoManagement(next.seoManagement);
  }
  writeTextFileAtomic(settingsPath(root), `${JSON.stringify(payload, null, 2)}\n`);
  const normalizedResult = normalizeSettings(payload);
  // Bake enabled snippets + analytics into Astro middleware for Stage / future builds.
  syncSnippetsInjection(
    root,
    normalizedResult.snippets ?? [],
    normalizedResult.analytics,
    normalizedResult.localization,
    normalizedResult.siteUrl,
  );
  // Always bake redirects + trailing-slash middleware (not SEO-gated).
  syncRedirectsInjection(root, normalizedResult, readRedirects(root));
  // When Aria manages SEO, bake head injection + discovery routes.
  syncManagedSeoAndDiscovery(root, normalizedResult);
  return normalizedResult;
}

/** Re-bake snippet/analytics middleware from current settings without rewriting JSON. */
export function bakeSnippetsInjection(projectPath: string): SiteSettings {
  const root = canonicalDirectory(projectPath);
  const settings = readSiteSettings(root);
  syncSnippetsInjection(
    root,
    settings.snippets ?? [],
    settings.analytics,
    settings.localization,
    settings.siteUrl,
  );
  return settings;
}

/** Replace analytics settings and persist. */
export function updateAnalyticsSettings(
  projectPath: string,
  analytics: AnalyticsSettings,
): SiteSettings {
  const current = readSiteSettings(projectPath);
  return writeSiteSettings(projectPath, {
    ...current,
    analytics: normalizeAnalyticsSettings(analytics),
  });
}

/** Replace the public content locale policy and persist it atomically. */
export function updateContentLocalization(
  projectPath: string,
  content: ContentLocalizationSettings,
): SiteSettings {
  const current = readSiteSettings(projectPath);
  return writeSiteSettings(
    projectPath,
    {
      ...current,
      localization: { content: assertContentLocalization(content) },
    },
    { replaceLocalization: true },
  );
}

/** Patch discovery settings and persist. */
export function updateDiscoverySettings(
  projectPath: string,
  patch: Partial<DiscoverySettings>,
): SiteSettings {
  const current = readSiteSettings(projectPath);
  const merged = mergeDiscoverySettings(current.discovery, patch);
  return writeSiteSettings(projectPath, {
    ...current,
    discovery: merged,
  });
}

/** Patch site SEO defaults and persist. */
export function updateSeoDefaults(
  projectPath: string,
  patch: {
    seoTitle?: string;
    seoDescription?: string;
    ogImage?: string;
    seoKeywords?: string;
    twitterCard?: string;
  },
): SiteSettings {
  const current = readSiteSettings(projectPath);
  return writeSiteSettings(projectPath, {
    ...current,
    seoTitle: patch.seoTitle !== undefined ? patch.seoTitle : current.seoTitle,
    seoDescription:
      patch.seoDescription !== undefined
        ? patch.seoDescription
        : current.seoDescription,
    ogImage: patch.ogImage !== undefined ? patch.ogImage : current.ogImage,
    seoKeywords:
      patch.seoKeywords !== undefined ? patch.seoKeywords : current.seoKeywords,
    twitterCard:
      patch.twitterCard !== undefined ? patch.twitterCard : current.twitterCard,
  });
}

function publicDir(projectPath: string): string {
  return path.join(path.resolve(projectPath), "public");
}

/** Resolve a stored favicon path (`/foo.svg`) to an absolute file under public/. */
export function resolvePublicAsset(
  projectPath: string,
  publicUrlPath: string,
): string | null {
  const trimmed = publicUrlPath.trim();
  if (!trimmed.startsWith("/")) return null;
  const rel = trimmed.replace(/^\/+/, "");
  if (!rel || rel.includes("..") || path.isAbsolute(rel)) return null;
  const root = canonicalDirectory(projectPath);
  const publicRoot = canonicalPathAllowMissing(publicDir(root));
  if (!isPathInside(root, publicRoot)) return null;
  try {
    const resolved = resolveWithinRoot(publicRoot, path.join(publicRoot, rel), {
      rejectFinalSymlink: true,
    });
    return MIME[path.extname(resolved).toLowerCase()] ? resolved : null;
  } catch {
    return null;
  }
}

/** Resolve public URL or project-relative source asset for favicon preview. */
export function resolveFaviconAsset(
  projectPath: string,
  faviconPath: string,
): string | null {
  const trimmed = faviconPath.trim();
  if (!trimmed) return null;

  const fromPublic = resolvePublicAsset(projectPath, trimmed);
  if (fromPublic) return fromPublic;

  // Project-relative source asset (e.g. src/assets/favicon.svg)
  if (trimmed.startsWith("/") || trimmed.includes("://") || path.isAbsolute(trimmed)) {
    return null;
  }
  if (trimmed.includes("..")) return null;
  const root = canonicalDirectory(projectPath);
  try {
    const resolved = resolveWithinRoot(root, path.resolve(root, trimmed), {
      rejectFinalSymlink: true,
    });
    return MIME[path.extname(resolved).toLowerCase()] ? resolved : null;
  } catch {
    return null;
  }
}

const MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export function readPublicAssetDataUrl(
  projectPath: string,
  publicUrlPath: string,
): string | null {
  const absolute = resolveFaviconAsset(projectPath, publicUrlPath);
  if (!absolute) return null;
  const ext = path.extname(absolute).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  if (statSync(absolute).size > 2 * 1024 * 1024) return null;
  const buf = readFileSync(absolute);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export async function pickFaviconFile(
  win: BrowserWindow | null,
): Promise<{ filePath: string } | { canceled: true }> {
  const options = {
    title: "Choose favicon",
    properties: ["openFile" as const],
    filters: [
      {
        name: "Images",
        extensions: ["svg", "png", "ico", "jpg", "jpeg", "webp", "gif"],
      },
    ],
  }
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  return { filePath: result.filePaths[0] };
}

export function installFaviconFile(
  projectPath: string,
  source: string,
): { favicon: string } {
  const root = canonicalDirectory(projectPath);

  const ext = path.extname(source).toLowerCase() || ".png";
  const destName = `favicon${ext}`;
  const destDir = publicDir(root);
  const dest = resolveWithinRoot(root, path.join(destDir, destName), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileTracked(source, dest);
  return { favicon: `/${destName}` };
}
