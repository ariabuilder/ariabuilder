import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type {
  CollectionSourceAdapter,
  CollectionSourceFormat,
} from "../../shared/types";
import { resolveWithinRoot } from "../pathSafety";

export const ASTRO_COLLECTION_CONFIG_FILES = [
  "src/content.config.ts",
  "src/content.config.mts",
  "src/content.config.js",
  "src/content.config.mjs",
  "src/content/config.ts",
  "src/content/config.js",
  "src/content/config.mjs",
  "src/content/config.mts",
  "src/live.config.ts",
  "src/live.config.mts",
  "src/live.config.js",
  "src/live.config.mjs",
] as const;

export type DiscoveredAstroCollection = {
  name: string;
  configFile: string;
  live: boolean;
  adapter: CollectionSourceAdapter;
  formats: CollectionSourceFormat[];
  initializerStart: number;
  initializerEnd: number;
  initializerSource: string;
  contentDirectory?: string;
  filePattern?: string;
  sourceFile?: string;
  idStrategy: "path" | "slug" | "field" | "custom" | "astro-store";
  loaderName?: string;
  dynamic: boolean;
};

type ParsedConfig = {
  relative: string;
  source: string;
  sourceFile: ts.SourceFile;
  bindings: Map<string, ts.Expression>;
  live: boolean;
};

function scriptKind(file: string): ts.ScriptKind {
  if (/\.(?:mts|ts)$/i.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function readConfig(root: string, relative: string): ParsedConfig | null {
  const file = resolveWithinRoot(root, path.join(root, relative), { allowMissing: true });
  if (!existsSync(file)) return null;
  try {
    if (!statSync(file).isFile() || statSync(file).size > 2 * 1024 * 1024) return null;
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, scriptKind(relative));
    const bindings = new Map<string, ts.Expression>();
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          bindings.set(declaration.name.text, declaration.initializer);
        }
      }
    }
    return { relative, source, sourceFile, bindings, live: relative.includes("live.config") };
  } catch {
    return null;
  }
}

function unwrap(expression: ts.Expression, bindings: Map<string, ts.Expression>, seen = new Set<string>()): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  if (ts.isIdentifier(current) && !seen.has(current.text)) {
    const next = bindings.get(current.text);
    if (next) {
      seen.add(current.text);
      return unwrap(next, bindings, seen);
    }
  }
  return current;
}

function propertyName(node: ts.PropertyName | ts.BindingName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function objectEntries(
  expression: ts.Expression,
  bindings: Map<string, ts.Expression>,
  seen = new Set<ts.Expression>(),
): Array<{ name: string; expression: ts.Expression }> {
  const resolved = unwrap(expression, bindings);
  if (!ts.isObjectLiteralExpression(resolved) || seen.has(resolved)) return [];
  seen.add(resolved);
  const entries: Array<{ name: string; expression: ts.Expression }> = [];
  for (const property of resolved.properties) {
    if (ts.isPropertyAssignment(property)) {
      const name = propertyName(property.name);
      if (name) entries.push({ name, expression: property.initializer });
      continue;
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      entries.push({ name: property.name.text, expression: property.name });
      continue;
    }
    if (ts.isSpreadAssignment(property)) {
      entries.push(...objectEntries(property.expression, bindings, seen));
    }
  }
  return entries;
}

function staticString(expression: ts.Expression | undefined, bindings: Map<string, ts.Expression>): string | null {
  if (!expression) return null;
  const resolved = unwrap(expression, bindings);
  if (ts.isStringLiteralLike(resolved) || ts.isNoSubstitutionTemplateLiteral(resolved)) return resolved.text;
  return null;
}

function callName(expression: ts.LeftHandSideExpression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return "";
}

function callExpression(expression: ts.Expression | undefined, bindings: Map<string, ts.Expression>): ts.CallExpression | null {
  if (!expression) return null;
  const resolved = unwrap(expression, bindings);
  return ts.isCallExpression(resolved) ? resolved : null;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  bindings: Map<string, ts.Expression>,
): ts.Expression | undefined {
  return objectEntries(object, bindings).find((entry) => entry.name === name)?.expression;
}

function formatsForPattern(pattern: string): CollectionSourceFormat[] {
  const lower = pattern.toLowerCase();
  const formats: CollectionSourceFormat[] = [];
  if (/(?:^|[^a-z])md(?:[^a-z]|$)/.test(lower)) formats.push("markdown");
  if (/(?:^|[^a-z])mdx(?:[^a-z]|$)/.test(lower)) formats.push("mdx");
  if (/(?:^|[^a-z])mdoc(?:[^a-z]|$)/.test(lower)) formats.push("markdoc");
  if (/(?:^|[^a-z])json(?:[^a-z]|$)/.test(lower)) formats.push("json");
  if (/(?:^|[^a-z])ya?ml(?:[^a-z]|$)/.test(lower)) formats.push("yaml");
  if (/(?:^|[^a-z])toml(?:[^a-z]|$)/.test(lower)) formats.push("toml");
  return formats.length ? formats : ["custom"];
}

function formatsForFile(file: string): CollectionSourceFormat[] {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".json") return ["json"];
  if (extension === ".yaml" || extension === ".yml") return ["yaml"];
  if (extension === ".toml") return ["toml"];
  return ["custom"];
}

function normalizedProjectPath(value: string): string | null {
  const normalized = path.posix.normalize(value.replace(/^\.\//, "").replace(/\\/g, "/"));
  if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

function discoverInitializer(
  config: ParsedConfig,
  name: string,
  expression: ts.Expression,
): DiscoveredAstroCollection {
  const resolved = unwrap(expression, config.bindings);
  const definitionCall = ts.isCallExpression(resolved) ? resolved : null;
  const definitionName = definitionCall ? callName(definitionCall.expression) : "";
  const initializer = definitionCall && (definitionName === "defineCollection" || definitionName === "defineLiveCollection")
    ? definitionCall
    : null;
  const optionsExpression = initializer?.arguments[0]
    ? unwrap(initializer.arguments[0], config.bindings)
    : null;
  const options = optionsExpression && ts.isObjectLiteralExpression(optionsExpression) ? optionsExpression : null;
  const loaderExpression = options ? objectProperty(options, "loader", config.bindings) : undefined;
  const loaderCall = callExpression(loaderExpression, config.bindings);
  const loaderName = loaderCall ? callName(loaderCall.expression) : undefined;
  const legacy = !config.live && config.relative.includes("src/content/config.") && !loaderExpression;

  let adapter: CollectionSourceAdapter = config.live ? "astro-live" : legacy ? "legacy-directory" : "astro-store";
  let formats: CollectionSourceFormat[] = legacy ? ["markdown", "mdx", "markdoc", "json", "yaml", "toml"] : ["custom"];
  let contentDirectory: string | undefined;
  let filePattern: string | undefined;
  let sourceFile: string | undefined;
  let idStrategy: DiscoveredAstroCollection["idStrategy"] = config.live ? "astro-store" : "path";
  let dynamic = !initializer;

  if (legacy) {
    contentDirectory = `src/content/${name}`;
    filePattern = "**/*.{md,mdx,mdoc,json,yaml,yml,toml}";
    dynamic = false;
  } else if (loaderName === "glob" && loaderCall) {
    const loaderOptionsExpression = loaderCall.arguments[0]
      ? unwrap(loaderCall.arguments[0], config.bindings)
      : null;
    const loaderOptions = loaderOptionsExpression && ts.isObjectLiteralExpression(loaderOptionsExpression)
      ? loaderOptionsExpression
      : null;
    const base = loaderOptions
      ? staticString(objectProperty(loaderOptions, "base", config.bindings), config.bindings)
      : null;
    const pattern = loaderOptions
      ? staticString(objectProperty(loaderOptions, "pattern", config.bindings), config.bindings)
      : null;
    const generateId = loaderOptions ? objectProperty(loaderOptions, "generateId", config.bindings) : undefined;
    const normalizedBase = base ? normalizedProjectPath(base) : null;
    adapter = normalizedBase && pattern && !generateId ? "astro-glob" : "astro-store";
    contentDirectory = normalizedBase ?? undefined;
    filePattern = pattern ?? undefined;
    formats = pattern ? formatsForPattern(pattern) : ["custom"];
    idStrategy = generateId ? "custom" : "path";
    dynamic = !normalizedBase || !pattern || Boolean(generateId);
  } else if (loaderName === "file" && loaderCall) {
    const file = staticString(loaderCall.arguments[0], config.bindings);
    const normalizedFile = file ? normalizedProjectPath(file) : null;
    const optionsExpression = loaderCall.arguments[1]
      ? unwrap(loaderCall.arguments[1], config.bindings)
      : null;
    const parser = optionsExpression && ts.isObjectLiteralExpression(optionsExpression)
      ? objectProperty(optionsExpression, "parser", config.bindings)
      : undefined;
    adapter = normalizedFile && !parser ? "astro-file" : "astro-store";
    sourceFile = normalizedFile ?? undefined;
    formats = normalizedFile ? formatsForFile(normalizedFile) : ["custom"];
    idStrategy = "field";
    dynamic = !normalizedFile || Boolean(parser);
  }

  if (definitionName === "defineLiveCollection") adapter = "astro-live";
  const start = initializer?.getStart(config.sourceFile) ?? resolved.getStart(config.sourceFile);
  const end = initializer?.getEnd() ?? resolved.getEnd();
  return {
    name,
    configFile: config.relative,
    live: config.live || definitionName === "defineLiveCollection",
    adapter,
    formats,
    initializerStart: start,
    initializerEnd: end,
    initializerSource: config.source.slice(start, end),
    ...(contentDirectory ? { contentDirectory } : {}),
    ...(filePattern ? { filePattern } : {}),
    ...(sourceFile ? { sourceFile } : {}),
    idStrategy,
    ...(loaderName ? { loaderName } : {}),
    dynamic,
  };
}

function collectionsExpression(config: ParsedConfig): ts.Expression | null {
  const direct = config.bindings.get("collections");
  if (direct) return direct;
  for (const statement of config.sourceFile.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
    const expression = unwrap(statement.expression, config.bindings);
    if (ts.isObjectLiteralExpression(expression)) return expression;
  }
  return null;
}

export function discoverAstroCollections(projectPath: string): DiscoveredAstroCollection[] {
  const root = resolveWithinRoot(projectPath, projectPath);
  const result = new Map<string, DiscoveredAstroCollection>();
  for (const relative of ASTRO_COLLECTION_CONFIG_FILES) {
    const config = readConfig(root, relative);
    if (!config) continue;
    const expression = collectionsExpression(config);
    if (!expression) continue;
    for (const entry of objectEntries(expression, config.bindings)) {
      const discovered = discoverInitializer(config, entry.name, entry.expression);
      result.set(`${discovered.live ? "live" : "content"}:${discovered.name}`, discovered);
    }
  }
  return [...result.values()];
}
