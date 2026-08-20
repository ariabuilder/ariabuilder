import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
} from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  canonicalDirectory,
  canonicalPathAllowMissing,
  isPathInside,
  removePathTracked,
  renamePathTracked,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";
import type {
  ComponentFolderMutationResult,
  CreateComponentResult,
  CreateLayoutResult,
  CreatePageResult,
  CreatePageOptions,
  ScanComponent,
  ScanPage,
  ScanResult,
} from "../shared/types";
import { resolvePageRole } from "../shared/pages";
import { blankPageAstroSource } from "../shared/composer/ariaPrimitives";
import {
  blankLayoutAstroSource,
  blankPageWithLayoutAstroSource,
  seedLayoutCreationProps,
} from "../shared/composer/layoutAuthoring";
import { extractPropSchema } from "../shared/composer/props";
import { readCollections, writeCollections } from "./collections";
import { readPagesMeta, writePagesMeta } from "./pagesMeta";

export type {
  ComponentFolderMutationResult,
  CreateComponentResult,
  CreateLayoutResult,
  CreatePageResult,
  CreatePageOptions,
  ScanComponent,
  ScanPage,
  ScanResult,
} from "../shared/types";

const PAGE_EXTS = new Set([".astro", ".md", ".mdx"]);
const COMPONENT_EXTS = new Set([".astro", ".tsx", ".jsx", ".vue", ".svelte"]);
const IGNORED_DIRS = new Set(["node_modules", ".git", ".astro", "dist"]);
const MAX_SCAN_FILES = 20_000;
const MAX_SCAN_DEPTH = 40;

function projectDirectory(root: string, relative: string): string {
  const lexical = path.join(root, relative);
  const parts = relative.split(/[\\/]/).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    let st;
    try {
      st = lstatSync(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return canonicalPathAllowMissing(lexical);
      }
      throw error;
    }
    if (st.isSymbolicLink()) {
      throw new Error(`${relative} cannot be a symlink`);
    }
  }
  return canonicalPathAllowMissing(lexical);
}

function fileToRoute(relPosix: string): string {
  const withoutExt = relPosix.replace(/\.(astro|md|mdx)$/i, "");
  const segments = withoutExt.split("/").filter(Boolean);
  if (segments.at(-1) === "index") segments.pop();
  if (segments.length === 0) return "/";
  return `/${segments.join("/")}`;
}

async function collectPages(pagesRoot: string, projectRoot: string): Promise<ScanPage[]> {
  if (!existsSync(pagesRoot)) return [];
  const pages: ScanPage[] = [];

  let visited = 0;
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > MAX_SCAN_DEPTH) throw new Error("Project folder nesting is too deep");
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_SCAN_FILES) throw new Error("Project is too large to scan");
      if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
      // Aria-managed preview harness — not a user page.
      if (entry.name === "__aria__" || entry.name === "aria-preview") continue;
      // Aria-managed discovery endpoints — not user pages.
      if (
        entry.name === "robots.txt.ts" ||
        entry.name === "sitemap.xml.ts" ||
        entry.name === "llms.txt.ts" ||
        entry.name === "sitemap-images.xml.ts" ||
        entry.name === "llms-full.txt.ts" ||
        /^sitemap-\d+\.xml\.ts$/i.test(entry.name)
      ) {
        continue;
      }
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!PAGE_EXTS.has(ext)) continue;
      const rel = path.relative(pagesRoot, full);
      const relPosix = rel.split(path.sep).join("/");
      let mtimeMs = 0;
      try {
        mtimeMs = (await stat(full)).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      pages.push({
        route: fileToRoute(relPosix),
        file: path.relative(projectRoot, full).split(path.sep).join("/"),
        mtimeMs,
      });
    }
  };

  await walk(pagesRoot, 0);
  pages.sort((a, b) => {
    if (a.route === "/") return -1;
    if (b.route === "/") return 1;
    return a.route.localeCompare(b.route);
  });
  return pages;
}

function componentDisplayName(fileName: string): string {
  return fileName.replace(/\.(astro|tsx|jsx|vue|svelte)$/i, "");
}

async function collectComponents(
  componentsRoot: string,
  projectRoot: string,
): Promise<ScanComponent[]> {
  if (!existsSync(componentsRoot)) return [];
  const components: ScanComponent[] = [];

  let visited = 0;
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > MAX_SCAN_DEPTH) throw new Error("Project folder nesting is too deep");
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_SCAN_FILES) throw new Error("Project is too large to scan");
      if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!COMPONENT_EXTS.has(ext)) continue;
      const relFromComponents = path
        .relative(componentsRoot, full)
        .split(path.sep)
        .join("/");
      const file = path.relative(projectRoot, full).split(path.sep).join("/");
      const parentSegments = relFromComponents.split("/").slice(0, -1);
      // Full folder path under src/components (e.g. "ui" or "ui/forms").
      const category =
        parentSegments.length > 0 ? parentSegments.join("/") : undefined;
      let mtimeMs = 0;
      try {
        mtimeMs = (await stat(full)).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      components.push({
        id: file,
        name: componentDisplayName(entry.name),
        file,
        mtimeMs,
        ...(category ? { category } : {}),
      });
    }
  };

  await walk(componentsRoot, 0);
  components.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
  return components;
}

export async function scanProject(projectPath: string): Promise<ScanResult> {
  const root = canonicalDirectory(projectPath);
  const pagesRoot = projectDirectory(root, path.join("src", "pages"));
  if (!isPathInside(root, pagesRoot)) throw new Error("Pages folder is outside the project");
  const layoutsRoot = projectDirectory(root, path.join("src", "layouts"));
  const componentsRoot = projectDirectory(root, path.join("src", "components"));
  if (!isPathInside(root, layoutsRoot) || !isPathInside(root, componentsRoot)) {
    throw new Error("A source folder is outside the project");
  }

  const pages = await collectPages(pagesRoot, root);
  let pagesMeta;
  let collections;
  try {
    pagesMeta = readPagesMeta(root);
  } catch {
    pagesMeta = { pages: {} };
  }
  try {
    collections = readCollections(root);
  } catch {
    collections = { collections: [] };
  }
  for (const page of pages) {
    page.role = resolvePageRole(page, pagesMeta, collections);
    const title = pagesMeta.pages[page.file]?.title?.trim();
    if (title) page.title = title;
  }
  const layouts = (await collectComponents(layoutsRoot, root)).filter((l) =>
    /\.astro$/i.test(l.file),
  );
  const components = await collectComponents(componentsRoot, root);

  return {
    name: path.basename(root) || root,
    root,
    pages,
    layouts,
    components,
    counts: {
      pages: pages.length,
      layouts: layouts.length,
      components: components.length,
    },
  };
}

/** Create `src/pages/{name}.astro` (nested paths allowed). Returns new page meta. */
export function createPage(
  projectPath: string,
  name: string,
  options: CreatePageOptions = {},
): CreatePageResult {
  const root = canonicalDirectory(projectPath);
  const pagesDir = projectDirectory(root, path.join("src", "pages"));
  if (!isPathInside(root, pagesDir)) throw new Error("Pages folder is outside the project");
  let fileName = name.trim().replace(/\.astro$/i, "");
  fileName = fileName.replace(/[^a-zA-Z0-9/_-]+/g, "-").replace(/^\/+|\/+$/g, "");
  if (!fileName) {
    throw new Error("Invalid page name");
  }

  const pagePath = path.join(pagesDir, `${fileName}.astro`);
  const resolved = resolveWithinRoot(root, pagePath, {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  if (!resolved.startsWith(pagesDir + path.sep) && resolved !== pagesDir) {
    throw new Error("Invalid page path");
  }
  if (existsSync(resolved)) {
    throw new Error("A page with that name already exists.");
  }

  mkdirSync(path.dirname(resolved), { recursive: true });

  // Aria blank page: Section+Container scaffold so Design managed CSS and
  // Composer have editable coverage from the first open (still clean Astro).
  const nestDepth = fileName.split("/").filter(Boolean).length - 1;
  const toSrcRoot = "../".repeat(nestDepth + 1);
  const globalCss = path.join(root, "src", "styles", "global.css");
  const styleImport = existsSync(globalCss)
    ? `import '${toSrcRoot}styles/global.css';\n`
    : "";
  let source: string;
  if (options.layout) {
    const layoutFile = resolveWithinRoot(root, options.layout.file, {
      rejectFinalSymlink: true,
    });
    const layoutsRoot = projectDirectory(root, path.join("src", "layouts"));
    if (
      !layoutFile.startsWith(layoutsRoot + path.sep) ||
      path.extname(layoutFile).toLowerCase() !== ".astro"
    ) {
      throw new Error("Selected layout must be an Astro file under src/layouts");
    }
    const schema = extractPropSchema(readFileSync(layoutFile, "utf8"));
    const seeded = seedLayoutCreationProps({
      fields: schema.fields,
      props: options.layout.props,
      pageName: fileName,
    });
    if (seeded.missingRequired.length) {
      throw new Error(
        `Layout requires: ${seeded.missingRequired.join(", ")}`,
      );
    }
    let layoutImport = path
      .relative(path.dirname(resolved), layoutFile)
      .split(path.sep)
      .join("/");
    if (!layoutImport.startsWith(".")) layoutImport = `./${layoutImport}`;
    source = blankPageWithLayoutAstroSource({
      layoutName: options.layout.name,
      layoutImport,
      props: seeded.props,
      styleImport,
    });
  } else {
    source = blankPageAstroSource({ styleImport });
  }

  writeTextFileAtomic(resolved, source, { overwrite: false });

  const relPosix = path
    .relative(pagesDir, resolved)
    .split(path.sep)
    .join("/");
  return {
    route: fileToRoute(relPosix),
    file: path.relative(root, resolved).split(path.sep).join("/"),
  };
}

/** Resolve a project-relative page file to an absolute path under `src/pages`. */
export function resolvePageFilePath(
  projectPath: string,
  relativeFile: string,
): string {
  const root = canonicalDirectory(projectPath);
  const pagesDir = projectDirectory(root, path.join("src", "pages"));
  if (!isPathInside(root, pagesDir)) throw new Error("Pages folder is outside the project");
  const absolute = resolveWithinRoot(root, path.resolve(root, relativeFile), {
    rejectFinalSymlink: true,
  });
  const underPages =
    absolute === pagesDir ||
    absolute.startsWith(pagesDir + path.sep) ||
    absolute.startsWith(pagesDir + "/");
  if (!underPages) {
    throw new Error("Invalid page path");
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error("Page file not found");
  }
  const extension = path.extname(absolute).toLowerCase();
  if (!new Set([".astro", ".md", ".mdx"]).has(extension)) {
    throw new Error("Unsupported page file");
  }
  return absolute;
}

/** Delete a page file under `src/pages`. */
export function deletePage(
  projectPath: string,
  relativeFile: string,
  options?: { unassignCms?: boolean },
): { ok: true } {
  const root = canonicalDirectory(projectPath);
  const absolute = resolvePageFilePath(root, relativeFile);
  const file = toPosixRel(root, absolute);
  const collectionsState = readCollections(root);
  const consumers = collectionsState.collections.flatMap((collection) => {
    const usages: string[] = [];
    if (collection.listPageFile === file) usages.push(`${collection.label} list page`);
    if (collection.templatePageFile === file) usages.push(`${collection.label} entry template`);
    return usages;
  });
  if (consumers.length > 0 && !options?.unassignCms) {
    throw new Error(
      `PAGE_IN_USE: This page is still assigned to ${consumers.join(", ")}. Remove those assignments before deleting it.`,
    );
  }
  if (consumers.length > 0) {
    writeCollections(root, {
      collections: collectionsState.collections.map((collection) => ({
        ...collection,
        listPageFile:
          collection.listPageFile === file ? null : collection.listPageFile,
        templatePageFile:
          collection.templatePageFile === file
            ? null
            : collection.templatePageFile,
      })),
    });
  }
  removePathTracked(absolute);
  const meta = readPagesMeta(root);
  if (meta.pages[file]) {
    const pages = { ...meta.pages };
    delete pages[file];
    writePagesMeta(root, { pages });
  }
  return { ok: true };
}

/** Create `src/components/{name}.astro` (nested paths allowed). */
export function createComponent(
  projectPath: string,
  name: string,
): CreateComponentResult {
  const root = canonicalDirectory(projectPath);
  const componentsDir = projectDirectory(root, path.join("src", "components"));
  if (!isPathInside(root, componentsDir)) {
    throw new Error("Components folder is outside the project");
  }
  let fileName = name.trim().replace(/\.astro$/i, "");
  fileName = fileName.replace(/[^a-zA-Z0-9/_-]+/g, "-").replace(/^\/+|\/+$/g, "");
  if (!fileName) {
    throw new Error("Invalid component name");
  }

  const componentPath = path.join(componentsDir, `${fileName}.astro`);
  const resolved = resolveWithinRoot(root, componentPath, {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  if (
    !resolved.startsWith(componentsDir + path.sep) &&
    resolved !== componentsDir
  ) {
    throw new Error("Invalid component path");
  }
  if (existsSync(resolved)) {
    throw new Error("A component with that name already exists.");
  }

  mkdirSync(path.dirname(resolved), { recursive: true });

  // A component may legally have zero or multiple roots. Keep creation neutral:
  // Composer supplies the editor-only empty target and preview document.
  const source = `---
---
`;

  writeTextFileAtomic(resolved, source, { overwrite: false });

  const file = path.relative(root, resolved).split(path.sep).join("/");
  const base = path.basename(resolved);
  return {
    id: file,
    name: componentDisplayName(base),
    file,
  };
}

/** Create a first-class Astro layout with one required default content slot. */
export function createLayout(
  projectPath: string,
  name: string,
): CreateLayoutResult {
  const root = canonicalDirectory(projectPath);
  const layoutsDir = projectDirectory(root, path.join("src", "layouts"));
  if (!isPathInside(root, layoutsDir)) {
    throw new Error("Layouts folder is outside the project");
  }
  let fileName = name.trim().replace(/\.astro$/i, "");
  fileName = fileName.replace(/[^a-zA-Z0-9/_-]+/g, "-").replace(/^\/+|\/+$/g, "");
  if (!fileName) throw new Error("Invalid layout name");

  const layoutPath = path.join(layoutsDir, `${fileName}.astro`);
  const resolved = resolveWithinRoot(root, layoutPath, {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  if (!resolved.startsWith(layoutsDir + path.sep) && resolved !== layoutsDir) {
    throw new Error("Invalid layout path");
  }
  if (existsSync(resolved)) {
    throw new Error("A layout with that name already exists.");
  }
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeTextFileAtomic(resolved, blankLayoutAstroSource(), { overwrite: false });
  const file = path.relative(root, resolved).split(path.sep).join("/");
  return {
    id: file,
    name: componentDisplayName(path.basename(resolved)),
    file,
  };
}

/** Resolve a project-relative component file under `src/components`. */
export function resolveComponentFilePath(
  projectPath: string,
  relativeFile: string,
): string {
  const root = canonicalDirectory(projectPath);
  const componentsDir = projectDirectory(root, path.join("src", "components"));
  if (!isPathInside(root, componentsDir)) {
    throw new Error("Components folder is outside the project");
  }
  const absolute = resolveWithinRoot(root, path.resolve(root, relativeFile), {
    rejectFinalSymlink: true,
  });
  const underComponents =
    absolute === componentsDir ||
    absolute.startsWith(componentsDir + path.sep) ||
    absolute.startsWith(componentsDir + "/");
  if (!underComponents) {
    throw new Error("Invalid component path");
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error("Component file not found");
  }
  const extension = path.extname(absolute).toLowerCase();
  if (!COMPONENT_EXTS.has(extension)) {
    throw new Error("Unsupported component file");
  }
  return absolute;
}

/** Delete a component file under `src/components`. */
export function deleteComponent(
  projectPath: string,
  relativeFile: string,
): { ok: true } {
  const root = canonicalDirectory(projectPath);
  const absolute = resolveComponentFilePath(root, relativeFile);
  const usages = findComponentUsageRecords(root, absolute);
  if (usages.length > 0) {
    throw new Error(
      `COMPONENT_IN_USE: This component is imported by ${usages.slice(0, 8).map((usage) => `${usage.file}:${usage.line}`).join(", ")}${usages.length > 8 ? ` and ${usages.length - 8} more` : ""}. Remove those imports before deleting it.`,
    );
  }
  removePathTracked(absolute);
  return { ok: true };
}

const IMPORT_SOURCE_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g;
const IMPORT_SCAN_EXTS = new Set([
  ".astro", ".js", ".jsx", ".mjs", ".mts", ".svelte", ".ts", ".tsx", ".vue",
]);

function resolveImportedFile(root: string, importer: string, source: string): string | null {
  const clean = source.split(/[?#]/, 1)[0] ?? "";
  let base: string;
  if (clean.startsWith("@/")) base = path.join(root, "src", clean.slice(2));
  else if (clean.startsWith("./") || clean.startsWith("../")) {
    base = path.resolve(path.dirname(importer), clean);
  } else if (clean.startsWith("src/")) base = path.join(root, clean);
  else return null;

  const candidates = [base];
  if (!path.extname(base)) {
    for (const ext of COMPONENT_EXTS) candidates.push(`${base}${ext}`);
    for (const ext of COMPONENT_EXTS) candidates.push(path.join(base, `index${ext}`));
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return path.resolve(candidate);
    } catch {
      // Continue through supported import candidates.
    }
  }
  return null;
}

export type ComponentUsageRecord = {
  file: string;
  line: number;
  referenceCount: number;
};

/** Static direct-import inventory shared by delete guards and Studio details. */
export function findComponentUsageRecords(
  root: string,
  componentAbsolute: string,
): ComponentUsageRecord[] {
  const usages: ComponentUsageRecord[] = [];
  const srcRoot = projectDirectory(root, "src");
  let visited = 0;
  const walk = (directory: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) throw new Error("Project folder nesting is too deep");
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || (entry.isDirectory() && IGNORED_DIRS.has(entry.name))) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile() || absolute === componentAbsolute) continue;
      if (!IMPORT_SCAN_EXTS.has(path.extname(entry.name).toLowerCase())) continue;
      visited += 1;
      if (visited > MAX_SCAN_FILES) throw new Error("Project has too many source files to scan safely");
      if (statSync(absolute).size > 2 * 1024 * 1024) continue;
      const sourceText = readFileSync(absolute, "utf8");
      IMPORT_SOURCE_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      let firstLine = 0;
      let referenceCount = 0;
      while ((match = IMPORT_SOURCE_RE.exec(sourceText)) !== null) {
        if (resolveImportedFile(root, absolute, match[1] ?? "") !== componentAbsolute) continue;
        if (!firstLine) firstLine = sourceText.slice(0, match.index).split("\n").length;
        referenceCount += 1;
      }
      if (referenceCount > 0) {
        usages.push({
          file: toPosixRel(root, absolute),
          line: firstLine,
          referenceCount,
        });
      }
    }
  };
  if (existsSync(srcRoot)) walk(srcRoot, 0);
  return usages;
}

function toPosixRel(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function normalizeComponentsFolderRel(input: string): string {
  if (typeof input !== "string") {
    throw new Error("Invalid folder path");
  }
  const trimmed = input.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    throw new Error("Invalid folder path");
  }
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length === 0 || parts.length > 30) {
    throw new Error("Invalid folder path");
  }
  const sanitized: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "..") {
      throw new Error("Invalid folder path");
    }
    const clean = part
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!clean || clean === "." || clean === "..") {
      throw new Error("Invalid folder path");
    }
    sanitized.push(clean);
  }
  return sanitized.join("/");
}

function resolveComponentsRoot(projectPath: string): {
  root: string;
  componentsDir: string;
} {
  const root = canonicalDirectory(projectPath);
  const componentsDir = projectDirectory(root, path.join("src", "components"));
  if (!isPathInside(root, componentsDir)) {
    throw new Error("Components folder is outside the project");
  }
  return { root, componentsDir };
}

function resolveComponentsFolder(
  projectPath: string,
  folderRelInput: string,
): {
  root: string;
  componentsDir: string;
  folderRel: string;
  absolute: string;
} {
  const { root, componentsDir } = resolveComponentsRoot(projectPath);
  const folderRel = normalizeComponentsFolderRel(folderRelInput);
  const absolute = resolveWithinRoot(
    root,
    path.join(componentsDir, ...folderRel.split("/")),
    { rejectFinalSymlink: true },
  );
  if (
    absolute !== componentsDir &&
    !absolute.startsWith(componentsDir + path.sep) &&
    !absolute.startsWith(componentsDir + "/")
  ) {
    throw new Error("Invalid component folder path");
  }
  if (absolute === componentsDir) {
    throw new Error("Cannot modify the components root folder");
  }
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    throw new Error("Component folder not found");
  }
  return { root, componentsDir, folderRel, absolute };
}

function folderRelFromAbsolute(
  componentsDir: string,
  absolute: string,
): string {
  if (absolute === componentsDir) return "";
  return path.relative(componentsDir, absolute).split(path.sep).join("/");
}

function listComponentFilesUnder(
  root: string,
  dirAbsolute: string,
): string[] {
  const files: string[] = [];
  const walk = (current: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) {
      throw new Error("Project folder nesting is too deep");
    }
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!COMPONENT_EXTS.has(path.extname(entry.name).toLowerCase())) continue;
      files.push(toPosixRel(root, full));
    }
  };
  walk(dirAbsolute, 0);
  return files;
}

function uniqueChildName(parentAbs: string, name: string): string {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = name;
  let i = 1;
  while (existsSync(path.join(parentAbs, candidate))) {
    candidate = ext ? `${stem}-${i}${ext}` : `${stem}-${i}`;
    i += 1;
    if (i > 10_000) throw new Error("Could not allocate a unique name");
  }
  return candidate;
}

function remapByFolderPrefix(
  fileRel: string,
  fromFolderRel: string,
  toFolderRel: string,
): string | null {
  const fromPrefix = `src/components/${fromFolderRel}`;
  const toPrefix = toFolderRel
    ? `src/components/${toFolderRel}`
    : "src/components";
  if (fileRel === fromPrefix || fileRel.startsWith(`${fromPrefix}/`)) {
    return `${toPrefix}${fileRel.slice(fromPrefix.length)}`;
  }
  return null;
}

/**
 * Rename a folder under `src/components`.
 * `nextNameOrPath` may be a leaf name (keeps parent) or a full relative path.
 */
export function renameComponentFolder(
  projectPath: string,
  folderRelInput: string,
  nextNameOrPath: string,
): ComponentFolderMutationResult {
  const { root, componentsDir, folderRel, absolute } = resolveComponentsFolder(
    projectPath,
    folderRelInput,
  );

  const rawNext =
    typeof nextNameOrPath === "string" ? nextNameOrPath.trim() : "";
  if (!rawNext) {
    throw new Error("Invalid folder name");
  }

  const parentRel = folderRelFromAbsolute(componentsDir, path.dirname(absolute));
  const nextRel = normalizeComponentsFolderRel(
    rawNext.includes("/")
      ? rawNext
      : parentRel
        ? `${parentRel}/${rawNext}`
        : rawNext,
  );

  if (nextRel === folderRel) {
    const files = listComponentFilesUnder(root, absolute);
    const movedFiles: Record<string, string> = {};
    for (const file of files) movedFiles[file] = file;
    return { ok: true, from: folderRel, to: nextRel, movedFiles };
  }

  const nextAbsolute = resolveWithinRoot(
    root,
    path.join(componentsDir, ...nextRel.split("/")),
    { allowMissing: true, rejectFinalSymlink: true },
  );
  if (
    nextAbsolute !== componentsDir &&
    !nextAbsolute.startsWith(componentsDir + path.sep) &&
    !nextAbsolute.startsWith(componentsDir + "/")
  ) {
    throw new Error("Invalid component folder path");
  }
  if (nextAbsolute === componentsDir) {
    throw new Error("Cannot rename a folder onto the components root");
  }
  // Prevent moving a folder into itself.
  if (
    nextAbsolute === absolute ||
    nextAbsolute.startsWith(absolute + path.sep) ||
    nextAbsolute.startsWith(absolute + "/")
  ) {
    throw new Error("Cannot move a folder into itself");
  }
  if (existsSync(nextAbsolute)) {
    throw new Error("A folder with that name already exists");
  }

  const filesBefore = listComponentFilesUnder(root, absolute);
  mkdirSync(path.dirname(nextAbsolute), { recursive: true });
  renamePathTracked(absolute, nextAbsolute);

  const movedFiles: Record<string, string> = {};
  for (const file of filesBefore) {
    const next = remapByFolderPrefix(file, folderRel, nextRel);
    if (next) movedFiles[file] = next;
  }

  return { ok: true, from: folderRel, to: nextRel, movedFiles };
}

/**
 * Dissolve a folder under `src/components`: move all children into the parent
 * folder, then remove the empty directory. Component files are never deleted.
 */
export function deleteComponentFolder(
  projectPath: string,
  folderRelInput: string,
): ComponentFolderMutationResult {
  const { root, componentsDir, folderRel, absolute } = resolveComponentsFolder(
    projectPath,
    folderRelInput,
  );
  const parentAbs = path.dirname(absolute);
  if (
    parentAbs !== componentsDir &&
    !parentAbs.startsWith(componentsDir + path.sep) &&
    !parentAbs.startsWith(componentsDir + "/")
  ) {
    throw new Error("Invalid component folder parent");
  }
  const parentRel = folderRelFromAbsolute(componentsDir, parentAbs);
  const movedFiles: Record<string, string> = {};

  const entries = readdirSync(absolute, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error("Component folder contains a symlink");
    }
    const srcAbs = path.join(absolute, entry.name);
    const destName = existsSync(path.join(parentAbs, entry.name))
      ? uniqueChildName(parentAbs, entry.name)
      : entry.name;
    const destAbs = path.join(parentAbs, destName);

    if (entry.isDirectory()) {
      const nestedFiles = listComponentFilesUnder(root, srcAbs);
      renamePathTracked(srcAbs, destAbs);
      const fromNested = toPosixRel(root, srcAbs);
      const toNested = toPosixRel(root, destAbs);
      for (const file of nestedFiles) {
        if (file === fromNested || file.startsWith(`${fromNested}/`)) {
          movedFiles[file] = `${toNested}${file.slice(fromNested.length)}`;
        }
      }
      continue;
    }

    renamePathTracked(srcAbs, destAbs);
    if (COMPONENT_EXTS.has(path.extname(entry.name).toLowerCase())) {
      movedFiles[toPosixRel(root, srcAbs)] = toPosixRel(root, destAbs);
    }
  }

  // Remove the dissolved folder (any leftover non-component files go with it
  // only if the directory is empty after moves — otherwise force-clean).
  try {
    rmdirSync(absolute);
  } catch {
    removePathTracked(absolute, { recursive: true, force: true });
  }

  return { ok: true, from: folderRel, to: parentRel, movedFiles };
}
