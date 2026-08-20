import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  EMPTY_DESIGN_META,
  normalizeFontsourceId,
  type DesignCssVarCategory,
  type DesignFonts,
  type DesignIconPackId,
  type DesignMeta,
  type DesignTokenPreference,
  type DesignTokenProviderId,
  type DesignVariableAlias,
  type DesignVariablesMeta,
} from "../../shared/design";
import {
  canonicalDirectory,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "../pathSafety";

const ICONIFY_PREFIX_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const MAX_ICON_PACKS = 200;
const VALID_TOKEN_PROVIDERS = new Set<DesignTokenProviderId>([
  "aria-css",
  "css",
  "tailwind-config",
  "tailwind-theme",
]);

function isValidIconifyPrefix(value: string): boolean {
  return value.length > 0 && value.length <= 64 && ICONIFY_PREFIX_RE.test(value);
}

function startCaseFontsourceId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const VALID_CATEGORIES = new Set<DesignCssVarCategory>([
  "color",
  "spacing",
  "typography",
  "borders",
  "effects",
  "layout",
  "other",
]);

function metaPath(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  const ariaDir = resolveWithinRoot(root, path.join(root, ".aria"), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  return resolveWithinRoot(root, path.join(ariaDir, "design-meta.json"), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

/** Exported for unit tests — also used by normalizeMeta. */
export function normalizeFonts(raw: unknown): DesignFonts {
  if (!raw || typeof raw !== "object") {
    return { google: [], custom: [], fontsource: [] };
  }
  const o = raw as Record<string, unknown>;
  const google: DesignFonts["google"] = [];
  if (Array.isArray(o.google)) {
    for (const item of o.google) {
      if (!item || typeof item !== "object") continue;
      const g = item as Record<string, unknown>;
      const family = typeof g.family === "string" ? g.family.trim() : "";
      if (!family) continue;
      const weights = Array.isArray(g.weights)
        ? g.weights.filter((w): w is number => typeof w === "number")
        : [];
      google.push({ family, weights });
    }
  }
  const custom: DesignFonts["custom"] = [];
  if (Array.isArray(o.custom)) {
    for (const item of o.custom) {
      if (!item || typeof item !== "object") continue;
      const c = item as Record<string, unknown>;
      const family = typeof c.family === "string" ? c.family.trim() : "";
      const file = typeof c.file === "string" ? c.file.trim() : "";
      if (!family || !file) continue;
      custom.push({ family, file });
    }
  }
  const fontsource: DesignFonts["fontsource"] = [];
  const seenFontsource = new Set<string>();
  if (Array.isArray(o.fontsource)) {
    for (const item of o.fontsource) {
      if (!item || typeof item !== "object") continue;
      const f = item as Record<string, unknown>;
      const id = normalizeFontsourceId(
        typeof f.id === "string" ? f.id : typeof f.family === "string" ? f.family : "",
      );
      if (!id || seenFontsource.has(id)) continue;
      seenFontsource.add(id);
      const family =
        typeof f.family === "string" && f.family.trim()
          ? f.family.trim()
          : startCaseFontsourceId(id);
      fontsource.push({
        id,
        family,
        variable: Boolean(f.variable),
      });
    }
  }
  return {
    google,
    custom,
    fontsource,
    bodyFamily:
      typeof o.bodyFamily === "string" && o.bodyFamily.trim()
        ? o.bodyFamily.trim()
        : undefined,
    headingFamily:
      typeof o.headingFamily === "string" && o.headingFamily.trim()
        ? o.headingFamily.trim()
        : undefined,
  };
}

function normalizeCategory(raw: unknown): DesignCssVarCategory {
  return typeof raw === "string" &&
    VALID_CATEGORIES.has(raw as DesignCssVarCategory)
    ? (raw as DesignCssVarCategory)
    : "other";
}

/**
 * Normalize an alias entry for design-meta persistence.
 * Empty `sourceKey` is allowed so Variable Manager can create draft alias
 * rows on the table before the user picks a source (mirrors empty customs).
 */
function normalizeAlias(raw: unknown): DesignVariableAlias | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sourceType = o.sourceType === "token" ? "token" : "custom";
  const sourceKey = typeof o.sourceKey === "string" ? o.sourceKey.trim() : "";
  return {
    label: typeof o.label === "string" ? o.label : "",
    sourceType,
    sourceKey,
    fallback: typeof o.fallback === "string" ? o.fallback : undefined,
  };
}

/** Exported for unit tests — also used by normalizeMeta. */
export function normalizeVariablesMeta(raw: unknown): DesignVariablesMeta {
  if (!raw || typeof raw !== "object") {
    return { custom: {}, aliases: {} };
  }
  const o = raw as Record<string, unknown>;
  const custom: DesignVariablesMeta["custom"] = {};
  if (o.custom && typeof o.custom === "object") {
    for (const [key, value] of Object.entries(
      o.custom as Record<string, unknown>,
    )) {
      const name = key.trim().replace(/^--/, "");
      if (!name || !value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      custom[name] = {
        label: typeof entry.label === "string" ? entry.label : "",
        category: normalizeCategory(entry.category),
        description:
          typeof entry.description === "string"
            ? entry.description
            : undefined,
      };
    }
  }
  const aliases: DesignVariablesMeta["aliases"] = {};
  if (o.aliases && typeof o.aliases === "object") {
    for (const [key, value] of Object.entries(
      o.aliases as Record<string, unknown>,
    )) {
      const name = key.trim().replace(/^--/, "");
      if (!name) continue;
      const alias = normalizeAlias(value);
      if (alias) aliases[name] = alias;
    }
  }
  return { custom, aliases };
}

function normalizeMeta(raw: unknown): DesignMeta {
  if (!raw || typeof raw !== "object") {
    return structuredClone(EMPTY_DESIGN_META);
  }
  const o = raw as Record<string, unknown>;
  const enabledIconPacks: DesignIconPackId[] = [];
  const seenPacks = new Set<string>();
  if (Array.isArray(o.enabledIconPacks)) {
    for (const pack of o.enabledIconPacks) {
      if (typeof pack !== "string") continue;
      const prefix = pack.trim().toLowerCase();
      if (!isValidIconifyPrefix(prefix) || seenPacks.has(prefix)) continue;
      seenPacks.add(prefix);
      enabledIconPacks.push(prefix);
      if (enabledIconPacks.length >= MAX_ICON_PACKS) break;
    }
  }
  const paletteOrder: string[] = [];
  if (Array.isArray(o.paletteOrder)) {
    for (const name of o.paletteOrder) {
      if (typeof name === "string" && name.trim()) {
        paletteOrder.push(name.trim());
      }
    }
  }
  const tokenPreferences: Record<string, DesignTokenPreference> = {};
  if (o.tokenPreferences && typeof o.tokenPreferences === "object") {
    for (const [rawKey, rawValue] of Object.entries(
      o.tokenPreferences as Record<string, unknown>,
    )) {
      const key = rawKey.trim();
      if (!key || !rawValue || typeof rawValue !== "object") continue;
      const value = rawValue as Record<string, unknown>;
      const preference: DesignTokenPreference = {};
      if (typeof value.preferredSourceId === "string" && value.preferredSourceId.trim()) {
        preference.preferredSourceId = value.preferredSourceId.trim();
      }
      if (value.adoptedFrom && typeof value.adoptedFrom === "object") {
        const adopted = value.adoptedFrom as Record<string, unknown>;
        const provider = adopted.provider;
        const relativeFile = typeof adopted.relativeFile === "string" ? adopted.relativeFile.trim() : "";
        const pointer = typeof adopted.pointer === "string" ? adopted.pointer.trim() : "";
        const sourceHash = typeof adopted.sourceHash === "string" ? adopted.sourceHash.trim() : "";
        if (
          typeof provider === "string" &&
          VALID_TOKEN_PROVIDERS.has(provider as DesignTokenProviderId) &&
          relativeFile &&
          pointer &&
          sourceHash
        ) {
          preference.adoptedFrom = {
            provider: provider as DesignTokenProviderId,
            relativeFile,
            pointer,
            sourceHash,
          };
        }
      }
      if (preference.preferredSourceId || preference.adoptedFrom) {
        tokenPreferences[key] = preference;
      }
    }
  }
  return {
    version: 2,
    enabledIconPacks,
    paletteOrder,
    fonts: normalizeFonts(o.fonts),
    variables: normalizeVariablesMeta(o.variables),
    tokenPreferences,
  };
}

export function readDesignMeta(projectPath: string): DesignMeta {
  const file = metaPath(projectPath);
  if (!existsSync(file)) {
    return structuredClone(EMPTY_DESIGN_META);
  }
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return normalizeMeta(raw);
  } catch {
    return structuredClone(EMPTY_DESIGN_META);
  }
}

export function writeDesignMeta(
  projectPath: string,
  meta: DesignMeta,
): DesignMeta {
  const file = metaPath(projectPath);
  mkdirSync(path.dirname(file), { recursive: true });
  const normalized = normalizeMeta(meta);
  writeTextFileAtomic(file, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}
