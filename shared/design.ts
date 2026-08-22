/** Shared design-system types for Electron main + renderer. */

export type DesignValueSource = "site" | "aria";

export type DesignSectionId =
  | "stylesheets"
  | "colors"
  | "typography"
  | "global-styles"
  | "icons"
  | "class-manager"
  | "variable-manager";

export type StylesheetInfo = {
  /** Project-relative posix path, e.g. `src/styles/global.css`. */
  relativePath: string;
  bytes: number;
  mtimeMs: number;
  /** True when this is the design-system entry (managed-block target). */
  isEntry: boolean;
};

export type DesignCssVarCategory =
  | "color"
  | "spacing"
  | "typography"
  | "borders"
  | "effects"
  | "layout"
  | "other";

export type DesignCssVar = {
  /** Custom property name without leading `--`. */
  name: string;
  value: string;
  source: DesignValueSource;
  category: DesignCssVarCategory;
};

/** Custom CSS variable managed in Variable Manager (value lives in CSS). */
export type DesignVariableDefinition = {
  label: string;
  value: string;
  category: DesignCssVarCategory;
  source: DesignValueSource;
  description?: string;
};

/**
 * Alias that points at another custom variable or a design token.
 * `sourceKey` may be empty for draft aliases created in Variable Manager
 * before the user chooses a source.
 */
export type DesignVariableAlias = {
  label: string;
  sourceType: "token" | "custom";
  sourceKey: string;
  fallback?: string;
};

export type DesignVariables = {
  custom: Record<string, DesignVariableDefinition>;
  aliases: Record<string, DesignVariableAlias>;
};

/**
 * Labels + alias metadata persisted in `.aria/design-meta.json`.
 * CSS values still live in the managed stylesheet block.
 */
export type DesignVariablesMeta = {
  custom: Record<
    string,
    {
      label: string;
      category: DesignCssVarCategory;
      description?: string;
    }
  >;
  aliases: Record<string, DesignVariableAlias>;
};

export const EMPTY_DESIGN_VARIABLES: DesignVariables = {
  custom: {},
  aliases: {},
};

export const EMPTY_DESIGN_VARIABLES_META: DesignVariablesMeta = {
  custom: {},
  aliases: {},
};

export type ColorShadeKey =
  | "25"
  | "50"
  | "100"
  | "200"
  | "300"
  | "400"
  | "500"
  | "600"
  | "700"
  | "800"
  | "900"
  | "950"
  | "DEFAULT";

export type DesignColorPalette = {
  id: string;
  name: string;
  shades: Partial<Record<ColorShadeKey, string>>;
  source: DesignValueSource;
};

/**
 * Color families referenced in site CSS (Tailwind utilities / @apply)
 * without a resolvable CSS custom-property value.
 */
export type DesignColorTokenReference = {
  family: string;
  shades: string[];
  count: number;
  /** Resolved preview swatches when CSS vars exist for this family. */
  preview: string[];
};

export type DesignTokenProviderId =
  | "aria-css"
  | "css"
  | "tailwind-config"
  | "tailwind-theme";

export type DesignTokenMode = {
  id: string;
  label: string;
  selector?: string;
  media?: string;
};

export type DesignTokenSource = {
  id: string;
  provider: DesignTokenProviderId;
  relativeFile: string;
  pointer: string;
  sourceHash: string;
  ownership: DesignValueSource;
  writable: boolean;
  writeReason?: string;
  mode: DesignTokenMode;
  authoredValue: string;
  resolvedValue?: string;
  valueRange?: { from: number; to: number };
  syntax?: "css" | "single-quoted" | "double-quoted" | "template";
};

/** Normalized token projected from one or more site/Aria source files. */
export type DesignToken = {
  id: string;
  category: DesignCssVarCategory;
  family: string;
  shade: ColorShadeKey;
  sources: DesignTokenSource[];
  activeSourceId: string | null;
  ambiguous: boolean;
  usageCount: number;
  usedIn: string[];
};

export type DesignSourceSummary = {
  id: string;
  provider: DesignTokenProviderId;
  relativeFile: string;
  sourceHash: string;
  writable: boolean;
  diagnostics: string[];
};

export type DesignDiagnostic = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  relativeFile?: string;
  pointer?: string;
  tokenId?: string;
};

export type DesignTokenPreference = {
  preferredSourceId?: string;
  adoptedFrom?: {
    provider: DesignTokenProviderId;
    relativeFile: string;
    pointer: string;
    sourceHash: string;
  };
};

export type DesignTokenMutationInput = {
  tokenId: string;
  sourceId: string;
  value: string;
  expectedRevision: string;
  expectedSourceHash: string;
};

export type DesignTokenSourceSelectionInput = {
  tokenId: string;
  sourceId: string;
  expectedRevision: string;
};

export type DesignTokenMutationPreview = {
  tokenId: string;
  sourceId: string;
  relativeFile: string;
  pointer: string;
  beforeValue: string;
  afterValue: string;
  expectedRevision: string;
  expectedSourceHash: string;
};

export type DesignTokenMutationResult = {
  ok: true;
  changedFiles: string[];
  snapshot: DesignSnapshot;
};

export type DesignSemanticColors = {
  success?: string;
  warning?: string;
  error?: string;
  info?: string;
};

/** Known global-style element keys (non-opinionated — empty until set). */
export type GlobalStyleElementKey =
  | "root"
  | "body"
  | "heading"
  | "subheading"
  | "paragraph"
  | "link"
  | "button"
  | "input"
  | "section"
  | "container";

export const GLOBAL_STYLE_BUTTON_VARIANTS = [
  "primary",
  "secondary",
  "muted",
  "destructive",
  "disabled",
] as const;

export type GlobalStyleButtonVariant =
  (typeof GLOBAL_STYLE_BUTTON_VARIANTS)[number];

export type BodyGlobalStyle = {
  backgroundColor: string;
  color: string;
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: string;
  letterSpacing: string;
  maxWidth: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  overflowX: string;
  overflowY: string;
  fontSmoothing: string;
  textWrap: string;
};

export type HeadingGlobalStyle = {
  color: string;
  fontFamily: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
  textWrap: string;
};

export type SubheadingGlobalStyle = {
  color: string;
  fontFamily: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
};

export type ParagraphGlobalStyle = {
  color: string;
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  letterSpacing: string;
  maxWidth: string;
  textWrap: string;
};

export type LinkGlobalStyle = {
  color: string;
  hoverColor: string;
  visitedColor: string;
  textDecoration: string;
  underlineOffset: string;
  fontWeight: string;
};

export type ButtonVariantGlobalStyle = {
  backgroundColor: string;
  color: string;
  borderColor: string;
  hoverBackgroundColor: string;
  hoverColor: string;
  hoverBorderColor: string;
};

export type ButtonBaseGlobalStyle = {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  borderRadius: string;
  paddingX: string;
  paddingY: string;
  borderWidth: string;
};

export type ButtonGlobalStyle = {
  base: ButtonBaseGlobalStyle;
  variants: Record<GlobalStyleButtonVariant, ButtonVariantGlobalStyle>;
};

export type InputGlobalStyle = {
  backgroundColor: string;
  color: string;
  placeholderColor: string;
  borderColor: string;
  borderRadius: string;
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
  paddingX: string;
  paddingY: string;
  focusRingColor: string;
};

export type SectionGlobalStyle = {
  contentMaxWidth: string;
  horizontalPadding: string;
  verticalPadding: string;
  sectionGap: string;
};

export type ContainerGlobalStyle = {
  maxWidth: string;
  width: string;
};

export type RootGlobalStyle = {
  fontSize: string;
  margin: string;
  padding: string;
  cursor: string;
  caretColor: string;
  selectionColor: string;
  selectionBackgroundColor: string;
  scrollBehavior: string;
  outlineColor: string;
  outlineWidth: string;
  outlineStyle: string;
  borderColor: string;
  borderRadius: string;
};

/** Typed site-wide element defaults (empty string = unset). */
export type DesignGlobalStyles = {
  body: BodyGlobalStyle;
  heading: HeadingGlobalStyle;
  subheading: SubheadingGlobalStyle;
  paragraph: ParagraphGlobalStyle;
  link: LinkGlobalStyle;
  button: ButtonGlobalStyle;
  input: InputGlobalStyle;
  section: SectionGlobalStyle;
  container: ContainerGlobalStyle;
  root: RootGlobalStyle;
};

function emptyButtonVariant(): ButtonVariantGlobalStyle {
  return {
    backgroundColor: "",
    color: "",
    borderColor: "",
    hoverBackgroundColor: "",
    hoverColor: "",
    hoverBorderColor: "",
  };
}

/** Empty (unset) global styles — leave site CSS alone until values are set. */
export function createEmptyGlobalStyles(): DesignGlobalStyles {
  return {
    body: {
      backgroundColor: "",
      color: "",
      fontFamily: "",
      fontSize: "",
      lineHeight: "",
      fontWeight: "",
      letterSpacing: "",
      maxWidth: "",
      marginTop: "",
      marginRight: "",
      marginBottom: "",
      marginLeft: "",
      paddingTop: "",
      paddingRight: "",
      paddingBottom: "",
      paddingLeft: "",
      overflowX: "",
      overflowY: "",
      fontSmoothing: "",
      textWrap: "",
    },
    heading: {
      color: "",
      fontFamily: "",
      fontWeight: "",
      lineHeight: "",
      letterSpacing: "",
      textTransform: "",
      textWrap: "",
    },
    subheading: {
      color: "",
      fontFamily: "",
      fontWeight: "",
      lineHeight: "",
      letterSpacing: "",
    },
    paragraph: {
      color: "",
      fontFamily: "",
      fontSize: "",
      lineHeight: "",
      letterSpacing: "",
      maxWidth: "",
      textWrap: "",
    },
    link: {
      color: "",
      hoverColor: "",
      visitedColor: "",
      textDecoration: "",
      underlineOffset: "",
      fontWeight: "",
    },
    button: {
      base: {
        fontFamily: "",
        fontSize: "",
        fontWeight: "",
        lineHeight: "",
        letterSpacing: "",
        borderRadius: "",
        paddingX: "",
        paddingY: "",
        borderWidth: "",
      },
      variants: {
        primary: emptyButtonVariant(),
        secondary: emptyButtonVariant(),
        muted: emptyButtonVariant(),
        destructive: emptyButtonVariant(),
        disabled: emptyButtonVariant(),
      },
    },
    input: {
      backgroundColor: "",
      color: "",
      placeholderColor: "",
      borderColor: "",
      borderRadius: "",
      fontFamily: "",
      fontSize: "",
      lineHeight: "",
      paddingX: "",
      paddingY: "",
      focusRingColor: "",
    },
    section: {
      contentMaxWidth: "",
      horizontalPadding: "",
      verticalPadding: "",
      sectionGap: "",
    },
    container: {
      maxWidth: "",
      width: "",
    },
    root: {
      fontSize: "",
      margin: "",
      padding: "",
      cursor: "",
      caretColor: "",
      selectionColor: "",
      selectionBackgroundColor: "",
      scrollBehavior: "",
      outlineColor: "",
      outlineWidth: "",
      outlineStyle: "",
      borderColor: "",
      borderRadius: "",
    },
  };
}

export const EMPTY_DESIGN_GLOBAL_STYLES: DesignGlobalStyles =
  createEmptyGlobalStyles();

/** Deep-clone global styles (structuredClone-safe plain data). */
export function cloneGlobalStyles(
  styles: DesignGlobalStyles,
): DesignGlobalStyles {
  return structuredClone(styles);
}

type LegacyBodySpacing = BodyGlobalStyle & {
  margin?: string;
  padding?: string;
};

function expandSpacingShorthand(shorthand: string): {
  top: string;
  right: string;
  bottom: string;
  left: string;
} {
  const parts = shorthand.trim().split(/\s+/).filter(Boolean);
  switch (parts.length) {
    case 1:
      return { top: parts[0]!, right: parts[0]!, bottom: parts[0]!, left: parts[0]! };
    case 2:
      return { top: parts[0]!, right: parts[1]!, bottom: parts[0]!, left: parts[1]! };
    case 3:
      return { top: parts[0]!, right: parts[1]!, bottom: parts[2]!, left: parts[1]! };
    case 4:
      return { top: parts[0]!, right: parts[1]!, bottom: parts[2]!, left: parts[3]! };
    default:
      return { top: "", right: "", bottom: "", left: "" };
  }
}

function expandLegacyBodySpacing(body: LegacyBodySpacing): BodyGlobalStyle {
  const next: LegacyBodySpacing = { ...body };
  if (next.margin?.trim()) {
    const sides = expandSpacingShorthand(next.margin);
    next.marginTop ||= sides.top;
    next.marginRight ||= sides.right;
    next.marginBottom ||= sides.bottom;
    next.marginLeft ||= sides.left;
  }
  if (next.padding?.trim()) {
    const sides = expandSpacingShorthand(next.padding);
    next.paddingTop ||= sides.top;
    next.paddingRight ||= sides.right;
    next.paddingBottom ||= sides.bottom;
    next.paddingLeft ||= sides.left;
  }
  delete next.margin;
  delete next.padding;
  return next;
}

/** Merge `patch` over `base`, keeping nested button variants intact. */
export function mergeGlobalStyles(
  base: DesignGlobalStyles,
  patch: Partial<DesignGlobalStyles> | DesignGlobalStyles,
): DesignGlobalStyles {
  const next = cloneGlobalStyles(base);
  if (patch.body) next.body = expandLegacyBodySpacing({ ...next.body, ...patch.body });
  if (patch.heading) next.heading = { ...next.heading, ...patch.heading };
  if (patch.subheading)
    next.subheading = { ...next.subheading, ...patch.subheading };
  if (patch.paragraph)
    next.paragraph = { ...next.paragraph, ...patch.paragraph };
  if (patch.link) next.link = { ...next.link, ...patch.link };
  if (patch.input) next.input = { ...next.input, ...patch.input };
  if (patch.section) next.section = { ...next.section, ...patch.section };
  if (patch.container)
    next.container = { ...next.container, ...patch.container };
  if (patch.root) next.root = { ...next.root, ...patch.root };
  if (patch.button) {
    next.button = {
      base: { ...next.button.base, ...(patch.button.base ?? {}) },
      variants: { ...next.button.variants },
    };
    for (const variant of GLOBAL_STYLE_BUTTON_VARIANTS) {
      const incoming = patch.button.variants?.[variant];
      if (incoming) {
        next.button.variants[variant] = {
          ...next.button.variants[variant],
          ...incoming,
        };
      }
    }
  }
  return next;
}

export type DesignClassRule = {
  name: string;
  css: string;
  source: DesignValueSource;
  /** Project-relative stylesheet containing the winning rule. */
  relativeFile?: string;
};

export type DesignClassRenameResult =
  | {
      ok: true;
      from: string;
      to: string;
      rewrittenFiles: string[];
      designRenamed: boolean;
    }
  | {
      ok: false;
      code: "CONFLICT" | "INVALID_INPUT";
      message: string;
      currentVersion?: string;
    };

export type DesignGoogleFont = {
  family: string;
  weights: number[];
};

export type DesignCustomFont = {
  family: string;
  /** Project-relative path to the font file. */
  file: string;
};

export type DesignFontsourceFont = {
  /** Fontsource family id, e.g. `open-sans`. */
  id: string;
  family: string;
  variable: boolean;
};

/** Resolve the family name declared by Fontsource package CSS. */
export function fontsourceCssFamily(
  font: Pick<DesignFontsourceFont, "family" | "variable">,
): string {
  const family = font.family.trim();
  if (!family || !font.variable || /\sVariable$/i.test(family)) return family;
  return `${family} Variable`;
}

export type DesignFonts = {
  google: DesignGoogleFont[];
  custom: DesignCustomFont[];
  fontsource: DesignFontsourceFont[];
  bodyFamily?: string;
  headingFamily?: string;
};

const FONTSOURCE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

/** Normalize a Fontsource family id (`Open Sans`, `@fontsource/open-sans/400.css` → `open-sans`). */
export function normalizeFontsourceId(raw: string): string {
  let value = raw.trim().toLowerCase();
  value = value
    .replace(/^@fontsource-variable\//, "")
    .replace(/^@fontsource\//, "");
  const slash = value.indexOf("/");
  if (slash >= 0) value = value.slice(0, slash);
  return FONTSOURCE_ID_RE.test(value) ? value : "";
}

export function fontsourcePackageName(
  font: Pick<DesignFontsourceFont, "id" | "variable">,
): string {
  const id = normalizeFontsourceId(font.id);
  return font.variable ? `@fontsource-variable/${id}` : `@fontsource/${id}`;
}

export function fontsourceCssImport(
  font: Pick<DesignFontsourceFont, "id" | "variable">,
): string {
  return `@import "${fontsourcePackageName(font)}";`;
}

export function fontsourceCdnStylesheetUrl(
  font: Pick<DesignFontsourceFont, "id" | "variable">,
): string | null {
  const id = normalizeFontsourceId(font.id);
  if (!id) return null;
  const encoded = encodeURIComponent(id);
  return font.variable
    ? `https://cdn.jsdelivr.net/fontsource/css/${encoded}:vf@latest/index.css`
    : `https://cdn.jsdelivr.net/fontsource/css/${encoded}@latest/index.css`;
}

/** Copy a fonts record, filling `fontsource` when older snapshots omit it. */
export function cloneDesignFonts(
  fonts: DesignFonts,
  patch: Partial<DesignFonts> = {},
): DesignFonts {
  return {
    google: patch.google ?? fonts.google.map((font) => ({ ...font, weights: [...font.weights] })),
    custom: patch.custom ?? fonts.custom.map((font) => ({ ...font })),
    fontsource:
      patch.fontsource ??
      (fonts.fontsource ?? []).map((font) => ({ ...font })),
    bodyFamily: "bodyFamily" in patch ? patch.bodyFamily : fonts.bodyFamily,
    headingFamily: "headingFamily" in patch ? patch.headingFamily : fonts.headingFamily,
  };
}

/** Google Fonts CSS endpoint for an enabled design-font set. */
export function googleFontsStylesheetUrl(
  fonts: readonly DesignGoogleFont[],
): string | null {
  const families = fonts
    .map((font) => {
      const family = font.family.trim();
      if (!family) return null;
      const weights = [...new Set(font.weights)]
        .filter((weight) => Number.isInteger(weight) && weight >= 100 && weight <= 900)
        .sort((left, right) => left - right);
      const requestedWeights = weights.length
        ? weights.join(";")
        : "400;500;600;700";
      return `family=${encodeURIComponent(family)}:wght@${requestedWeights}`;
    })
    .filter((value): value is string => Boolean(value));
  return families.length
    ? `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`
    : null;
}

/** Composer preview stylesheets for Google + Fontsource (CDN bridge before npm lands). */
export function composerFontStylesheetUrls(fonts: DesignFonts | null | undefined): string[] {
  if (!fonts) return [];
  const urls: string[] = [];
  const google = googleFontsStylesheetUrl(fonts.google);
  if (google) urls.push(google);
  for (const font of fonts.fontsource ?? []) {
    const url = fontsourceCdnStylesheetUrl(font);
    if (url) urls.push(url);
  }
  return urls;
}

/** Iconify collection prefix (e.g. `lucide`, `mdi`, `simple-icons`). */
export type DesignIconPackId = string;

export type DesignIcons = {
  enabledPacks: DesignIconPackId[];
};

/** Project Iconify / astro-icon runtime detection result. */
export type DesignIconRuntimeStatus = {
  hasAstroIcon: boolean;
  hasIntegration: boolean;
  installedJsonPrefixes: string[];
};

/** Installed `@fontsource` / `@fontsource-variable` packages in the project. */
export type DesignFontsourceRuntimeStatus = {
  installedPackages: string[];
};

export type DesignIconSearchRequest = {
  pack: DesignIconPackId;
  query?: string;
  cursor?: string | null;
  limit?: number;
};

export type DesignIconSearchItem = {
  id: string;
  pack: DesignIconPackId;
  name: string;
  label: string;
};

export type DesignIconSearchResult = {
  items: DesignIconSearchItem[];
  nextCursor: string | null;
  snapshotVersion: string;
};

export type DesignResolvedIcon = {
  id: string;
  dataUrl: string;
  viewBox: string;
  snapshotVersion: string;
};

export type DesignIconResolveResult = {
  icons: Record<string, DesignResolvedIcon>;
  missing: string[];
};

/** Non-CSS facts stored in `.aria/design-meta.json`. */
export type DesignMeta = {
  version: 2;
  enabledIconPacks: DesignIconPackId[];
  paletteOrder: string[];
  fonts: DesignFonts;
  variables: DesignVariablesMeta;
  tokenPreferences: Record<string, DesignTokenPreference>;
};

export type DesignSnapshot = {
  revision: string;
  entryRelativePath: string | null;
  stylesheets: StylesheetInfo[];
  sourceFiles: string[];
  sources: DesignSourceSummary[];
  tokens: DesignToken[];
  diagnostics: DesignDiagnostic[];
  variables: DesignVariables;
  colors: {
    palettes: DesignColorPalette[];
    semantic: DesignSemanticColors;
    /** Site-only: utility/token families found in CSS without CSS-var values. */
    siteTokenRefs: DesignColorTokenReference[];
  };
  globalStyles: DesignGlobalStyles;
  classes: DesignClassRule[];
  fonts: DesignFonts;
  icons: DesignIcons;
  meta: DesignMeta;
};

export type DesignColorsPatch = {
  palettes?: DesignColorPalette[];
  semantic?: DesignSemanticColors;
  adoptedFrom?: Record<
    string,
    NonNullable<DesignTokenPreference["adoptedFrom"]>
  >;
};

export type DesignPatch = {
  colors?: DesignColorsPatch;
  variables?: DesignVariables;
  globalStyles?: DesignGlobalStyles;
  classes?: DesignClassRule[];
  fonts?: DesignFonts;
  icons?: DesignIcons;
};

export type StylesheetReadResult = {
  relativePath: string;
  content: string;
  mtimeMs: number;
};

export type StylesheetWriteResult = {
  relativePath: string;
  mtimeMs: number;
};

export type StylesheetConflictError = {
  code: "mtime_conflict";
  message: string;
  currentMtimeMs: number;
};

export const DESIGN_BLOCK_BEGIN = "/* aria:design-begin */";
export const DESIGN_BLOCK_END = "/* aria:design-end */";
export const DESIGN_FONT_IMPORTS_BEGIN = "/* aria:font-imports-begin */";
export const DESIGN_FONT_IMPORTS_END = "/* aria:font-imports-end */";
export const DESIGN_SECTION_FONTS = "/* aria:fonts */";
export const DESIGN_SECTION_VARIABLES = "/* aria:variables */";
export const DESIGN_SECTION_GLOBALS = "/* aria:globals */";
export const DESIGN_SECTION_PRIMITIVES = "/* aria:primitives */";
export const DESIGN_SECTION_CLASSES = "/* aria:classes */";

export const COLOR_SHADE_KEYS: ColorShadeKey[] = [
  "25",
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
];

export const SEMANTIC_CSS_VAR: Record<keyof DesignSemanticColors, string> = {
  success: "success",
  warning: "warning",
  error: "destructive",
  info: "info",
};

export const EMPTY_DESIGN_FONTS: DesignFonts = {
  google: [],
  custom: [],
  fontsource: [],
};

export const EMPTY_DESIGN_META: DesignMeta = {
  version: 2,
  enabledIconPacks: [],
  paletteOrder: [],
  fonts: { google: [], custom: [], fontsource: [] },
  variables: { custom: {}, aliases: {} },
  tokenPreferences: {},
};
