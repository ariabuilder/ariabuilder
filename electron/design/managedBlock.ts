import {
  DESIGN_BLOCK_BEGIN,
  DESIGN_BLOCK_END,
  DESIGN_FONT_IMPORTS_BEGIN,
  DESIGN_FONT_IMPORTS_END,
  DESIGN_SECTION_CLASSES,
  DESIGN_SECTION_FONTS,
  DESIGN_SECTION_GLOBALS,
  DESIGN_SECTION_PRIMITIVES,
  DESIGN_SECTION_VARIABLES,
  EMPTY_DESIGN_VARIABLES,
  SEMANTIC_CSS_VAR,
  fontsourceCssImport,
  googleFontsStylesheetUrl,
  normalizeFontsourceId,
  type BodyGlobalStyle,
  type DesignClassRule,
  type DesignColorPalette,
  type DesignFonts,
  type DesignGlobalStyles,
  type DesignIcons,
  type DesignSemanticColors,
  type DesignVariableAlias,
  type DesignVariables,
} from "../../shared/design";
import { ARIA_BEM_PRIMITIVES_CSS } from "../../shared/composer/ariaBemCss";

export type ManagedBlockModel = {
  fonts: DesignFonts;
  variables: DesignVariables;
  colors: {
    palettes: DesignColorPalette[];
    semantic: DesignSemanticColors;
  };
  globalStyles: DesignGlobalStyles;
  classes: DesignClassRule[];
  icons: DesignIcons;
};

function camelToKebab(property: string): string {
  return property.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function buildCssRule(
  selector: string,
  declarations: Record<string, string> | undefined,
): string {
  if (!declarations) return "";
  const lines = Object.entries(declarations)
    .map(([property, value]) => [property, value.trim()] as const)
    .filter(([, value]) => value.length > 0)
    .map(([property, value]) => `  ${camelToKebab(property)}: ${value};`);
  if (lines.length === 0) return "";
  return `${selector} {\n${lines.join("\n")}\n}`;
}

/** Expand body fields into CSS declarations, including vendor-prefixed smoothing. */
function expandBodyDeclarations(
  body: BodyGlobalStyle,
): Record<string, string> {
  const { fontSmoothing, ...rest } = body;
  const declarations: Record<string, string> = { ...rest };
  if (fontSmoothing?.trim() === "antialiased") {
    declarations.WebkitFontSmoothing = "antialiased";
    declarations.MozOsxFontSmoothing = "grayscale";
  }
  return declarations;
}

const ARIA_SECTION_NODE_SELECTOR =
  "[data-aria-type='Section'], [data-aria-type='section']";
const ARIA_SECTION_CONTENT_SELECTOR =
  "[data-aria-type='Section'] > *, [data-aria-type='section'] > *";
const ARIA_CONTAINER_NODE_SELECTOR =
  "[data-aria-type='Container'], [data-aria-type='container']";

function buildFontsCss(fonts: DesignFonts): string {
  const parts: string[] = [];
  for (const font of fonts.custom) {
    if (!font.family.trim() || !font.file.trim()) continue;
    const format = font.file.endsWith(".woff2")
      ? "woff2"
      : font.file.endsWith(".woff")
        ? "woff"
        : font.file.endsWith(".otf")
          ? "opentype"
          : "truetype";
    parts.push(
      [
        "@font-face {",
        `  font-family: '${font.family.trim()}';`,
        `  src: url('/${font.file.replace(/^\/+/, "")}') format('${format}');`,
        "  font-display: swap;",
        "}",
      ].join("\n"),
    );
  }
  const familyRules: Record<string, string> = {};
  if (fonts.bodyFamily?.trim()) {
    familyRules.fontFamily = fonts.bodyFamily.trim();
  }
  if (Object.keys(familyRules).length) {
    parts.push(buildCssRule("body", familyRules));
  }
  if (fonts.headingFamily?.trim()) {
    parts.push(
      buildCssRule("h1, h2, h3, h4, h5, h6", {
        fontFamily: fonts.headingFamily.trim(),
      }),
    );
  }
  return parts.filter(Boolean).join("\n\n");
}

function managedFontImports(fonts: DesignFonts): string {
  const lines: string[] = [];
  const googleUrl = googleFontsStylesheetUrl(fonts.google);
  if (googleUrl) lines.push(`@import url('${googleUrl}');`);
  for (const font of fonts.fontsource ?? []) {
    const id = normalizeFontsourceId(font.id);
    if (!id) continue;
    lines.push(fontsourceCssImport({ id, variable: font.variable }));
  }
  if (lines.length === 0) return "";
  return [DESIGN_FONT_IMPORTS_BEGIN, ...lines, DESIGN_FONT_IMPORTS_END].join(
    "\n",
  );
}

function removeManagedFontImports(fileContent: string): string {
  const begin = fileContent.indexOf(DESIGN_FONT_IMPORTS_BEGIN);
  const end = fileContent.indexOf(DESIGN_FONT_IMPORTS_END);
  if (begin === -1 || end === -1 || end < begin) return fileContent;
  return `${fileContent.slice(0, begin)}${fileContent.slice(
    end + DESIGN_FONT_IMPORTS_END.length,
  )}`.replace(/^\s+/, "");
}

function prependManagedFontImports(
  fileContent: string,
  imports: string,
): string {
  if (!imports) return fileContent;
  const charset = fileContent.match(/^(?:\uFEFF)?@charset\s+(['"])[^'"]+\1\s*;/i);
  if (!charset) return `${imports}\n\n${fileContent.replace(/^\s+/, "")}`;
  const rest = fileContent.slice(charset[0].length).replace(/^\s+/, "");
  return `${charset[0]}\n\n${imports}${rest ? `\n\n${rest}` : "\n"}`;
}

function resolveTokenAliasValue(
  sourceKey: string,
  palettes: DesignColorPalette[],
  semantic: DesignSemanticColors,
  fallback?: string,
): string {
  const trimmed = sourceKey.trim();
  const paletteMatch = trimmed.match(
    /^tokens\.colors\.palette\.([a-zA-Z0-9_-]+)(?:-(\d+|DEFAULT))?$/,
  );
  if (paletteMatch) {
    const paletteName = paletteMatch[1]!;
    const shade = paletteMatch[2];
    const palette = palettes.find((p) => p.name === paletteName);
    if (palette) {
      if (!shade) {
        return (
          palette.shades.DEFAULT?.trim() ||
          palette.shades["500"]?.trim() ||
          fallback?.trim() ||
          ""
        );
      }
      return (
        palette.shades[shade as keyof typeof palette.shades]?.trim() ||
        fallback?.trim() ||
        ""
      );
    }
  }

  const semanticMatch = trimmed.match(
    /^tokens\.colors\.semantic\.([a-zA-Z0-9_-]+)$/,
  );
  if (semanticMatch) {
    const key = semanticMatch[1] as keyof DesignSemanticColors;
    const mapped = SEMANTIC_CSS_VAR[key] ?? key;
    // Prefer the semantic bag; fall back to palette-emitted CSS var name.
    const fromBag = semantic[key]?.trim();
    if (fromBag) return fromBag;
    // Also accept keys that match CSS var names (success/warning/destructive/info).
    for (const [semanticKey, cssVar] of Object.entries(SEMANTIC_CSS_VAR) as Array<
      [keyof DesignSemanticColors, string]
    >) {
      if (cssVar === mapped || semanticKey === key) {
        const value = semantic[semanticKey]?.trim();
        if (value) return value;
      }
    }
  }

  return fallback?.trim() || "";
}

function resolveAliasCssValue(
  alias: DesignVariableAlias,
  palettes: DesignColorPalette[],
  semantic: DesignSemanticColors,
): string {
  if (alias.sourceType === "custom") {
    const sourceKey = alias.sourceKey.trim().replace(/^--/, "");
    if (!sourceKey) return "";
    const fallback = alias.fallback?.trim();
    return fallback
      ? `var(--${sourceKey}, ${fallback})`
      : `var(--${sourceKey})`;
  }

  return resolveTokenAliasValue(
    alias.sourceKey,
    palettes,
    semantic,
    alias.fallback,
  );
}

function buildVariablesCss(
  variables: DesignVariables,
  palettes: DesignColorPalette[],
  semantic: DesignSemanticColors,
): string {
  const lines: string[] = [];
  const emitted = new Set<string>();

  for (const palette of palettes) {
    const base =
      palette.shades.DEFAULT?.trim() ||
      palette.shades["500"]?.trim() ||
      "";
    if (base) {
      lines.push(`  --${palette.name}: ${base};`);
      emitted.add(palette.name);
    }
    for (const [shade, value] of Object.entries(palette.shades)) {
      if (shade === "DEFAULT" || !value?.trim()) continue;
      const key = `${palette.name}-${shade}`;
      lines.push(`  --${key}: ${value.trim()};`);
      emitted.add(key);
    }
  }

  for (const [key, cssVar] of Object.entries(SEMANTIC_CSS_VAR) as Array<
    [keyof DesignSemanticColors, string]
  >) {
    const value = semantic[key]?.trim();
    if (!value) continue;
    lines.push(`  --${cssVar}: ${value};`);
    emitted.add(cssVar);
  }

  const custom = variables?.custom ?? EMPTY_DESIGN_VARIABLES.custom;
  const aliases = variables?.aliases ?? EMPTY_DESIGN_VARIABLES.aliases;

  for (const [name, definition] of Object.entries(custom)) {
    if (emitted.has(name)) continue;
    if (!definition.value.trim()) continue;
    lines.push(`  --${name}: ${definition.value.trim()};`);
    emitted.add(name);
  }

  for (const [name, alias] of Object.entries(aliases)) {
    if (emitted.has(name)) continue;
    const value = resolveAliasCssValue(alias, palettes, semantic).trim();
    if (!value) continue;
    lines.push(`  --${name}: ${value};`);
    emitted.add(name);
  }

  if (lines.length === 0) return "";
  return `:root {\n${lines.join("\n")}\n}`;
}

function buildGlobalsCss(globalStyles: DesignGlobalStyles): string {
  const { body, heading, subheading, paragraph, link, button, input, section, container, root } =
    globalStyles;

  const rules = [
    buildCssRule("html", {
      fontSize: root.fontSize,
      margin: root.margin,
      padding: root.padding,
      cursor: root.cursor,
      caretColor: root.caretColor,
      scrollBehavior: root.scrollBehavior,
      outlineColor: root.outlineColor,
      outlineWidth: root.outlineWidth,
      outlineStyle: root.outlineStyle,
      borderColor: root.borderColor,
      borderRadius: root.borderRadius,
    }),
    buildCssRule("::selection", {
      color: root.selectionColor,
      backgroundColor: root.selectionBackgroundColor,
    }),
    buildCssRule("body", expandBodyDeclarations(body)),
    buildCssRule("h1, h2, h3, h4, h5, h6", { ...heading }),
    buildCssRule("h4, h5, h6, [data-aria-subheading='true']", {
      ...subheading,
    }),
    buildCssRule("p", { ...paragraph }),
    buildCssRule("a", {
      color: link.color,
      textDecoration: link.textDecoration,
      textUnderlineOffset: link.underlineOffset,
      fontWeight: link.fontWeight,
    }),
    buildCssRule("a:hover", { color: link.hoverColor }),
    buildCssRule("a:visited", { color: link.visitedColor }),
    buildCssRule(
      "button, [type='button'], [type='submit'], [type='reset'], .btn, [data-button-variant]",
      {
        fontFamily: button.base.fontFamily,
        fontSize: button.base.fontSize,
        fontWeight: button.base.fontWeight,
        lineHeight: button.base.lineHeight,
        letterSpacing: button.base.letterSpacing,
        borderRadius: button.base.borderRadius,
        paddingInline: button.base.paddingX,
        paddingBlock: button.base.paddingY,
        borderWidth: button.base.borderWidth,
      },
    ),
    ...Object.entries(button.variants).flatMap(([variant, style]) => [
      buildCssRule(`.btn-${variant}, [data-button-variant='${variant}']`, {
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderColor: style.borderColor,
      }),
      buildCssRule(
        `.btn-${variant}:hover, [data-button-variant='${variant}']:hover`,
        {
          backgroundColor: style.hoverBackgroundColor,
          color: style.hoverColor,
          borderColor: style.hoverBorderColor,
        },
      ),
    ]),
    buildCssRule(
      "input:not([type='checkbox']):not([type='radio']), textarea, select, .input",
      {
        backgroundColor: input.backgroundColor,
        color: input.color,
        borderColor: input.borderColor,
        borderRadius: input.borderRadius,
        fontFamily: input.fontFamily,
        fontSize: input.fontSize,
        lineHeight: input.lineHeight,
        paddingInline: input.paddingX,
        paddingBlock: input.paddingY,
      },
    ),
    buildCssRule(
      "input:not([type='checkbox']):not([type='radio'])::placeholder, textarea::placeholder",
      { color: input.placeholderColor },
    ),
    buildCssRule(
      "input:not([type='checkbox']):not([type='radio']):focus-visible, textarea:focus-visible, select:focus-visible, .input:focus-visible",
      {
        outlineColor: input.focusRingColor,
        outlineStyle: input.focusRingColor ? "solid" : "",
        outlineWidth: input.focusRingColor ? "2px" : "",
        outlineOffset: input.focusRingColor ? "2px" : "",
      },
    ),
    buildCssRule(ARIA_SECTION_NODE_SELECTOR, {
      paddingInline: section.horizontalPadding,
      paddingBlock: section.verticalPadding,
      gap: section.sectionGap,
      boxSizing: section.horizontalPadding || section.verticalPadding || section.sectionGap
        ? "border-box"
        : "",
    }),
    buildCssRule(ARIA_SECTION_CONTENT_SELECTOR, {
      maxWidth: section.contentMaxWidth,
      marginInline: section.contentMaxWidth ? "auto" : "",
      boxSizing: section.contentMaxWidth ? "border-box" : "",
    }),
    buildCssRule(ARIA_CONTAINER_NODE_SELECTOR, {
      maxWidth: container.maxWidth,
      width: container.width,
      boxSizing: container.maxWidth || container.width ? "border-box" : "",
    }),
  ].filter(Boolean);

  return rules.join("\n\n");
}

function buildClassesCss(classes: DesignClassRule[]): string {
  return classes
    .map((item) => item.css.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Serialize the Aria managed design block (including markers). */
export function serializeManagedBlock(model: ManagedBlockModel): string {
  const sections: string[] = [DESIGN_BLOCK_BEGIN];

  const fontsCss = buildFontsCss(model.fonts);
  if (fontsCss) {
    sections.push(DESIGN_SECTION_FONTS, fontsCss);
  }

  const variablesCss = buildVariablesCss(
    model.variables,
    model.colors.palettes,
    model.colors.semantic,
  );
  if (variablesCss) {
    sections.push(DESIGN_SECTION_VARIABLES, variablesCss);
  }

  const globalsCss = buildGlobalsCss(model.globalStyles);
  if (globalsCss) {
    sections.push(DESIGN_SECTION_GLOBALS, globalsCss);
  }

  sections.push(DESIGN_SECTION_PRIMITIVES, ARIA_BEM_PRIMITIVES_CSS);

  const classesCss = buildClassesCss(model.classes);
  if (classesCss) {
    sections.push(DESIGN_SECTION_CLASSES, classesCss);
  }

  sections.push(DESIGN_BLOCK_END);
  return sections.join("\n\n") + "\n";
}

export function extractManagedBlock(fileContent: string): {
  before: string;
  block: string | null;
  after: string;
} {
  const begin = fileContent.indexOf(DESIGN_BLOCK_BEGIN);
  const end = fileContent.indexOf(DESIGN_BLOCK_END);
  if (begin === -1 || end === -1 || end < begin) {
    return { before: fileContent, block: null, after: "" };
  }
  const blockEnd = end + DESIGN_BLOCK_END.length;
  return {
    before: fileContent.slice(0, begin),
    block: fileContent.slice(begin, blockEnd),
    after: fileContent.slice(blockEnd),
  };
}

/** Replace or append the managed block in a stylesheet. */
export function applyManagedBlockToFile(
  fileContent: string,
  model: ManagedBlockModel,
): string {
  fileContent = removeManagedFontImports(fileContent);
  const serialized = serializeManagedBlock(model);
  const { before, block, after } = extractManagedBlock(fileContent);
  let withBlock: string;
  if (block === null) {
    const trimmed = fileContent.replace(/\s*$/, "");
    withBlock = !trimmed ? serialized : `${trimmed}\n\n${serialized}`;
  } else {
    const beforeTrimmed = before.replace(/\s*$/, "");
    const afterTrimmed = after.replace(/^\s*/, "");
    const pieces = [beforeTrimmed, serialized.replace(/\n$/, ""), afterTrimmed]
      .filter((p) => p.length > 0)
      .join("\n\n");
    withBlock = pieces.endsWith("\n") ? pieces : `${pieces}\n`;
  }
  return prependManagedFontImports(withBlock, managedFontImports(model.fonts));
}

const PRIMITIVES_SECTION_END_MARKERS = [
  DESIGN_SECTION_FONTS,
  DESIGN_SECTION_VARIABLES,
  DESIGN_SECTION_GLOBALS,
  DESIGN_SECTION_CLASSES,
  DESIGN_BLOCK_END,
] as const;

export function extractAriaBemPrimitivesCss(fileContent: string): string | null {
  const start = fileContent.indexOf(DESIGN_SECTION_PRIMITIVES);
  if (start < 0) return null;
  const tail = fileContent.slice(start + DESIGN_SECTION_PRIMITIVES.length);
  let end = tail.length;
  for (const marker of PRIMITIVES_SECTION_END_MARKERS) {
    const index = tail.indexOf(marker);
    if (index >= 0 && index < end) end = index;
  }
  return tail.slice(0, end).trim();
}

/** True when the managed primitives section exists but is not the current Aria defaults. */
export function stylesheetHasStaleAriaBemPrimitives(fileContent: string): boolean {
  const existing = extractAriaBemPrimitivesCss(fileContent);
  return existing !== null && existing !== ARIA_BEM_PRIMITIVES_CSS.trim();
}

/** True when the managed primitives section is missing or out of date. */
export function stylesheetNeedsAriaBemPrimitives(fileContent: string): boolean {
  return extractAriaBemPrimitivesCss(fileContent) !== ARIA_BEM_PRIMITIVES_CSS.trim();
}
