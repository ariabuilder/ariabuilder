import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { DesignGoogleFont } from "../../shared/design";
import { canonicalDirectory, writeTextFileAtomic } from "../pathSafety";
import { listProjectStylesheets } from "./discovery";

const GOOGLE_FONTS_URL_RE =
  /https:\/\/fonts\.googleapis\.com\/css2?\?[^"' )\s]+/gi;

const CSS_GOOGLE_IMPORT_RE =
  /@import\s+(?:url\(\s*)?['"]?(https:\/\/fonts\.googleapis\.com\/css2?\?[^'")\s]+)['"]?\s*\)?\s*;?/gi;

const HTML_GOOGLE_STYLESHEET_LINK_RE =
  /<link\b[^>]*\bhref\s*=\s*['"](https:\/\/fonts\.googleapis\.com\/css2?\?[^'"]+)['"][^>]*\/?>/gi;

const SCAN_EXTENSIONS = new Set([
  ".astro",
  ".html",
  ".htm",
  ".vue",
  ".tsx",
  ".jsx",
  ".ts",
  ".js",
  ".mjs",
  ".css",
]);

function extractWeights(axisPart: string | undefined): number[] {
  if (!axisPart) return [400, 500, 600, 700];

  const weights = new Set<number>();

  // css2: wght@400;700  or  ital,wght@0,400;0,700;1,400
  const atIndex = axisPart.indexOf("@");
  if (atIndex >= 0) {
    const values = axisPart.slice(atIndex + 1);
    for (const token of values.split(";")) {
      const parts = token.split(",");
      const weightToken = parts[parts.length - 1]?.trim();
      const weight = Number(weightToken);
      if (Number.isFinite(weight) && weight > 0) weights.add(weight);
    }
  } else {
    // css (v1): 400,700,400italic
    for (const token of axisPart.split(",")) {
      const match = token.trim().match(/^(\d{3})/);
      if (match) weights.add(Number(match[1]));
    }
  }

  if (weights.size === 0) return [400, 500, 600, 700];
  return [...weights].sort((a, b) => a - b);
}

/** Parse one Google Fonts CSS URL into family/weight records. */
export function parseGoogleFontsUrl(rawUrl: string): DesignGoogleFont[] {
  let url: URL;
  try {
    url = new URL(rawUrl.replace(/&amp;/g, "&"));
  } catch {
    return [];
  }

  if (!url.hostname.includes("fonts.googleapis.com")) return [];

  const results: DesignGoogleFont[] = [];
  const familyParams = url.searchParams.getAll("family");

  for (const param of familyParams) {
    const decoded = param.replace(/\+/g, " ");

    // v1-style: Roboto:400,700|Open+Sans:300 inside one family param
    if (decoded.includes("|")) {
      for (const chunk of decoded.split("|")) {
        const c = chunk.indexOf(":");
        const n = (c >= 0 ? chunk.slice(0, c) : chunk).trim();
        const a = c >= 0 ? chunk.slice(c + 1) : undefined;
        if (n) results.push({ family: n, weights: extractWeights(a) });
      }
      continue;
    }

    const colon = decoded.indexOf(":");
    const namePart = colon >= 0 ? decoded.slice(0, colon) : decoded;
    const axisPart = colon >= 0 ? decoded.slice(colon + 1) : undefined;
    const family = namePart.trim();
    if (!family) continue;
    results.push({ family, weights: extractWeights(axisPart) });
  }

  return results;
}

function collectFromContent(
  content: string,
  into: Map<string, DesignGoogleFont>,
): void {
  GOOGLE_FONTS_URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = GOOGLE_FONTS_URL_RE.exec(content))) {
    for (const font of parseGoogleFontsUrl(match[0])) {
      const key = font.family.toLowerCase();
      const existing = into.get(key);
      if (!existing) {
        into.set(key, font);
        continue;
      }
      const weights = new Set([...existing.weights, ...font.weights]);
      into.set(key, {
        family: existing.family,
        weights: [...weights].sort((a, b) => a - b),
      });
    }
  }
}

function walkSourceFiles(dir: string, out: string[]): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === ".astro"
        ) {
          continue;
        }
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SCAN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      out.push(absolute);
    }
  }
}

/**
 * Find Google Font families already referenced by the project
 * (CSS @import / url, and <link> / strings in Astro/HTML/JS sources).
 */
export function discoverGoogleFonts(projectPath: string): DesignGoogleFont[] {
  const root = canonicalDirectory(projectPath);
  const found = new Map<string, DesignGoogleFont>();

  for (const sheet of listProjectStylesheets(root)) {
    try {
      const absolute = path.join(root, ...sheet.relativePath.split("/"));
      collectFromContent(readFileSync(absolute, "utf8"), found);
    } catch {
      /* skip */
    }
  }

  const sourceFiles: string[] = [];
  for (const rel of ["src", "public"]) {
    walkSourceFiles(path.join(root, rel), sourceFiles);
  }

  for (const absolute of sourceFiles) {
    // Stylesheets already covered above.
    if (path.extname(absolute).toLowerCase() === ".css") continue;
    try {
      collectFromContent(readFileSync(absolute, "utf8"), found);
    } catch {
      /* skip */
    }
  }

  return [...found.values()].sort((a, b) => a.family.localeCompare(b.family));
}

/** Prefer meta family/weights; ensure every discovered family is present. */
export function mergeGoogleFonts(
  metaGoogle: DesignGoogleFont[],
  discovered: DesignGoogleFont[],
): DesignGoogleFont[] {
  const byFamily = new Map<string, DesignGoogleFont>();

  for (const font of discovered) {
    const key = font.family.toLowerCase();
    byFamily.set(key, {
      family: font.family.trim(),
      weights: font.weights.length ? [...font.weights] : [400, 500, 600, 700],
    });
  }

  for (const font of metaGoogle) {
    const key = font.family.toLowerCase();
    const existing = byFamily.get(key);
    byFamily.set(key, {
      family: font.family.trim() || existing?.family || font.family,
      weights:
        font.weights.length > 0
          ? [...font.weights]
          : existing?.weights?.length
            ? [...existing.weights]
            : [400, 500, 600, 700],
    });
  }

  return [...byFamily.values()].sort((a, b) =>
    a.family.localeCompare(b.family),
  );
}

function normalizeFamilyKey(family: string): string {
  return family.trim().toLowerCase();
}

/**
 * Drop families from a Google Fonts CSS URL.
 * Returns null when no families remain (caller should delete the statement).
 */
export function rewriteGoogleFontsUrlWithoutFamilies(
  rawUrl: string,
  removeFamilies: ReadonlySet<string>,
): string | null {
  if (removeFamilies.size === 0) return rawUrl;

  let url: URL;
  try {
    url = new URL(rawUrl.replace(/&amp;/g, "&"));
  } catch {
    return rawUrl;
  }

  if (!url.hostname.includes("fonts.googleapis.com")) return rawUrl;

  const kept: string[] = [];
  let removedAny = false;
  for (const param of url.searchParams.getAll("family")) {
    const decoded = param.replace(/\+/g, " ");
    if (decoded.includes("|")) {
      const keptChunks: string[] = [];
      for (const chunk of decoded.split("|")) {
        const c = chunk.indexOf(":");
        const name = (c >= 0 ? chunk.slice(0, c) : chunk).trim();
        if (!name) continue;
        if (removeFamilies.has(normalizeFamilyKey(name))) {
          removedAny = true;
          continue;
        }
        keptChunks.push(chunk);
      }
      if (keptChunks.length) kept.push(keptChunks.join("|"));
      continue;
    }

    const colon = decoded.indexOf(":");
    const name = (colon >= 0 ? decoded.slice(0, colon) : decoded).trim();
    if (!name) continue;
    if (removeFamilies.has(normalizeFamilyKey(name))) {
      removedAny = true;
      continue;
    }
    kept.push(param);
  }

  if (kept.length === 0) return null;
  if (!removedAny) return rawUrl;

  const next = new URL(url.origin + url.pathname);
  for (const family of kept) next.searchParams.append("family", family);
  for (const [key, value] of url.searchParams.entries()) {
    if (key === "family") continue;
    next.searchParams.append(key, value);
  }
  return next.toString();
}

function collapseBlankLines(content: string): string {
  return content.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Remove (or rewrite) Google Fonts imports/links that reference the given families.
 */
export function stripGoogleFontFamiliesFromContent(
  content: string,
  families: readonly string[],
): { content: string; changed: boolean } {
  const remove = new Set(
    families.map(normalizeFamilyKey).filter((family) => family.length > 0),
  );
  if (remove.size === 0) return { content, changed: false };

  let next = content;
  let changed = false;

  next = next.replace(CSS_GOOGLE_IMPORT_RE, (full, url: string) => {
    const rewritten = rewriteGoogleFontsUrlWithoutFamilies(url, remove);
    if (rewritten === null) {
      changed = true;
      return "";
    }
    if (rewritten === url) return full;
    changed = true;
    return full.replace(url, rewritten);
  });

  next = next.replace(HTML_GOOGLE_STYLESHEET_LINK_RE, (full, url: string) => {
    const rewritten = rewriteGoogleFontsUrlWithoutFamilies(url, remove);
    if (rewritten === null) {
      changed = true;
      return "";
    }
    if (rewritten === url) return full;
    changed = true;
    return full.replace(url, rewritten);
  });

  // Catch remaining bare URLs (template strings, etc.) that only referenced removed families.
  next = next.replace(GOOGLE_FONTS_URL_RE, (url) => {
    const rewritten = rewriteGoogleFontsUrlWithoutFamilies(url, remove);
    if (rewritten === null) {
      changed = true;
      return "";
    }
    if (rewritten !== url) changed = true;
    return rewritten ?? url;
  });

  if (!changed) return { content, changed: false };
  return { content: collapseBlankLines(next), changed: true };
}

function projectFilesForGoogleFontEdits(projectPath: string): string[] {
  const root = canonicalDirectory(projectPath);
  const files = new Set<string>();

  for (const sheet of listProjectStylesheets(root)) {
    files.add(path.join(root, ...sheet.relativePath.split("/")));
  }

  const sourceFiles: string[] = [];
  for (const rel of ["src", "public"]) {
    walkSourceFiles(path.join(root, rel), sourceFiles);
  }
  for (const absolute of sourceFiles) files.add(absolute);

  return [...files];
}

/**
 * Remove deactivated Google Font families from project CSS / Astro / HTML sources.
 * Managed Aria font @imports are rewritten separately via the design block.
 */
export function removeGoogleFontFamiliesFromProject(
  projectPath: string,
  families: readonly string[],
): { filesChanged: number } {
  const remove = families.map((f) => f.trim()).filter(Boolean);
  if (remove.length === 0) return { filesChanged: 0 };

  let filesChanged = 0;
  for (const absolute of projectFilesForGoogleFontEdits(projectPath)) {
    let original: string;
    try {
      if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
      original = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }

    const { content, changed } = stripGoogleFontFamiliesFromContent(
      original,
      remove,
    );
    if (!changed || content === original) continue;

    try {
      writeTextFileAtomic(absolute, content, { overwrite: true });
      filesChanged += 1;
    } catch {
      /* skip unwritable */
    }
  }

  return { filesChanged };
}
