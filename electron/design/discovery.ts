import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  canonicalDirectory,
  resolveWithinRoot,
} from "../pathSafety";
import type { StylesheetInfo } from "../../shared/design";

const CSS_IMPORT_RE =
  /(?:@import\s+(?:url\()?['"]([^'"]+\.css)['"]|import\s+['"]([^'"]+\.css)['"])/gi;

const ENTRY_CANDIDATES = [
  path.join("src", "styles", "global.css"),
  path.join("src", "styles", "globals.css"),
  path.join("src", "styles", "base.css"),
  path.join("src", "styles", "index.css"),
  path.join("styles", "global.css"),
  path.join("styles", "globals.css"),
];

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

function walkCssFiles(dir: string, root: string, out: Set<string>): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === ".astro"
      ) {
        continue;
      }
      walkCssFiles(absolute, root, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (path.extname(entry.name).toLowerCase() !== ".css") continue;
    out.add(toPosix(path.relative(root, absolute)));
  }
}

function collectImportTargets(
  content: string,
  fromFile: string,
  root: string,
  out: Set<string>,
): void {
  CSS_IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CSS_IMPORT_RE.exec(content))) {
    const raw = (match[1] || match[2] || "").trim();
    if (!raw || raw.startsWith("http://") || raw.startsWith("https://")) {
      continue;
    }
    const cleaned = raw.replace(/^\.\//, "");
    const absolute = path.isAbsolute(cleaned)
      ? cleaned
      : path.resolve(path.dirname(fromFile), cleaned);
    try {
      const resolved = resolveWithinRoot(root, absolute, {
        allowMissing: true,
        rejectFinalSymlink: true,
      });
      if (
        existsSync(resolved) &&
        statSync(resolved).isFile() &&
        path.extname(resolved).toLowerCase() === ".css"
      ) {
        out.add(toPosix(path.relative(root, resolved)));
      }
    } catch {
      /* ignore out-of-root */
    }
  }
}

function scanLayoutImports(root: string, out: Set<string>): void {
  const layoutsDir = path.join(root, "src", "layouts");
  const pagesDir = path.join(root, "src", "pages");
  for (const dir of [layoutsDir, pagesDir]) {
    if (!existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length) {
      const current = stack.pop()!;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(absolute);
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        if (![".astro", ".ts", ".js", ".mjs", ".tsx", ".jsx"].includes(ext)) {
          continue;
        }
        try {
          const content = readFileSync(absolute, "utf8");
          collectImportTargets(content, absolute, root, out);
        } catch {
          /* ignore unreadable */
        }
      }
    }
  }
}

/** Prefer global.css, then other common entry names that exist. */
export function resolveDesignEntryRelativePath(
  projectPath: string,
): string | null {
  const root = canonicalDirectory(projectPath);
  for (const candidate of ENTRY_CANDIDATES) {
    const absolute = path.join(root, candidate);
    if (existsSync(absolute) && statSync(absolute).isFile()) {
      return toPosix(candidate);
    }
  }
  return null;
}

export function resolveDesignEntryAbsolute(
  projectPath: string,
): string | null {
  const relative = resolveDesignEntryRelativePath(projectPath);
  if (!relative) return null;
  const root = canonicalDirectory(projectPath);
  return resolveWithinRoot(root, path.join(root, relative), {
    rejectFinalSymlink: true,
  });
}

/** Default path used when creating the design entry. */
export function defaultEntryRelativePath(): string {
  return "src/styles/global.css";
}

export function listProjectStylesheets(
  projectPath: string,
): StylesheetInfo[] {
  const root = canonicalDirectory(projectPath);
  const found = new Set<string>();

  walkCssFiles(path.join(root, "src", "styles"), root, found);
  walkCssFiles(path.join(root, "styles"), root, found);
  scanLayoutImports(root, found);

  // Also pull imports from already-found CSS files (one hop).
  for (const rel of [...found]) {
    const absolute = path.join(root, ...rel.split("/"));
    try {
      const content = readFileSync(absolute, "utf8");
      collectImportTargets(content, absolute, root, found);
    } catch {
      /* ignore */
    }
  }

  const entry = resolveDesignEntryRelativePath(projectPath);

  const items: StylesheetInfo[] = [];
  for (const relativePath of found) {
    const absolute = path.join(root, ...relativePath.split("/"));
    try {
      const stat = statSync(absolute);
      if (!stat.isFile()) continue;
      items.push({
        relativePath,
        bytes: stat.size,
        mtimeMs: Math.floor(stat.mtimeMs),
        isEntry: relativePath === entry,
      });
    } catch {
      /* ignore */
    }
  }

  items.sort((a, b) => {
    if (a.isEntry !== b.isEntry) return a.isEntry ? -1 : 1;
    return a.relativePath.localeCompare(b.relativePath);
  });
  return items;
}

export function ensureStylesDirectory(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  const stylesDir = resolveWithinRoot(
    root,
    path.join(root, "src", "styles"),
    { allowMissing: true, rejectFinalSymlink: true },
  );
  mkdirSync(stylesDir, { recursive: true });
  return stylesDir;
}

export function resolveStylesheetAbsolute(
  projectPath: string,
  relativePath: string,
): string {
  const root = canonicalDirectory(projectPath);
  const normalized = relativePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    throw new Error("Invalid stylesheet path");
  }
  if (!normalized.toLowerCase().endsWith(".css")) {
    throw new Error("Stylesheet must be a .css file");
  }
  const absolute = resolveWithinRoot(
    root,
    path.join(root, ...normalized.split("/")),
    { allowMissing: true, rejectFinalSymlink: true },
  );
  return absolute;
}
