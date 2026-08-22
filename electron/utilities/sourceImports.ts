import fs from "node:fs";
import path from "node:path";
import { canonicalDirectory, resolveWithinRoot } from "../pathSafety";

export const SOURCE_IMPORT_MARKER = "aria:utility-manager:tailwind";

export type SourceImportEdit = {
  relativePath: string;
  absolutePath: string;
  before: string;
  after: string;
  createdFrontmatter: boolean;
};

export type SourceImportPlan = {
  edits: SourceImportEdit[];
  blockedFiles: string[];
  targetCount: number;
};

const SOURCE_DIRECTORIES = [
  path.join("src", "layouts"),
  path.join("src", "pages"),
];

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function walk(directory: string, out: string[]): void {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, out);
    else if ([".astro", ".md", ".mdx"].includes(path.extname(entry.name).toLowerCase())) {
      out.push(absolute);
    }
  }
}

function stylesheetImportPath(fromFile: string, stylesheet: string): string {
  let relative = toPosix(path.relative(path.dirname(fromFile), stylesheet));
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}

function importedCssAbsolute(
  root: string,
  fromFile: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith(".")) return null;
  try {
    return resolveWithinRoot(root, path.resolve(path.dirname(fromFile), specifier), {
      allowMissing: true,
      rejectFinalSymlink: true,
    });
  } catch {
    return null;
  }
}

function alreadyImportsStylesheet(
  root: string,
  file: string,
  content: string,
  stylesheet: string,
): boolean {
  const pattern = /import\s+(?:[^"']+?\s+from\s+)?["']([^"']+\.css)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    if (importedCssAbsolute(root, file, match[1]!) === stylesheet) return true;
  }
  return false;
}

export function addManagedStylesheetImport(
  content: string,
  specifier: string,
): string {
  const statement = `import "${specifier}"; // ${SOURCE_IMPORT_MARKER}`;
  if (content.startsWith("---")) {
    const openEnd = content.indexOf("\n");
    const close = content.indexOf("\n---", Math.max(0, openEnd));
    if (close === -1) throw new Error("Astro frontmatter is not closed.");
    return `${content.slice(0, openEnd + 1)}${statement}\n${content.slice(openEnd + 1)}`;
  }
  return `---\n${statement}\n---\n\n${content}`;
}

function markdownLayout(file: string, content: string): string | null {
  if (!content.startsWith("---")) return null;
  const close = content.indexOf("\n---", 3);
  if (close === -1) return null;
  const frontmatter = content.slice(3, close);
  const match = frontmatter.match(/^layout\s*:\s*([^\n#]+)$/m);
  if (!match) return null;
  const raw = match[1]!.trim().replace(/^['"]|['"]$/g, "");
  if (!raw || /[{}$]/.test(raw)) return null;
  return path.resolve(path.dirname(file), raw);
}

export function planGlobalStylesheetImports(
  projectPath: string,
  stylesheetRelativePath: string,
): SourceImportPlan {
  const root = canonicalDirectory(projectPath);
  const stylesheet = resolveWithinRoot(root, stylesheetRelativePath, {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  const files: string[] = [];
  for (const relative of SOURCE_DIRECTORIES) walk(path.join(root, relative), files);

  const astroTargets = new Set(
    files.filter((file) => path.extname(file).toLowerCase() === ".astro"),
  );
  const blockedFiles: string[] = [];
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (extension !== ".md" && extension !== ".mdx") continue;
    const layout = markdownLayout(file, fs.readFileSync(file, "utf8"));
    if (!layout) {
      blockedFiles.push(toPosix(path.relative(root, file)));
      continue;
    }
    try {
      const resolved = resolveWithinRoot(root, layout, {
        rejectFinalSymlink: true,
      });
      if (path.extname(resolved).toLowerCase() !== ".astro") throw new Error();
      astroTargets.add(resolved);
    } catch {
      blockedFiles.push(toPosix(path.relative(root, file)));
    }
  }

  const edits: SourceImportEdit[] = [];
  for (const absolutePath of [...astroTargets].sort()) {
    const before = fs.readFileSync(absolutePath, "utf8");
    if (alreadyImportsStylesheet(root, absolutePath, before, stylesheet)) continue;
    const specifier = stylesheetImportPath(absolutePath, stylesheet);
    edits.push({
      relativePath: toPosix(path.relative(root, absolutePath)),
      absolutePath,
      before,
      after: addManagedStylesheetImport(before, specifier),
      createdFrontmatter: !before.startsWith("---"),
    });
  }
  return { edits, blockedFiles, targetCount: astroTargets.size };
}

export function assertManagedSourceImportIntact(content: string): void {
  if (!content.includes(`// ${SOURCE_IMPORT_MARKER}`)) {
    throw new Error("An Aria-managed global stylesheet import changed.");
  }
}

export function removeManagedSourceImport(
  content: string,
  createdFrontmatter = false,
): string {
  assertManagedSourceImportIntact(content);
  const next = content.replace(
    new RegExp(`^[ \\t]*import\\s+["'][^"']+\\.css["'];?[ \\t]*// ${SOURCE_IMPORT_MARKER}\\r?\\n?`, "m"),
    "",
  );
  return createdFrontmatter
    ? next.replace(/^---\r?\n---\r?\n\r?\n/, "")
    : next;
}

export function preserveManagedSourceImport(content: string): string {
  assertManagedSourceImportIntact(content);
  return content.replace(
    new RegExp(`[ \\t]*// ${SOURCE_IMPORT_MARKER}(?=\\r?$)`, "m"),
    "",
  );
}
