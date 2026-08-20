import fs from "node:fs";
import path from "node:path";
import {
  COMMON_UTILITY_CANDIDATES,
  FALLBACK_BREAKPOINTS,
  type ComposerFrameworkCapabilities,
  type ComposerUtilityFramework,
} from "../../shared/composer/frameworks";
import { canonicalDirectory, resolveWithinRoot } from "../pathSafety";

const SOURCE_EXT = /\.(?:astro|html|vue|svelte|jsx|tsx|js|ts|css)$/i;
const CONFIG_RE = /^(?:tailwind|uno|unocss)\.config\.(?:js|cjs|mjs|ts)$/i;
const IGNORE = new Set(["node_modules", ".git", "dist", ".astro", ".vercel", ".wrangler"]);

function readSafe(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function walk(root: string, dir: string, out: string[], depth = 0): void {
  if (depth > 8 || out.length >= 600) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(root, absolute, out, depth + 1);
    else if (SOURCE_EXT.test(entry.name) || CONFIG_RE.test(entry.name)) {
      out.push(path.relative(root, absolute).replace(/\\/g, "/"));
    }
    if (out.length >= 600) return;
  }
}

function dependencyNames(root: string): Set<string> {
  try {
    const pkg = JSON.parse(readSafe(path.join(root, "package.json"))) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

function pxValue(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(px|rem|em)$/);
  if (!match) return null;
  const number = Number(match[1]);
  return Math.round(number * (match[2] === "px" ? 1 : 16));
}

function collectBreakpoints(text: string, out: Record<string, number>) {
  const patterns = [
    /--breakpoint-([\w-]+)\s*:\s*([\d.]+(?:px|rem|em))/g,
    /(["']?)(sm|md|lg|xl|2xl)\1\s*:\s*["']([\d.]+(?:px|rem|em))["']/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const name = match.length === 4 ? match[2]! : match[1]!;
      const raw = match.length === 4 ? match[3]! : match[2]!;
      const value = pxValue(raw);
      if (value) out[name] = value;
    }
  }
}

function collectCandidates(text: string, out: Set<string>) {
  const quotedClass = /(?:class|className)\s*=\s*["'`]([^"'`]+)["'`]/g;
  let match: RegExpExecArray | null;
  while ((match = quotedClass.exec(text))) {
    for (const token of match[1]!.split(/\s+/)) {
      if (token && token.length < 160 && !/[{}$]/.test(token)) out.add(token);
    }
  }
  const apply = /@apply\s+([^;{}]+)/g;
  while ((match = apply.exec(text))) {
    for (const token of match[1]!.split(/\s+/)) if (token) out.add(token);
  }
}

export function detectComposerFrameworks(
  projectPath: string,
): ComposerFrameworkCapabilities {
  const root = canonicalDirectory(projectPath);
  const deps = dependencyNames(root);
  const detected = new Set<ComposerUtilityFramework>();
  const sources: string[] = [];
  const diagnostics: string[] = [];
  let configured = false;

  if ([...deps].some((name) => name === "tailwindcss" || name.startsWith("@tailwindcss/"))) {
    detected.add("tailwind");
    sources.push("package.json");
  }
  if ([...deps].some((name) => name === "unocss" || name.startsWith("@unocss/"))) {
    detected.add("unocss");
    sources.push("package.json");
  }

  const files: string[] = [];
  walk(root, root, files);
  const candidates = new Set(COMMON_UTILITY_CANDIDATES);
  const breakpoints: Record<string, number> = {};
  for (const relative of files) {
    const absolute = resolveWithinRoot(root, relative);
    const text = readSafe(absolute);
    if (!text) continue;
    if (/tailwind\.config\./i.test(relative) || /@(?:import\s+["']tailwindcss|tailwind\s+|theme\s*\{)/i.test(text)) {
      detected.add("tailwind");
      configured = true;
      sources.push(relative);
    }
    if (/(?:uno|unocss)\.config\./i.test(relative) || /UnoCSS|unocss|@unocss/i.test(text)) {
      detected.add("unocss");
      configured = true;
      sources.push(relative);
    }
    collectCandidates(text, candidates);
    collectBreakpoints(text, breakpoints);
  }

  if (!detected.size) diagnostics.push("No Tailwind or UnoCSS project evidence found.");
  if (detected.size > 1) diagnostics.push("Both utility runtimes are configured; suggestions include both syntaxes.");
  const list = [...detected];
  return {
    primary: list.includes("tailwind") ? "tailwind" : list[0] ?? "none",
    detected: list,
    confidence: configured ? "configured" : list.length ? "package" : "none",
    sources: [...new Set(sources)].sort(),
    breakpoints: { ...FALLBACK_BREAKPOINTS, ...breakpoints },
    candidates: [...candidates].sort(),
    diagnostics,
  };
}
