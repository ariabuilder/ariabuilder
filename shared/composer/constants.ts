/** Dev-only selection markers (Vite plugin). Never written to disk via serializeAstro. */
export const ARIA_MARKER_START = "data-aria-s";
export const ARIA_MARKER_END = "data-aria-e";

/**
 * Stamped on live DOM after markers are stripped (Phase 1 design client).
 * Survives page-script DOM rewrites better than holding node references alone.
 */
export const ARIA_PATH_ATTR = "data-aria-p";

/** Persisted authoring metadata used only to name a node in Composer Layers. */
export const ARIA_LAYER_LABEL_ATTR = "data-aria-layer-label";

/** Query/hash used by Phase 1 design-mode preview (documented early for bridge note). */
export const ARIA_DESIGN_HASH = "aria-design";

/** Alternate design-mode query flag (`?aria-design` / `?aria-design=1`). */
export const ARIA_DESIGN_QUERY = "aria-design";

/** Ephemeral override dir under the project (`node_modules/.aria/`). */
export const ARIA_MARKER_DIR = ".aria";

export const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export const RAW_ELEMENTS = new Set(["style", "script"]);

export const INLINE_TAGS = new Set([
  "strong",
  "em",
  "b",
  "i",
  "sup",
  "sub",
  "code",
  "a",
  "span",
  "br",
  "img",
  "small",
  "mark",
  "u",
  "s",
]);

/** Explicit rejection of DSL sidecar as document source of truth. */
export const COMPOSER_SOT_POLICY = {
  documentSot: ".astro on disk",
  rejectedSidecar: ".aria/composer/*.json",
  reason:
    "Composer edits persist only as idiomatic .astro. A JSON DSL sidecar must not be introduced as SoT.",
} as const;
