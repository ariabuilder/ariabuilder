import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { canonicalDirectory, isPathInside } from "./pathSafety";

const SOURCE_EXTS = new Set([".astro", ".md", ".mdx"]);
const CONFIG_EXTS = new Set([
  ".ts",
  ".js",
  ".mjs",
  ".cts",
  ".mts",
  ".tsx",
  ".jsx",
]);
const IMAGE_EXTS = new Set([
  ".svg",
  ".png",
  ".ico",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
]);

const PUBLIC_FAVICON_CANDIDATES = [
  "favicon.svg",
  "favicon.ico",
  "favicon.png",
  "favicon.webp",
  "favicon.jpg",
  "favicon.jpeg",
  "favicon.gif",
];

type IconCandidate = {
  file: string;
  hrefLiteral: string | null;
  hrefExpr: string | null;
  rel: string;
  media: string;
  /** Prefer layouts over pages; lower is better. */
  sourceRank: number;
};

const MAX_DISCOVERY_FILES = 2_000;
const MAX_DISCOVERY_DEPTH = 20;

function walkFiles(
  dir: string,
  exts: Set<string>,
  out: string[],
  depth = 0,
): void {
  if (depth > MAX_DISCOVERY_DEPTH || out.length >= MAX_DISCOVERY_FILES) return;
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, exts, out, depth + 1);
      continue;
    }
    if (exts.has(path.extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
}

function attrValue(tag: string, name: string): string | null {
  const re = new RegExp(
    `\\b${name}\\s*=\\s*(?:["']([^"']*)["']|\\{([^}]*)\\})`,
    "i",
  );
  const match = tag.match(re);
  if (!match) return null;
  return (match[1] ?? match[2] ?? "").trim() || null;
}

function isLiteralAttr(tag: string, name: string): boolean {
  return new RegExp(`\\b${name}\\s*=\\s*["']`, "i").test(tag);
}

function collectLinkCandidates(
  source: string,
  file: string,
  sourceRank: number,
): IconCandidate[] {
  const tags = source.match(/<link\b[^>]*>/gi) ?? [];
  const out: IconCandidate[] = [];
  for (const tag of tags) {
    const rel = (attrValue(tag, "rel") ?? "").toLowerCase();
    if (!rel.includes("icon")) continue;
    const hrefRaw = attrValue(tag, "href");
    if (!hrefRaw) continue;
    const media = (attrValue(tag, "media") ?? "").toLowerCase();
    const literal = isLiteralAttr(tag, "href");
    out.push({
      file,
      hrefLiteral: literal ? hrefRaw : null,
      hrefExpr: literal ? null : hrefRaw.replace(/\.src$/, "").trim(),
      rel,
      media,
      sourceRank,
    });
  }
  return out;
}

function scoreCandidate(c: IconCandidate): number {
  let score = c.sourceRank * 100;
  if (c.rel.includes("apple-touch")) score += 30;
  if (c.media.includes("prefers-color-scheme: dark")) score += 20;
  if (c.media.includes("prefers-color-scheme: light")) score -= 5;
  if (c.hrefLiteral) score -= 10;
  return score;
}

function looksLikePublicUrl(value: string): boolean {
  return (
    value.startsWith("/") && !value.startsWith("//") && !value.includes("://")
  );
}

function normalizePublicUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!looksLikePublicUrl(trimmed)) return null;
  if (trimmed.includes("..")) return null;
  return trimmed.split("?")[0]?.split("#")[0] || null;
}

/** `favicon: "/x.png"` or `favicon = "/x.png"` in config-like sources. */
function findStringPropInSource(source: string, prop: string): string | null {
  const re = new RegExp(
    `(?:(?:export\\s+)?(?:const|let|var)\\s+)?${prop}\\s*[:=]\\s*["'](/[^"']+)["']`,
    "m",
  );
  const match = source.match(re);
  return match?.[1] ? normalizePublicUrl(match[1]) : null;
}

function findSrcRoot(fromFile: string): string | null {
  let current = path.dirname(fromFile);
  for (let i = 0; i < 12; i++) {
    if (path.basename(current) === "src") return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function resolveImportPath(
  fromFile: string,
  specifier: string,
  projectRoot: string,
): string | null {
  if (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("@/")
  ) {
    return null;
  }
  const cleaned = specifier.replace(/[?#].*$/, "");
  let absolute: string;
  if (cleaned.startsWith("@/")) {
    const projectSrcGuess = findSrcRoot(fromFile);
    if (!projectSrcGuess) return null;
    absolute = path.resolve(projectSrcGuess, cleaned.slice(2));
  } else {
    absolute = path.resolve(path.dirname(fromFile), cleaned);
  }
  if (isPathInside(projectRoot, absolute) && existsSync(absolute) && statSync(absolute).isFile()) return absolute;
  for (const ext of [".ts", ".js", ".mjs", ".tsx", ".jsx", ".astro"]) {
    const withExt = absolute + ext;
    if (isPathInside(projectRoot, withExt) && existsSync(withExt) && statSync(withExt).isFile()) return withExt;
  }
  for (const ext of [".ts", ".js", ".mjs"]) {
    const index = path.join(absolute, `index${ext}`);
    if (isPathInside(projectRoot, index) && existsSync(index) && statSync(index).isFile()) return index;
  }
  return null;
}

function findDefaultImportSpecifier(
  source: string,
  localName: string,
): string | null {
  const re = new RegExp(`import\\s+${localName}\\s+from\\s+["']([^"']+)["']`);
  return source.match(re)?.[1] ?? null;
}

function findNamedImportSpecifier(
  source: string,
  localName: string,
): string | null {
  const re = /import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const names = match[1]?.split(",") ?? [];
    for (const part of names) {
      const bits = part.trim().split(/\s+as\s+/i);
      const imported = bits[0]?.trim();
      const local = (bits[1] ?? bits[0])?.trim();
      if (local === localName || imported === localName) {
        return match[2] ?? null;
      }
    }
  }
  return null;
}

function absoluteImageToStoredPath(
  projectRoot: string,
  absolute: string,
): string | null {
  const root = canonicalDirectory(projectRoot);
  const abs = path.resolve(absolute);
  if (!isPathInside(root, abs)) return null;
  if (!IMAGE_EXTS.has(path.extname(abs).toLowerCase())) return null;

  const pub = path.join(root, "public");
  if (abs.startsWith(pub + path.sep)) {
    const rel = abs.slice(pub.length).split(path.sep).join("/");
    return rel.startsWith("/") ? rel : `/${rel}`;
  }

  return abs.slice(root.length + 1).split(path.sep).join("/");
}

function findPropInProject(projectRoot: string, prop: string): string | null {
  const files: string[] = [];
  walkFiles(path.join(projectRoot, "src"), CONFIG_EXTS, files);
  for (const file of files) {
    try {
      const found = findStringPropInSource(readFileSync(file, "utf8"), prop);
      if (found) return found;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function resolveExprToStoredPath(
  expr: string,
  filePath: string,
  projectRoot: string,
): string | null {
  const cleaned = expr.replace(/\s+/g, "");
  if (!cleaned) return null;
  const source = readFileSync(filePath, "utf8");

  const propMatch = cleaned.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
  if (propMatch) {
    const [, rootIdent, prop] = propMatch;
    const specifier =
      findDefaultImportSpecifier(source, rootIdent!) ??
      findNamedImportSpecifier(source, rootIdent!);
    if (specifier) {
       const modPath = resolveImportPath(filePath, specifier, projectRoot);
      if (modPath) {
        try {
          const fromProp = findStringPropInSource(
            readFileSync(modPath, "utf8"),
            prop!,
          );
          if (fromProp) return fromProp;
        } catch {
          /* ignore */
        }
      }
    }
    return findPropInProject(projectRoot, prop!);
  }

  if (/^[A-Za-z_$][\w$]*$/.test(cleaned)) {
    const specifier =
      findDefaultImportSpecifier(source, cleaned) ??
      findNamedImportSpecifier(source, cleaned);
    if (!specifier) return null;
     const abs = resolveImportPath(filePath, specifier, projectRoot);
    if (!abs) return null;
    return absoluteImageToStoredPath(projectRoot, abs);
  }

  return null;
}

function discoverFromPublic(projectRoot: string): string | null {
  const pub = path.join(projectRoot, "public");
  for (const name of PUBLIC_FAVICON_CANDIDATES) {
    const full = path.join(pub, name);
    if (isPathInside(projectRoot, full) && existsSync(full) && statSync(full).isFile()) {
      return `/${name}`;
    }
  }
  return null;
}

/**
 * Find an already-assigned favicon from layouts/pages (and public/ fallback).
 * Returns a public URL (`/favicon.svg`) or project-relative source path.
 */
export function discoverProjectFavicon(projectPath: string): string | null {
  let root: string;
  try {
    root = canonicalDirectory(projectPath);
  } catch {
    return null;
  }

  const layoutFiles: string[] = [];
  const pageFiles: string[] = [];
  walkFiles(path.join(root, "src", "layouts"), SOURCE_EXTS, layoutFiles);
  walkFiles(path.join(root, "src", "pages"), SOURCE_EXTS, pageFiles);

  const located: IconCandidate[] = [];
  for (const file of layoutFiles) {
    try {
      located.push(
        ...collectLinkCandidates(readFileSync(file, "utf8"), file, 0),
      );
    } catch {
      /* ignore */
    }
  }
  for (const file of pageFiles) {
    try {
      located.push(
        ...collectLinkCandidates(readFileSync(file, "utf8"), file, 1),
      );
    } catch {
      /* ignore */
    }
  }

  located.sort((a, b) => scoreCandidate(a) - scoreCandidate(b));

  for (const c of located) {
    if (c.hrefLiteral) {
      const url = normalizePublicUrl(c.hrefLiteral);
      if (url) return url;
      continue;
    }
    if (c.hrefExpr) {
      try {
        const resolved = resolveExprToStoredPath(c.hrefExpr, c.file, root);
        if (resolved) return resolved;
      } catch {
        /* ignore */
      }
    }
  }

  const fromConfig =
    findPropInProject(root, "favicon") ??
    findPropInProject(root, "faviconLight");
  if (fromConfig) return fromConfig;

  return discoverFromPublic(root);
}
