import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { DesignIconRuntimeStatus } from "../../shared/design";
import { canonicalDirectory, isPathInside } from "../pathSafety";

const CONFIG_NAMES = [
  "astro.config.mjs",
  "astro.config.js",
  "astro.config.ts",
  "astro.config.mts",
  "astro.config.cjs",
  "astro.config.cts",
];

const ICONIFY_JSON_PREFIX = "@iconify-json/";
const MAX_FILE_BYTES = 512 * 1024;

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

function collectDeps(root: string): Record<string, string> {
  const pkgPath = path.join(root, "package.json");
  const raw = readSafe(pkgPath);
  if (!raw) return {};
  try {
    const pkg = JSON.parse(raw) as {
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

function hasAstroIconIntegration(root: string): boolean {
  for (const name of CONFIG_NAMES) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    if (!isPathInside(root, file)) continue;
    const raw = readSafe(file);
    if (!raw) continue;
    if (raw.includes("astro-icon") || /from\s+["']astro-icon["']/.test(raw)) {
      return true;
    }
  }
  return false;
}

export function detectIconRuntime(
  projectPath: string,
): DesignIconRuntimeStatus {
  const root = canonicalDirectory(projectPath);
  const deps = collectDeps(root);
  const hasAstroIcon = "astro-icon" in deps;
  const installedJsonPrefixes: string[] = [];
  for (const name of Object.keys(deps)) {
    if (!name.startsWith(ICONIFY_JSON_PREFIX)) continue;
    const prefix = name.slice(ICONIFY_JSON_PREFIX.length).trim();
    if (prefix) installedJsonPrefixes.push(prefix);
  }
  installedJsonPrefixes.sort((a, b) => a.localeCompare(b));

  return {
    hasAstroIcon,
    hasIntegration: hasAstroIconIntegration(root),
    installedJsonPrefixes,
  };
}
