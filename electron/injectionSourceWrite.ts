import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ANALYTICS_PROVIDER_MAP } from "../shared/analytics/providers";
import { substituteInjectionFields } from "../shared/analytics/fingerprints";
import { replaceFrontmatterLiteral } from "../shared/analytics/sourceExpressions";
import type {
  InjectionScanResult,
  SourceInjectionFinding,
  UpdateSourceInjectionInput,
  UpdateSourceInjectionResult,
} from "../shared/injections";
import {
  INJECTION_DISABLED_BEGIN,
  INJECTION_DISABLED_END,
  SNIPPET_NAME_COMMENT_PREFIX,
} from "../shared/injections";
import type {
  AnalyticsProviderId,
  AnalyticsSettings,
  CodeSnippet,
  CodeSnippetPlacement,
  SiteSettings,
} from "../shared/types";
import {
  scanInjectionSources,
} from "./injectionSourceScan";
import { canonicalDirectory, resolveWithinRoot, writeTextFileAtomic } from "./pathSafety";
import { bakeSnippetsInjection, readSiteSettings, writeSiteSettings } from "./siteSettings";

const MAX_SNIPPET_CODE = 50_000;
const MAX_SNIPPET_NAME = 200;

function projectFile(root: string, relative: string): string {
  return resolveWithinRoot(
    root,
    path.join(root, ...relative.split("/").filter(Boolean)),
    { allowMissing: true, rejectFinalSymlink: true },
  );
}

function readSource(root: string, relative: string): string {
  const absolute = projectFile(root, relative);
  if (!existsSync(absolute)) {
    throw new Error(`Source file not found: ${relative}`);
  }
  return readFileSync(absolute, "utf8");
}

function writeSource(root: string, relative: string, contents: string): void {
  writeTextFileAtomic(projectFile(root, relative), contents);
}

function allFindings(scan: InjectionScanResult): SourceInjectionFinding[] {
  return [...scan.analytics, ...scan.snippets];
}

function findById(scan: InjectionScanResult, id: string): SourceInjectionFinding {
  const finding = allFindings(scan).find((item) => item.id === id);
  if (!finding) throw new Error("Injection not found. Re-scan and try again.");
  return finding;
}

type SpanReplacement = { start: number; end: number; next: string };

function applyReplacements(source: string, replacements: SpanReplacement[]): string {
  const ordered = [...replacements].sort((a, b) => b.start - a.start);
  let out = source;
  for (const replacement of ordered) {
    if (replacement.start < 0 || replacement.end > out.length || replacement.start > replacement.end) {
      throw new Error("Injection span is stale. Re-scan and try again.");
    }
    out =
      out.slice(0, replacement.start) +
      replacement.next +
      out.slice(replacement.end);
  }
  return out;
}

function precedingNameComment(
  source: string,
  start: number,
): { start: number; end: number; name: string } | null {
  const before = source.slice(Math.max(0, start - 280), start);
  const match = before.match(/<!--\s*aria:snippet-name:\s*(.*?)\s*-->\s*$/);
  if (!match || match.index === undefined) return null;
  const absStart = Math.max(0, start - 280) + match.index;
  return {
    start: absStart,
    end: start,
    name: match[1]?.trim() ?? "",
  };
}

function expandForDelete(source: string, start: number, end: number): { start: number; end: number } {
  let from = start;
  let to = end;
  const name = precedingNameComment(source, start);
  if (name) from = name.start;

  const before = source.slice(Math.max(0, from - 80), from);
  const after = source.slice(to, to + 80);
  if (/<!--\s*aria:injection-disabled-begin\s*-->\s*$/.test(before)) {
    const begin = source.lastIndexOf("<!--", from - 1);
    if (begin >= 0) from = begin;
  }
  const endMatch = after.match(/^\s*<!--\s*aria:injection-disabled-end\s*-->/);
  if (endMatch) to += endMatch[0].length;

  return { start: from, end: to };
}

function insertAtPlacement(
  source: string,
  html: string,
  placement: CodeSnippetPlacement,
): string {
  const block = html.endsWith("\n") ? html : `${html}\n`;
  if (placement === "header") {
    const index = source.search(/<\/head>/i);
    if (index >= 0) return source.slice(0, index) + block + source.slice(index);
  }
  if (placement === "body") {
    const match = source.match(/<body\b[^>]*>/i);
    if (match && match.index !== undefined) {
      const at = match.index + match[0].length;
      return source.slice(0, at) + `\n${block}` + source.slice(at);
    }
  }
  if (placement === "footer") {
    const index = source.search(/<\/body>/i);
    if (index >= 0) return source.slice(0, index) + block + source.slice(index);
  }
  return `${source.replace(/\s*$/, "")}\n${block}`;
}

function nameComment(name: string): string {
  const trimmed = name.trim().slice(0, MAX_SNIPPET_NAME);
  if (!trimmed) return "";
  return `<!-- ${SNIPPET_NAME_COMMENT_PREFIX} ${trimmed} -->\n`;
}

function createSnippetId(): string {
  return `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function refreshGenerated(root: string): SiteSettings {
  return bakeSnippetsInjection(root);
}

function result(root: string, settings?: SiteSettings, usedMiddleware?: boolean): UpdateSourceInjectionResult {
  return {
    scan: scanInjectionSources(root),
    settings: settings ?? refreshGenerated(root),
    usedMiddleware,
  };
}

function upsertEnvKey(root: string, key: string, value: string): void {
  const relative = ".env.local";
  const absolute = projectFile(root, relative);
  const existing = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
  const pattern = new RegExp(`^((?:export\\s+)?${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=)(.*)$`, "m");
  const line = `${key}=${value}`;
  const next = pattern.test(existing)
    ? existing.replace(pattern, `$1${value}`)
    : existing.trim().length > 0
      ? `${existing.replace(/\s*$/, "")}\n${line}\n`
      : `${line}\n`;
  writeTextFileAtomic(absolute, next);
}

function editFinding(
  root: string,
  finding: SourceInjectionFinding,
  patch: {
    code?: string;
    name?: string;
    placement?: CodeSnippetPlacement;
    fields?: Record<string, string>;
  },
): void {
  const relative = finding.file;
  let source = readSource(root, relative);

  if (patch.fields && finding.kind === "analytics" && finding.providerId) {
    const nextFields = { ...finding.fields, ...patch.fields };
    let astroDirty = false;
    let boundKeys = 0;

    for (const [key, to] of Object.entries(patch.fields)) {
      const meta = finding.fieldMeta?.[key];
      if (!meta) continue;
      if ((finding.fields?.[key] ?? "") === to) continue;
      if (meta.envKey) {
        upsertEnvKey(root, meta.envKey, to);
        boundKeys += 1;
        continue;
      }
      if (meta.ident) {
        const replaced = replaceFrontmatterLiteral(source, meta.ident, to);
        if (replaced) {
          source = replaced;
          astroDirty = true;
          boundKeys += 1;
        }
      }
    }

    if (boundKeys === 0) {
      const previousForHtml: Record<string, string> = { ...(finding.fields ?? {}) };
      for (const [key, meta] of Object.entries(finding.fieldMeta ?? {})) {
        previousForHtml[key] = meta.raw;
      }
      const replacements: SpanReplacement[] = [];
      for (const span of finding.spans) {
        const original = source.slice(span.start, span.end);
        const substituted = substituteInjectionFields(
          original,
          finding.providerId,
          previousForHtml,
          nextFields,
        );
        if (substituted == null) {
          throw new Error(
            "This analytics snippet is too customized to edit as a provider. Manage it under Snippets instead.",
          );
        }
        replacements.push({ start: span.start, end: span.end, next: substituted });
      }
      source = applyReplacements(source, replacements);
      astroDirty = true;
    }

    if (astroDirty) writeSource(root, relative, source);
    return;
  }

  if (patch.placement && patch.placement !== finding.placement) {
    const html = (patch.code ?? finding.rawHtml).trim();
    const deleteReplacements: SpanReplacement[] = finding.spans.map((span) => {
      const expanded = expandForDelete(source, span.start, span.end);
      return { start: expanded.start, end: expanded.end, next: "" };
    });
    source = applyReplacements(source, deleteReplacements);
    const named = patch.name !== undefined ? patch.name : finding.name;
    const payload = `${nameComment(named)}${html}`;
    source = insertAtPlacement(source, payload, patch.placement);
    writeSource(root, relative, source);
    return;
  }

  const replacements: SpanReplacement[] = [];
  if (patch.code !== undefined) {
    if (finding.spans.length === 1 && finding.spans[0]) {
      replacements.push({
        start: finding.spans[0].start,
        end: finding.spans[0].end,
        next: patch.code,
      });
    } else if (finding.spans.length > 1) {
      const first = finding.spans[0]!;
      replacements.push({ start: first.start, end: first.end, next: patch.code });
      for (const span of finding.spans.slice(1)) {
        const expanded = expandForDelete(source, span.start, span.end);
        replacements.push({ start: expanded.start, end: expanded.end, next: "" });
      }
    }
  }

  if (patch.name !== undefined && finding.spans[0]) {
    const first = finding.spans[0];
    const existing = precedingNameComment(source, first.start);
    const comment = nameComment(patch.name);
    if (existing) {
      replacements.push({ start: existing.start, end: existing.end, next: comment });
    } else if (comment) {
      replacements.push({ start: first.start, end: first.start, next: comment });
    }
  }

  if (replacements.length === 0) return;
  writeSource(root, relative, applyReplacements(source, replacements));
}

function setEnabledFinding(
  root: string,
  finding: SourceInjectionFinding,
  enabled: boolean,
): void {
  const source = readSource(root, finding.file);
  if (enabled === finding.enabled) return;
  const replacements: SpanReplacement[] = finding.spans.map((span) => {
    const original = source.slice(span.start, span.end);
    if (enabled) {
      let from = span.start;
      let to = span.end;
      const before = source.slice(Math.max(0, span.start - 80), span.start);
      const beginMatch = before.match(
        /<!--\s*aria:injection-disabled-begin\s*-->\s*$/,
      );
      if (beginMatch) from = span.start - beginMatch[0].length;
      const after = source.slice(span.end, span.end + 80);
      const endMatch = after.match(/^\s*<!--\s*aria:injection-disabled-end\s*-->/);
      if (endMatch) to = span.end + endMatch[0].length;
      return { start: from, end: to, next: original };
    }
    return {
      start: span.start,
      end: span.end,
      next: `${INJECTION_DISABLED_BEGIN}\n${original}\n${INJECTION_DISABLED_END}`,
    };
  });
  writeSource(root, finding.file, applyReplacements(source, replacements));
}

function deleteFinding(root: string, finding: SourceInjectionFinding): void {
  const source = readSource(root, finding.file);
  const replacements: SpanReplacement[] = finding.spans.map((span) => {
    const expanded = expandForDelete(source, span.start, span.end);
    return { start: expanded.start, end: expanded.end, next: "" };
  });
  writeSource(root, finding.file, applyReplacements(source, replacements));
}

function addSnippetToLayout(
  root: string,
  layout: string,
  name: string,
  placement: CodeSnippetPlacement,
  code: string,
): void {
  const source = readSource(root, layout);
  const payload = `${nameComment(name)}${code.trim()}`;
  writeSource(root, layout, insertAtPlacement(source, payload, placement));
}

function addAnalyticsToLayout(
  root: string,
  layout: string,
  providerId: AnalyticsProviderId,
  fields: Record<string, string>,
): void {
  const definition = ANALYTICS_PROVIDER_MAP[providerId];
  const resolved: Record<string, string> = { ...fields };
  for (const field of definition.fields) {
    if (field.required && !resolved[field.key]?.trim() && field.placeholder) {
      resolved[field.key] = field.placeholder;
    }
  }
  const compiled = definition.buildScripts(resolved);
  let source = readSource(root, layout);
  const headHTML = compiled.head.filter(Boolean).join("\n");
  const bodyStartHTML = compiled.bodyStart.filter(Boolean).join("\n");
  const bodyEndHTML = compiled.bodyEnd.filter(Boolean).join("\n");
  if (headHTML) source = insertAtPlacement(source, headHTML, "header");
  if (bodyStartHTML) source = insertAtPlacement(source, bodyStartHTML, "body");
  if (bodyEndHTML) source = insertAtPlacement(source, bodyEndHTML, "footer");
  writeSource(root, layout, source);
}

function addSnippetViaMiddleware(
  root: string,
  name: string,
  placement: CodeSnippetPlacement,
  code: string,
): SiteSettings {
  const current = readSiteSettings(root);
  const snippets: CodeSnippet[] = [...(current.snippets ?? [])];
  snippets.push({
    id: createSnippetId(),
    name: name.trim().slice(0, MAX_SNIPPET_NAME),
    placement,
    code,
    enabled: true,
  });
  return writeSiteSettings(root, { ...current, snippets });
}

function addAnalyticsViaMiddleware(
  root: string,
  providerId: AnalyticsProviderId,
  fields: Record<string, string>,
): SiteSettings {
  const current = readSiteSettings(root);
  const analytics: AnalyticsSettings = {
    version: 1,
    activeProviders: [...(current.analytics?.activeProviders ?? [])],
    providers: { ...(current.analytics?.providers ?? {}) },
  };
  if (!analytics.activeProviders.includes(providerId)) {
    analytics.activeProviders.push(providerId);
  }
  analytics.providers[providerId] = {
    ...(analytics.providers[providerId] ?? {}),
    ...fields,
  };
  return writeSiteSettings(root, { ...current, analytics });
}

function assertCode(code: string): void {
  if (code.length > MAX_SNIPPET_CODE) {
    throw new Error("Snippet code is too large");
  }
}

/**
 * Mutate a source-backed injection, or fall back to Aria middleware when
 * the project has no layout to write into.
 */
export function updateSourceInjection(
  projectPath: string,
  input: UpdateSourceInjectionInput,
): UpdateSourceInjectionResult {
  const root = canonicalDirectory(projectPath);
  const scan = scanInjectionSources(root);

  if (input.op === "addSnippet") {
    assertCode(input.code);
    if (!input.code.trim()) {
      return result(root);
    }
    if (scan.targetLayout) {
      addSnippetToLayout(
        root,
        scan.targetLayout,
        input.name,
        input.placement,
        input.code,
      );
      return result(root);
    }
    const settings = addSnippetViaMiddleware(
      root,
      input.name,
      input.placement,
      input.code,
    );
    return result(root, settings, true);
  }

  if (input.op === "addAnalytics") {
    if (!ANALYTICS_PROVIDER_MAP[input.providerId]) {
      throw new Error("Unknown analytics provider");
    }
    if (scan.targetLayout) {
      addAnalyticsToLayout(root, scan.targetLayout, input.providerId, input.fields);
      return result(root);
    }
    const settings = addAnalyticsViaMiddleware(root, input.providerId, input.fields);
    return result(root, settings, true);
  }

  const finding = findById(scan, input.id);

  if (input.op === "setEnabled") {
    setEnabledFinding(root, finding, input.enabled);
    return result(root);
  }

  if (input.op === "delete") {
    deleteFinding(root, finding);
    return result(root);
  }

  if (input.op === "edit") {
    if (input.code !== undefined) assertCode(input.code);
    editFinding(root, finding, {
      code: input.code,
      name: input.name,
      placement: input.placement,
      fields: input.fields,
    });
    return result(root);
  }

  throw new Error("Unsupported injection update");
}
