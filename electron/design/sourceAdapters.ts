import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  COLOR_SHADE_KEYS,
  type ColorShadeKey,
  type DesignColorPalette,
  type DesignColorTokenReference,
  type DesignDiagnostic,
  type DesignMeta,
  type DesignSnapshot,
  type DesignSourceSummary,
  type DesignToken,
  type DesignTokenMode,
  type DesignTokenMutationInput,
  type DesignTokenMutationPreview,
  type DesignTokenProviderId,
  type DesignTokenSource,
  type StylesheetInfo,
} from "../../shared/design";
import { canonicalDirectory, resolveWithinRoot } from "../pathSafety";
import { extractManagedBlock } from "./managedBlock";
import {
  extractCustomProperties,
  resolveColorValue,
} from "./parseCss";

const SHADE_SET = new Set<string>([...COLOR_SHADE_KEYS, "DEFAULT"]);
const TAILWIND_CONFIG_RE = /^tailwind\.config\.(?:js|cjs|mjs|ts)$/i;
const SOURCE_EXTENSIONS = new Set([
  ".astro",
  ".vue",
  ".svelte",
  ".tsx",
  ".jsx",
  ".html",
  ".md",
  ".mdx",
  ".ts",
  ".js",
  ".css",
  ".scss",
]);
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".astro",
  "dist",
  ".aria",
  ".vercel",
  ".wrangler",
]);
const KNOWN_BARE_COLOR_FAMILIES = new Set([
  "primary",
  "secondary",
  "muted",
  "accent",
  "destructive",
  "success",
  "warning",
  "error",
  "info",
  "neutral",
  "slate",
  "gray",
  "grey",
  "zinc",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "foreground",
  "background",
  "card",
  "popover",
  "sidebar",
  "chart",
]);
const COLOR_UTILITY_RE = new RegExp(
  String.raw`(?:text|bg|border|ring|outline|fill|stroke|from|to|via|decoration|accent|caret|divide|placeholder|shadow)-([a-z][\w-]*)(?:\/[\w.\[\]-]+)?(?=[\s"'\x60;)}\],]|$)`,
  "gi",
);
/** `var(--token)`, `theme(--token)`, and `bg-(--token)` style references. */
const CUSTOM_PROPERTY_REF_RE = /\(\s*--([a-zA-Z0-9_-]+)/g;

type InternalDiscovery = {
  sources: DesignTokenSource[];
  summaries: DesignSourceSummary[];
  watchedFiles: Set<string>;
  diagnostics: DesignDiagnostic[];
};

export type DesignSourceAdapter = {
  id: string;
  providers: readonly DesignTokenProviderId[];
  detect: (root: string, stylesheets: StylesheetInfo[]) => boolean;
  read: (root: string, stylesheets: StylesheetInfo[]) => InternalDiscovery;
  planWrite: (source: DesignTokenSource, value: string) => string;
};

export type DesignTokenIndex = {
  tokens: DesignToken[];
  sources: DesignSourceSummary[];
  sourceFiles: string[];
  diagnostics: DesignDiagnostic[];
  sitePalettes: DesignColorPalette[];
  siteTokenRefs: DesignColorTokenReference[];
};

export type PlannedDesignTokenMutation = {
  preview: DesignTokenMutationPreview;
  absoluteFile: string;
  nextContent: string;
};

type CssBlock = {
  prelude: string;
  from: number;
  to: number;
  parent: CssBlock | null;
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function tokenId(family: string, shade: ColorShadeKey): string {
  return `color.${family}.${shade}`;
}

function sourceId(
  provider: DesignTokenProviderId,
  relativeFile: string,
  pointer: string,
  mode: string,
): string {
  return `${provider}:${relativeFile}:${pointer}:${mode}`;
}

function colorParts(rawName: string): {
  family: string;
  shade: ColorShadeKey;
} {
  const normalized = rawName.replace(/^(?:color|colors)-/, "");
  const match = normalized.match(/^(.+)-(25|50|100|200|300|400|500|600|700|800|900|950|DEFAULT)$/i);
  if (match && SHADE_SET.has(match[2]!.toUpperCase() === "DEFAULT" ? "DEFAULT" : match[2]!)) {
    return {
      family: match[1]!.toLowerCase(),
      shade: (match[2]!.toUpperCase() === "DEFAULT"
        ? "DEFAULT"
        : match[2]) as ColorShadeKey,
    };
  }
  return { family: normalized.toLowerCase(), shade: "DEFAULT" };
}

function tokenPartsFromSource(source: DesignTokenSource): {
  family: string;
  shade: ColorShadeKey;
} {
  const name = source.pointer.match(/::--([a-zA-Z0-9_-]+)$/)?.[1];
  if (name) return colorParts(name);
  const match = source.pointer.match(
    /\.([^.]+)\.(25|50|100|200|300|400|500|600|700|800|900|950|DEFAULT)$/i,
  );
  if (match) {
    return {
      family: match[1]!.toLowerCase(),
      shade: (match[2]!.toUpperCase() === "DEFAULT" ? "DEFAULT" : match[2]) as ColorShadeKey,
    };
  }
  return {
    family: source.pointer.split(".").at(-1)!.toLowerCase(),
    shade: "DEFAULT",
  };
}

function discoveredColorFamilies(sources: DesignTokenSource[]): Set<string> {
  return new Set(sources.map((source) => tokenPartsFromSource(source).family));
}

function allCssBlocks(css: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  const stack: CssBlock[] = [];
  let segmentStart = 0;
  let quote: "'" | '"' | null = null;
  let comment = false;
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]!;
    const next = css[index + 1];
    if (comment) {
      if (char === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && char === "/" && next === "*") {
      comment = true;
      index += 1;
      continue;
    }
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "{") {
      const block: CssBlock = {
        prelude: css.slice(segmentStart, index).trim(),
        from: index + 1,
        to: css.length,
        parent: stack.at(-1) ?? null,
      };
      blocks.push(block);
      stack.push(block);
      segmentStart = index + 1;
    } else if (char === "}") {
      const block = stack.pop();
      if (block) block.to = index;
      segmentStart = index + 1;
    } else if (char === ";" && stack.length) {
      segmentStart = index + 1;
    }
  }
  return blocks;
}

function enclosingBlocks(blocks: CssBlock[], offset: number): CssBlock[] {
  return blocks
    .filter((block) => block.from <= offset && offset < block.to)
    .sort((a, b) => a.from - b.from);
}

function cssMode(blocks: CssBlock[]): DesignTokenMode {
  const media = blocks
    .map((block) => block.prelude)
    .find((prelude) => /^@media\b/i.test(prelude));
  const selector = [...blocks]
    .reverse()
    .map((block) => block.prelude)
    .find((prelude) => prelude && !prelude.startsWith("@"));
  const dark = blocks.some((block) =>
    /(?:^|[\s,[>+~])\.dark\b|data-theme\s*=\s*["']?dark|prefers-color-scheme\s*:\s*dark/i.test(
      block.prelude,
    ),
  );
  if (dark) {
    return {
      id: "dark",
      label: "Dark",
      ...(selector ? { selector } : {}),
      ...(media ? { media } : {}),
    };
  }
  if (media) return { id: `media:${media}`, label: media, media };
  if (selector && !/(?:^|,)\s*(?::root|html)(?:\s|,|$)/i.test(selector)) {
    return { id: `selector:${selector}`, label: selector, selector };
  }
  return {
    id: "default",
    label: "Default",
    ...(selector ? { selector } : {}),
  };
}

function cssPointer(blocks: CssBlock[], name: string): string {
  const context = blocks.map((block) => block.prelude).filter(Boolean).join(" > ");
  return `${context || ":root"}::--${name}`;
}

function readCssSources(
  root: string,
  stylesheets: StylesheetInfo[],
): InternalDiscovery {
  const sources: DesignTokenSource[] = [];
  const summaries: DesignSourceSummary[] = [];
  const watchedFiles = new Set<string>();
  const diagnostics: DesignDiagnostic[] = [];

  for (const sheet of stylesheets) {
    const relativeFile = sheet.relativePath;
    const absolute = resolveWithinRoot(root, path.join(root, ...relativeFile.split("/")), {
      rejectFinalSymlink: true,
    });
    let content = "";
    try {
      content = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    watchedFiles.add(relativeFile);
    const sourceHash = sha256(content);
    const { before, block } = extractManagedBlock(content);
    const managedFrom = block ? before.length : -1;
    const managedTo = block ? before.length + block.length : -1;
    const blocks = allCssBlocks(content);
    const fileProviders = new Map<DesignTokenProviderId, boolean>();
    const re = /--([a-zA-Z0-9_-]+)(\s*:\s*)([^;{}]+);/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content))) {
      const declarationFrom = match.index;
      if (managedFrom >= 0 && declarationFrom >= managedFrom && declarationFrom < managedTo) {
        continue;
      }
      const name = match[1]!;
      const raw = match[3]!;
      const value = raw.trim();
      if (!value) continue;
      const variable = extractCustomProperties(`:root { --${name}: ${value}; }`, "site")[0];
      if (!variable || variable.category !== "color") continue;
      const context = enclosingBlocks(blocks, declarationFrom);
      const isTheme = context.some((candidate) => /^@theme\b/i.test(candidate.prelude));
      const provider: DesignTokenProviderId = isTheme ? "tailwind-theme" : "css";
      const mode = cssMode(context);
      const pointer = cssPointer(context, name);
      const leading = raw.length - raw.trimStart().length;
      const from = match.index + match[0].indexOf(raw) + leading;
      const to = from + value.length;
      const parts = colorParts(name);
      sources.push({
        id: sourceId(provider, relativeFile, pointer, mode.id),
        provider,
        relativeFile,
        pointer,
        sourceHash,
        ownership: "site",
        writable: !relativeFile.startsWith("node_modules/"),
        ...(!relativeFile.startsWith("node_modules/")
          ? {}
          : { writeReason: "Dependency stylesheets are read-only." }),
        mode,
        authoredValue: value,
        valueRange: { from, to },
        syntax: "css",
      });
      fileProviders.set(provider, true);
      void parts;
    }

    for (const provider of fileProviders.keys()) {
      const providerSources = sources.filter(
        (source) => source.relativeFile === relativeFile && source.provider === provider,
      );
      summaries.push({
        id: `${provider}:${relativeFile}`,
        provider,
        relativeFile,
        sourceHash,
        writable: providerSources.some((source) => source.writable),
        diagnostics: [],
      });
    }
  }

  // Resolve aliases across all project stylesheets while preserving authored
  // values and mode-specific overrides.
  const modes = new Set(["default", ...sources.map((source) => source.mode.id)]);
  for (const mode of modes) {
    const applicable = sources.filter(
      (source) => source.mode.id === "default" || source.mode.id === mode,
    );
    const vars = new Map<string, string>();
    for (const source of applicable) {
      const name = source.pointer.match(/::--([a-zA-Z0-9_-]+)$/)?.[1];
      if (name) vars.set(name, source.authoredValue);
    }
    for (const source of applicable.filter((candidate) => candidate.mode.id === mode)) {
      source.resolvedValue = resolveColorValue(source.authoredValue, vars) ?? undefined;
      if (!source.resolvedValue) {
        diagnostics.push({
          code: "DESIGN_CSS_COLOR_UNRESOLVED",
          severity: "warning",
          message: `The authored color ${source.authoredValue} could not be resolved to a preview value.`,
          relativeFile: source.relativeFile,
          pointer: source.pointer,
        });
      }
    }
  }

  return { sources, summaries, watchedFiles, diagnostics };
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  if (
    ts.isCallExpression(current) &&
    current.arguments.length &&
    (ts.isIdentifier(current.expression) || ts.isPropertyAccessExpression(current.expression))
  ) {
    const name = ts.isIdentifier(current.expression)
      ? current.expression.text
      : current.expression.name.text;
    if (name === "defineConfig") return unwrapExpression(current.arguments[0]!);
  }
  return current;
}

function propertyName(node: ts.PropertyName | undefined): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return null;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | null {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property.name) === name) {
      return property.initializer;
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) {
      return property.name;
    }
  }
  return null;
}

function localInitializer(
  file: ts.SourceFile,
  name: string,
): ts.Expression | null {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        return declaration.initializer ?? null;
      }
    }
  }
  return null;
}

function resolveObject(
  file: ts.SourceFile,
  expression: ts.Expression | null,
  seen = new Set<string>(),
): ts.ObjectLiteralExpression | null {
  if (!expression) return null;
  const current = unwrapExpression(expression);
  if (ts.isObjectLiteralExpression(current)) return current;
  if (ts.isIdentifier(current) && !seen.has(current.text)) {
    seen.add(current.text);
    return resolveObject(file, localInitializer(file, current.text), seen);
  }
  return null;
}

function configExpression(file: ts.SourceFile): ts.Expression | null {
  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      return statement.expression;
    }
    if (!ts.isExpressionStatement(statement)) continue;
    const expression = statement.expression;
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(expression.left) &&
      ts.isIdentifier(expression.left.expression) &&
      expression.left.expression.text === "module" &&
      expression.left.name.text === "exports"
    ) {
      return expression.right;
    }
  }
  return null;
}

function literalColor(
  file: ts.SourceFile,
  expression: ts.Expression,
  seen = new Set<string>(),
): {
  value: string;
  syntax: DesignTokenSource["syntax"];
  node: ts.Expression;
  direct: boolean;
} | null {
  const current = unwrapExpression(expression);
  if (ts.isStringLiteral(current)) {
    const raw = current.getText();
    return {
      value: current.text,
      syntax: raw.startsWith("'") ? "single-quoted" : "double-quoted",
      node: current,
      direct: current === unwrapExpression(expression),
    };
  }
  if (ts.isNoSubstitutionTemplateLiteral(current)) {
    return {
      value: current.text,
      syntax: "template",
      node: current,
      direct: current === unwrapExpression(expression),
    };
  }
  if (ts.isIdentifier(current) && !seen.has(current.text)) {
    seen.add(current.text);
    const resolved = localInitializer(file, current.text);
    if (!resolved) return null;
    const literal = literalColor(file, resolved, seen);
    return literal ? { ...literal, direct: false } : null;
  }
  return null;
}

function tailwindConfigFiles(root: string): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return entries.filter((entry) => TAILWIND_CONFIG_RE.test(entry)).sort();
}

function readTailwindSources(root: string): InternalDiscovery {
  const sources: DesignTokenSource[] = [];
  const summaries: DesignSourceSummary[] = [];
  const watchedFiles = new Set<string>();
  const diagnostics: DesignDiagnostic[] = [];
  if (existsSync(path.join(root, "package.json"))) watchedFiles.add("package.json");

  for (const relativeFile of tailwindConfigFiles(root)) {
    const absolute = resolveWithinRoot(root, path.join(root, relativeFile), {
      rejectFinalSymlink: true,
    });
    const content = readFileSync(absolute, "utf8");
    const sourceHash = sha256(content);
    watchedFiles.add(relativeFile);
    const kind = relativeFile.endsWith(".ts")
      ? ts.ScriptKind.TS
      : relativeFile.endsWith(".js") || relativeFile.endsWith(".mjs") || relativeFile.endsWith(".cjs")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.Unknown;
    const file = ts.createSourceFile(relativeFile, content, ts.ScriptTarget.Latest, true, kind);
    const config = resolveObject(file, configExpression(file));
    const fileDiagnostics: string[] = [];
    if (!config) {
      const message = "Tailwind configuration is dynamic and cannot be inspected without executing project code.";
      fileDiagnostics.push(message);
      diagnostics.push({
        code: "DESIGN_TAILWIND_DYNAMIC_CONFIG",
        severity: "warning",
        message,
        relativeFile,
      });
      summaries.push({
        id: `tailwind-config:${relativeFile}`,
        provider: "tailwind-config",
        relativeFile,
        sourceHash,
        writable: false,
        diagnostics: fileDiagnostics,
      });
      continue;
    }
    if (objectProperty(config, "presets")) {
      const message = "Tailwind presets are not executed or expanded during design discovery.";
      fileDiagnostics.push(message);
      diagnostics.push({
        code: "DESIGN_TAILWIND_PRESETS_UNRESOLVED",
        severity: "warning",
        message,
        relativeFile,
        pointer: "presets",
      });
    }
    const theme = resolveObject(file, objectProperty(config, "theme"));
    const extend = theme ? resolveObject(file, objectProperty(theme, "extend")) : null;
    const candidates: Array<{ object: ts.ObjectLiteralExpression; prefix: string }> = [];
    const themeColors = theme ? resolveObject(file, objectProperty(theme, "colors")) : null;
    const extendColors = extend ? resolveObject(file, objectProperty(extend, "colors")) : null;
    if (themeColors) candidates.push({ object: themeColors, prefix: "theme.colors" });
    if (extendColors) candidates.push({ object: extendColors, prefix: "theme.extend.colors" });
    if (!candidates.length) {
      const message = "No statically authored Tailwind color object was found.";
      fileDiagnostics.push(message);
      diagnostics.push({
        code: "DESIGN_TAILWIND_COLORS_UNRESOLVED",
        severity: "info",
        message,
        relativeFile,
      });
    }

    for (const candidate of candidates) {
      for (const familyProperty of candidate.object.properties) {
        if (!ts.isPropertyAssignment(familyProperty)) {
          if (ts.isSpreadAssignment(familyProperty)) {
            const message = `${candidate.prefix} contains a spread that remains read-only.`;
            if (!fileDiagnostics.includes(message)) fileDiagnostics.push(message);
            diagnostics.push({
              code: "DESIGN_TAILWIND_SPREAD_UNRESOLVED",
              severity: "warning",
              message,
              relativeFile,
              pointer: candidate.prefix,
            });
          }
          continue;
        }
        const family = propertyName(familyProperty.name)?.toLowerCase();
        if (!family) {
          const message = `${candidate.prefix} contains a computed color key that remains read-only.`;
          fileDiagnostics.push(message);
          diagnostics.push({
            code: "DESIGN_TAILWIND_COMPUTED_KEY_UNRESOLVED",
            severity: "warning",
            message,
            relativeFile,
            pointer: candidate.prefix,
          });
          continue;
        }
        if (family === "transparent" || family === "current") continue;
        const direct = literalColor(file, familyProperty.initializer);
        const familyObject = resolveObject(file, familyProperty.initializer);
        const entries: Array<{
          shade: ColorShadeKey;
          expression: ts.Expression;
          pointer: string;
        }> = [];
        if (direct) {
          entries.push({
            shade: "DEFAULT",
            expression: familyProperty.initializer,
            pointer: `${candidate.prefix}.${family}`,
          });
        } else if (familyObject) {
          for (const shadeProperty of familyObject.properties) {
            if (!ts.isPropertyAssignment(shadeProperty)) continue;
            const rawShade = propertyName(shadeProperty.name);
            const shade = rawShade?.toUpperCase() === "DEFAULT" ? "DEFAULT" : rawShade;
            if (!shade || !SHADE_SET.has(shade)) continue;
            entries.push({
              shade: shade as ColorShadeKey,
              expression: shadeProperty.initializer,
              pointer: `${candidate.prefix}.${family}.${shade}`,
            });
          }
        } else {
          const message = `${candidate.prefix}.${family} is dynamic and remains read-only.`;
          fileDiagnostics.push(message);
          diagnostics.push({
            code: "DESIGN_TAILWIND_TOKEN_UNRESOLVED",
            severity: "warning",
            message,
            relativeFile,
            pointer: `${candidate.prefix}.${family}`,
            tokenId: tokenId(family, "DEFAULT"),
          });
        }

        for (const entry of entries) {
          const literal = literalColor(file, entry.expression);
          if (!literal) {
            const message = `${entry.pointer} is not a static color literal and remains read-only.`;
            fileDiagnostics.push(message);
            diagnostics.push({
              code: "DESIGN_TAILWIND_TOKEN_UNRESOLVED",
              severity: "warning",
              message,
              relativeFile,
              pointer: entry.pointer,
              tokenId: tokenId(family, entry.shade),
            });
            continue;
          }
          const resolved = resolveColorValue(literal.value, new Map());
          const mode: DesignTokenMode = { id: "default", label: "Default" };
          sources.push({
            id: sourceId("tailwind-config", relativeFile, entry.pointer, mode.id),
            provider: "tailwind-config",
            relativeFile,
            pointer: entry.pointer,
            sourceHash,
            ownership: "site",
            writable: Boolean(resolved && literal.direct),
            ...(!resolved
              ? { writeReason: "The authored value is not a concrete CSS color." }
              : !literal.direct
                ? { writeReason: "This value is shared through a static alias and is read-only." }
                : {}),
            mode,
            authoredValue: literal.value,
            ...(resolved ? { resolvedValue: resolved } : {}),
            ...(literal.direct
              ? {
                  valueRange: {
                    from: literal.node.getStart(file),
                    to: literal.node.getEnd(),
                  },
                }
              : {}),
            syntax: literal.syntax,
          });
        }
      }
    }

    summaries.push({
      id: `tailwind-config:${relativeFile}`,
      provider: "tailwind-config",
      relativeFile,
      sourceHash,
      writable: sources.some(
        (source) => source.relativeFile === relativeFile && source.writable,
      ),
      diagnostics: [...new Set(fileDiagnostics)],
    });
  }

  return { sources, summaries, watchedFiles, diagnostics };
}

const CSS_SOURCE_ADAPTER: DesignSourceAdapter = {
  id: "css",
  providers: ["css", "tailwind-theme"],
  detect: (_root, stylesheets) => stylesheets.length > 0,
  read: readCssSources,
  planWrite: (_source, value) => value,
};

const TAILWIND_CONFIG_ADAPTER: DesignSourceAdapter = {
  id: "tailwind-config",
  providers: ["tailwind-config"],
  detect: (root) => tailwindConfigFiles(root).length > 0,
  read: (root) => readTailwindSources(root),
  planWrite: (source, value) => replacementForSource(source, value),
};

export const DESIGN_SOURCE_ADAPTERS: readonly DesignSourceAdapter[] = [
  CSS_SOURCE_ADAPTER,
  TAILWIND_CONFIG_ADAPTER,
];

function walkSourceFiles(directory: string, out: string[], depth = 0): void {
  if (depth > 40 || !existsSync(directory)) return;
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) walkSourceFiles(absolute, out, depth + 1);
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(absolute);
    }
  }
}

type UsageEntry = { count: number; files: Set<string>; shades: Set<string> };

function recordFamilyUsage(
  inventory: Map<string, UsageEntry>,
  family: string,
  shade: string,
  relativeFile: string,
): void {
  let entry = inventory.get(family);
  if (!entry) {
    entry = { count: 0, files: new Set(), shades: new Set() };
    inventory.set(family, entry);
  }
  entry.count += 1;
  entry.files.add(relativeFile);
  entry.shades.add(shade);
}

function usageInventory(
  root: string,
  discoveredFamilies: Set<string>,
): {
  families: Map<string, UsageEntry>;
  sourceFiles: string[];
} {
  const inventory = new Map<string, UsageEntry>();
  const files: string[] = [];
  walkSourceFiles(root, files);
  for (const absolute of files) {
    let content = "";
    try {
      content = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    const relativeFile = toPosix(path.relative(root, absolute));
    COLOR_UTILITY_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = COLOR_UTILITY_RE.exec(content))) {
      const token = match[1]!.toLowerCase();
      const shadeMatch = token.match(/^(.+)-(25|50|100|200|300|400|500|600|700|800|900|950|DEFAULT)$/i);
      const family = (shadeMatch?.[1] ?? token).toLowerCase();
      const shade = shadeMatch?.[2]?.toUpperCase() === "DEFAULT"
        ? "DEFAULT"
        : shadeMatch?.[2] ?? "DEFAULT";
      if (
        !shadeMatch &&
        !KNOWN_BARE_COLOR_FAMILIES.has(family) &&
        !discoveredFamilies.has(family)
      ) {
        continue;
      }
      recordFamilyUsage(inventory, family, shade, relativeFile);
    }
    CUSTOM_PROPERTY_REF_RE.lastIndex = 0;
    while ((match = CUSTOM_PROPERTY_REF_RE.exec(content))) {
      const { family, shade } = colorParts(match[1]!);
      if (!discoveredFamilies.has(family)) continue;
      recordFamilyUsage(inventory, family, shade, relativeFile);
    }
  }
  return {
    families: inventory,
    sourceFiles: files.map((absolute) => toPosix(path.relative(root, absolute))).sort(),
  };
}

function mergeSummaries(items: DesignSourceSummary[]): DesignSourceSummary[] {
  const map = new Map<string, DesignSourceSummary>();
  for (const item of items) {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, { ...item, diagnostics: [...item.diagnostics] });
      continue;
    }
    existing.writable ||= item.writable;
    existing.diagnostics = [...new Set([...existing.diagnostics, ...item.diagnostics])];
  }
  return [...map.values()].sort((a, b) =>
    a.relativeFile.localeCompare(b.relativeFile) || a.provider.localeCompare(b.provider),
  );
}

function normalizeTokens(
  sources: DesignTokenSource[],
  usage: Map<string, UsageEntry>,
  meta: DesignMeta,
): DesignToken[] {
  const map = new Map<string, DesignTokenSource[]>();
  for (const source of sources) {
    const { family, shade } = tokenPartsFromSource(source);
    const id = tokenId(family, shade);
    map.set(id, [...(map.get(id) ?? []), source]);
  }

  return [...map.entries()]
    .map(([id, tokenSources]) => {
      const [, family, rawShade] = id.split(".");
      const preference = meta.tokenPreferences[id];
      const preferred = preference?.preferredSourceId
        ? tokenSources.find((source) => source.id === preference.preferredSourceId)
        : null;
      const aria = tokenSources.find((source) => source.ownership === "aria");
      const competingSiteSources = tokenSources.filter(
        (source) =>
          source.ownership === "site" &&
          source.mode.id === "default" &&
          Boolean(source.resolvedValue),
      );
      const sameOrderedSource =
        competingSiteSources.length > 1 &&
        competingSiteSources.every(
          (source) =>
            source.provider === competingSiteSources[0]!.provider &&
            source.relativeFile === competingSiteSources[0]!.relativeFile &&
            Boolean(source.valueRange),
        );
      const precedenceProven = competingSiteSources.length <= 1 || sameOrderedSource;
      const provenSiteSource = precedenceProven
        ? competingSiteSources.at(-1) ?? null
        : null;
      const active = preferred ?? aria ?? provenSiteSource ?? tokenSources.at(-1) ?? null;
      const usageEntry = usage.get(family!);
      return {
        id,
        category: "color" as const,
        family: family!,
        shade: rawShade as ColorShadeKey,
        sources: tokenSources.sort((a, b) =>
          a.relativeFile.localeCompare(b.relativeFile) || a.pointer.localeCompare(b.pointer),
        ),
        activeSourceId: active?.id ?? null,
        ambiguous: !preferred && !precedenceProven,
        usageCount: usageEntry?.count ?? 0,
        usedIn: [...(usageEntry?.files ?? [])].sort(),
      } satisfies DesignToken;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function sitePalettesFromTokens(tokens: DesignToken[]): DesignColorPalette[] {
  const palettes = new Map<string, DesignColorPalette>();
  for (const token of tokens) {
    const sources = token.sources.filter(
      (source) => source.ownership === "site" && source.mode.id === "default" && source.resolvedValue,
    );
    if (!sources.length) continue;
    const preferred = sources.find((source) => source.id === token.activeSourceId);
    const source = preferred ?? sources.at(-1)!;
    let palette = palettes.get(token.family);
    if (!palette) {
      palette = {
        id: `site:${token.family}`,
        name: token.family,
        shades: {},
        source: "site",
      };
      palettes.set(token.family, palette);
    }
    palette.shades[token.shade] = source.resolvedValue!;
  }
  return [...palettes.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function unresolvedReferences(
  tokens: DesignToken[],
  usage: Map<string, UsageEntry>,
): DesignColorTokenReference[] {
  const resolvedFamilies = new Set(
    tokens
      .filter((token) =>
        token.sources.some((source) => source.ownership === "site" && source.resolvedValue),
      )
      .map((token) => token.family),
  );
  return [...usage.entries()]
    .filter(([family]) => !resolvedFamilies.has(family))
    .map(([family, entry]) => ({
      family,
      shades: [...entry.shades].sort((a, b) => {
        if (a === "DEFAULT") return -1;
        if (b === "DEFAULT") return 1;
        return Number(a) - Number(b);
      }),
      count: entry.count,
      preview: [],
    }))
    .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
}

export function ariaTokenSources(
  palettes: DesignColorPalette[],
  relativeFile: string | null,
  blockCss: string,
): DesignTokenSource[] {
  if (!relativeFile) return [];
  const sourceHash = sha256(blockCss);
  const mode: DesignTokenMode = { id: "default", label: "Default" };
  const sources: DesignTokenSource[] = [];
  for (const palette of palettes) {
    for (const [shade, value] of Object.entries(palette.shades)) {
      if (!value) continue;
      const normalizedShade = shade as ColorShadeKey;
      const pointer = `aria.colors.${palette.name}.${normalizedShade}`;
      sources.push({
        id: sourceId("aria-css", relativeFile, pointer, mode.id),
        provider: "aria-css",
        relativeFile,
        pointer,
        sourceHash,
        ownership: "aria",
        writable: false,
        writeReason: "Use the Aria palette editor for managed tokens.",
        mode,
        authoredValue: value,
        resolvedValue: resolveColorValue(value, new Map()) ?? value,
      });
    }
  }
  return sources;
}

export function discoverDesignTokenIndex(
  projectPath: string,
  stylesheets: StylesheetInfo[],
  meta: DesignMeta,
  managedSources: DesignTokenSource[] = [],
): DesignTokenIndex {
  const root = canonicalDirectory(projectPath);
  const discoveries = DESIGN_SOURCE_ADAPTERS.filter((adapter) =>
    adapter.detect(root, stylesheets),
  ).map((adapter) => adapter.read(root, stylesheets));
  const allSources = [
    ...discoveries.flatMap((discovery) => discovery.sources),
    ...managedSources,
  ];
  const usage = usageInventory(root, discoveredColorFamilies(allSources));
  const tokens = normalizeTokens(allSources, usage.families, meta);
  const managedSummaries: DesignSourceSummary[] = managedSources.length
    ? [{
        id: `aria-css:${managedSources[0]!.relativeFile}`,
        provider: "aria-css",
        relativeFile: managedSources[0]!.relativeFile,
        sourceHash: managedSources[0]!.sourceHash,
        writable: false,
        diagnostics: [],
      }]
    : [];
  return {
    tokens,
    sources: mergeSummaries([
      ...discoveries.flatMap((discovery) => discovery.summaries),
      ...managedSummaries,
    ]),
    sourceFiles: [
      ...new Set(discoveries.flatMap((discovery) => [...discovery.watchedFiles])),
      ...usage.sourceFiles,
    ].sort(),
    diagnostics: discoveries.flatMap((discovery) => discovery.diagnostics),
    sitePalettes: sitePalettesFromTokens(tokens),
    siteTokenRefs: unresolvedReferences(tokens, usage.families),
  };
}

function replacementForSource(source: DesignTokenSource, value: string): string {
  switch (source.syntax) {
    case "single-quoted":
      return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    case "double-quoted":
      return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    case "template":
      return `\`${value.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
    default:
      return value;
  }
}

export function planDesignTokenMutation(
  projectPath: string,
  snapshot: DesignSnapshot,
  input: DesignTokenMutationInput,
): PlannedDesignTokenMutation {
  if (snapshot.revision !== input.expectedRevision) {
    throw new Error("DESIGN_SOURCE_CONFLICT: The design index changed. Refresh and try again.");
  }
  const token = snapshot.tokens.find((candidate) => candidate.id === input.tokenId);
  const source = token?.sources.find((candidate) => candidate.id === input.sourceId);
  if (!token || !source) {
    throw new Error("DESIGN_SOURCE_CONFLICT: The selected design token source no longer exists.");
  }
  if (token.ambiguous) {
    throw new Error("DESIGN_SOURCE_AMBIGUOUS: Choose the source to edit before changing this token.");
  }
  if (!source.writable || !source.valueRange) {
    throw new Error(`DESIGN_SOURCE_UNSAFE: ${source.writeReason ?? "This token source is read-only."}`);
  }
  if (source.sourceHash !== input.expectedSourceHash) {
    throw new Error("DESIGN_SOURCE_CONFLICT: The token source changed. Refresh and try again.");
  }
  const nextValue = input.value.trim();
  if (!nextValue || !resolveColorValue(nextValue, new Map())) {
    throw new Error("DESIGN_SOURCE_INVALID: Enter a concrete CSS color value.");
  }
  const root = canonicalDirectory(projectPath);
  const absoluteFile = resolveWithinRoot(
    root,
    path.join(root, ...source.relativeFile.split("/")),
    { rejectFinalSymlink: true },
  );
  const content = readFileSync(absoluteFile, "utf8");
  if (sha256(content) !== source.sourceHash) {
    throw new Error("DESIGN_SOURCE_CONFLICT: The token source changed on disk. Refresh and try again.");
  }
  const adapter = DESIGN_SOURCE_ADAPTERS.find((candidate) =>
    candidate.providers.includes(source.provider),
  );
  if (!adapter) {
    throw new Error("DESIGN_SOURCE_UNSAFE: No adapter can write this token source.");
  }
  const replacement = adapter.planWrite(source, nextValue);
  const current = content.slice(source.valueRange.from, source.valueRange.to);
  if (!current) {
    throw new Error("DESIGN_SOURCE_CONFLICT: The token value range is no longer valid.");
  }
  return {
    preview: {
      tokenId: token.id,
      sourceId: source.id,
      relativeFile: source.relativeFile,
      pointer: source.pointer,
      beforeValue: source.authoredValue,
      afterValue: nextValue,
      expectedRevision: snapshot.revision,
      expectedSourceHash: source.sourceHash,
    },
    absoluteFile,
    nextContent: `${content.slice(0, source.valueRange.from)}${replacement}${content.slice(source.valueRange.to)}`,
  };
}
