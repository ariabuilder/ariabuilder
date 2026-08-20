import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  fontsourcePackageName,
  normalizeFontsourceId,
  type DesignFontsourceFont,
  type DesignFontsourceRuntimeStatus,
} from "../../shared/design";
import { canonicalDirectory, writeTextFileAtomic } from "../pathSafety";
import { listProjectStylesheets } from "./discovery";

const FONTSOURCE_IMPORT_RE =
  /(?:@import\s+(?:url\(\s*)?|import\s*\(?\s*)['"](@fontsource(?:-variable)?\/[a-z0-9-]+(?:\/[^'"]*)?)['"]/gi;

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

const MAX_PACKAGE_JSON_BYTES = 512 * 1024;

function startCaseFontsourceId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseFontsourceSpecifier(
  specifier: string,
): DesignFontsourceFont | null {
  const trimmed = specifier.trim();
  const variable = trimmed.startsWith("@fontsource-variable/");
  const id = normalizeFontsourceId(trimmed);
  if (!id) return null;
  return {
    id,
    family: startCaseFontsourceId(id),
    variable,
  };
}

function collectFromContent(
  content: string,
  into: Map<string, DesignFontsourceFont>,
): void {
  FONTSOURCE_IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FONTSOURCE_IMPORT_RE.exec(content))) {
    const parsed = parseFontsourceSpecifier(match[1] ?? "");
    if (!parsed) continue;
    const existing = into.get(parsed.id);
    into.set(parsed.id, {
      id: parsed.id,
      family: existing?.family || parsed.family,
      variable: Boolean(parsed.variable || existing?.variable),
    });
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
 * Find Fontsource families already imported by the project CSS / JS / Astro.
 */
export function discoverFontsourceFonts(
  projectPath: string,
): DesignFontsourceFont[] {
  const root = canonicalDirectory(projectPath);
  const found = new Map<string, DesignFontsourceFont>();

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
    if (path.extname(absolute).toLowerCase() === ".css") continue;
    try {
      collectFromContent(readFileSync(absolute, "utf8"), found);
    } catch {
      /* skip */
    }
  }

  return [...found.values()].sort((a, b) => a.family.localeCompare(b.family));
}

/** Prefer meta id / family / variable; ensure every discovered family is present. */
export function mergeFontsourceFonts(
  metaFontsource: DesignFontsourceFont[],
  discovered: DesignFontsourceFont[],
): DesignFontsourceFont[] {
  const byId = new Map<string, DesignFontsourceFont>();

  for (const font of discovered) {
    const id = normalizeFontsourceId(font.id);
    if (!id) continue;
    const existing = byId.get(id);
    byId.set(id, {
      id,
      family: font.family.trim() || existing?.family || startCaseFontsourceId(id),
      variable: Boolean(font.variable || existing?.variable),
    });
  }

  for (const font of metaFontsource) {
    const id = normalizeFontsourceId(font.id);
    if (!id) continue;
    const existing = byId.get(id);
    byId.set(id, {
      id,
      family: font.family.trim() || existing?.family || startCaseFontsourceId(id),
      variable: Boolean(font.variable),
    });
  }

  return [...byId.values()].sort((a, b) => a.family.localeCompare(b.family));
}

function collapseBlankLines(content: string): string {
  return content.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function fontKey(font: Pick<DesignFontsourceFont, "id" | "variable">): string {
  return fontsourcePackageName(font);
}

/**
 * Remove `@fontsource*` imports that match the given enabled records.
 */
export function stripFontsourceFontsFromContent(
  content: string,
  fonts: readonly Pick<DesignFontsourceFont, "id" | "variable">[],
): { content: string; changed: boolean } {
  const remove = new Set(
    fonts
      .map((font) => fontsourcePackageName(font))
      .filter((name) => name.endsWith("/") === false && name.includes("/")),
  );
  if (remove.size === 0) return { content, changed: false };

  const next = content.replace(
    /(?:@import\s+(?:url\(\s*)?|import\s*\(?\s*)['"](@fontsource(?:-variable)?\/[a-z0-9-]+(?:\/[^'"]*)?)['"]\s*\)?\s*;?/gi,
    (full, specifier: string) => {
      const parsed = parseFontsourceSpecifier(specifier);
      if (!parsed) return full;
      return remove.has(fontKey(parsed)) ? "" : full;
    },
  );

  if (next === content) return { content, changed: false };
  return { content: collapseBlankLines(next), changed: true };
}

function projectFilesForFontsourceEdits(projectPath: string): string[] {
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

export function removeFontsourceFontsFromProject(
  projectPath: string,
  fonts: readonly Pick<DesignFontsourceFont, "id" | "variable">[],
): { filesChanged: number } {
  if (fonts.length === 0) return { filesChanged: 0 };

  let filesChanged = 0;
  for (const absolute of projectFilesForFontsourceEdits(projectPath)) {
    let original: string;
    try {
      if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
      original = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }

    const { content, changed } = stripFontsourceFontsFromContent(original, fonts);
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

function collectDeps(root: string): Record<string, string> {
  const pkgPath = path.join(root, "package.json");
  try {
    if (!statSync(pkgPath).isFile() || statSync(pkgPath).size > MAX_PACKAGE_JSON_BYTES) {
      return {};
    }
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
  } catch {
    return {};
  }
}

export function detectFontsourceRuntime(
  projectPath: string,
): DesignFontsourceRuntimeStatus {
  const root = canonicalDirectory(projectPath);
  const deps = collectDeps(root);
  const installedPackages = Object.keys(deps)
    .filter(
      (name) =>
        name.startsWith("@fontsource/") || name.startsWith("@fontsource-variable/"),
    )
    .sort((left, right) => left.localeCompare(right));
  return { installedPackages };
}
