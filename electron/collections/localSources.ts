import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { globSync } from "tinyglobby";
import { load as parseAstroYaml, YAMLException } from "js-yaml";
import { parse as parseToml } from "smol-toml";
import { parseDocument } from "yaml";
import type {
  AriaCollectionDef,
  ExternalCollectionEntry,
  ExternalEntryIssue,
} from "../../shared/types";
import type { ExternalFieldObservation } from "../../shared/externalCollectionEntries";
import { resolveWithinRoot } from "../pathSafety";

export type LocalEntryQuery = {
  query?: string;
  page?: number;
  limit?: number;
  sort?: { field: string; direction: "asc" | "desc" };
  exactId?: string;
};

export type LocalEntryQueryResult = {
  items: ExternalCollectionEntry[];
  observations: ExternalFieldObservation[];
  issues: ExternalEntryIssue[];
  total: number;
  filteredTotal: number;
  scannedTotal: number;
  page: number;
  limit: number;
  truncated: boolean;
};

const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_BODY_BYTES = 50_000;
const SENSITIVE_KEY = /authorization|api[-_]?key|password|secret|token|credential/i;

function readText(file: string): string {
  const stat = statSync(file);
  if (!stat.isFile()) throw new Error("Source path is not a file");
  if (stat.size > MAX_FILE_BYTES) throw new Error("Source files must be smaller than 2 MB");
  return readFileSync(file, "utf8");
}

function clean(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[depth-limited]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value.slice(0, MAX_BODY_BYTES);
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => clean(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(0, 500)) {
    if (!SENSITIVE_KEY.test(key)) output[key] = clean(child, depth + 1);
  }
  return output;
}

function parseYaml(source: string, file: string): unknown {
  const document = parseDocument(source, { prettyErrors: false, strict: true, uniqueKeys: true });
  if (document.errors.length) throw new Error(`${file}: ${document.errors[0]!.message}`);
  return document.toJS({ maxAliasCount: 0 }) as unknown;
}

function parseDataFile(source: string, file: string): unknown {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".json") return JSON.parse(source) as unknown;
  if (extension === ".yaml" || extension === ".yml") return parseYaml(source, file);
  if (extension === ".toml") return parseToml(source);
  throw new Error(`Aria cannot safely parse ${extension || "this file type"} without Astro's configured parser`);
}

function parseMarkupFrontmatter(source: string, file: string, delimiter: "---" | "+++"): unknown {
  try {
    return delimiter === "+++" ? parseToml(source) : parseAstroYaml(source);
  } catch (cause) {
    const message = cause instanceof YAMLException
      ? cause.reason
      : cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${file}: ${message}`);
  }
}

function parseMarkupEntry(source: string, file: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = source.replace(/\r\n?/g, "\n");
  const match = /(?:^\uFEFF?|^\s*\n)(---|\+\+\+)([\s\S]*?\n)\1/.exec(normalized);
  if (!match) {
    const opening = /^(?:\uFEFF)?(---|\+\+\+)\n/.exec(normalized)?.[1];
    if (opening) throw new Error(`${file}: frontmatter is missing its closing ${opening} fence`);
    return { frontmatter: {}, body: normalized };
  }
  const delimiter = match[1] as "---" | "+++";
  const remainder = normalized.slice(match.index + match[0].length);
  const frontmatter = parseMarkupFrontmatter(match[2]!, file, delimiter);
  return {
    frontmatter: objectData(frontmatter ?? {}, file),
    body: remainder.replace(/^\n+/, ""),
  };
}

function pathId(relativeFile: string): string {
  const withoutExtension = relativeFile.replace(/\.[^.]+$/, "");
  return path.posix.basename(withoutExtension).toLowerCase() === "index"
    ? path.posix.dirname(withoutExtension)
    : withoutExtension;
}

function objectData(value: unknown, file: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${file}: each collection entry must be a key-value object`);
  }
  return clean(value) as Record<string, unknown>;
}

function projectRelativeFromGlob(sourceRoot: string, projectDirectory: string, absolute: string): string {
  const relativeToSource = path.relative(sourceRoot, absolute).split(path.sep).join("/");
  return path.posix.join(projectDirectory.replaceAll("\\", "/"), relativeToSource);
}

function entryFromGlobFile(sourceRoot: string, projectDirectory: string, absolute: string): ExternalCollectionEntry {
  const relativeToSource = path.relative(sourceRoot, absolute).split(path.sep).join("/");
  const projectRelative = projectRelativeFromGlob(sourceRoot, projectDirectory, absolute);
  const extension = path.extname(absolute).toLowerCase();
  const source = readText(absolute);
  if ([".md", ".mdx", ".mdoc"].includes(extension)) {
    const parsed = parseMarkupEntry(source, projectRelative);
    const data = clean(parsed.frontmatter) as Record<string, unknown>;
    return {
      id: typeof data.slug === "string" && data.slug.trim() ? data.slug.trim() : pathId(relativeToSource),
      data,
      body: parsed.body.slice(0, MAX_BODY_BYTES),
      filePath: projectRelative,
      ...(typeof data.locale === "string" ? { locale: data.locale.slice(0, 100) } : {}),
    };
  }
  const data = objectData(parseDataFile(source, projectRelative), projectRelative);
  return {
    id: typeof data.slug === "string" && data.slug.trim() ? data.slug.trim() : pathId(relativeToSource),
    data,
    filePath: projectRelative,
    ...(typeof data.locale === "string" ? { locale: data.locale.slice(0, 100) } : {}),
  };
}

function fileLoaderEntries(root: string, collection: AriaCollectionDef): { entries: ExternalCollectionEntry[]; truncated: boolean } {
  const relative = collection.source?.sourceFile;
  if (!relative) throw new Error("The file() loader path could not be determined safely");
  const absolute = resolveWithinRoot(root, path.join(root, relative));
  const parsed = parseDataFile(readText(absolute), relative);
  const rows: Array<{ id: string; value: unknown }> = [];
  if (Array.isArray(parsed)) {
    parsed.forEach((value, index) => {
      const candidate = value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>).id
        : undefined;
      if (typeof candidate !== "string" && typeof candidate !== "number") {
        throw new Error(`${relative}: item ${index + 1} needs a string or number id`);
      }
      rows.push({ id: String(candidate), value });
    });
  } else if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (typeof record.id === "string" || typeof record.id === "number") {
      rows.push({ id: String(record.id), value: record });
    } else {
      for (const [key, value] of Object.entries(record)) rows.push({ id: key, value });
    }
  } else {
    throw new Error(`${relative}: file() collection data must be an array or object`);
  }
  const entries = rows.slice(0, MAX_FILES).map(({ id, value }) => {
    const data = objectData(value, relative);
    return {
      id,
      data,
      filePath: relative,
      ...(typeof data.locale === "string" ? { locale: data.locale.slice(0, 100) } : {}),
    };
  });
  return { entries, truncated: rows.length > MAX_FILES };
}

function sourceIssue(filePath: string, cause: unknown): ExternalEntryIssue {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const separator = raw.indexOf(": ");
  const withoutPath = (separator > 0 ? raw.slice(separator + 2).trim() : raw)
    .replace(/\s+/g, " ");
  const normalizedMessage = withoutPath
    .replace(/Missing closing ["']quote/i, "Missing closing quote")
    .replace(/[.!?]+$/, "");
  return {
    filePath,
    message: normalizedMessage.replace(/^./, (letter) => letter.toUpperCase()),
  };
}

function globLoaderEntries(root: string, collection: AriaCollectionDef): {
  entries: ExternalCollectionEntry[];
  issues: ExternalEntryIssue[];
  truncated: boolean;
  scannedTotal: number;
} {
  const relative = collection.source?.contentDirectory;
  const pattern = collection.source?.filePattern;
  if (!relative || !pattern) throw new Error("The glob() loader path or pattern could not be determined safely");
  const sourceRoot = resolveWithinRoot(root, path.join(root, relative), { allowMissing: true });
  let files: string[];
  try {
    files = globSync(pattern, {
      cwd: sourceRoot,
      absolute: true,
      onlyFiles: true,
      dot: false,
      deep: 64,
      followSymbolicLinks: false,
    }).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  } catch (error) {
    throw new Error(`Unable to read the collection glob: ${error instanceof Error ? error.message : String(error)}`);
  }
  const truncated = files.length > MAX_FILES;
  const inspected = files.slice(0, MAX_FILES);
  const entries: ExternalCollectionEntry[] = [];
  const issues: ExternalEntryIssue[] = [];
  for (const file of inspected) {
    try {
      entries.push(entryFromGlobFile(sourceRoot, relative, file));
    } catch (cause) {
      issues.push(sourceIssue(projectRelativeFromGlob(sourceRoot, relative, file), cause));
    }
  }
  return {
    entries,
    issues,
    truncated,
    scannedTotal: inspected.length,
  };
}

function observedType(value: unknown): ExternalFieldObservation["types"][number] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "object") return "object";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value))) return "datetime";
  }
  return "string";
}

function comparable(value: unknown): string | number | boolean {
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLocaleLowerCase();
  try { return value == null ? "" : JSON.stringify(value).toLocaleLowerCase(); }
  catch { return ""; }
}

export async function queryLocalCollectionSource(
  root: string,
  collection: AriaCollectionDef,
  request: LocalEntryQuery,
): Promise<LocalEntryQueryResult> {
  const discovered = collection.source?.adapter === "astro-file"
    ? { ...fileLoaderEntries(root, collection), issues: [] as ExternalEntryIssue[], scannedTotal: 1 }
    : globLoaderEntries(root, collection);
  const observations = new Map<string, Set<ExternalFieldObservation["types"][number]>>();
  for (const entry of discovered.entries) {
    for (const [key, value] of Object.entries(entry.data).slice(0, 250)) {
      const type = observedType(value);
      if (!type) continue;
      const current = observations.get(key) ?? new Set<ExternalFieldObservation["types"][number]>();
      if (observations.has(key) || observations.size < 250) {
        current.add(type);
        observations.set(key, current);
      }
    }
  }
  const query = typeof request.query === "string" ? request.query.trim().toLocaleLowerCase() : "";
  const matches = discovered.entries.filter((entry) => {
    if (request.exactId && entry.id !== request.exactId) return false;
    return !query || JSON.stringify(entry).toLocaleLowerCase().includes(query);
  });
  if (request.sort) {
    const direction = request.sort.direction === "desc" ? -1 : 1;
    const field = request.sort.field;
    matches.sort((left, right) => {
      const a = comparable(field === "id" ? left.id : left.data[field]);
      const b = comparable(field === "id" ? right.id : right.data[field]);
      if (typeof a === "number" && typeof b === "number") return (a - b) * direction;
      return String(a).localeCompare(String(b), undefined, { numeric: true }) * direction;
    });
  }
  const page = Math.max(1, Number(request.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(request.limit) || 50));
  const start = (page - 1) * limit;
  return {
    items: matches.slice(start, start + limit),
    observations: [...observations].map(([key, types]) => ({ key, types: [...types] })),
    issues: discovered.issues,
    total: discovered.entries.length,
    filteredTotal: matches.length,
    scannedTotal: discovered.scannedTotal,
    page,
    limit,
    truncated: discovered.truncated,
  };
}
