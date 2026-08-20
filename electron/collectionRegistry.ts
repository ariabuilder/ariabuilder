import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { AriaEntryRecord, FieldSchema, FieldType } from "../shared/cms";
import type {
  AriaCollectionDef,
  AriaCollectionSchemaDef,
  CollectionCapabilities,
  CollectionSourceInfo,
  CollectionsState,
  CollectionMigrationAssessment,
  CollectionMigrationResult,
  ExternalCollectionEntry,
  ExternalEntryDetailResult,
  ExternalEntryListRequest,
  ExternalEntryListResult,
} from "../shared/types";
import {
  buildExternalFieldDescriptors,
  buildExternalFieldDescriptorsFromObservations,
  getExternalEntryTitle,
  resolveProjectAssetId,
  type ExternalFieldObservation,
} from "../shared/externalCollectionEntries";
import { readCollections, writeCollections } from "./collections";
import { resolveLocalAstroCommand } from "./astroCli";
import {
  buildCollectionDefineInitializer,
  collectionConfigMarkers,
} from "./cms/contentSync";
import { importEntryRecord, slugify } from "./cms/services";
import {
  canonicalDirectory,
  removePathTracked,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";
import { execElectronNode } from "./processLaunch";
import { readSiteSettings } from "./siteSettings";
import { projectProcessEnv } from "./toolEnv";
import {
  discoverAstroCollections,
} from "./collections/discovery";
import {
  queryLocalCollectionSource,
} from "./collections/localSources";

const READ_WRITE_CAPABILITIES: CollectionCapabilities = {
  read: true, refresh: true, writeEntry: true, createEntry: true,
  translate: true, publish: true, writeSchema: true, migrate: false,
};
const READ_ONLY_CAPABILITIES: CollectionCapabilities = {
  read: true, refresh: true, writeEntry: false, createEntry: false,
  translate: false, publish: false, writeSchema: false, migrate: true,
};

const CONFIG_NAMES = [
  "src/content.config.ts", "src/content.config.js", "src/content.config.mjs", "src/content.config.mts",
  "src/content/config.ts", "src/live.config.ts", "src/live.config.js", "src/live.config.mjs", "src/live.config.mts",
] as const;

function readSmallFile(file: string, maxBytes = 2 * 1024 * 1024): string | null {
  try {
    if (!statSync(file).isFile() || statSync(file).size > maxBytes) return null;
    return readFileSync(file, "utf8");
  } catch { return null; }
}

function titleFromName(name: string): string {
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function keysFromGeneratedTypes(source: string | null, section: "content" | "live"): string[] {
  if (!source) return [];
  if (section === "live") return [];
  const start = source.indexOf("type DataEntryMap = {");
  if (start < 0) return [];
  const end = source.indexOf("\n\t};", start);
  const body = source.slice(start, end > start ? end : undefined);
  return [...body.matchAll(/(?:^|\n)\s*["']([A-Za-z0-9_-]+)["']\s*:\s*Record</g)].map((match) => match[1]!);
}

type CollectionInitializer = {
  start: number;
  end: number;
  source: string;
};

function matchingDelimiter(source: string, open: number, left: string, right: string): number {
  let depth = 0;
  let quote = "";
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]!;
    const next = source[index + 1] ?? "";
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === left) depth += 1;
    if (char === right) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function defineCollectionInitializerAt(source: string, start: number): CollectionInitializer | null {
  const call = source.indexOf("defineCollection", start);
  if (call < 0) return null;
  const open = source.indexOf("(", call + "defineCollection".length);
  if (open < 0) return null;
  const close = matchingDelimiter(source, open, "(", ")");
  if (close < 0) return null;
  return { start: call, end: close + 1, source: source.slice(call, close + 1) };
}

function collectionInitializer(source: string, name: string): CollectionInitializer | null {
  const exportMatch = /export\s+const\s+collections\s*=\s*\{/.exec(source);
  if (!exportMatch) return null;
  const open = source.indexOf("{", exportMatch.index);
  const close = matchingDelimiter(source, open, "{", "}");
  if (open < 0 || close < 0) return null;
  const body = source.slice(open + 1, close);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const property = new RegExp(`(?:^|[,\\n])\\s*(?:["']${escaped}["']|${escaped})\\s*:\\s*([A-Za-z_$][\\w$]*|defineCollection\\s*\\()`, "m").exec(body);
  let binding: string | null = null;
  let inlineStart = -1;
  if (property) {
    const expression = property[1] ?? "";
    if (expression.startsWith("defineCollection")) {
      inlineStart = open + 1 + property.index + property[0].lastIndexOf("defineCollection");
    } else {
      binding = expression;
    }
  } else {
    const shorthand = new RegExp(`(?:^|[,\\n])\\s*${escaped}\\s*(?=,|$)`, "m").exec(body);
    if (shorthand) binding = name;
  }
  if (inlineStart >= 0) return defineCollectionInitializerAt(source, inlineStart);
  if (!binding) return null;
  const declaration = new RegExp(`\\b(?:const|let|var)\\s+${binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*defineCollection\\s*\\(`).exec(source);
  return declaration ? defineCollectionInitializerAt(source, declaration.index) : null;
}

function providerFromSource(source: string): { provider: CollectionSourceInfo["provider"]; label: CollectionSourceInfo["label"]; hint?: string } {
  if (/(?:@sanity\/astro|sanity(?:Loader|Client)|createClient\s*\()/i.test(source)) return { provider: "sanity", label: "Sanity", hint: "Sanity loader or client" };
  if (/(?:payloadcms|@payloadcms|payload\.find|payload(?:Loader|Client))/i.test(source)) return { provider: "payload", label: "Payload", hint: "Payload loader or client" };
  return { provider: "external", label: "External CMS", hint: "Custom Astro loader" };
}

const IMAGE_FIELD_KEYS = new Set(["avatar", "cover", "coverimage", "featuredimage", "hero", "heroimage", "image", "photo", "thumbnail"]);

function schemaType(key: string, property: Record<string, unknown>): FieldType {
  if (IMAGE_FIELD_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")) && property.type === "string") return "image";
  if (property.format === "date") return "date";
  if (property.format === "date-time") return "datetime";
  if (Array.isArray(property.enum)) return "select";
  if (property.type === "boolean") return "boolean";
  if (property.type === "integer") return "integer";
  if (property.type === "number") return "number";
  if (property.type === "array") {
    const items = property.items && typeof property.items === "object"
      ? property.items as Record<string, unknown>
      : null;
    if (items?.type === "string") return "multiSelect";
    if (items?.type === "object") return "repeater";
    return "json";
  }
  if (property.type === "object") return "object";
  return "string";
}

function schemaFieldFromJson(
  key: string,
  property: Record<string, unknown>,
  required: boolean,
): FieldSchema {
  const type = schemaType(key, property);
  const nestedSource = type === "repeater"
    ? property.items
    : type === "object"
      ? property
      : null;
  const nestedObject = nestedSource && typeof nestedSource === "object"
    ? nestedSource as Record<string, unknown>
    : null;
  const nestedProperties = nestedObject?.properties && typeof nestedObject.properties === "object"
    ? nestedObject.properties as Record<string, unknown>
    : null;
  const nestedRequired = new Set(
    Array.isArray(nestedObject?.required)
      ? nestedObject.required.filter((item): item is string => typeof item === "string")
      : [],
  );
  const fields = nestedProperties
    ? Object.entries(nestedProperties).flatMap(([nestedKey, value]) =>
        nestedKey === "$schema" || !value || typeof value !== "object"
          ? []
          : [schemaFieldFromJson(nestedKey, value as Record<string, unknown>, nestedRequired.has(nestedKey))])
    : [];
  const options = Array.isArray(property.enum)
    ? property.enum.filter((item): item is string => typeof item === "string")
    : type === "multiSelect"
      && property.items
      && typeof property.items === "object"
      && Array.isArray((property.items as Record<string, unknown>).enum)
        ? ((property.items as Record<string, unknown>).enum as unknown[]).filter((item): item is string => typeof item === "string")
        : [];
  return {
    key,
    label: typeof property.title === "string" ? property.title : titleFromName(key),
    type,
    required,
    ...(options.length ? { options } : {}),
    ...(fields.length ? { fields } : {}),
  };
}

function schemaFromJson(raw: unknown): AriaCollectionSchemaDef | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const root = raw as Record<string, unknown>;
  const properties = root.properties && typeof root.properties === "object"
    ? root.properties as Record<string, unknown> : null;
  if (!properties) return undefined;
  const required = new Set(Array.isArray(root.required) ? root.required.filter((item): item is string => typeof item === "string") : []);
  const fields: FieldSchema[] = [];
  for (const [key, value] of Object.entries(properties).slice(0, 250)) {
    if (key === "$schema" || !value || typeof value !== "object") continue;
    fields.push(schemaFieldFromJson(key, value as Record<string, unknown>, required.has(key)));
  }
  return { fields, version: 1 };
}

function readGeneratedSchema(root: string, name: string): AriaCollectionSchemaDef | undefined {
  const file = path.join(root, ".astro", "collections", `${name}.schema.json`);
  const text = existsSync(file) ? readSmallFile(file) : null;
  if (!text) return undefined;
  try { return schemaFromJson(JSON.parse(text)); } catch { return undefined; }
}

function configSources(root: string): Array<{ relative: string; source: string; live: boolean }> {
  return CONFIG_NAMES.flatMap((relative) => {
    const file = resolveWithinRoot(root, path.join(root, relative), { allowMissing: true });
    const source = existsSync(file) ? readSmallFile(file) : null;
    return source ? [{ relative, source, live: relative.includes("live.config") }] : [];
  });
}

function configForName(configs: ReturnType<typeof configSources>, name: string, live: boolean) {
  return configs.find((config) => config.live === live && new RegExp(`(?:["']${name}["']|\\b${name}\\b)`).test(config.source))
    ?? configs.find((config) => config.live === live);
}

function cacheMetadata(root: string): Pick<CollectionSourceInfo, "cacheState" | "lastSuccessfulRefresh"> {
  const file = path.join(root, "node_modules", ".astro", "data-store.json");
  try {
    const stat = statSync(file);
    const age = Date.now() - stat.mtimeMs;
    return { cacheState: age <= 24 * 60 * 60 * 1000 ? "fresh" : "stale", lastSuccessfulRefresh: stat.mtime.toISOString() };
  } catch { return { cacheState: "unavailable" }; }
}

function localContentNames(root: string): string[] {
  const directory = path.join(root, "src", "content");
  try { return readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name); }
  catch { return []; }
}

export function readCollectionRegistry(projectPath: string): CollectionsState {
  const root = canonicalDirectory(projectPath);
  const managedState = readCollections(root);
  const managed = managedState.collections.map((collection) => ({
    ...collection,
    source: {
      kind: "aria-managed", provider: "aria", label: "Aria CMS", mode: "managed",
      readOnly: false, schemaAvailable: Boolean(collection.schema), cacheState: "fresh",
    } satisfies CollectionSourceInfo,
    capabilities: { ...READ_WRITE_CAPABILITIES },
  }));
  const managedNames = new Set(managed.map((collection) => collection.name));
  const types = readSmallFile(path.join(root, ".astro", "content.d.ts"));
  const configs = configSources(root);
  const astDiscovered = discoverAstroCollections(root);
  const byKey = new Map(astDiscovered.map((item) => [`${item.live ? "live" : "content"}:${item.name}`, item]));
  const generatedNames = keysFromGeneratedTypes(types, "content");
  const localFolders = localContentNames(root);
  const cache = cacheMetadata(root);

  for (const name of localFolders) {
    const key = `content:${name}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      name,
      configFile: "src/content/config.ts",
      live: false,
      adapter: "legacy-directory",
      formats: ["markdown", "mdx", "markdoc", "json", "yaml", "toml"],
      initializerStart: 0,
      initializerEnd: 0,
      initializerSource: "",
      contentDirectory: `src/content/${name}`,
      filePattern: "**/*.{md,mdx,mdoc,json,yaml,yml,toml}",
      idStrategy: "path",
      dynamic: false,
    });
  }
  for (const name of generatedNames) {
    const key = `content:${name}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      name,
      configFile: configForName(configs, name, false)?.relative ?? "src/content.config.ts",
      live: false,
      adapter: "astro-store",
      formats: ["custom"],
      initializerStart: 0,
      initializerEnd: 0,
      initializerSource: "",
      idStrategy: "astro-store",
      dynamic: true,
    });
  }

  const discovered = [...byKey.values()]
    .filter((descriptor) => !managedNames.has(descriptor.name))
    .map((descriptor): AriaCollectionDef => {
      const local = descriptor.adapter === "legacy-directory"
        || descriptor.adapter === "astro-glob"
        || descriptor.adapter === "astro-file";
      const astroLoader = descriptor.loaderName === "glob" || descriptor.loaderName === "file";
      const availableStore = cache.cacheState !== "unavailable";
      const readable = local || (descriptor.adapter === "astro-store" && availableStore);
      const provider = local || astroLoader
        ? { provider: "astro" as const, label: "Local Astro" as const, hint: astroLoader ? `Astro ${descriptor.loaderName} loader` : "File collection" }
        : providerFromSource(descriptor.initializerSource);
      const schema = readGeneratedSchema(root, descriptor.name);
      const availability = local || availableStore && descriptor.adapter === "astro-store"
        ? "ready" as const
        : descriptor.adapter === "astro-store"
          ? "needs-refresh" as const
          : "unavailable" as const;
      const availabilityReason = descriptor.adapter === "astro-live"
        ? "Live collections are resolved by the project at request time and do not provide a stable import snapshot."
        : descriptor.adapter === "astro-store" && !availableStore
          ? "No Astro cache is available. Refresh this source to let Astro build its collection store."
          : undefined;
      const configEditable = descriptor.initializerEnd > descriptor.initializerStart
        && /\bdefine(?:Live)?Collection\s*\(/.test(descriptor.initializerSource);
      const migrationMode = readable
        ? configEditable ? "automatic" as const : "assisted" as const
        : "unavailable" as const;
      return {
        id: `astro:${descriptor.live ? "live" : "content"}:${descriptor.name}`,
        name: descriptor.name,
        label: titleFromName(descriptor.name),
        kind: "content",
        urlPattern: null,
        listPageFile: null,
        templatePageFile: null,
        schema,
        supports: [],
        scope: "global",
        source: {
          kind: local ? "astro-local" : descriptor.live ? "external-live" : "external-build",
          provider: provider.provider,
          label: provider.label,
          mode: local ? "file" : descriptor.live ? "live" : "build-time",
          readOnly: true,
          configFile: descriptor.configFile,
          loaderHint: provider.hint,
          adapter: descriptor.adapter,
          formats: descriptor.formats,
          idStrategy: descriptor.idStrategy,
          migrationMode,
          availability,
          ...(availabilityReason ? { availabilityReason } : {}),
          ...(descriptor.contentDirectory ? { contentDirectory: descriptor.contentDirectory } : {}),
          ...(descriptor.filePattern ? { filePattern: descriptor.filePattern } : {}),
          ...(descriptor.sourceFile ? { sourceFile: descriptor.sourceFile } : {}),
          schemaAvailable: Boolean(schema),
          ...(local ? { cacheState: "fresh" as const } : cache),
          ...(!readable ? {
            capabilityNotes: {
              read: availabilityReason ?? "No readable source snapshot is available.",
              migrate: availabilityReason ?? "No stable source snapshot is available to import.",
            },
          } : {}),
        },
        capabilities: {
          ...READ_ONLY_CAPABILITIES,
          read: readable,
          refresh: descriptor.adapter !== "astro-live",
          migrate: migrationMode === "automatic",
        },
      };
    });

  return { collections: [...managed, ...discovered], revision: managedState.revision };
}

function devalueModule(root: string): string | null {
  const direct = [
    path.join(root, "node_modules", "devalue", "index.js"),
    path.join(root, "node_modules", "astro", "node_modules", "devalue", "index.js"),
  ];
  for (const candidate of direct) if (existsSync(candidate)) return candidate;
  const pnpm = path.join(root, "node_modules", ".pnpm");
  try {
    const entry = readdirSync(pnpm).find((name) => name.startsWith("devalue@"));
    const candidate = entry ? path.join(pnpm, entry, "node_modules", "devalue", "index.js") : "";
    return candidate && existsSync(candidate) ? candidate : null;
  } catch { return null; }
}

const CACHE_INSPECTOR_SOURCE = `
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const [storeFile, devalueFile] = process.argv.slice(1);
const { parse } = await import(pathToFileURL(devalueFile).href);
const store = parse(await readFile(storeFile, "utf8"));
const sensitive = /authorization|api[-_]?key|password|secret|token|credential/i;
function clean(value, depth = 0) {
  if (depth > 12) return "[depth-limited]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.slice(0, 50000);
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => clean(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value).slice(0, 500)) {
    if (sensitive.test(key)) continue;
    out[key] = clean(child, depth + 1);
  }
  return out;
}
const result = {};
let remaining = 500;
for (const [collection, entries] of store instanceof Map ? store : []) {
  if (!(entries instanceof Map) || remaining <= 0) continue;
  const items = [];
  for (const [id, entry] of entries) {
    if (items.length >= 100 || remaining-- <= 0) break;
    items.push({ id: String(id), data: clean(entry?.data ?? {}), body: typeof entry?.body === "string" ? entry.body.slice(0, 50000) : undefined, filePath: typeof entry?.filePath === "string" ? entry.filePath : undefined, locale: typeof entry?.data?.locale === "string" ? entry.data.locale : undefined });
  }
  result[String(collection)] = { count: entries.size, entries: items };
}
process.stdout.write(JSON.stringify(result));
`;

const CACHE_QUERY_SOURCE = `
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const [storeFile, devalueFile, collectionName, requestJson] = process.argv.slice(1);
const request = JSON.parse(requestJson);
const { parse } = await import(pathToFileURL(devalueFile).href);
const store = parse(await readFile(storeFile, "utf8"));
const entries = store instanceof Map ? store.get(collectionName) : null;
if (!(entries instanceof Map)) {
  process.stderr.write("COLLECTION_NOT_CACHED");
  process.exit(2);
}
const sensitive = /authorization|api[-_]?key|password|secret|token|credential/i;
const MAX_SCANNED = 5000;
function clean(value, depth = 0) {
  if (depth > 12) return "[depth-limited]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.slice(0, 50000);
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => clean(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value).slice(0, 500)) {
    if (sensitive.test(key)) continue;
    out[key] = clean(child, depth + 1);
  }
  return out;
}
function observedType(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "object") return "object";
  if (typeof value === "string") {
    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return "date";
    if (/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}/.test(value) && !Number.isNaN(Date.parse(value))) return "datetime";
  }
  return "string";
}
function comparable(value) {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLocaleLowerCase();
  try { return JSON.stringify(value).toLocaleLowerCase(); } catch { return ""; }
}
const observations = new Map();
const matches = [];
const query = typeof request.query === "string" ? request.query.trim().toLocaleLowerCase() : "";
let scannedTotal = 0;
if (entries instanceof Map) {
  for (const [id, rawEntry] of entries) {
    if (scannedTotal >= MAX_SCANNED) break;
    scannedTotal += 1;
    const data = clean(rawEntry?.data ?? {});
    for (const [key, value] of Object.entries(data).slice(0, 250)) {
      let types = observations.get(key);
      if (!types) {
        if (observations.size >= 250) continue;
        types = new Set();
        observations.set(key, types);
      }
      const type = observedType(value);
      if (type) types.add(type);
    }
    const item = {
      id: String(id),
      data,
      body: typeof rawEntry?.body === "string" ? rawEntry.body.slice(0, 50000) : undefined,
      filePath: typeof rawEntry?.filePath === "string" ? rawEntry.filePath.slice(0, 2000) : undefined,
      locale: typeof data?.locale === "string" ? data.locale.slice(0, 100) : undefined,
    };
    if (typeof request.exactId === "string" && item.id !== request.exactId) continue;
    if (query && !JSON.stringify({ id: item.id, data: item.data, body: item.body }).toLocaleLowerCase().includes(query)) continue;
    matches.push(item);
  }
}
if (request.sort && typeof request.sort.field === "string") {
  const direction = request.sort.direction === "desc" ? -1 : 1;
  const field = request.sort.field;
  matches.sort((a, b) => {
    const left = comparable(field === "id" ? a.id : a.data[field]);
    const right = comparable(field === "id" ? b.id : b.data[field]);
    if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
    return String(left).localeCompare(String(right), undefined, { numeric: true }) * direction;
  });
}
const page = Math.max(1, Number(request.page) || 1);
const limit = Math.min(100, Math.max(1, Number(request.limit) || 50));
const start = (page - 1) * limit;
process.stdout.write(JSON.stringify({
  items: matches.slice(start, start + limit),
  observations: [...observations].map(([key, types]) => ({ key, types: [...types] })),
  total: entries instanceof Map ? entries.size : 0,
  filteredTotal: matches.length,
  scannedTotal,
  page,
  limit,
  truncated: entries instanceof Map ? entries.size > scannedTotal : false,
}));
`;

type CacheInspection = {
  cache: Record<string, { count: number; entries: NonNullable<CollectionSourceInfo["inspectionEntries"]> }>;
  error?: string;
};

async function inspectContentCache(root: string): Promise<CacheInspection> {
  const store = path.join(root, "node_modules", ".astro", "data-store.json");
  const devalue = devalueModule(root);
  if (!existsSync(store)) return { cache: {} };
  if (!devalue) return { cache: {}, error: "Astro cache parser is unavailable" };
  return new Promise((resolve) => {
    execElectronNode(["--input-type=module", "-e", CACHE_INSPECTOR_SOURCE, store, devalue], {
      cwd: root,
      env: {},
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        resolve({ cache: {}, error: "Astro collection cache inspection failed" });
        return;
      }
      try { resolve({ cache: JSON.parse(String(stdout)) }); }
      catch { resolve({ cache: {}, error: "Astro collection cache returned invalid data" }); }
    });
  });
}

type CacheQueryResult = Omit<ExternalEntryListResult, "fields"> & {
  observations: ExternalFieldObservation[];
};

type ExternalEntryQuery = Omit<ExternalEntryListRequest, "collectionId"> & {
  exactId?: string;
};

async function queryContentCache(
  root: string,
  collectionName: string,
  request: Omit<ExternalEntryListRequest, "collectionId"> & { exactId?: string },
): Promise<CacheQueryResult> {
  const store = path.join(root, "node_modules", ".astro", "data-store.json");
  const devalue = devalueModule(root);
  if (!existsSync(store)) throw new Error("No Astro cache is available for this collection");
  if (!devalue) throw new Error("Astro cache parser is unavailable");
  return new Promise((resolve, reject) => {
    execElectronNode(
      ["--input-type=module", "-e", CACHE_QUERY_SOURCE, store, devalue, collectionName, JSON.stringify(request)],
      {
        cwd: root,
        env: {},
        timeout: 15_000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr).includes("COLLECTION_NOT_CACHED")
            ? "No Astro cache snapshot is available for this collection. Refresh the source and try again."
            : "Astro collection cache query failed"));
          return;
        }
        try {
          resolve(JSON.parse(String(stdout)) as CacheQueryResult);
        } catch {
          reject(new Error("Astro collection cache returned invalid data"));
        }
      },
    );
  });
}

function queryExternalEntries(
  root: string,
  collection: AriaCollectionDef,
  request: ExternalEntryQuery,
): Promise<CacheQueryResult> {
  return collection.source?.kind === "astro-local"
    ? queryLocalCollectionSource(root, collection, request)
    : queryContentCache(root, collection.name, request);
}

function externalCollectionForId(root: string, collectionId: string): AriaCollectionDef {
  const collection = readCollectionRegistry(root).collections.find(
    (item) => item.id === collectionId || item.name === collectionId,
  );
  if (collection?.source?.readOnly && !collection.capabilities?.read) {
    throw new Error(collection.source.availabilityReason ?? "This collection is not readable right now");
  }
  if (!collection?.source?.readOnly) {
    throw new Error("Choose a read-only external or local Astro collection");
  }
  return collection;
}

export async function listExternalEntries(
  projectPath: string,
  input: ExternalEntryListRequest,
): Promise<ExternalEntryListResult> {
  const root = canonicalDirectory(projectPath);
  const collectionId = typeof input?.collectionId === "string" ? input.collectionId.trim() : "";
  if (!collectionId) throw new Error("Collection id is required");
  const collection = externalCollectionForId(root, collectionId);
  const result = await queryExternalEntries(root, collection, {
    query: typeof input.query === "string" ? input.query.slice(0, 500) : undefined,
    page: Math.max(1, Math.trunc(input.page ?? 1)),
    limit: Math.min(100, Math.max(1, Math.trunc(input.limit ?? 50))),
    sort: input.sort && typeof input.sort.field === "string"
      ? {
          field: input.sort.field.slice(0, 200),
          direction: input.sort.direction === "desc" ? "desc" : "asc",
        }
      : undefined,
  });
  return {
    items: result.items,
    fields: buildExternalFieldDescriptorsFromObservations(
      collection.schema?.fields ?? [],
      result.observations,
    ),
    issues: result.issues,
    total: result.total,
    filteredTotal: result.filteredTotal,
    scannedTotal: result.scannedTotal,
    page: result.page,
    limit: result.limit,
    truncated: result.truncated,
  };
}

export async function getExternalEntry(
  projectPath: string,
  collectionId: string,
  entryId: string,
): Promise<ExternalEntryDetailResult | null> {
  const root = canonicalDirectory(projectPath);
  const normalizedCollectionId = collectionId.trim();
  const normalizedEntryId = entryId.trim();
  if (!normalizedCollectionId || !normalizedEntryId) throw new Error("Collection and entry ids are required");
  const collection = externalCollectionForId(root, normalizedCollectionId);
  const result = await queryExternalEntries(root, collection, {
    exactId: normalizedEntryId.slice(0, 1000),
    page: 1,
    limit: 1,
  });
  const entry = result.items[0];
  if (!entry) return null;
  return {
    entry,
    fields: buildExternalFieldDescriptors(collection.schema?.fields ?? [], [entry]),
  };
}

/** Enrich the registry from local files or bounded, credential-pruned cache data. */
export async function readCollectionRegistryWithCache(projectPath: string): Promise<CollectionsState> {
  const root = canonicalDirectory(projectPath);
  const registry = readCollectionRegistry(root);
  const inspection = await inspectContentCache(root);
  const localInspections = new Map<string, CacheQueryResult | Error>();
  await Promise.all(registry.collections.map(async (collection) => {
    if (collection.source?.kind !== "astro-local") return;
    try {
      localInspections.set(collection.name, await queryLocalCollectionSource(root, collection, { page: 1, limit: 100 }));
    } catch (error) {
      localInspections.set(collection.name, error instanceof Error ? error : new Error(String(error)));
    }
  }));
  return {
    ...registry,
    collections: registry.collections.map((collection) => {
      const local = localInspections.get(collection.name);
      if (local instanceof Error && collection.source) {
        return { ...collection, source: { ...collection.source, error: local.message } };
      }
      if (local && !(local instanceof Error) && collection.source) {
        const locales = [...new Set(local.items.map((entry) => entry.locale).filter((locale): locale is string => Boolean(locale)))];
        return {
          ...collection,
          source: {
            ...collection.source,
            entryCount: local.total,
            inspectionEntries: local.items,
            ...(locales.length ? { discoveredLocales: locales } : {}),
          },
        };
      }
      const inspected = inspection.cache[collection.name];
      if (!collection.source) return collection;
      if (!collection.source.readOnly) return collection;
      if (!inspected) {
        if (collection.source.adapter === "astro-store" && !inspection.error) {
          return {
            ...collection,
            capabilities: { ...collection.capabilities!, read: false, migrate: false },
            source: {
              ...collection.source,
              availability: "needs-refresh",
              availabilityReason: "No Astro cache snapshot is available for this collection. Refresh the source and try again.",
              migrationMode: "unavailable",
            },
          };
        }
        return inspection.error
          ? { ...collection, source: { ...collection.source, error: inspection.error } }
          : collection;
      }
      const locales = [...new Set(inspected.entries.map((entry) => entry.locale).filter((locale): locale is string => Boolean(locale)))];
      return {
        ...collection,
        source: {
          ...collection.source,
          entryCount: inspected.count,
          inspectionEntries: inspected.entries,
          ...(locales.length ? { discoveredLocales: locales } : {}),
        },
      };
    }),
  };
}

const MIGRATION_RESERVED_KEYS = new Set([
  "id", "title", "slug", "locale", "body", "draft", "$schema",
  "createdat", "updatedat", "publishedat", "ariaentryid", "translationkey",
]);

function normalizedMigrationKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valuesForKey(records: readonly Record<string, unknown>[], key: string): unknown[] {
  return records.flatMap((record) => key in record ? [record[key]] : []);
}

function inferMigrationField(key: string, values: readonly unknown[]): FieldSchema {
  const present = values.filter((value) => value != null);
  const label = titleFromName(key);
  const normalized = normalizedMigrationKey(key);
  if (IMAGE_FIELD_KEYS.has(normalized) && present.every((value) => typeof value === "string")) {
    return { key, label, type: "image" };
  }
  if (present.length > 0 && present.every((value) => Array.isArray(value))) {
    const items = present.flatMap((value) => value as unknown[]).filter((value) => value != null);
    if (items.every((value) => typeof value === "string")) {
      const options = [...new Set(items as string[])].slice(0, 250);
      return { key, label, type: "multiSelect", ...(options.length ? { options } : {}) };
    }
    if (items.length > 0 && items.every(isPlainRecord)) {
      const itemRecords = items as Record<string, unknown>[];
      const nestedKeys = [...new Set(itemRecords.flatMap((record) => Object.keys(record)))].slice(0, 100);
      return {
        key,
        label,
        type: "repeater",
        fields: nestedKeys.map((nestedKey) => inferMigrationField(nestedKey, valuesForKey(itemRecords, nestedKey))),
      };
    }
    return { key, label, type: "json" };
  }
  if (present.length > 0 && present.every(isPlainRecord)) {
    const objectRecords = present as Record<string, unknown>[];
    const nestedKeys = [...new Set(objectRecords.flatMap((record) => Object.keys(record)))].slice(0, 100);
    return {
      key,
      label,
      type: "object",
      fields: nestedKeys.map((nestedKey) => inferMigrationField(nestedKey, valuesForKey(objectRecords, nestedKey))),
    };
  }
  if (present.every((value) => typeof value === "boolean")) return { key, label, type: "boolean" };
  if (present.every((value) => typeof value === "number" && Number.isInteger(value))) return { key, label, type: "integer" };
  if (present.every((value) => typeof value === "number")) return { key, label, type: "number" };
  return { key, label, type: "string" };
}

function normalizedMigrationField(field: FieldSchema, values: readonly unknown[]): FieldSchema {
  const inferred = inferMigrationField(field.key, values);
  const shouldUseInferred = (
    (field.type === "json" && inferred.type !== "string")
    || (field.type === "object" && !(field.fields?.length) && inferred.type === "object")
    || (field.type === "string" && inferred.type === "image")
  );
  const base = shouldUseInferred ? inferred : field;
  const nestedRecords = field.type === "repeater"
    ? values.flatMap((value) => Array.isArray(value) ? value.filter(isPlainRecord) : [])
    : field.type === "object"
      ? values.filter(isPlainRecord)
      : [];
  const nestedFields = base.fields?.map((child) =>
    normalizedMigrationField(child, valuesForKey(nestedRecords, child.key)));
  return {
    ...base,
    label: field.label || base.label,
    ...(base.type === "multiSelect" && !(base.options?.length) && inferred.options?.length
      ? { options: inferred.options }
      : {}),
    ...(nestedFields?.length ? { fields: nestedFields } : {}),
    ...(field.required === undefined ? {} : { required: field.required }),
    ...(field.searchable === undefined ? {} : { searchable: field.searchable }),
    ...(field.showInEntryList === undefined ? {} : { showInEntryList: field.showInEntryList }),
  };
}

function migrationSchemaFields(
  sourceFields: readonly FieldSchema[],
  entries: readonly ExternalCollectionEntry[],
): FieldSchema[] {
  const records = entries.map((entry) => entry.data);
  const sourceKeys = new Set(sourceFields.map((field) => field.key));
  const inferredKeys = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return [
    ...sourceFields.map((field) => normalizedMigrationField(field, valuesForKey(records, field.key))),
    ...inferredKeys
      .filter((key) => !sourceKeys.has(key))
      .map((key) => inferMigrationField(key, valuesForKey(records, key))),
  ].filter((field) => !MIGRATION_RESERVED_KEYS.has(normalizedMigrationKey(field.key)));
}

function migratedFieldValue(
  root: string,
  entry: ExternalCollectionEntry,
  value: unknown,
  field: FieldSchema,
): unknown {
  if (value == null) return value;
  if (field.type === "image" || field.type === "file") {
    if (isPlainRecord(value) && typeof value.mediaId === "string") return value;
    if (typeof value !== "string") return value;
    const marker = "__ASTRO_IMAGE_";
    const relativeAsset = value.startsWith(marker) ? value.slice(marker.length) : value;
    const resolvedAsset = entry.filePath
      ? resolveProjectAssetId(entry.filePath, relativeAsset)
      : null;
    const mediaId = resolvedAsset ?? value;
    if (!mediaId) throw new Error(`Unable to resolve ${field.label} for ${getExternalEntryTitle(entry)}`);
    return { mediaId };
  }
  if (field.type === "object" && isPlainRecord(value)) {
    const nested = new Map((field.fields ?? []).map((child) => [child.key, child]));
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      nested.has(key) ? migratedFieldValue(root, entry, child, nested.get(key)!) : child,
    ]));
  }
  if (field.type === "repeater" && Array.isArray(value)) {
    return value.map((item) => isPlainRecord(item)
      ? migratedFieldValue(root, entry, item, { ...field, type: "object" })
      : item);
  }
  if (field.type !== "string" && field.type !== "text") return value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function migratedFrontmatter(
  root: string,
  entry: ExternalCollectionEntry,
  fields: readonly FieldSchema[],
): Record<string, unknown> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      if (!(field.key in entry.data)) return [];
      return [[field.key, migratedFieldValue(root, entry, entry.data[field.key], field)] as const];
    }),
  );
}

function allocateMigrationSlug(
  candidate: unknown,
  fallback: string,
  locale: string,
  used: Set<string>,
): string {
  const base = slugify(typeof candidate === "string" && candidate.trim() ? candidate : fallback);
  let slug = base;
  let suffix = 2;
  while (used.has(`${locale}\0${slug}`)) slug = `${base}-${suffix++}`;
  used.add(`${locale}\0${slug}`);
  return slug;
}

function writeMigratedEntry(
  root: string,
  collection: AriaCollectionDef,
  entry: ExternalCollectionEntry,
  fields: readonly FieldSchema[],
  defaultLocale: string,
  usedSlugs: Set<string>,
): void {
  const collectionId = collection.id;
  const entryId = randomUUID();
  const title = getExternalEntryTitle(entry);
  const locale = (
    entry.locale
    || (typeof entry.data.locale === "string" ? entry.data.locale : "")
    || defaultLocale
  ).trim() || defaultLocale;
  const slug = allocateMigrationSlug(entry.data.slug, entry.id || title, locale, usedSlugs);
  const now = new Date().toISOString();
  const record: AriaEntryRecord = {
    entry: {
      id: entryId,
      collectionId,
      status: "draft",
      version: randomUUID(),
      authorId: "local",
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    },
    locales: [{
      entryId,
      collectionId,
      locale,
      slug,
      title,
      frontmatter: migratedFrontmatter(root, entry, fields),
      body: entry.body ?? null,
      isSource: true,
    }],
    relations: [],
  };
  importEntryRecord(root, collection, record);
}

async function loadMigrationEntries(root: string, collection: AriaCollectionDef): Promise<ExternalCollectionEntry[]> {
  const entries: ExternalCollectionEntry[] = [];
  let page = 1;
  while (true) {
    const result = await queryExternalEntries(root, collection, { page, limit: 100 });
    if (result.truncated) throw new Error("This collection has more than 5,000 entries. Import it in smaller batches.");
    entries.push(...result.items);
    if (entries.length >= result.filteredTotal) break;
    page += 1;
  }
  return entries;
}

function migrationConfigSource(root: string, collection: AriaCollectionDef): { file: string; source: string; initializer: CollectionInitializer } | null {
  const relative = collection.source?.configFile;
  if (!relative) return null;
  const file = resolveWithinRoot(root, path.join(root, relative), { rejectFinalSymlink: true });
  const source = readSmallFile(file);
  const discovered = source
    ? discoverAstroCollections(root).find((item) => item.name === collection.name && item.configFile === relative)
    : null;
  const initializer = source && discovered && discovered.initializerEnd > discovered.initializerStart
    ? {
        start: discovered.initializerStart,
        end: discovered.initializerEnd,
        source: source.slice(discovered.initializerStart, discovered.initializerEnd),
      }
    : source ? collectionInitializer(source, collection.name) : null;
  return source && initializer ? { file, source, initializer } : null;
}

function sourcePlanFingerprint(
  collection: AriaCollectionDef,
  entries: readonly ExternalCollectionEntry[],
  fields: readonly FieldSchema[],
  config: ReturnType<typeof migrationConfigSource>,
): string {
  return createHash("sha256").update(JSON.stringify({
    collection: collection.name,
    source: collection.source,
    entries,
    fields,
    initializer: config?.initializer.source ?? null,
  })).digest("hex");
}

async function migrationAssessmentSnapshot(
  root: string,
  collection: AriaCollectionDef,
): Promise<{
  assessment: CollectionMigrationAssessment;
  entries: ExternalCollectionEntry[];
  sourceFingerprint: string;
}> {
  if (!collection?.source || !collection.capabilities?.migrate) {
    throw new Error("This collection is not a migration source");
  }
  const entries = await loadMigrationEntries(root, collection);
  const fields = migrationSchemaFields(collection.schema?.fields ?? [], entries);
  const config = migrationConfigSource(root, collection);
  const sourceFingerprint = sourcePlanFingerprint(collection, entries, fields, config);
  const { inspectionEntries: _inspectionEntries, ...source } = collection.source;
  const stableAssessment = {
    collection: { id: collection.id, name: collection.name, label: collection.label },
    source,
    entryCount: entries.length,
    locales: [...new Set(entries.map((entry) => entry.locale).filter((locale): locale is string => Boolean(locale)))],
    fields,
    initialImportStatus: "draft" as const,
    mutatesExternalSource: true,
    requiresExplicitMapping: !config,
    ...(collection.source.configFile ? { configurationFile: collection.source.configFile } : {}),
  };
  return {
    entries,
    sourceFingerprint,
    assessment: {
      previewHash: createHash("sha256").update(JSON.stringify({ ...stableAssessment, sourceFingerprint })).digest("hex"),
      generatedAt: new Date().toISOString(),
      ...stableAssessment,
    },
  };
}

export async function assessCollectionMigration(
  projectPath: string,
  collectionId: string,
): Promise<CollectionMigrationAssessment> {
  const root = canonicalDirectory(projectPath);
  const collection = externalCollectionForId(root, collectionId);
  return (await migrationAssessmentSnapshot(root, collection)).assessment;
}

function ensureMigrationConfigImports(source: string): string {
  const additions: string[] = [];
  if (!/import\s*\{[^}]*\bz\b[^}]*\}\s*from\s*["'][^"']+["']/.test(source)) {
    additions.push('import { z } from "astro/zod";');
  }
  if (!/import\s*\{[^}]*\bglob\b[^}]*\}\s*from\s*["']astro\/loaders["']/.test(source)) {
    additions.push('import { glob } from "astro/loaders";');
  }
  return additions.length ? `${additions.join("\n")}\n${source}` : source;
}

function cutOverCollectionConfig(
  root: string,
  collection: AriaCollectionDef,
  managedCollection: AriaCollectionDef,
): void {
  const config = migrationConfigSource(root, collection);
  if (!config) throw new Error("Aria cannot safely update this collection definition automatically");
  const markers = collectionConfigMarkers(collection.name);
  const replacement = `${markers.begin}\n${buildCollectionDefineInitializer(managedCollection)}\n${markers.end}`;
  const next = ensureMigrationConfigImports(
    `${config.source.slice(0, config.initializer.start)}${replacement}${config.source.slice(config.initializer.end)}`,
  );
  writeTextFileAtomic(config.file, next.endsWith("\n") ? next : `${next}\n`);
}

function removeOriginalLocalEntries(
  root: string,
  collection: AriaCollectionDef,
  entries: readonly ExternalCollectionEntry[],
): void {
  if (collection.source?.adapter === "astro-file") {
    const sourceFile = collection.source.sourceFile;
    if (!sourceFile) throw new Error("Aria cannot locate the original file() source");
    const file = resolveWithinRoot(root, path.join(root, sourceFile), { rejectFinalSymlink: true });
    if (!/\.(?:json|ya?ml|toml)$/i.test(file)) {
      throw new Error("Aria refused to replace an unsupported file() source");
    }
    if (entries.some((entry) => entry.filePath !== sourceFile)) {
      throw new Error("Aria refused to replace a file() source with ambiguous entry paths");
    }
    removePathTracked(file, { force: true });
    return;
  }
  const contentDirectory = collection.source?.contentDirectory;
  if (!contentDirectory) return;
  const sourceRoot = resolveWithinRoot(root, path.join(root, contentDirectory), { rejectFinalSymlink: true });
  for (const entry of entries) {
    if (!entry.filePath) throw new Error(`Aria cannot locate the source file for ${entry.id}`);
    const file = resolveWithinRoot(root, path.join(root, entry.filePath), { rejectFinalSymlink: true });
    const relative = path.relative(sourceRoot, file);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !/\.(?:md|mdx|mdoc|json|ya?ml|toml)$/i.test(file)) {
      throw new Error(`Aria refused to replace a source file outside ${contentDirectory}`);
    }
    removePathTracked(file, { force: true });
  }
}

async function verifyMigratedAstroCollection(root: string): Promise<void> {
  const command = resolveLocalAstroCommand(root, ["sync"]);
  if (!command) return;
  await new Promise<void>((resolve, reject) => {
    execElectronNode(command.args, {
      cwd: root,
      env: projectProcessEnv(),
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    }, (error, _stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }
      const message = String(stderr || error.message || "Astro could not load the migrated collection")
        .replace(/(?:Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]")
        .replace(/(["']?(?:api[-_]?key|token|secret|password|authorization)["']?\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
        .slice(0, 2_000);
      reject(new Error(`Migration validation failed: ${message}`));
    });
  });
}

export async function migrateCollectionToAria(
  projectPath: string,
  collectionId: string,
  expectedPreviewHash: string,
): Promise<CollectionMigrationResult> {
  const root = canonicalDirectory(projectPath);
  const collection = externalCollectionForId(root, collectionId);
  const snapshot = await migrationAssessmentSnapshot(root, collection);
  const assessment = snapshot.assessment;
  if (!expectedPreviewHash || assessment.previewHash !== expectedPreviewHash) {
    throw new Error("COLLECTION_MIGRATION_CONFLICT: The source changed. Review the import again before continuing.");
  }
  if (!assessment.entryCount) {
    throw new Error("This collection has no entries to import");
  }
  if (assessment.requiresExplicitMapping) {
    throw new Error("Aria cannot safely update this collection definition automatically");
  }

  const state = readCollections(root);
  if (state.collections.some((item) => item.name === collection.name)) {
    throw new Error(`CONFLICT: Collection name already exists: ${collection.name}`);
  }
  const current = await migrationAssessmentSnapshot(root, collection);
  if (current.sourceFingerprint !== snapshot.sourceFingerprint) {
    throw new Error("COLLECTION_MIGRATION_CONFLICT: The source changed. Review the import again before continuing.");
  }
  const managedCollectionId = randomUUID();
  const managedCollection: AriaCollectionDef = {
    id: managedCollectionId,
    name: collection.name,
    label: collection.label,
    kind: collection.kind,
    urlPattern: null,
    listPageFile: null,
    templatePageFile: null,
    schema: { fields: assessment.fields, version: 1 },
    contentDirectory: `src/content/${collection.name}`,
    supports: ["body", "drafts", "revisions", "search"],
    scope: "global",
  };
  writeCollections(root, { collections: [...state.collections, managedCollection] });
  cutOverCollectionConfig(root, collection, managedCollection);
  removeOriginalLocalEntries(root, collection, snapshot.entries);

  const defaultLocale = readSiteSettings(root).localization?.content.defaultLocale ?? "en";
  const usedSlugs = new Set<string>();
  let importedEntries = 0;
  for (const entry of snapshot.entries) {
    writeMigratedEntry(
      root,
      managedCollection,
      entry,
      assessment.fields,
      defaultLocale,
      usedSlugs,
    );
    importedEntries += 1;
  }
  await verifyMigratedAstroCollection(root);
  return {
    ok: true,
    collectionId: managedCollectionId,
    collectionName: collection.name,
    importedEntries,
    initialStatus: "draft",
    sourceChanged: true,
    routesChanged: false,
  };
}
