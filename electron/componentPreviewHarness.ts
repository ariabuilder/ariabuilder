import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  COMPOSER_COMPONENT_AUTHORING_ROUTE,
  COMPOSER_COMPONENT_THUMBNAIL_ROUTE,
  deriveComposerComponentPreviewData,
  mergeComposerComponentPreviewData,
  previewDatePropKeys,
  previewDateRevivalSource,
  type ComposerComponentPreviewData,
  type ComposerComponentPreviewSession,
} from "../shared/composer/componentAuthoring";
import { extractPropSchema } from "../shared/composer/props";
import {
  canonicalDirectory,
  removePathTracked,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";

export const COMPONENT_PREVIEW_ROUTE = COMPOSER_COMPONENT_THUMBNAIL_ROUTE;
export const COMPONENT_AUTHORING_ROUTE = COMPOSER_COMPONENT_AUTHORING_ROUTE;
export const COMPONENT_PREVIEW_DIR_NAME = "aria-preview";
export const COMPONENT_THUMB_VERSION = 5;

export const COMPONENT_THUMB_ENTRY_REL =
  "node_modules/.aria/component-thumbnail.astro";
export const COMPONENT_AUTHORING_ENTRY_REL =
  "node_modules/.aria/component-authoring.astro";

const LEGACY_HARNESS_REL = "src/pages/aria-preview/component.astro";
const LEGACY_SIGNATURE = "Aria-managed component preview harness (v";
const GENERATED_DIR_POSIX = "node_modules/.aria";

const STYLE_CANDIDATES = [
  "src/styles/global.css",
  "src/styles/globals.css",
  "src/styles/index.css",
  "src/index.css",
] as const;

export function isSafeComponentId(value: string): boolean {
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized.startsWith("src/components/") && !normalized.startsWith("src/layouts/")) {
    return false;
  }
  if (normalized.includes("..") || normalized.includes("\0")) return false;
  return /\.astro$/i.test(normalized);
}

function importSpecifierFromGenerated(projectRelPosix: string): string {
  const rel = path.posix.relative(GENERATED_DIR_POSIX, projectRelPosix);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function collectStyleImports(root: string): string[] {
  return STYLE_CANDIDATES.filter((candidate) =>
    existsSync(path.join(root, ...candidate.split("/"))),
  ).map(importSpecifierFromGenerated);
}

function styleLines(styleImports: readonly string[]): string {
  return styleImports.map((specifier) => `import ${JSON.stringify(specifier)};`).join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function slotMarkup(data: ComposerComponentPreviewData): string {
  const entries = Object.entries(data.slots);
  if (!entries.length) return "";
  return entries
    .map(([name, value]) =>
      name === "default"
        ? escapeHtml(value)
        : `<Fragment slot=${JSON.stringify(name)}>${escapeHtml(value)}</Fragment>`,
    )
    .join("\n  ");
}

function catalogComponentIds(componentIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of componentIds) {
    const id = raw.trim().replace(/\\/g, "/");
    if (!isSafeComponentId(id) || !id.startsWith("src/components/") || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  ids.sort();
  return ids;
}

function catalogLoaderEntries(componentIds: readonly string[]): string {
  return catalogComponentIds(componentIds)
    .map((id) => {
      const specifier = importSpecifierFromGenerated(id);
      return `  ${JSON.stringify(id)}: () => import(${JSON.stringify(specifier)}),`;
    })
    .join("\n");
}

/** Stable catalog harness: pick the target with `?id=` instead of rewriting per capture. */
export function buildComponentPreviewHarnessSource(
  componentIds: readonly string[],
  styleImports: string[] = [],
): string {
  const styles = styleLines(styleImports);
  const loaders = catalogLoaderEntries(componentIds);
  return `---
/** Aria-managed ephemeral component thumbnail (v${COMPONENT_THUMB_VERSION}). */
${styles ? `${styles}\n` : ""}const loaders = {
${loaders}
};
const rawId = Astro.url.searchParams.get("id") ?? "";
const id = rawId.replace(/\\\\/g, "/");
const loader = Object.prototype.hasOwnProperty.call(loaders, id) ? loaders[id] : undefined;
let Component = null;
let ok = false;
if (typeof loader === "function") {
  const mod = await loader();
  Component = mod.default;
  ok = Boolean(Component);
}
---
<!doctype html>
<html lang="en" data-aria-component-thumb-version="${COMPONENT_THUMB_VERSION}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Aria component thumbnail</title>
    <style is:global>
      html, body { margin: 0; min-height: 100%; background: #fff; }
      .aria-component-preview-root { box-sizing: border-box; min-height: 100vh; padding: 24px; display: flex; align-items: flex-start; justify-content: center; }
    </style>
  </head>
  <body>
    <div class="aria-component-preview-root" data-aria-component-preview={id} data-aria-component-preview-ok={ok ? "1" : "0"}>
      {ok && Component ? <Component /> : null}
    </div>
  </body>
</html>
`;
}

export function buildComponentAuthoringHarnessSource(
  componentId: string,
  data: ComposerComponentPreviewData,
  styleImports: string[] = [],
  datePropKeys: readonly string[] = [],
): string {
  const id = componentId.trim().replace(/\\/g, "/");
  if (!isSafeComponentId(id)) throw new Error("Invalid component id for authoring harness");
  const styles = styleLines(styleImports);
  const children = slotMarkup(data);
  const invocation = children
    ? `<Component {...ariaPreviewProps}>\n  ${children}\n</Component>`
    : `<Component {...ariaPreviewProps} />`;
  return `---
/** Aria-managed ephemeral component authoring route. Never copied into project source. */
${styles ? `${styles}\n` : ""}import Component from ${JSON.stringify(importSpecifierFromGenerated(id))};
const ariaPreviewProps = ${JSON.stringify(data.props)};${previewDateRevivalSource(datePropKeys)}
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Aria component authoring</title>
    <style is:global>
      html, body { margin: 0; min-height: 100%; width: 100%; }
      body { min-height: 100vh; }
    </style>
  </head>
  <body data-aria-component-authoring=${JSON.stringify(id)}>
    ${invocation}
  </body>
</html>
`;
}

function placeholderSource(kind: "thumbnail" | "authoring"): string {
  return `---\n/** Aria-managed ephemeral ${kind} route. */\n---\n<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Aria ${kind}</title></head><body></body></html>\n`;
}

function generatedAbsolute(root: string, relative: string): string {
  return resolveWithinRoot(root, path.join(root, ...relative.split("/")), { allowMissing: true });
}

/** Remove only the exact legacy Aria harness; user files in that folder survive. */
export function migrateLegacyComponentPreviewHarness(projectPath: string): boolean {
  const root = canonicalDirectory(projectPath);
  const absolute = generatedAbsolute(root, LEGACY_HARNESS_REL);
  if (!existsSync(absolute)) return false;
  let source = "";
  try { source = readFileSync(absolute, "utf8"); } catch { return false; }
  if (!source.includes(LEGACY_SIGNATURE)) return false;
  removePathTracked(absolute);
  const parent = path.dirname(absolute);
  try {
    if (readdirSync(parent).length === 0) removePathTracked(parent);
  } catch { /* best effort */ }
  return true;
}

export function ensureComponentPreviewEntrypoints(projectPath: string): {
  thumbnail: string;
  authoring: string;
} {
  const root = canonicalDirectory(projectPath);
  migrateLegacyComponentPreviewHarness(root);
  const thumbnail = generatedAbsolute(root, COMPONENT_THUMB_ENTRY_REL);
  const authoring = generatedAbsolute(root, COMPONENT_AUTHORING_ENTRY_REL);
  mkdirSync(path.dirname(thumbnail), { recursive: true });
  if (!existsSync(thumbnail)) writeTextFileAtomic(thumbnail, placeholderSource("thumbnail"));
  if (!existsSync(authoring)) writeTextFileAtomic(authoring, placeholderSource("authoring"));
  return { thumbnail, authoring };
}

export type EnsureHarnessResult = { absolutePath: string; written: boolean };

export function ensureComponentPreviewHarness(
  projectPath: string,
  componentIds: readonly string[],
): EnsureHarnessResult {
  const root = canonicalDirectory(projectPath);
  const { thumbnail: absolute } = ensureComponentPreviewEntrypoints(root);
  const source = buildComponentPreviewHarnessSource(
    componentIds,
    collectStyleImports(root),
  );
  const existing = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
  if (existing === source) return { absolutePath: absolute, written: false };
  writeTextFileAtomic(absolute, source, { overwrite: true });
  return { absolutePath: absolute, written: true };
}

export function prepareComponentAuthoringPreview(
  projectPath: string,
  componentId: string,
  override?: Partial<Pick<ComposerComponentPreviewData, "props" | "slots">> | null,
): ComposerComponentPreviewSession {
  const root = canonicalDirectory(projectPath);
  const id = componentId.trim().replace(/\\/g, "/");
  if (!isSafeComponentId(id)) throw new Error("Invalid component id for authoring preview");
  const componentAbsolute = generatedAbsolute(root, id);
  if (!existsSync(componentAbsolute)) throw new Error("Component source no longer exists");
  const schema = extractPropSchema(readFileSync(componentAbsolute, "utf8"));
  const generated = deriveComposerComponentPreviewData(schema.fields, schema.slots);
  const data = mergeComposerComponentPreviewData(generated, override);
  const { authoring } = ensureComponentPreviewEntrypoints(root);
  writeTextFileAtomic(
    authoring,
    buildComponentAuthoringHarnessSource(
      id,
      data,
      collectStyleImports(root),
      previewDatePropKeys(schema.fields),
    ),
    { overwrite: true },
  );
  return {
    componentFile: id,
    route: COMPONENT_AUTHORING_ROUTE,
    revision: statSync(authoring).mtimeMs,
    data,
  };
}

export { isAriaManagedRoute } from "../shared/composer/componentAuthoring";
