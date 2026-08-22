import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  EMPTY_DESIGN_FONTS,
  EMPTY_DESIGN_VARIABLES,
  createEmptyGlobalStyles,
  mergeGlobalStyles,
  type DesignClassRule,
  type DesignCssVar,
  type DesignCustomFont,
  type DesignFonts,
  type DesignPatch,
  type DesignSnapshot,
  type DesignTokenMutationInput,
  type DesignTokenMutationPreview,
  type DesignTokenMutationResult,
  type DesignTokenSourceSelectionInput,
  type DesignVariableAlias,
  type DesignVariableDefinition,
  type DesignVariables,
  type DesignVariablesMeta,
  type StylesheetReadResult,
  type StylesheetWriteResult,
} from "../../shared/design";
import { sourceUsesAriaBemPrimitives } from "../../shared/composer/ariaBem";
import { hashRevision } from "../../shared/agent/revision";
import { dialog, shell, type BrowserWindow } from "../electron-api";
import {
  canonicalDirectory,
  removePathTracked,
  resolveWithinRoot,
  writeBinaryFileAtomic,
  writeTextFileAtomic,
} from "../pathSafety";
import {
  defaultEntryRelativePath,
  ensureStylesDirectory,
  listProjectStylesheets,
  resolveDesignEntryRelativePath,
  resolveStylesheetAbsolute,
} from "./discovery";
import {
  applyManagedBlockToFile,
  extractManagedBlock,
  stylesheetHasStaleAriaBemPrimitives,
  stylesheetNeedsAriaBemPrimitives,
  type ManagedBlockModel,
} from "./managedBlock";
import { syncManagedTailwindThemeBridge } from "../utilities/themeBridge";
import { readDesignMeta, writeDesignMeta } from "./meta";
import { detectIconRuntime } from "./iconRuntime";
import { resolveProjectIcons, searchProjectIcons } from "./iconProvider";
import {
  discoverGoogleFonts,
  mergeGoogleFonts,
  removeGoogleFontFamiliesFromProject,
} from "./googleFontDiscovery";
import {
  detectFontsourceRuntime,
  discoverFontsourceFonts,
  mergeFontsourceFonts,
  removeFontsourceFontsFromProject,
} from "./fontsourceDiscovery";
import {
  extractClassRules,
  extractColorClassVariables,
  extractCustomProperties,
  extractRules,
  groupColorVariables,
  isVarReference,
  mapRulesToGlobalStyles,
  resolvePaletteColors,
} from "./parseCss";
import {
  ariaTokenSources,
  discoverDesignTokenIndex,
  planDesignTokenMutation,
} from "./sourceAdapters";
import { runProjectMutation } from "../mutations";

function readFile(projectPath: string, relativePath: string): string {
  const absolute = resolveStylesheetAbsolute(projectPath, relativePath);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error("Stylesheet not found");
  }
  return readFileSync(absolute, "utf8");
}

const CUSTOM_FONT_EXTENSIONS = new Set([
  ".woff2",
  ".woff",
  ".ttf",
  ".otf",
  ".eot",
]);

/** Media variant crops live here; never treat as design fonts. */
const UPLOADS_VARIANTS_DIR = "variants";
const MAX_UPLOADS_FONT_SCAN_DEPTH = 40;

function inferCustomFontFamily(fileName: string): string {
  const base = path
    .basename(fileName, path.extname(fileName))
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.replace(/[-_]+/g, " ").trim() || "Custom Font";
}

function toPosixRelative(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

/** Shallow scan of `public/fonts` (design-managed uploads). */
function discoverPublicFontsDir(projectPath: string): DesignCustomFont[] {
  const root = canonicalDirectory(projectPath);
  const fontsDir = path.join(root, "public", "fonts");
  if (!existsSync(fontsDir) || !statSync(fontsDir).isDirectory()) {
    return [];
  }

  let entries: string[];
  try {
    entries = readdirSync(fontsDir);
  } catch {
    return [];
  }

  const fonts: DesignCustomFont[] = [];
  for (const name of entries) {
    const ext = path.extname(name).toLowerCase();
    if (!CUSTOM_FONT_EXTENSIONS.has(ext)) continue;
    const absolute = path.join(fontsDir, name);
    try {
      if (!statSync(absolute).isFile()) continue;
    } catch {
      continue;
    }
    fonts.push({
      family: inferCustomFontFamily(name),
      file: `fonts/${name}`,
    });
  }
  return fonts;
}

/**
 * Recursive scan of `public/uploads` for font files already in the media library.
 * Skips the media `variants/` tree.
 */
function discoverUploadsFonts(projectPath: string): DesignCustomFont[] {
  const root = canonicalDirectory(projectPath);
  const uploadsDir = path.join(root, "public", "uploads");
  if (!existsSync(uploadsDir) || !statSync(uploadsDir).isDirectory()) {
    return [];
  }

  const fonts: DesignCustomFont[] = [];
  const stack: { dir: string; depth: number }[] = [{ dir: uploadsDir, depth: 0 }];

  while (stack.length) {
    const { dir: current, depth } = stack.pop()!;
    if (depth > MAX_UPLOADS_FONT_SCAN_DEPTH) continue;

    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (depth === 0 && entry.name === UPLOADS_VARIANTS_DIR) continue;
        stack.push({ dir: absolute, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!CUSTOM_FONT_EXTENSIONS.has(ext)) continue;

      const relWithinUploads = toPosixRelative(uploadsDir, absolute);
      if (
        !relWithinUploads ||
        relWithinUploads.startsWith("..") ||
        relWithinUploads === UPLOADS_VARIANTS_DIR ||
        relWithinUploads.startsWith(`${UPLOADS_VARIANTS_DIR}/`)
      ) {
        continue;
      }

      fonts.push({
        family: inferCustomFontFamily(entry.name),
        file: `uploads/${relWithinUploads}`,
      });
    }
  }

  return fonts;
}

/**
 * Scan `public/fonts` and media `public/uploads` for font files the project already ships.
 * Paths are public-URL relative (`fonts/…`, `uploads/…`).
 */
export function discoverCustomFonts(projectPath: string): DesignCustomFont[] {
  const byFile = new Map<string, DesignCustomFont>();
  for (const font of [
    ...discoverPublicFontsDir(projectPath),
    ...discoverUploadsFonts(projectPath),
  ]) {
    byFile.set(font.file, font);
  }
  return [...byFile.values()].sort((a, b) => a.family.localeCompare(b.family));
}

/**
 * Disk is the source of truth for which custom font files exist.
 * Meta supplies preferred family names when the file is already registered.
 */
function mergeCustomFonts(
  metaCustom: DesignCustomFont[],
  discovered: DesignCustomFont[],
): DesignCustomFont[] {
  const metaByFile = new Map(
    metaCustom
      .filter((font) => font.file.trim())
      .map((font) => [font.file.replace(/\\/g, "/").replace(/^\/+/, ""), font]),
  );

  const merged: DesignCustomFont[] = discovered.map((font) => {
    const key = font.file.replace(/\\/g, "/").replace(/^\/+/, "");
    const fromMeta = metaByFile.get(key);
    return {
      family: fromMeta?.family?.trim() || font.family,
      file: key,
    };
  });

  return merged.sort((a, b) => a.family.localeCompare(b.family));
}

function resolveProjectFonts(
  projectPath: string,
  metaFonts: DesignFonts,
): DesignFonts {
  const custom = mergeCustomFonts(
    metaFonts.custom,
    discoverCustomFonts(projectPath),
  );
  const google = mergeGoogleFonts(
    metaFonts.google,
    discoverGoogleFonts(projectPath),
  );
  const fontsource = mergeFontsourceFonts(
    metaFonts.fontsource ?? [],
    discoverFontsourceFonts(projectPath),
  );
  return {
    google,
    custom,
    fontsource,
    bodyFamily: metaFonts.bodyFamily,
    headingFamily: metaFonts.headingFamily,
  };
}

function startCaseLabel(key: string): string {
  return key
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

const CSS_VAR_REFERENCE_PATTERN =
  /^var\(\s*--([a-zA-Z0-9-_]+)\s*(?:,\s*(.+))?\)$/i;
const LEGACY_ICON_PACK_VARIABLE = "aria-icon-packs";

function removeLegacyIconPackVariable(meta: DesignVariablesMeta): void {
  delete meta.custom[LEGACY_ICON_PACK_VARIABLE];
  delete meta.aliases[LEGACY_ICON_PACK_VARIABLE];
}

function parseCustomVarReference(
  value: string,
): { sourceKey: string; fallback: string } | null {
  const match = value.trim().match(CSS_VAR_REFERENCE_PATTERN);
  if (!match) return null;
  return {
    sourceKey: (match[1] ?? "").trim(),
    fallback: match[2]?.trim() ?? "",
  };
}

/**
 * Merge remaining (non-color) CSS custom properties with design-meta labels/aliases
 * into the Variable Manager shape.
 */
export function buildDesignVariables(
  remaining: DesignCssVar[],
  metaVariables: DesignVariablesMeta,
): DesignVariables {
  const custom: Record<string, DesignVariableDefinition> = {};
  const aliases: Record<string, DesignVariableAlias> = {};
  const seen = new Set<string>();

  // Meta-defined aliases win even when CSS holds a resolved token value.
  for (const [key, alias] of Object.entries(metaVariables.aliases)) {
    if (key === LEGACY_ICON_PACK_VARIABLE) continue;
    aliases[key] = {
      label: alias.label,
      sourceType: alias.sourceType,
      sourceKey: alias.sourceKey,
      fallback: alias.fallback,
    };
    seen.add(key);
  }

  for (const variable of remaining) {
    if (variable.name === LEGACY_ICON_PACK_VARIABLE) continue;
    if (seen.has(variable.name)) continue;
    seen.add(variable.name);

    const metaCustom = metaVariables.custom[variable.name];
    const varRef = parseCustomVarReference(variable.value);

    // Auto-detect var(--x) as a custom-source alias when not already in meta.
    if (varRef && varRef.sourceKey) {
      aliases[variable.name] = {
        label: metaCustom
          ? metaCustom.label
          : startCaseLabel(variable.name),
        sourceType: "custom",
        sourceKey: varRef.sourceKey,
        fallback: varRef.fallback || undefined,
      };
      continue;
    }

    custom[variable.name] = {
      label: metaCustom
        ? metaCustom.label
        : startCaseLabel(variable.name),
      value: variable.value,
      category: metaCustom?.category ?? variable.category,
      source: variable.source,
      description: metaCustom?.description,
    };
  }

  // Preserve Aria-managed custom vars that have empty values (not yet in CSS).
  for (const [key, metaCustom] of Object.entries(metaVariables.custom)) {
    if (key === LEGACY_ICON_PACK_VARIABLE) continue;
    if (seen.has(key)) continue;
    custom[key] = {
      label: metaCustom.label,
      value: "",
      category: metaCustom.category,
      source: "aria",
      description: metaCustom.description,
    };
  }

  return { custom, aliases };
}

function variablesToMeta(variables: DesignVariables): DesignVariablesMeta {
  const custom: DesignVariablesMeta["custom"] = {};
  for (const [key, definition] of Object.entries(variables.custom)) {
    custom[key] = {
      label: definition.label,
      category: definition.category,
      description: definition.description,
    };
  }
  return {
    custom,
    aliases: { ...variables.aliases },
  };
}

function flatVariablesForColorResolve(
  variables: DesignVariables,
): DesignCssVar[] {
  const list: DesignCssVar[] = [];
  for (const [name, definition] of Object.entries(variables.custom)) {
    list.push({
      name,
      value: definition.value,
      source: definition.source,
      category: definition.category,
    });
  }
  for (const [name, alias] of Object.entries(variables.aliases)) {
    if (alias.sourceType === "custom" && alias.sourceKey.trim()) {
      const fallback = alias.fallback?.trim();
      list.push({
        name,
        value: fallback
          ? `var(--${alias.sourceKey.trim()}, ${fallback})`
          : `var(--${alias.sourceKey.trim()})`,
        source: "aria",
        category: "other",
      });
    }
  }
  return list;
}

function mergeVariables(
  site: DesignCssVar[],
  aria: DesignCssVar[],
): DesignCssVar[] {
  const map = new Map<string, DesignCssVar>();
  for (const variable of site) {
    map.set(variable.name, variable);
  }
  for (const variable of aria) {
    const existing = map.get(variable.name);
    if (
      existing &&
      !isVarReference(existing.value) &&
      isVarReference(variable.value)
    ) {
      map.set(variable.name, { ...existing, source: "aria" });
      continue;
    }
    map.set(variable.name, { ...variable, source: "aria" });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function modelFromManagedBlockCss(blockCss: string | null): ManagedBlockModel {
  if (!blockCss) {
    return {
      fonts: structuredClone(EMPTY_DESIGN_FONTS),
      variables: structuredClone(EMPTY_DESIGN_VARIABLES),
      colors: { palettes: [], semantic: {} },
      globalStyles: createEmptyGlobalStyles(),
      classes: [],
      icons: { enabledPacks: [] },
    };
  }
  const vars = extractCustomProperties(blockCss, "aria");
  const { palettes, semantic, remaining } = groupColorVariables(vars);
  return {
    fonts: structuredClone(EMPTY_DESIGN_FONTS),
    variables: buildDesignVariables(remaining, {
      custom: {},
      aliases: {},
    }),
    colors: { palettes, semantic },
    globalStyles: mapRulesToGlobalStyles(extractRules(blockCss)),
    classes: extractClassRules(blockCss, "aria"),
    icons: { enabledPacks: [] },
  };
}

/**
 * Sites that already seeded the primitives section keep that first-wave CSS
 * forever unless we rewrite it. Refresh on snapshot so the canvas picks up
 * current Aria defaults without requiring a Composer edit.
 */
function refreshStaleAriaBemPrimitives(root: string): void {
  const relativePath = resolveDesignEntryRelativePath(root);
  if (!relativePath) return;
  const absolute = resolveStylesheetAbsolute(root, relativePath);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return;
  const existing = readFileSync(absolute, "utf8");
  if (!stylesheetHasStaleAriaBemPrimitives(existing)) return;
  const { block } = extractManagedBlock(existing);
  const next = applyManagedBlockToFile(existing, modelFromManagedBlockCss(block));
  if (next === existing) return;
  writeTextFileAtomic(absolute, next);
}

export function getDesignSnapshot(projectPath: string): DesignSnapshot {
  const root = canonicalDirectory(projectPath);
  refreshStaleAriaBemPrimitives(root);
  const stylesheets = listProjectStylesheets(root);
  const entryRelativePath = resolveDesignEntryRelativePath(root);
  const meta = readDesignMeta(root);
  removeLegacyIconPackVariable(meta.variables);

  let siteCss = "";
  let ariaBlockCss = "";
  const classMap = new Map<string, DesignClassRule>();

  for (const sheet of stylesheets) {
    try {
      const content = readFile(root, sheet.relativePath);
      const { before, block, after } = extractManagedBlock(content);
      siteCss += `\n${before}\n${after}\n`;
      for (const item of extractClassRules(`${before}\n${after}`, "site")) {
        classMap.set(item.name, {
          ...item,
          source: "site",
          relativeFile: sheet.relativePath,
        });
      }
      if (block && sheet.isEntry) {
        ariaBlockCss = block;
      } else if (block) {
        ariaBlockCss += `\n${block}\n`;
      }
      if (block) {
        for (const item of extractClassRules(block, "aria")) {
          classMap.set(item.name, {
            ...item,
            source: "aria",
            relativeFile: sheet.relativePath,
          });
        }
      }
    } catch {
      /* skip unreadable */
    }
  }

  const siteVars = extractCustomProperties(siteCss, "site");
  // `.color-*` utilities become synthetic --color-* tokens for Colors / picker.
  // Real CSS variables win over class-derived synthetics of the same name.
  const siteClassColorVars = extractColorClassVariables(siteCss, "site");
  const siteVarMap = new Map<string, DesignCssVar>();
  for (const variable of siteClassColorVars) {
    siteVarMap.set(variable.name, variable);
  }
  for (const variable of siteVars) {
    siteVarMap.set(variable.name, variable);
  }
  const ariaVars = extractCustomProperties(ariaBlockCss, "aria");
  const mergedVars = mergeVariables([...siteVarMap.values()], ariaVars);

  const { palettes: groupedPalettes, semantic, remaining } =
    groupColorVariables(mergedVars);
  const variables = buildDesignVariables(remaining, meta.variables);
  const palettes = resolvePaletteColors(
    groupedPalettes,
    [...mergedVars, ...flatVariablesForColorResolve(variables)],
  );

  const ariaPalettes = resolvePaletteColors(
    groupColorVariables(ariaVars).palettes,
    [...mergedVars, ...flatVariablesForColorResolve(variables)],
  ).map((palette) => ({ ...palette, source: "aria" as const }));
  const tokenIndex = discoverDesignTokenIndex(
    root,
    stylesheets,
    meta,
    ariaTokenSources(ariaPalettes, entryRelativePath, ariaBlockCss),
  );
  const palettesByName = new Map(palettes.map((palette) => [palette.name, palette]));
  for (const sitePalette of tokenIndex.sitePalettes) {
    const existing = palettesByName.get(sitePalette.name);
    if (!existing) {
      palettes.push(sitePalette);
      palettesByName.set(sitePalette.name, sitePalette);
      continue;
    }
    if (existing.source === "site") {
      existing.shades = { ...existing.shades, ...sitePalette.shades };
    }
  }

  if (meta.paletteOrder.length) {
    palettes.sort((a, b) => {
      const ai = meta.paletteOrder.indexOf(a.name);
      const bi = meta.paletteOrder.indexOf(b.name);
      if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }

  const paletteNames = new Set(palettes.map((p) => p.name));
  const siteTokenRefs = tokenIndex.siteTokenRefs.filter(
    (ref) => !paletteNames.has(ref.family),
  );

  const siteRules = extractRules(siteCss);
  const ariaRules = extractRules(ariaBlockCss);
  const siteGlobals = mapRulesToGlobalStyles(siteRules);
  const ariaGlobals = mapRulesToGlobalStyles(ariaRules);
  const globalStyles = mergeGlobalStyles(siteGlobals, ariaGlobals);

  const snapshotBase = {
    entryRelativePath,
    stylesheets,
    sourceFiles: tokenIndex.sourceFiles,
    sources: tokenIndex.sources,
    tokens: tokenIndex.tokens,
    diagnostics: tokenIndex.diagnostics,
    variables,
    colors: { palettes, semantic, siteTokenRefs },
    globalStyles,
    classes: [...classMap.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    fonts: resolveProjectFonts(projectPath, meta.fonts),
    icons: { enabledPacks: [...meta.enabledIconPacks] },
    meta,
  };
  return {
    revision: hashRevision(snapshotBase, "d"),
    ...snapshotBase,
  };
}

export function ensureDesignEntry(projectPath: string): {
  relativePath: string;
  created: boolean;
} {
  const root = canonicalDirectory(projectPath);
  const existing = resolveDesignEntryRelativePath(root);
  if (existing) {
    return { relativePath: existing, created: false };
  }
  ensureStylesDirectory(root);
  const relativePath = defaultEntryRelativePath();
  const absolute = resolveStylesheetAbsolute(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  if (!existsSync(absolute)) {
    writeTextFileAtomic(absolute, `/* Site styles */\n\n`, {
      overwrite: false,
    });
  }
  return { relativePath, created: true };
}

export function patchDesignSystem(
  projectPath: string,
  patch: DesignPatch,
): DesignSnapshot {
  const root = canonicalDirectory(projectPath);
  const { relativePath: entryRel } = ensureDesignEntry(root);
  const absolute = resolveStylesheetAbsolute(root, entryRel);
  let existingContent = existsSync(absolute)
    ? readFileSync(absolute, "utf8")
    : "";
  const { block: existingBlock } = extractManagedBlock(existingContent);
  const prior = modelFromManagedBlockCss(existingBlock);
  const meta = readDesignMeta(root);
  removeLegacyIconPackVariable(meta.variables);
  // Re-hydrate aliases/labels from meta — CSS alone can't represent token aliases.
  {
    const flat: DesignCssVar[] = Object.entries(prior.variables.custom).map(
      ([name, definition]) => ({
        name,
        value: definition.value,
        source: definition.source,
        category: definition.category,
      }),
    );
    // Also surface alias CSS values from the block so custom-source aliases stay.
    const blockVars = existingBlock
      ? extractCustomProperties(existingBlock, "aria")
      : [];
    const { remaining: blockRemaining } = groupColorVariables(blockVars);
    const byName = new Map(flat.map((v) => [v.name, v]));
    for (const variable of blockRemaining) {
      if (!byName.has(variable.name)) byName.set(variable.name, variable);
    }
    prior.variables = buildDesignVariables(
      [...byName.values()],
      meta.variables,
    );
  }
  prior.fonts =
    meta.fonts.google.length ||
    meta.fonts.custom.length ||
    (meta.fonts.fontsource ?? []).length
      ? meta.fonts
      : prior.fonts;
  prior.icons = { enabledPacks: [...meta.enabledIconPacks] };

  if (patch.colors) {
    if (patch.colors.palettes) {
      prior.colors.palettes = patch.colors.palettes.map((p) => ({
        ...p,
        source: "aria" as const,
      }));
      meta.paletteOrder = patch.colors.palettes.map((p) => p.name);
    }
    if (patch.colors.semantic) {
      prior.colors.semantic = { ...patch.colors.semantic };
    }
    if (patch.colors.adoptedFrom) {
      for (const [tokenId, adoptedFrom] of Object.entries(
        patch.colors.adoptedFrom,
      )) {
        meta.tokenPreferences[tokenId] = {
          ...(meta.tokenPreferences[tokenId] ?? {}),
          adoptedFrom: { ...adoptedFrom },
        };
      }
    }
  }
  if (patch.variables) {
    prior.variables = {
      custom: Object.fromEntries(
        Object.entries(patch.variables.custom).map(([key, definition]) => [
          key,
          { ...definition, source: "aria" as const },
        ]),
      ),
      aliases: { ...patch.variables.aliases },
    };
    meta.variables = variablesToMeta(prior.variables);
  }
  if (patch.globalStyles) {
    prior.globalStyles = mergeGlobalStyles(
      prior.globalStyles ?? createEmptyGlobalStyles(),
      patch.globalStyles,
    );
  }
  if (patch.classes) {
    prior.classes = patch.classes.map((c) => ({
      ...c,
      source: "aria" as const,
    }));
  }
  if (patch.fonts) {
    const previouslyEnabled = resolveProjectFonts(root, meta.fonts);
    const nextEnabledGoogle = new Set(
      patch.fonts.google.map((font) => font.family.trim().toLowerCase()),
    );
    const removedGoogleFamilies = previouslyEnabled.google
      .map((font) => font.family.trim())
      .filter(
        (family) => family && !nextEnabledGoogle.has(family.toLowerCase()),
      );
    const nextFontsource = new Set(
      (patch.fonts.fontsource ?? []).map(
        (font) => `${font.variable ? "v" : "s"}:${font.id.trim().toLowerCase()}`,
      ),
    );
    const removedFontsource = previouslyEnabled.fontsource.filter((font) => {
      const key = `${font.variable ? "v" : "s"}:${font.id.trim().toLowerCase()}`;
      return font.id.trim() && !nextFontsource.has(key);
    });

    prior.fonts = {
      ...patch.fonts,
      fontsource: patch.fonts.fontsource ?? [],
    };
    meta.fonts = prior.fonts;

    if (removedGoogleFamilies.length > 0) {
      // Drop site-authored @import / <link> references so discovery won't
      // resurrect deactivated fonts on the next snapshot.
      removeGoogleFontFamiliesFromProject(root, removedGoogleFamilies);
      existingContent = existsSync(absolute)
        ? readFileSync(absolute, "utf8")
        : existingContent;
    }
    if (removedFontsource.length > 0) {
      removeFontsourceFontsFromProject(root, removedFontsource);
      existingContent = existsSync(absolute)
        ? readFileSync(absolute, "utf8")
        : existingContent;
    }
  }
  if (patch.icons) {
    prior.icons = patch.icons;
    meta.enabledIconPacks = [...patch.icons.enabledPacks];
  }

  writeDesignMeta(root, meta);

  const nextContent = applyManagedBlockToFile(existingContent, prior);
  writeTextFileAtomic(absolute, nextContent);
  syncManagedTailwindThemeBridge(root, prior.colors);

  return getDesignSnapshot(root);
}

/**
 * When Composer writes markup that uses Aria BEM primitives, keep the Design
 * managed primitives CSS current. Seed it on first use; replace it when the
 * Aria defaults change so sites are not stuck with the first-seeded look.
 */
export function buildAriaBemPrimitiveStylesheetEdit(
  projectPath: string,
  pendingSources: ReadonlyMap<string, string>,
): { relativeFile: string; content: string } | null {
  if (![...pendingSources.values()].some(sourceUsesAriaBemPrimitives)) return null;
  const root = canonicalDirectory(projectPath);
  const { relativePath } = ensureDesignEntry(root);
  const absolute = resolveStylesheetAbsolute(root, relativePath);
  const existing = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
  if (!stylesheetNeedsAriaBemPrimitives(existing)) return null;
  const { block } = extractManagedBlock(existing);
  const content = applyManagedBlockToFile(existing, modelFromManagedBlockCss(block));
  if (content === existing) return null;
  return { relativeFile: relativePath, content };
}

export function applyAriaBemPrimitivesToStylesheet(content: string): string {
  if (!stylesheetNeedsAriaBemPrimitives(content)) return content;
  const { block } = extractManagedBlock(content);
  return applyManagedBlockToFile(content, modelFromManagedBlockCss(block));
}

export function previewDesignTokenMutation(
  projectPath: string,
  input: DesignTokenMutationInput,
): DesignTokenMutationPreview {
  const root = canonicalDirectory(projectPath);
  const snapshot = getDesignSnapshot(root);
  return planDesignTokenMutation(root, snapshot, input).preview;
}

export async function applyDesignTokenMutation(
  projectPath: string,
  input: DesignTokenMutationInput,
): Promise<DesignTokenMutationResult> {
  const root = canonicalDirectory(projectPath);
  const snapshot = getDesignSnapshot(root);
  const plan = planDesignTokenMutation(root, snapshot, input);
  return runProjectMutation(
    root,
    {
      actor: "user",
      surface: "design",
      operation: "edit site design token",
      targets: [plan.preview.relativeFile],
    },
    () => {
      writeTextFileAtomic(plan.absoluteFile, plan.nextContent);
      return {
        ok: true as const,
        changedFiles: [plan.preview.relativeFile],
        snapshot: getDesignSnapshot(root),
      };
    },
  );
}

export async function selectDesignTokenSource(
  projectPath: string,
  input: DesignTokenSourceSelectionInput,
): Promise<DesignTokenMutationResult> {
  const root = canonicalDirectory(projectPath);
  const snapshot = getDesignSnapshot(root);
  if (snapshot.revision !== input.expectedRevision) {
    throw new Error(
      "DESIGN_SOURCE_CONFLICT: The design index changed. Refresh and try again.",
    );
  }
  const token = snapshot.tokens.find((candidate) => candidate.id === input.tokenId);
  const source = token?.sources.find(
    (candidate) => candidate.id === input.sourceId && candidate.ownership === "site",
  );
  if (!token || !source) {
    throw new Error(
      "DESIGN_SOURCE_CONFLICT: The selected design token source no longer exists.",
    );
  }
  return runProjectMutation(
    root,
    {
      actor: "user",
      surface: "design",
      operation: "select site design token source",
      targets: [".aria/design-meta.json"],
    },
    () => {
      const meta = readDesignMeta(root);
      meta.tokenPreferences[token.id] = {
        ...(meta.tokenPreferences[token.id] ?? {}),
        preferredSourceId: source.id,
      };
      writeDesignMeta(root, meta);
      return {
        ok: true as const,
        changedFiles: [".aria/design-meta.json"],
        snapshot: getDesignSnapshot(root),
      };
    },
  );
}

export function listStylesheets(projectPath: string) {
  return listProjectStylesheets(canonicalDirectory(projectPath));
}

export { detectIconRuntime, detectFontsourceRuntime, resolveProjectIcons, searchProjectIcons };

const USAGE_SOURCE_EXTS = new Set([
  ".astro",
  ".vue",
  ".tsx",
  ".jsx",
  ".html",
  ".md",
  ".mdx",
  ".css",
  ".scss",
]);
const USAGE_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".astro",
  "dist",
  ".aria",
]);

function collectUsageReferencedNames(content: string): string[] {
  const found: string[] = [];
  for (const match of content.matchAll(
    /(?:class|className)\s*=\s*["'`]([^"'`]*)["'`]/g,
  )) {
    found.push(...match[1]!.split(/\s+/).filter(Boolean));
  }
  for (const match of content.matchAll(/class:([\w-]+)/g)) {
    found.push(match[1]!);
  }
  for (const match of content.matchAll(/@apply\s+([^;{]+)/g)) {
    for (const token of match[1]!.trim().split(/\s+/)) {
      const cleaned = token.replace(/^!/, "").trim();
      if (cleaned && !cleaned.startsWith("-")) found.push(cleaned);
    }
  }
  return found;
}

function walkUsageSourceFiles(
  dir: string,
  out: string[],
  depth = 0,
): void {
  if (depth > 40 || !existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (USAGE_SKIP_DIRS.has(entry.name)) continue;
      walkUsageSourceFiles(absolute, out, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (USAGE_SOURCE_EXTS.has(ext)) out.push(absolute);
  }
}

/** Best-effort count of class name references in project source. */
export function scanClassUsage(
  projectPath: string,
  classNames: readonly string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of classNames) counts[name] = 0;
  if (classNames.length === 0) return counts;

  const tracked = new Set(classNames);
  const root = canonicalDirectory(projectPath);
  const files: string[] = [];
  for (const rel of ["src", "styles"]) {
    walkUsageSourceFiles(path.join(root, rel), files);
  }

  for (const absolute of files) {
    let content: string;
    try {
      content = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    for (const name of collectUsageReferencedNames(content)) {
      if (!tracked.has(name)) continue;
      counts[name] = (counts[name] ?? 0) + 1;
    }
  }

  return counts;
}

export function readStylesheet(
  projectPath: string,
  relativePath: string,
): StylesheetReadResult {
  const root = canonicalDirectory(projectPath);
  const absolute = resolveStylesheetAbsolute(root, relativePath);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error("Stylesheet not found");
  }
  const stat = statSync(absolute);
  return {
    relativePath: relativePath.replace(/\\/g, "/"),
    content: readFileSync(absolute, "utf8"),
    mtimeMs: Math.floor(stat.mtimeMs),
  };
}

export function writeStylesheet(
  projectPath: string,
  relativePath: string,
  content: string,
  expectedMtimeMs?: number | null,
): StylesheetWriteResult {
  const root = canonicalDirectory(projectPath);
  const absolute = resolveStylesheetAbsolute(root, relativePath);
  if (existsSync(absolute)) {
    const currentMtime = Math.floor(statSync(absolute).mtimeMs);
    if (
      expectedMtimeMs != null &&
      Number.isFinite(expectedMtimeMs) &&
      currentMtime !== Math.floor(expectedMtimeMs)
    ) {
      const error = new Error(
        "Stylesheet changed on disk. Reload before saving.",
      ) as Error & { code: string; currentMtimeMs: number };
      error.code = "mtime_conflict";
      error.currentMtimeMs = currentMtime;
      throw error;
    }
  }
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeTextFileAtomic(absolute, content);
  const stat = statSync(absolute);
  return {
    relativePath: relativePath.replace(/\\/g, "/"),
    mtimeMs: Math.floor(stat.mtimeMs),
  };
}

export function createStylesheet(
  projectPath: string,
  name: string,
): StylesheetReadResult {
  const root = canonicalDirectory(projectPath);
  ensureStylesDirectory(root);
  const cleaned = name
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.+/, "")
    .replace(/[^a-zA-Z0-9/_-]+/g, "-")
    .replace(/^\/+|\/+$/g, "");
  if (!cleaned) throw new Error("Invalid stylesheet name");
  const withExt = cleaned.toLowerCase().endsWith(".css")
    ? cleaned
    : `${cleaned}.css`;
  const relativePath = `src/styles/${withExt}`;
  const absolute = resolveStylesheetAbsolute(root, relativePath);
  if (existsSync(absolute)) {
    throw new Error("A stylesheet with that name already exists.");
  }
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeTextFileAtomic(absolute, `/* ${path.basename(withExt)} */\n\n`, {
    overwrite: false,
  });
  return readStylesheet(root, relativePath);
}

export function deleteStylesheet(
  projectPath: string,
  relativePath: string,
): { ok: true } {
  const root = canonicalDirectory(projectPath);
  const absolute = resolveStylesheetAbsolute(root, relativePath);
  const entry = resolveDesignEntryRelativePath(root);
  const normalized = relativePath.replace(/\\/g, "/");
  if (entry && normalized === entry) {
    throw new Error("Cannot delete the design entry stylesheet.");
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error("Stylesheet not found");
  }
  removePathTracked(absolute, { force: true });
  return { ok: true };
}

export function revealStylesheet(
  projectPath: string,
  relativePath: string,
): { path: string } {
  const root = canonicalDirectory(projectPath);
  const absolute = resolveStylesheetAbsolute(root, relativePath);
  if (!existsSync(absolute)) {
    throw new Error("Stylesheet not found");
  }
  shell.showItemInFolder(absolute);
  return { path: absolute };
}

const FONT_EXTENSIONS = new Set([
  ".woff2",
  ".woff",
  ".ttf",
  ".otf",
  ".eot",
]);

function writeCustomFontFile(
  projectPath: string,
  input: { fileName: string; bytes: Uint8Array; family?: string },
): { family: string; file: string } {
  const root = canonicalDirectory(projectPath);
  const ext = path.extname(input.fileName).toLowerCase();
  if (!FONT_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported font format");
  }
  const base = path
    .basename(input.fileName, ext)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const family =
    input.family?.trim() ||
    base.replace(/[-_]+/g, " ").trim() ||
    "Custom Font";
  const fileName = `${base || "custom-font"}${ext}`;
  const fontsDir = resolveWithinRoot(root, path.join(root, "public", "fonts"), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  mkdirSync(fontsDir, { recursive: true });
  let destName = fileName;
  let dest = resolveWithinRoot(root, path.join(fontsDir, destName), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
  let suffix = 2;
  while (existsSync(dest)) {
    destName = `${base || "custom-font"}-${suffix}${ext}`;
    dest = resolveWithinRoot(root, path.join(fontsDir, destName), {
      allowMissing: true,
      rejectFinalSymlink: true,
    });
    suffix += 1;
  }
  writeBinaryFileAtomic(dest, Buffer.from(input.bytes));
  return {
    family: String(family),
    file: `fonts/${destName}`,
  };
}

/** Non-dialog font import for agent / automation (bytes already in memory). */
export function importDesignFontBytes(
  projectPath: string,
  input: { fileName: string; bytes: Uint8Array; family?: string },
): { family: string; file: string } {
  try {
    if (!input.bytes.byteLength) throw new Error("Font bytes were empty");
    return writeCustomFontFile(projectPath, input);
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to import font",
    );
  }
}

export async function uploadDesignFont(
  win: BrowserWindow | null,
  projectPath: string,
): Promise<
  | { canceled: true }
  | { family: string; file: string }
> {
  try {
    const root = canonicalDirectory(projectPath);
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: "Upload font",
          properties: ["openFile"],
          filters: [
            {
              name: "Fonts",
              extensions: ["woff2", "woff", "ttf", "otf", "eot"],
            },
          ],
        })
      : await dialog.showOpenDialog({
          title: "Upload font",
          properties: ["openFile"],
          filters: [
            {
              name: "Fonts",
              extensions: ["woff2", "woff", "ttf", "otf", "eot"],
            },
          ],
        });
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true };
    }
    const source = result.filePaths[0];
    const ext = path.extname(source).toLowerCase();
    if (!FONT_EXTENSIONS.has(ext)) {
      throw new Error("Unsupported font format");
    }
    const bytes = new Uint8Array(readFileSync(source));
    return importDesignFontBytes(root, {
      fileName: path.basename(source),
      bytes,
    });
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Failed to upload font",
    );
  }
}

function resolveCustomFontAbsolute(
  projectPath: string,
  relativeFile: string,
): string {
  const root = canonicalDirectory(projectPath);
  const normalized = relativeFile.replace(/\\/g, "/").replace(/^\/+/, "");
  const allowedPrefix =
    normalized.startsWith("fonts/") || normalized.startsWith("uploads/");
  if (!allowedPrefix || normalized.includes("..")) {
    throw new Error("Invalid font path");
  }
  return resolveWithinRoot(root, path.join(root, "public", normalized), {
    allowMissing: true,
    rejectFinalSymlink: true,
  });
}

export function revealDesignFont(
  projectPath: string,
  relativeFile: string,
): { path: string } {
  const absolute = resolveCustomFontAbsolute(projectPath, relativeFile);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error("Font file not found");
  }
  shell.showItemInFolder(absolute);
  return { path: absolute };
}

export function deleteDesignFont(
  projectPath: string,
  relativeFile: string,
): { ok: true } {
  const absolute = resolveCustomFontAbsolute(projectPath, relativeFile);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error("Font file not found");
  }
  removePathTracked(absolute, { force: true });
  return { ok: true };
}
