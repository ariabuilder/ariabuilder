import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  classifyInjectionHtml,
  providerPrimaryValue,
} from "../shared/analytics/fingerprints";
import { resolveSourceFields } from "../shared/analytics/sourceExpressions";
import { ANALYTICS_PROVIDER_MAP } from "../shared/analytics/providers";
import type {
  InjectionScanResult,
  InjectionScope,
  InjectionSpan,
  SourceInjectionFinding,
} from "../shared/injections";
import type { AnalyticsProviderId, CodeSnippetPlacement } from "../shared/types";
import { canonicalDirectory, isPathInside } from "./pathSafety";

const SOURCE_EXTS = new Set([".astro", ".md", ".mdx"]);
const MAX_FILES = 400;
const MAX_DEPTH = 12;
const MAX_FILE_BYTES = 512 * 1024;

const SCRIPT_RE =
  /<script\b([^>]*?)(?:\/>|>([\s\S]*?)<\/script>)/gi;
const NOSCRIPT_RE =
  /<noscript\b([^>]*?)>([\s\S]*?)<\/noscript>/gi;
const DISABLED_REGION_RE =
  /<!--\s*aria:injection-disabled-begin\s*-->[\s\S]*?<!--\s*aria:injection-disabled-end\s*-->/gi;
const NAME_COMMENT_RE =
  /<!--\s*aria:snippet-name:\s*(.*?)\s*-->/gi;

type RawTag = {
  start: number;
  end: number;
  html: string;
  kind: "script" | "noscript";
};

type DisabledRegion = { start: number; end: number };

function parseEnvFile(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function loadProjectEnv(root: string): Record<string, string> {
  const names = [
    ".env",
    ".env.local",
    ".env.development",
    ".env.development.local",
  ];
  const values: Record<string, string> = {};
  for (const name of names) {
    const raw = readSafe(path.join(root, name));
    if (!raw) continue;
    Object.assign(values, parseEnvFile(raw));
  }
  return values;
}

function walkFiles(
  dir: string,
  root: string,
  exts: Set<string>,
  out: string[],
  depth = 0,
): void {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (!isPathInside(root, full)) continue;
    if (entry.isDirectory()) {
      walkFiles(full, root, exts, out, depth + 1);
      continue;
    }
    if (exts.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

function relPosix(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function readSafe(file: string): string | null {
  try {
    if (!statSync(file).isFile() || statSync(file).size > MAX_FILE_BYTES) {
      return null;
    }
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function scopeForFile(relative: string): InjectionScope | null {
  if (relative.startsWith("src/aria/") || relative === "src/aria") return null;
  if (relative.startsWith("src/layouts/")) return "layout";
  if (relative.startsWith("src/pages/")) return "page";
  if (relative.startsWith("src/components/")) return "component";
  return null;
}

function getAttr(openAttrs: string, name: string): string | undefined {
  const re = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = openAttrs.match(re);
  if (!match) return undefined;
  const value = match[1] ?? match[2] ?? match[3];
  return value?.trim() || undefined;
}

function hasAttr(openAttrs: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)${name}(?:\\s|=|\\/|$)`, "i").test(openAttrs);
}

function isHttpSrc(src: string | undefined): boolean {
  if (!src) return false;
  return /^(https?:)?\/\//i.test(src);
}

function looksLikeModuleScript(inner: string): boolean {
  const trimmed = inner.trim();
  if (!trimmed) return true;
  if (/^(?:import|export)\b/m.test(trimmed)) return true;
  if (/\bimport\s*(?:type\s+)?[\w*{]/.test(trimmed) && /\bfrom\s+['"]/.test(trimmed)) {
    return true;
  }
  return false;
}

function isSkippedType(openAttrs: string): boolean {
  const type = (getAttr(openAttrs, "type") ?? "").toLowerCase();
  if (
    type === "application/ld+json" ||
    type === "application/json" ||
    type === "importmap" ||
    type === "speculationrules"
  ) {
    return true;
  }
  const lang = (getAttr(openAttrs, "lang") ?? "").toLowerCase();
  return lang === "ts" || lang === "tsx" || lang === "js" || lang === "jsx";
}

function isInjectionCandidate(openAttrs: string, inner: string, html: string): boolean {
  if (isSkippedType(openAttrs)) return false;
  const src = getAttr(openAttrs, "src");
  const classified = classifyInjectionHtml(html);
  if (classified.kind === "analytics") return true;
  if (isHttpSrc(src)) return true;
  if (hasAttr(openAttrs, "is:inline")) return inner.trim().length > 0 || Boolean(src);
  if (looksLikeModuleScript(inner)) return false;
  if (src) return false;
  return /https?:\/\//i.test(inner) || /createElement\s*\(\s*['"]script['"]/i.test(inner);
}

function collectTags(source: string): RawTag[] {
  const tags: RawTag[] = [];
  SCRIPT_RE.lastIndex = 0;
  for (const match of source.matchAll(SCRIPT_RE)) {
    const index = match.index ?? 0;
    tags.push({
      start: index,
      end: index + match[0].length,
      html: match[0],
      kind: "script",
    });
  }
  NOSCRIPT_RE.lastIndex = 0;
  for (const match of source.matchAll(NOSCRIPT_RE)) {
    const index = match.index ?? 0;
    tags.push({
      start: index,
      end: index + match[0].length,
      html: match[0],
      kind: "noscript",
    });
  }
  tags.sort((a, b) => a.start - b.start);
  return tags;
}

function disabledRegions(source: string): DisabledRegion[] {
  const regions: DisabledRegion[] = [];
  DISABLED_REGION_RE.lastIndex = 0;
  for (const match of source.matchAll(DISABLED_REGION_RE)) {
    const index = match.index ?? 0;
    regions.push({ start: index, end: index + match[0].length });
  }
  return regions;
}

function isInside(offset: number, regions: DisabledRegion[]): boolean {
  return regions.some((region) => offset >= region.start && offset < region.end);
}

function inferPlacement(source: string, offset: number): CodeSnippetPlacement {
  const before = source.slice(0, offset);
  const after = source.slice(offset);
  const headOpen = before.toLowerCase().lastIndexOf("<head");
  const headCloseBefore = before.toLowerCase().lastIndexOf("</head");
  const bodyOpen = before.toLowerCase().lastIndexOf("<body");
  const bodyCloseBefore = before.toLowerCase().lastIndexOf("</body");
  const nextHeadClose = after.search(/<\/head>/i);

  const insideHead = headOpen >= 0 && headOpen > headCloseBefore && headOpen > bodyOpen;
  if (insideHead) return "header";
  if (headOpen > headCloseBefore && nextHeadClose >= 0 && (bodyOpen < 0 || headOpen > bodyOpen)) {
    return "header";
  }

  const insideBody = bodyOpen >= 0 && bodyOpen > bodyCloseBefore;
  if (insideBody) {
    const bodyTagEnd = source.indexOf(">", bodyOpen);
    const distFromBody = offset - (bodyTagEnd >= 0 ? bodyTagEnd : bodyOpen);
    const nextBodyClose = after.search(/<\/body>/i);
    if (nextBodyClose >= 0 && (nextBodyClose < distFromBody || nextBodyClose < 400)) {
      return "footer";
    }
    if (distFromBody < 800) return "body";
    return "footer";
  }

  return "header";
}

function normalizeHtml(html: string): string {
  return html.replace(/\s+/g, " ").trim();
}

function fingerprintCode(code: string): string {
  return createHash("sha1").update(normalizeHtml(code)).digest("hex").slice(0, 12);
}

function nameFromComment(source: string, start: number): string | undefined {
  const before = source.slice(Math.max(0, start - 240), start);
  NAME_COMMENT_RE.lastIndex = 0;
  let last: string | undefined;
  for (const match of before.matchAll(NAME_COMMENT_RE)) {
    last = match[1]?.trim();
  }
  return last || undefined;
}

function inferSnippetName(html: string, fallbackFile: string): string {
  const src = html.match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
  const url = src?.[1] ?? src?.[2];
  if (url) {
    try {
      const host = new URL(url, "https://aria.local").hostname;
      if (host && host !== "aria.local") return host;
    } catch {
      // ignore
    }
  }
  const fileName = fallbackFile.split("/").pop() ?? fallbackFile;
  return fileName.replace(/\.(astro|mdx|md)$/i, "") || "Custom snippet";
}

function analyticsName(providerId: AnalyticsProviderId): string {
  return ANALYTICS_PROVIDER_MAP[providerId]?.label ?? providerId;
}

function findingId(finding: {
  file: string;
  kind: SourceInjectionFinding["kind"];
  placement: CodeSnippetPlacement;
  rawHtml: string;
  providerId?: AnalyticsProviderId;
  fields?: Record<string, string>;
}): string {
  if (finding.kind === "analytics" && finding.providerId) {
    const primary = providerPrimaryValue(finding.providerId, finding.fields ?? {});
    return `src:${finding.file}:${finding.providerId}:${primary}`;
  }
  return `src:${finding.file}:${finding.placement}:${fingerprintCode(finding.rawHtml)}`;
}

function groupKey(finding: SourceInjectionFinding): string | null {
  if (finding.kind !== "analytics" || !finding.providerId) return null;
  return `${finding.file}:${finding.providerId}:${providerPrimaryValue(finding.providerId, finding.fields ?? {})}`;
}

function uniqueSpans(spans: InjectionSpan[]): InjectionSpan[] {
  const out: InjectionSpan[] = [];
  for (const span of spans) {
    if (!out.some((item) => item.start === span.start && item.end === span.end && item.file === span.file)) {
      out.push(span);
    }
  }
  out.sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start);
  return out;
}

function mergeFindings(findings: SourceInjectionFinding[]): SourceInjectionFinding[] {
  const grouped = new Map<string, SourceInjectionFinding>();
  const passthrough: SourceInjectionFinding[] = [];

  for (const finding of findings) {
    const key = groupKey(finding);
    if (!key) {
      passthrough.push(finding);
      continue;
    }
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...finding, spans: [...finding.spans] });
      continue;
    }
    existing.spans = uniqueSpans([...existing.spans, ...finding.spans]);
    existing.enabled = existing.enabled && finding.enabled;
    existing.fields = { ...existing.fields, ...finding.fields };
    existing.fieldMeta = { ...existing.fieldMeta, ...finding.fieldMeta };
    if (finding.placement === "header") existing.placement = "header";
  }

  const merged = [...grouped.values()].map((finding) => ({
    ...finding,
    spans: uniqueSpans(finding.spans),
    id: findingId(finding),
  }));

  return [...merged, ...passthrough].sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return (a.spans[0]?.start ?? 0) - (b.spans[0]?.start ?? 0);
  });
}

function scanFile(
  root: string,
  absolute: string,
  env: Record<string, string>,
): SourceInjectionFinding[] {
  const relative = relPosix(root, absolute);
  const scope = scopeForFile(relative);
  if (!scope) return [];
  const source = readSafe(absolute);
  if (!source) return [];

  const regions = disabledRegions(source);
  const findings: SourceInjectionFinding[] = [];

  for (const tag of collectTags(source)) {
    const openMatch = tag.html.match(/^<(?:script|noscript)\b([^>]*)>/i);
    const openAttrs = openMatch?.[1] ?? "";
    const inner = tag.html.replace(/^<[^>]+>/, "").replace(/<\/(?:script|noscript)>$/i, "");
    if (!isInjectionCandidate(openAttrs, inner, tag.html)) continue;

    const classified = classifyInjectionHtml(tag.html);
    const enabled = !isInside(tag.start, regions);
    const placement = inferPlacement(source, tag.start);
    const named = nameFromComment(source, tag.start);
    const fields = classified.kind === "analytics" ? classified.fields : undefined;
    const providerId =
      classified.kind === "analytics" ? classified.providerId : undefined;
    const resolved =
      fields !== undefined
        ? resolveSourceFields(fields, source, env)
        : { fields: undefined, fieldMeta: undefined };
    const name =
      named ||
      (providerId ? analyticsName(providerId) : inferSnippetName(tag.html, relative));

    const finding: SourceInjectionFinding = {
      id: "",
      kind: classified.kind,
      file: relative,
      scope,
      placement,
      enabled,
      rawHtml: tag.html,
      spans: [{ file: relative, start: tag.start, end: tag.end }],
      name,
      providerId,
      fields: resolved.fields,
      fieldMeta:
        resolved.fieldMeta && Object.keys(resolved.fieldMeta).length > 0
          ? resolved.fieldMeta
          : undefined,
    };
    finding.id = findingId(finding);
    findings.push(finding);
  }

  return mergeFindings(findings);
}

function rebuildGroupedRawHtml(
  sourceByFile: Map<string, string>,
  findings: SourceInjectionFinding[],
): SourceInjectionFinding[] {
  return findings.map((finding) => {
    const source = sourceByFile.get(finding.file);
    if (!source) return finding;
    const rawHtml = finding.spans
      .map((span) => source.slice(span.start, span.end))
      .join("\n");
    const named = nameFromComment(source, finding.spans[0]?.start ?? 0);
    return {
      ...finding,
      rawHtml,
      name: named || finding.name,
      id: findingId({ ...finding, rawHtml }),
    };
  });
}

function pickTargetLayout(root: string, layoutFiles: string[]): string | null {
  if (layoutFiles.length === 0) return null;
  const scored = layoutFiles
    .map((absolute) => {
      const relative = relPosix(root, absolute);
      const source = readSafe(absolute) ?? "";
      const hasShell =
        /<html\b/i.test(source) && /<head\b/i.test(source) && /<body\b/i.test(source);
      return { relative, hasShell };
    })
    .sort((a, b) => {
      if (a.hasShell !== b.hasShell) return a.hasShell ? -1 : 1;
      return a.relative.localeCompare(b.relative);
    });
  return scored[0]?.relative ?? null;
}

/**
 * Probe layouts, pages, and components for third-party / inline injection scripts.
 */
export function scanInjectionSources(projectPath: string): InjectionScanResult {
  const root = canonicalDirectory(projectPath);
  const files: string[] = [];
  walkFiles(path.join(root, "src", "layouts"), root, SOURCE_EXTS, files);
  walkFiles(path.join(root, "src", "pages"), root, SOURCE_EXTS, files);
  walkFiles(path.join(root, "src", "components"), root, SOURCE_EXTS, files);

  const env = loadProjectEnv(root);
  const unique = [...new Set(files)];
  const sourceByFile = new Map<string, string>();
  const collected: SourceInjectionFinding[] = [];

  for (const absolute of unique) {
    const relative = relPosix(root, absolute);
    if (scopeForFile(relative) == null) continue;
    const source = readSafe(absolute);
    if (source) sourceByFile.set(relative, source);
    collected.push(...scanFile(root, absolute, env));
  }

  const merged = rebuildGroupedRawHtml(sourceByFile, mergeFindings(collected));
  const analytics = merged.filter((item) => item.kind === "analytics");
  const snippets = merged.filter((item) => item.kind === "snippet");
  const layoutFiles = unique.filter((file) =>
    relPosix(root, file).startsWith("src/layouts/"),
  );

  return {
    scannedAt: new Date().toISOString(),
    analytics,
    snippets,
    targetLayout: pickTargetLayout(root, layoutFiles),
  };
}

export function normalizeInjectionHtml(html: string): string {
  return normalizeHtml(html);
}

export function extractHttpUrls(html: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    const cleaned = match[0].replace(/[.,;]+$/, "");
    if (cleaned.length >= 12 && !urls.includes(cleaned)) urls.push(cleaned);
  }
  return urls;
}
