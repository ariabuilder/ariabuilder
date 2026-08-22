import fs from "node:fs";
import path from "node:path";
import {
  SEMANTIC_CSS_VAR,
  type DesignColorPalette,
  type DesignSemanticColors,
} from "../../shared/design";
import { canonicalDirectory, resolveWithinRoot, writeTextFileAtomic } from "../pathSafety";
import { readTailwindReceipt } from "./receipt";

export const TAILWIND_IMPORT_MARKER = "aria:utility-manager:tailwind-import";
export const TAILWIND_THEME_BEGIN = "/* aria:utility-manager:tailwind-theme-begin */";
export const TAILWIND_THEME_END = "/* aria:utility-manager:tailwind-theme-end */";

export type TailwindThemeAliases = {
  css: string;
  aliasCount: number;
  collisions: string[];
};

const TAILWIND_IMPORT_RE = /@import\s+(?:url\()?\s*["']tailwindcss["']\s*\)?[^;]*;/i;
const COLLISION_SCAN_SKIP = new Set([
  "node_modules", ".git", ".astro", ".aria", "dist", ".vercel", ".wrangler",
]);

function collectCssFiles(directory: string, out: string[], limit = 500): void {
  if (!fs.existsSync(directory) || out.length >= limit) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (out.length >= limit) return;
    if (entry.name.startsWith(".") || COLLISION_SCAN_SKIP.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectCssFiles(absolute, out, limit);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".css")) out.push(absolute);
  }
}

export function collectProjectCssForTailwindCollisions(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  const files: string[] = [];
  collectCssFiles(path.join(root, "src"), files);
  collectCssFiles(path.join(root, "styles"), files);
  return files.map((file) => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return "";
    }
  }).join("\n");
}

function stripThemeBlock(content: string): {
  content: string;
  block: string | null;
} {
  const begin = content.indexOf(TAILWIND_THEME_BEGIN);
  const end = content.indexOf(TAILWIND_THEME_END);
  if (begin === -1 && end === -1) return { content, block: null };
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error("The Aria-managed Tailwind theme block is incomplete.");
  }
  const blockEnd = end + TAILWIND_THEME_END.length;
  return {
    content: `${content.slice(0, begin)}${content.slice(blockEnd)}`,
    block: content.slice(begin, blockEnd),
  };
}

function authoredColorVariables(content: string): Set<string> {
  const { content: outside } = stripThemeBlock(content);
  const names = new Set<string>();
  const pattern = /--color-([a-zA-Z0-9_-]+)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(outside))) names.add(match[1]!);
  return names;
}

function addAlias(
  lines: string[],
  collisions: string[],
  authored: Set<string>,
  name: string,
  source: string,
): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return;
  if (authored.has(name)) {
    collisions.push(name);
    return;
  }
  lines.push(`  --color-${name}: var(--${source});`);
}

export function buildTailwindThemeAliases(
  content: string,
  palettes: readonly DesignColorPalette[],
  semantic: DesignSemanticColors,
): TailwindThemeAliases {
  const authored = authoredColorVariables(content);
  const lines: string[] = [];
  const collisions: string[] = [];
  for (const palette of palettes.filter((item) => item.source === "aria")) {
    const base = palette.shades.DEFAULT?.trim() || palette.shades["500"]?.trim();
    if (base) addAlias(lines, collisions, authored, palette.name, palette.name);
    for (const [shade, value] of Object.entries(palette.shades)) {
      if (shade === "DEFAULT" || !value?.trim()) continue;
      addAlias(
        lines,
        collisions,
        authored,
        `${palette.name}-${shade}`,
        `${palette.name}-${shade}`,
      );
    }
  }
  for (const [key, cssVariable] of Object.entries(SEMANTIC_CSS_VAR) as Array<
    [keyof DesignSemanticColors, string]
  >) {
    if (!semantic[key]?.trim()) continue;
    addAlias(lines, collisions, authored, cssVariable, cssVariable);
  }
  const body = lines.length
    ? lines.join("\n")
    : "  /* Add palettes in Aria Design to create color utilities. */";
  return {
    css: [
      TAILWIND_THEME_BEGIN,
      "@theme inline {",
      body,
      "}",
      TAILWIND_THEME_END,
    ].join("\n"),
    aliasCount: lines.length,
    collisions: [...new Set(collisions)].sort(),
  };
}

function insertTailwindImport(content: string): string {
  const statement = `@import "tailwindcss"; /* ${TAILWIND_IMPORT_MARKER} */`;
  const charset = content.match(/^(?:\uFEFF)?@charset\s+(['"])[^'"]+\1\s*;\s*/i);
  if (!charset) return `${statement}\n${content}`;
  return `${charset[0]}${statement}\n${content.slice(charset[0].length)}`;
}

export function applyTailwindThemeBridge(
  content: string,
  palettes: readonly DesignColorPalette[],
  semantic: DesignSemanticColors,
  options?: {
    ensureTailwindImport?: boolean;
    collisionContent?: string;
  },
): {
  content: string;
  importOwned: boolean;
  aliasCount: number;
  collisions: string[];
} {
  const without = stripThemeBlock(content).content.trimEnd();
  const aliases = buildTailwindThemeAliases(
    options?.collisionContent ?? without,
    palettes,
    semantic,
  );
  const importOwned = Boolean(options?.ensureTailwindImport && !TAILWIND_IMPORT_RE.test(without));
  const withImport = importOwned ? insertTailwindImport(without) : without;
  return {
    content: `${withImport.trimEnd()}\n\n${aliases.css}\n`,
    importOwned,
    aliasCount: aliases.aliasCount,
    collisions: aliases.collisions,
  };
}

export function assertManagedTailwindStylesheetIntact(
  content: string,
  importOwned: boolean,
): void {
  stripThemeBlock(content);
  if (!content.includes(TAILWIND_THEME_BEGIN) || !content.includes(TAILWIND_THEME_END)) {
    throw new Error("The Aria-managed Tailwind theme block changed.");
  }
  if (importOwned && !content.includes(`/* ${TAILWIND_IMPORT_MARKER} */`)) {
    throw new Error("The Aria-managed Tailwind stylesheet import changed.");
  }
}

export function removeManagedTailwindStylesheet(
  content: string,
  importOwned: boolean,
): string {
  assertManagedTailwindStylesheetIntact(content, importOwned);
  let next = stripThemeBlock(content).content;
  if (importOwned) {
    next = next.replace(
      new RegExp(`^@import\\s+["']tailwindcss["'];[ \\t]*/\\* ${TAILWIND_IMPORT_MARKER} \\*/\\r?\\n?`, "m"),
      "",
    );
  }
  return normalizeTailwindStylesheetAfterRemoval(next);
}

export function normalizeTailwindStylesheetAfterRemoval(content: string): string {
  return content.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function syncManagedTailwindThemeBridge(
  projectPath: string,
  colors: {
    palettes: readonly DesignColorPalette[];
    semantic: DesignSemanticColors;
  },
): void {
  const receipt = readTailwindReceipt(projectPath);
  if (!receipt) return;
  const root = canonicalDirectory(projectPath);
  const absolute = resolveWithinRoot(root, receipt.stylesheet.relativePath, {
    rejectFinalSymlink: true,
  });
  const current = fs.readFileSync(absolute, "utf8");
  assertManagedTailwindStylesheetIntact(current, receipt.stylesheet.importOwned);
  const next = applyTailwindThemeBridge(
    current,
    colors.palettes,
    colors.semantic,
    { collisionContent: collectProjectCssForTailwindCollisions(root) },
  ).content;
  if (next !== current) writeTextFileAtomic(absolute, next);
}

export function tailwindStylesheetHasImport(content: string): boolean {
  return TAILWIND_IMPORT_RE.test(content);
}
