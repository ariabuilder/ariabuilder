import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  deriveComposerComponentPreviewData,
  previewDatePropKeys,
  previewDateRevivalSource,
  type ComposerPreviewValue,
} from "../shared/composer/componentAuthoring";
import { buildComposerLayoutContract } from "../shared/composer/layoutAuthoring";
import { parseAstro } from "../shared/composer/parseAstro";
import {
  canonicalDirectory,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";

export const LAYOUT_PREVIEW_ROUTE = "/aria-preview/layout";
export const LAYOUT_THUMB_VERSION = 1;
export const LAYOUT_THUMB_ENTRY_REL = "node_modules/.aria/layout-thumbnail.astro";

const GENERATED_DIR_POSIX = "node_modules/.aria";
const STYLE_CANDIDATES = [
  "src/styles/global.css",
  "src/styles/globals.css",
  "src/styles/index.css",
  "src/index.css",
] as const;

export type LayoutHarnessSlot = {
  name: string | null;
  label: string;
};

export type LayoutPreviewHarnessResult = {
  absolutePath: string;
  written: boolean;
  layoutId: string;
  mtimeMs: number;
};

function placeholderSource(): string {
  return `---\n/** Aria-managed ephemeral layout thumbnail route. */\n---\n<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Aria layout thumbnail</title></head><body></body></html>\n`;
}

export function isSafeLayoutId(value: string): boolean {
  const normalized = value.trim().replace(/\\/g, "/");
  return (
    normalized.startsWith("src/layouts/") &&
    !normalized.includes("..") &&
    !normalized.includes("\0") &&
    /\.astro$/i.test(normalized)
  );
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

function specimenMarkup(slot: LayoutHarnessSlot, layoutId: string): string {
  const label = escapeHtml(slot.label);
  const name = slot.name ?? "default";
  const block = `<div class="aria-layout-specimen aria-layout-specimen--${slot.name ? "named" : "default"}" data-aria-layout-specimen=${JSON.stringify(layoutId)} data-aria-layout-slot=${JSON.stringify(name)}>
    <span class="aria-layout-specimen__label">${label}</span>
    <span class="aria-layout-specimen__line aria-layout-specimen__line--strong"></span>
    <span class="aria-layout-specimen__line"></span>
    ${slot.name ? "" : '<span class="aria-layout-specimen__line aria-layout-specimen__line--short"></span>'}
  </div>`;
  return slot.name
    ? `<Fragment slot=${JSON.stringify(slot.name)}>${block}</Fragment>`
    : block;
}

export function buildLayoutPreviewHarnessSource(input: {
  layoutId: string;
  props: Record<string, ComposerPreviewValue>;
  slots: LayoutHarnessSlot[];
  styleImports?: string[];
  datePropKeys?: readonly string[];
}): string {
  const id = input.layoutId.trim().replace(/\\/g, "/");
  if (!isSafeLayoutId(id)) throw new Error("Invalid layout id for preview harness");
  const styles = styleLines(input.styleImports ?? []);
  const children = input.slots.map((slot) => specimenMarkup(slot, id)).join("\n  ");
  const invocation = children
    ? `<Layout {...ariaPreviewProps}>\n  ${children}\n</Layout>`
    : `<Layout {...ariaPreviewProps} />`;

  return `---
/** Aria-managed ephemeral layout thumbnail (v${LAYOUT_THUMB_VERSION}). */
${styles ? `${styles}\n` : ""}import Layout from ${JSON.stringify(importSpecifierFromGenerated(id))};
const ariaPreviewProps = ${JSON.stringify(input.props)};${previewDateRevivalSource(input.datePropKeys ?? [])}
---
<style is:global>
  .aria-layout-specimen {
    box-sizing: border-box;
    min-width: 0;
    border: 2px dashed oklch(0.67 0.13 188 / 0.82);
    border-radius: 10px;
    background: oklch(0.92 0.035 188 / 0.88);
    color: oklch(0.32 0.055 188);
    padding: 18px;
    font: 600 14px/1.2 ui-sans-serif, system-ui, sans-serif;
  }
  .aria-layout-specimen--default { min-height: 320px; }
  .aria-layout-specimen--named { min-height: 108px; }
  .aria-layout-specimen__label { display: block; margin-block-end: 24px; }
  .aria-layout-specimen__line {
    display: block;
    width: min(72%, 560px);
    height: 10px;
    margin-block: 12px;
    border-radius: 999px;
    background: currentColor;
    opacity: 0.18;
  }
  .aria-layout-specimen__line--strong { width: min(46%, 360px); height: 16px; opacity: 0.3; }
  .aria-layout-specimen__line--short { width: min(58%, 440px); }
  @media (prefers-color-scheme: dark) {
    .aria-layout-specimen {
      background: oklch(0.32 0.045 188 / 0.9);
      color: oklch(0.88 0.055 188);
    }
  }
</style>
${invocation}
<script is:inline>document.documentElement.dataset.ariaLayoutPreview = ${JSON.stringify(id)};</script>
`;
}

export function ensureLayoutPreviewEntrypoint(projectPath: string): string {
  const root = canonicalDirectory(projectPath);
  const absolutePath = resolveWithinRoot(root, LAYOUT_THUMB_ENTRY_REL, {
    allowMissing: true,
  });
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  if (!existsSync(absolutePath)) {
    writeTextFileAtomic(absolutePath, placeholderSource(), { overwrite: false });
  }
  return absolutePath;
}

export async function ensureLayoutPreviewHarness(
  projectPath: string,
  layoutId: string,
): Promise<LayoutPreviewHarnessResult> {
  const root = canonicalDirectory(projectPath);
  const id = layoutId.trim().replace(/\\/g, "/");
  if (!isSafeLayoutId(id)) throw new Error("Invalid layout id for preview harness");
  const layoutAbsolute = resolveWithinRoot(root, id, { rejectFinalSymlink: true });
  const source = readFileSync(layoutAbsolute, "utf8");
  const parsed = await parseAstro(source, { filename: layoutAbsolute });
  if (!parsed.editable) throw new Error(parsed.reason);

  const contract = buildComposerLayoutContract(parsed.model);
  const slots = contract.slots
    .filter((slot) => slot.static)
    .map((slot) => ({ name: slot.name, label: slot.label }));
  const data = deriveComposerComponentPreviewData(
    parsed.model.propSchema,
    slots.map((slot) => slot.name ?? "default"),
  );
  const generated = buildLayoutPreviewHarnessSource({
    layoutId: id,
    props: data.props,
    slots,
    styleImports: collectStyleImports(root),
    datePropKeys: previewDatePropKeys(parsed.model.propSchema),
  });
  const absolutePath = ensureLayoutPreviewEntrypoint(root);
  const existing = existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
  const written = existing !== generated;
  if (written) writeTextFileAtomic(absolutePath, generated, { overwrite: true });
  return {
    absolutePath,
    written,
    layoutId: id,
    mtimeMs: statSync(layoutAbsolute).mtimeMs,
  };
}
