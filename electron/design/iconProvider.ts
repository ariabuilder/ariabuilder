import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { getIconData, iconToSVG } from "@iconify/utils";
import type {
  DesignIconResolveResult,
  DesignIconSearchItem,
  DesignIconSearchRequest,
  DesignIconSearchResult,
} from "../../shared/design";
import { canonicalDirectory, isPathInside } from "../pathSafety";
import { detectIconRuntime } from "./iconRuntime";
import { readDesignMeta } from "./meta";

const ICON_PREFIX_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ICON_NAME_RE = /^[a-z0-9]+(?:[-_:][a-z0-9]+)*$/;
const MAX_QUERY_LENGTH = 120;
const MAX_PAGE_SIZE = 100;
const MAX_RESOLVE_IDS = 100;
const MAX_ICON_PACKAGE_BYTES = 24 * 1024 * 1024;

type IconifyCollection = Parameters<typeof getIconData>[0];

type CachedCollection = {
  file: string;
  fingerprint: string;
  collection: IconifyCollection;
  catalog: DesignIconSearchItem[];
};

const packageCache = new Map<string, CachedCollection>();

function assertPrefix(value: unknown): string {
  if (typeof value !== "string") throw new Error("Icon pack is required");
  const prefix = value.trim().toLowerCase();
  if (!ICON_PREFIX_RE.test(prefix)) throw new Error("Invalid icon pack");
  return prefix;
}

function eligiblePacks(root: string): Set<string> {
  const enabled = new Set(readDesignMeta(root).enabledIconPacks);
  const installed = new Set(detectIconRuntime(root).installedJsonPrefixes);
  return new Set([...enabled].filter((prefix) => installed.has(prefix)));
}

function assertEnabledInstalledPack(
  root: string,
  value: unknown,
  allowed = eligiblePacks(root),
): string {
  const prefix = assertPrefix(value);
  if (!allowed.has(prefix)) {
    const enabled = new Set(readDesignMeta(root).enabledIconPacks);
    if (!enabled.has(prefix)) throw new Error(`Icon pack is not enabled: ${prefix}`);
    throw new Error(`Icon pack is not installed: ${prefix}`);
  }
  return prefix;
}

function toLabel(name: string): string {
  return name
    .split(/[-_:]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolvePackageFile(root: string, prefix: string): string {
  const projectRequire = createRequire(path.join(root, "package.json"));
  let file = "";
  try {
    file = projectRequire.resolve(`@iconify-json/${prefix}/icons.json`);
  } catch {
    throw new Error(`Icon pack data is unavailable: ${prefix}`);
  }
  if (!isPathInside(root, file)) {
    throw new Error(`Icon pack resolves outside the project: ${prefix}`);
  }
  return file;
}

function readCollection(root: string, prefix: string): CachedCollection {
  const file = resolvePackageFile(root, prefix);
  const stats = statSync(file);
  if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_ICON_PACKAGE_BYTES) {
    throw new Error(`Icon pack data is invalid: ${prefix}`);
  }
  const fingerprint = `${stats.mtimeMs}:${stats.size}`;
  const cacheKey = `${root}\u0000${prefix}`;
  const cached = packageCache.get(cacheKey);
  if (cached?.file === file && cached.fingerprint === fingerprint) return cached;

  let collection: IconifyCollection;
  try {
    collection = JSON.parse(readFileSync(file, "utf8")) as IconifyCollection;
  } catch {
    throw new Error(`Icon pack data is malformed: ${prefix}`);
  }
  if (!collection || typeof collection !== "object") {
    throw new Error(`Icon pack data is malformed: ${prefix}`);
  }
  const names = Array.from(
    new Set([
      ...Object.keys(collection.icons ?? {}),
      ...Object.keys(collection.aliases ?? {}),
    ]),
  ).filter((name) => ICON_NAME_RE.test(name)).sort();
  const catalog = names.map((name) => ({
    id: `${prefix}:${name}`,
    pack: prefix,
    name,
    label: toLabel(name),
  }));
  const next = { file, fingerprint, collection, catalog };
  packageCache.set(cacheKey, next);
  return next;
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeCursor(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value !== "string" || value.length > 40) return 0;
  try {
    const offset = Number.parseInt(Buffer.from(value, "base64url").toString("utf8"), 10);
    return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

function svgDataUrl(body: string, attributes: Record<string, string>): string {
  const attrs = Object.entries(attributes)
    .map(([name, value]) => `${name}="${value.replaceAll('"', "&quot;")}"`)
    .join(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function searchProjectIcons(
  projectPath: string,
  request: DesignIconSearchRequest,
): DesignIconSearchResult {
  const root = canonicalDirectory(projectPath);
  if (!request || typeof request !== "object") throw new Error("Icon search request is required");
  const prefix = assertEnabledInstalledPack(root, request.pack);
  const query = typeof request.query === "string"
    ? request.query.trim().slice(0, MAX_QUERY_LENGTH).toLowerCase()
    : "";
  const requestedLimit =
    typeof request.limit === "number" && Number.isFinite(request.limit)
      ? Math.trunc(request.limit)
      : 48;
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, requestedLimit));
  const offset = decodeCursor(request.cursor);
  const source = readCollection(root, prefix);
  const matching = query
    ? source.catalog.filter((item) => `${item.name} ${item.label}`.toLowerCase().includes(query))
    : source.catalog;
  const items = matching.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    nextCursor: nextOffset < matching.length ? encodeCursor(nextOffset) : null,
    snapshotVersion: `${prefix}:${source.fingerprint}`,
  };
}

export function resolveProjectIcons(
  projectPath: string,
  requestedIds: readonly string[],
): DesignIconResolveResult {
  const root = canonicalDirectory(projectPath);
  if (!Array.isArray(requestedIds) || requestedIds.length > MAX_RESOLVE_IDS) {
    throw new Error("Invalid icon resolve request");
  }
  const ids = [...new Set(requestedIds.map((id) => String(id).trim()).filter(Boolean))];
  const icons: DesignIconResolveResult["icons"] = {};
  const missing: string[] = [];
  const collectionByPack = new Map<string, CachedCollection>();
  const allowedPacks = eligiblePacks(root);

  for (const id of ids) {
    const separator = id.indexOf(":");
    const prefix = separator > 0 ? id.slice(0, separator) : "";
    const name = separator > 0 ? id.slice(separator + 1) : "";
    if (!ICON_NAME_RE.test(name)) {
      missing.push(id);
      continue;
    }
    let source: CachedCollection;
    try {
      const allowedPrefix = assertEnabledInstalledPack(root, prefix, allowedPacks);
      source = collectionByPack.get(allowedPrefix) ?? readCollection(root, allowedPrefix);
      collectionByPack.set(allowedPrefix, source);
    } catch {
      missing.push(id);
      continue;
    }
    const icon = getIconData(source.collection, name);
    if (!icon) {
      missing.push(id);
      continue;
    }
    const rendered = iconToSVG(icon);
    const viewBox = rendered.attributes.viewBox ?? "0 0 24 24";
    icons[id] = {
      id,
      dataUrl: svgDataUrl(rendered.body, rendered.attributes),
      viewBox,
      snapshotVersion: `${prefix}:${source.fingerprint}`,
    };
  }
  return { icons, missing };
}

export function clearProjectIconCache(): void {
  packageCache.clear();
}
