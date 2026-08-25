import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { FieldSchema } from "../../shared/cms";
import type {
  ProjectLocaleResolver,
  ProjectTranslationAdoptionAssessment,
  ProjectTranslationAdoptionInput,
  ProjectTranslationAdoptionResult,
  ProjectTranslationCatalog,
  ProjectTranslationCatalogResult,
  ProjectTranslationConsumer,
  ProjectTranslationCutoverInput,
  ProjectTranslationCutoverResult,
  ProjectTranslationEditInput,
  ProjectTranslationEditResult,
  ProjectTranslationKey,
  ProjectTranslationNamespace,
  ProjectTranslationScalar,
  TranslationCoverageIssue,
} from "../../shared/composer/projectTranslations";
import { canonicalDirectory, resolveWithinRoot, writeTextFileAtomic } from "../pathSafety";
import { fallbackChain } from "../../shared/localization";
import { markSelfWrite } from "./selfWrite";
import {
  TranslationCatalogWorkerRegistry,
  type TranslationCatalogWorker,
} from "./translationCatalogWorkerLifecycle";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_FILES = 2_000;
const TRANSLATION_WORKER_TIMEOUT_MS = 60_000;
const CANDIDATE_NAME = /(?:^|[/_.-])(i18n|l10n|locale|locales|messages?|translations?)(?:[/_.-]|$)/i;
const SCALAR_KINDS = new Set(["string", "number", "boolean"]);

type Leaf = {
  value: ProjectTranslationScalar;
  file: string;
  range: { from: number; to: number };
};

type LiteralTree = ProjectTranslationScalar | { [key: string]: LiteralTree } | LiteralTree[];

type Evaluated = {
  value: LiteralTree;
  leaves: Map<string, Leaf>;
};

type ModuleRecord = {
  absoluteFile: string;
  relativeFile: string;
  source: string;
  sourceFile: ts.SourceFile;
  declarations: Map<string, ts.Expression>;
  imports: Map<string, { imported: string; specifier: string }>;
  exports: Array<{ name: string; expression: ts.Expression }>;
};

type CachedRegistry = {
  generation: number;
  promise: Promise<ProjectTranslationCatalogResult>;
};

const registryCache = new Map<string, CachedRegistry>();
const registryGeneration = new Map<string, number>();
const translationWorkers = new TranslationCatalogWorkerRegistry();

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identifier(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_$]+(.)?/g, (_match, next: string | undefined) => next?.toUpperCase() ?? "");
  return (/^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`) || "translation";
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function titleCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function slugify(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "translations";
}

function canonicalLocale(value: string): string | null {
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null;
  } catch {
    return null;
  }
}

function configuredDefaultLocale(root: string): string | undefined {
  try {
    const settings = JSON.parse(
      fs.readFileSync(path.join(root, ".aria", "site-settings.json"), "utf8"),
    ) as { localization?: { content?: { defaultLocale?: unknown } } };
    const locale = settings.localization?.content?.defaultLocale;
    return typeof locale === "string" && locale.trim()
      ? canonicalLocale(locale.trim()) ?? undefined
      : undefined;
  } catch {
    return undefined;
  }
}

function readSmallFile(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= MAX_SOURCE_BYTES
      ? fs.readFileSync(file, "utf8")
      : null;
  } catch {
    return null;
  }
}

function scriptKind(file: string): ts.ScriptKind {
  if (/\.tsx$/i.test(file)) return ts.ScriptKind.TSX;
  if (/\.(?:js|mjs|cjs|jsx)$/i.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) current = current.expression;
  return current;
}

function propertyName(name: ts.PropertyName, sourceFile: ts.SourceFile): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) return name.expression.text;
  const text = name.getText(sourceFile);
  return /^['"][^'"]+['"]$/.test(text) ? text.slice(1, -1) : null;
}

function parseModule(root: string, absoluteFile: string, cache: Map<string, ModuleRecord>): ModuleRecord | null {
  const safe = resolveWithinRoot(root, absoluteFile, { rejectFinalSymlink: true });
  const existing = cache.get(safe);
  if (existing) return existing;
  const source = readSmallFile(safe);
  if (source == null || !/\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i.test(safe)) return null;
  const sourceFile = ts.createSourceFile(safe, source, ts.ScriptTarget.Latest, true, scriptKind(safe));
  const record: ModuleRecord = {
    absoluteFile: safe,
    relativeFile: toPosix(path.relative(root, safe)),
    source,
    sourceFile,
    declarations: new Map(),
    imports: new Map(),
    exports: [],
  };
  cache.set(safe, record);
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      if (statement.importClause.name) record.imports.set(statement.importClause.name.text, { imported: "default", specifier });
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          record.imports.set(element.name.text, {
            imported: element.propertyName?.text ?? element.name.text,
            specifier,
          });
        }
      }
    }
    if (ts.isVariableStatement(statement)) {
      const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        record.declarations.set(declaration.name.text, declaration.initializer);
        if (exported) record.exports.push({ name: declaration.name.text, expression: declaration.initializer });
      }
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      record.exports.push({ name: "default", expression: statement.expression });
    }
  }
  return record;
}

function resolveModuleFile(root: string, owner: ModuleRecord, specifier: string): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;
  const base = path.resolve(path.dirname(owner.absoluteFile), specifier);
  const candidates = [
    base,
    ...[".ts", ".tsx", ".js", ".mjs", ".cjs", ".mts", ".cts", ".json"].map((extension) => `${base}${extension}`),
    ...["index.ts", "index.js", "index.json"].map((file) => path.join(base, file)),
  ];
  for (const candidate of candidates) {
    try {
      const safe = resolveWithinRoot(root, candidate, { rejectFinalSymlink: true });
      if (fs.statSync(safe).isFile()) return safe;
    } catch {
      // Try the next statically resolved candidate.
    }
  }
  return null;
}

function jsonEvaluated(root: string, absoluteFile: string, pathParts: string[] = []): Evaluated | null {
  const safe = resolveWithinRoot(root, absoluteFile, { rejectFinalSymlink: true });
  const source = readSmallFile(safe);
  if (source == null) return null;
  try {
    const parsed = ts.parseJsonText(safe, source);
    const statement = parsed.statements[0];
    if (!statement || !ts.isExpressionStatement(statement)) return null;
    const record: ModuleRecord = {
      absoluteFile: safe,
      relativeFile: toPosix(path.relative(root, safe)),
      source,
      sourceFile: parsed,
      declarations: new Map(),
      imports: new Map(),
      exports: [],
    };
    return evaluateExpression(root, record, statement.expression, new Map(), pathParts);
  } catch {
    return null;
  }
}

function evaluateExpression(
  root: string,
  module: ModuleRecord,
  expression: ts.Expression,
  moduleCache: Map<string, ModuleRecord>,
  pathParts: string[] = [],
  seen = new Set<string>(),
): Evaluated {
  const current = unwrap(expression);
  const leaves = new Map<string, Leaf>();
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    const value = current.text;
    leaves.set(pathParts.join("."), { value, file: module.relativeFile, range: { from: current.getStart(module.sourceFile), to: current.getEnd() } });
    return { value, leaves };
  }
  if (ts.isNumericLiteral(current)) {
    const value = Number(current.text);
    leaves.set(pathParts.join("."), { value, file: module.relativeFile, range: { from: current.getStart(module.sourceFile), to: current.getEnd() } });
    return { value, leaves };
  }
  if (current.kind === ts.SyntaxKind.TrueKeyword || current.kind === ts.SyntaxKind.FalseKeyword || current.kind === ts.SyntaxKind.NullKeyword) {
    const value = current.kind === ts.SyntaxKind.TrueKeyword ? true : current.kind === ts.SyntaxKind.FalseKeyword ? false : null;
    leaves.set(pathParts.join("."), { value, file: module.relativeFile, range: { from: current.getStart(module.sourceFile), to: current.getEnd() } });
    return { value, leaves };
  }
  if (ts.isPrefixUnaryExpression(current) && ts.isNumericLiteral(current.operand)) {
    const value = current.operator === ts.SyntaxKind.MinusToken ? -Number(current.operand.text) : Number(current.operand.text);
    leaves.set(pathParts.join("."), { value, file: module.relativeFile, range: { from: current.getStart(module.sourceFile), to: current.getEnd() } });
    return { value, leaves };
  }
  if (ts.isIdentifier(current)) {
    const key = `${module.absoluteFile}:${current.text}`;
    if (seen.has(key)) throw new Error(`Circular value at ${pathParts.join(".") || current.text}`);
    const nextSeen = new Set(seen).add(key);
    const local = module.declarations.get(current.text);
    if (local) return evaluateExpression(root, module, local, moduleCache, pathParts, nextSeen);
    const imported = module.imports.get(current.text);
    const importedFile = imported && resolveModuleFile(root, module, imported.specifier);
    if (!imported || !importedFile) throw new Error(`Computed value ${current.text}`);
    if (importedFile.endsWith(".json")) {
      const parsed = jsonEvaluated(root, importedFile, pathParts);
      if (!parsed) throw new Error(`Invalid JSON import ${imported.specifier}`);
      return parsed;
    }
    const importedModule = parseModule(root, importedFile, moduleCache);
    const target = importedModule?.exports.find((item) => item.name === imported.imported);
    if (!importedModule || !target) throw new Error(`Unresolved import ${imported.specifier}`);
    return evaluateExpression(root, importedModule, target.expression, moduleCache, pathParts, nextSeen);
  }
  if (ts.isObjectLiteralExpression(current)) {
    const value: Record<string, LiteralTree> = {};
    for (const property of current.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        throw new Error(`Unsupported object member at ${pathParts.join(".") || "catalog"}`);
      }
      const name = propertyName(property.name, module.sourceFile);
      if (!name) throw new Error(`Computed object key at ${pathParts.join(".") || "catalog"}`);
      const evaluated = evaluateExpression(
        root,
        module,
        ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer,
        moduleCache,
        [...pathParts, name],
        seen,
      );
      value[name] = evaluated.value;
      for (const [key, leaf] of evaluated.leaves) leaves.set(key, leaf);
    }
    return { value, leaves };
  }
  if (ts.isArrayLiteralExpression(current)) {
    const value: LiteralTree[] = [];
    current.elements.forEach((element, index) => {
      if (!ts.isExpression(element) || ts.isSpreadElement(element)) throw new Error(`Unsupported array value at ${pathParts.join(".")}`);
      const evaluated = evaluateExpression(root, module, element, moduleCache, [...pathParts, String(index)], seen);
      value.push(evaluated.value);
      for (const [key, leaf] of evaluated.leaves) leaves.set(key, leaf);
    });
    return { value, leaves };
  }
  throw new Error(`Computed value at ${pathParts.join(".") || "catalog"}`);
}

function isGeneratedTranslationPath(relativeFile: string): boolean {
  const normalized = toPosix(relativeFile).toLowerCase();
  return (
    normalized.endsWith(".d.ts") ||
    normalized.startsWith("src/paraglide/") ||
    normalized.startsWith("src/generated/")
  );
}

function isGeneratedTranslationDirectory(relativeDirectory: string): boolean {
  const normalized = toPosix(relativeDirectory).toLowerCase().replace(/\/+$/, "");
  return normalized === "src/paraglide" || normalized === "src/generated";
}

export function isTranslationRegistryChange(relativeFile: string): boolean {
  const normalized = toPosix(relativeFile).replace(/^\.\//, "");
  if (!normalized) return true;
  if (isGeneratedTranslationPath(normalized)) return false;
  if (/\.astro$/i.test(normalized)) return true;
  if (normalized.toLowerCase() === ".aria/site-settings.json") return true;
  return (
    /\.(?:ts|js|mjs|cjs|mts|cts|json)$/i.test(normalized) &&
    CANDIDATE_NAME.test(normalized)
  );
}

export function translationCandidateFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    if (files.length >= MAX_SOURCE_FILES) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= MAX_SOURCE_FILES) break;
      if (entry.name.startsWith(".") || ["node_modules", "dist", "build", "coverage"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!isGeneratedTranslationDirectory(path.relative(root, absolute))) walk(absolute);
      }
      else {
        const relative = toPosix(path.relative(root, absolute));
        if (
          /\.(?:ts|js|mjs|cjs|mts|cts|json)$/i.test(entry.name) &&
          CANDIDATE_NAME.test(relative) &&
          !isGeneratedTranslationPath(relative)
        ) files.push(absolute);
      }
    }
  };
  const src = path.join(root, "src");
  walk(fs.existsSync(src) ? src : root);
  return files;
}

function isObject(value: LiteralTree): value is { [key: string]: LiteralTree } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function localeEntries(value: LiteralTree): Array<[string, { [key: string]: LiteralTree }]> {
  if (!isObject(value)) return [];
  const entries: Array<[string, { [key: string]: LiteralTree }]> = [];
  for (const [rawLocale, localeValue] of Object.entries(value)) {
    const locale = canonicalLocale(rawLocale);
    if (!locale || !isObject(localeValue)) return [];
    entries.push([locale, localeValue]);
  }
  return entries.length >= 2 ? entries : [];
}

function flattenTree(value: LiteralTree, prefix: string[] = [], output = new Map<string, ProjectTranslationScalar>()): Map<string, ProjectTranslationScalar> {
  if (value === null || SCALAR_KINDS.has(typeof value)) {
    output.set(prefix.join("."), value as ProjectTranslationScalar);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => flattenTree(item, [...prefix, String(index)], output));
  } else {
    Object.entries(value).forEach(([key, item]) => flattenTree(item, [...prefix, key], output));
  }
  return output;
}

function detectResolver(root: string): ProjectLocaleResolver {
  const files = translationCandidateFiles(root).filter((file) => /\.(?:ts|js|astro)$/i.test(file)).slice(0, 500);
  for (const file of files) {
    const source = readSmallFile(file);
    const match = source && /searchParams\.get\(\s*["']([A-Za-z][A-Za-z0-9_-]*)["']\s*\)/.exec(source);
    if (match?.[1]) return { kind: "query-param", parameter: match[1] };
  }
  return { kind: "path-prefix" };
}

function importResolvesTo(root: string, ownerFile: string, specifier: string, sourceFile: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const base = path.resolve(path.dirname(ownerFile), specifier);
  const target = path.resolve(root, sourceFile).replace(/\.(?:ts|js|mjs|cjs|mts|cts|json)$/i, "");
  return base.replace(/\.(?:ts|js|mjs|cjs|mts|cts|json)$/i, "") === target;
}

function scanConsumers(root: string, catalog: ProjectTranslationCatalog): ProjectTranslationConsumer[] {
  const results: ProjectTranslationConsumer[] = [];
  const walk = (directory: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || ["node_modules", "dist", "build"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) { walk(absolute); continue; }
      if (!entry.name.endsWith(".astro")) continue;
      const source = readSmallFile(absolute);
      if (!source || !source.includes(catalog.exportName)) continue;
      const importPattern = new RegExp(`import\\s*\\{[^}]*\\b${catalog.exportName}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`);
      const importMatch = importPattern.exec(source);
      if (!importMatch?.[1] || !importResolvesTo(root, absolute, importMatch[1], catalog.sourceFile)) continue;
      const aliasPattern = new RegExp(`const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${catalog.exportName}\\[([^\\]]+)\\]\\.([A-Za-z_$][\\w$]*)\\s*;?`, "g");
      for (const alias of source.matchAll(aliasPattern)) {
        const contextVariable = alias[1]!;
        const localeExpression = alias[2]!.trim();
        const namespace = alias[3]!;
        const expressionPattern = new RegExp(`\\b${contextVariable}((?:\\??\\.[A-Za-z_$][\\w$]*)+)`, "g");
        for (const occurrence of source.matchAll(expressionPattern)) {
          const expression = occurrence[0]!;
          if ((occurrence.index ?? -1) >= (alias.index ?? 0) && (occurrence.index ?? 0) < (alias.index ?? 0) + alias[0].length) continue;
          const keyPath = occurrence[1]!.replace(/\?/g, "").split(".").filter(Boolean);
          const key = catalog.namespaces.find((item) => item.name === namespace)?.keys.find((item) => item.path.join(".") === keyPath.join("."));
          const from = occurrence.index ?? 0;
          results.push({
            id: sha256(`${toPosix(path.relative(root, absolute))}:${from}:${expression}`).slice(0, 16),
            file: toPosix(path.relative(root, absolute)),
            expression,
            namespace,
            keyPath,
            contextVariable,
            localeExpression,
            sourceHash: sha256(source),
            sourceRange: { from, to: from + expression.length },
            status: key?.complete ? "safe" : "manual",
            ...(!key?.complete ? { reason: "The key is missing from one or more catalog locales." } : {}),
          });
        }
      }
    }
  };
  walk(path.join(root, "src"));
  return results;
}

function buildCatalog(
  root: string,
  module: ModuleRecord,
  exportName: string,
  evaluated: Evaluated,
  resolver: ProjectLocaleResolver,
): ProjectTranslationCatalog | null {
  const locales = localeEntries(evaluated.value);
  if (!locales.length) return null;
  const localeCodes = locales.map(([locale]) => locale);
  const localeSourceNames = new Map(
    Object.keys(evaluated.value as Record<string, LiteralTree>)
      .map((raw) => [canonicalLocale(raw), raw] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0])),
  );
  const settingsDefault = configuredDefaultLocale(root);
  const defaultLocale = settingsDefault && localeCodes.includes(settingsDefault) ? settingsDefault : localeCodes[0]!;
  const namespaceNames = [...new Set(locales.flatMap(([, value]) => Object.keys(value)))];
  const diagnostics: TranslationCoverageIssue[] = [];
  const namespaces: ProjectTranslationNamespace[] = namespaceNames.map((namespace): ProjectTranslationNamespace => {
    const flattened = new Map<string, Map<string, ProjectTranslationScalar>>();
    for (const [locale, value] of locales) {
      const namespaceValue = value[namespace];
      flattened.set(locale, namespaceValue === undefined ? new Map() : flattenTree(namespaceValue));
    }
    const paths = [...new Set([...flattened.values()].flatMap((values) => [...values.keys()]))].sort();
    const keys: ProjectTranslationKey[] = paths.map((key): ProjectTranslationKey => {
      const keyPath = key.split(".").filter(Boolean);
      const values: ProjectTranslationKey["values"] = {};
      const sourceRanges: ProjectTranslationKey["sourceRanges"] = {};
      const sourceFiles: ProjectTranslationKey["sourceFiles"] = {};
      for (const locale of localeCodes) {
        values[locale] = flattened.get(locale)?.get(key);
        const leaf = evaluated.leaves.get([localeSourceNames.get(locale) ?? locale, namespace, ...keyPath].join("."));
        sourceRanges[locale] = leaf?.range;
        sourceFiles[locale] = leaf?.file;
        if (values[locale] === undefined) diagnostics.push({
          kind: "missing-key",
          namespace,
          keyPath,
          locale,
          message: `${locale} is missing ${namespace}.${key}`,
        });
      }
      return {
        path: keyPath,
        label: keyPath.map(titleCase).join(" · "),
        values,
        sourceRanges,
        sourceFiles,
        complete: localeCodes.every((locale) => values[locale] !== undefined),
        editable: localeCodes.every((locale) => Boolean(sourceRanges[locale] && sourceFiles[locale])),
      };
    });
    return { id: `${slugify(exportName)}-${slugify(namespace)}`, name: namespace, label: titleCase(namespace), keys };
  });
  const sourceFiles = [...new Set([...evaluated.leaves.values()].map((leaf) => leaf.file))].map((file) => ({
    file,
    hash: sha256(fs.readFileSync(path.join(root, file), "utf8")),
  }));
  const aggregateHash = sha256(sourceFiles.map((file) => `${file.file}:${file.hash}`).sort().join("\n"));
  const id = sha256(`${module.relativeFile}:${exportName}`).slice(0, 16);
  const catalog: ProjectTranslationCatalog = {
    id,
    label: titleCase(exportName === "default" ? path.basename(module.relativeFile).replace(/\.[^.]+$/, "") : exportName),
    sourceFile: module.relativeFile,
    sourceHash: aggregateHash,
    sourceFiles,
    exportName,
    locales: localeCodes,
    defaultLocale,
    resolver,
    namespaces,
    diagnostics,
    consumers: [],
    capabilities: { read: true, editScalar: true, adopt: true, bind: true },
  };
  catalog.consumers = scanConsumers(root, catalog);
  return catalog;
}

export async function discoverProjectTranslationCatalogsInProcess(root: string): Promise<ProjectTranslationCatalogResult> {
  const startedAt = Date.now();
  const moduleCache = new Map<string, ModuleRecord>();
  const resolver = detectResolver(root);
  const catalogs: ProjectTranslationCatalog[] = [];
  const unsupported: ProjectTranslationCatalogResult["unsupported"] = [];
  for (const absoluteFile of translationCandidateFiles(root)) {
    if (absoluteFile.endsWith(".json")) {
      const evaluated = jsonEvaluated(root, absoluteFile);
      if (!evaluated) {
        unsupported.push({ sourceFile: toPosix(path.relative(root, absoluteFile)), exportName: "default", reason: "Invalid or non-literal JSON catalog." });
        continue;
      }
      const source = fs.readFileSync(absoluteFile, "utf8");
      const sourceFile = ts.createSourceFile(absoluteFile, "", ts.ScriptTarget.Latest);
      const module: ModuleRecord = {
        absoluteFile,
        relativeFile: toPosix(path.relative(root, absoluteFile)),
        source,
        sourceFile,
        declarations: new Map(),
        imports: new Map(),
        exports: [],
      };
      const catalog = buildCatalog(root, module, "default", evaluated, resolver);
      if (catalog) catalogs.push(catalog);
      continue;
    }
    const module = parseModule(root, absoluteFile, moduleCache);
    if (!module) continue;
    for (const exported of module.exports) {
      try {
        const evaluated = evaluateExpression(root, module, exported.expression, moduleCache);
        const catalog = buildCatalog(root, module, exported.name, evaluated, resolver);
        if (catalog) catalogs.push(catalog);
      } catch (cause) {
        unsupported.push({
          sourceFile: module.relativeFile,
          exportName: exported.name,
          reason: cause instanceof Error ? cause.message : "The export is not statically analyzable.",
        });
      }
    }
  }
  const unique = catalogs.filter((catalog, index) => catalogs.findIndex((candidate) => candidate.id === catalog.id) === index);
  console.info(
    `[aria:perf] Translation discovery completed in ${Date.now() - startedAt}ms across ${moduleCache.size} parsed modules.`,
  );
  return { catalogs: unique, unsupported, scannedAt: new Date().toISOString() };
}

async function discover(root: string): Promise<ProjectTranslationCatalogResult> {
  if (!process.versions.electron || process.env.VITEST) {
    return discoverProjectTranslationCatalogsInProcess(root);
  }
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const electronOutputDirectory = path.basename(moduleDirectory) === "chunks"
    ? path.dirname(moduleDirectory)
    : moduleDirectory;
  const worker = new Worker(
    path.join(electronOutputDirectory, "translation-catalog-worker.mjs"),
    { workerData: { root } },
  );
  return translationWorkers.run(
    root,
    worker as unknown as TranslationCatalogWorker,
    TRANSLATION_WORKER_TIMEOUT_MS,
  );
}

export function invalidateTranslationCatalogRegistry(projectPath: string): void {
  const root = canonicalDirectory(projectPath);
  translationWorkers.cancel(root);
  registryGeneration.set(root, (registryGeneration.get(root) ?? 0) + 1);
  registryCache.delete(root);
}

export function disposeTranslationCatalogRegistry(projectPath: string): void {
  const root = canonicalDirectory(projectPath);
  translationWorkers.cancel(root);
  registryCache.delete(root);
  registryGeneration.delete(root);
}

export function listProjectTranslationCatalogs(projectPath: string, refresh = false): Promise<ProjectTranslationCatalogResult> {
  const root = canonicalDirectory(projectPath);
  if (refresh) invalidateTranslationCatalogRegistry(root);
  const generation = registryGeneration.get(root) ?? 0;
  const cached = registryCache.get(root);
  if (cached && cached.generation === generation) return cached.promise;
  const promise = discover(root);
  registryCache.set(root, { generation, promise });
  return promise;
}

export function warmTranslationCatalogRegistry(projectPath: string): void {
  void listProjectTranslationCatalogs(projectPath).catch(() => undefined);
}

function literal(value: ProjectTranslationScalar): string {
  return value === null ? "null" : typeof value === "string" ? JSON.stringify(value) : String(value);
}

export async function editProjectTranslationValue(projectPath: string, input: ProjectTranslationEditInput): Promise<ProjectTranslationEditResult> {
  const root = canonicalDirectory(projectPath);
  const result = await listProjectTranslationCatalogs(root);
  const catalog = result.catalogs.find((item) => item.id === input.catalogId);
  if (!catalog) throw new Error("TRANSLATION_CATALOG_NOT_FOUND: Refresh the project catalog and try again.");
  if (catalog.sourceHash !== input.expectedSourceHash) throw new Error("TRANSLATION_CATALOG_CONFLICT: The catalog changed after it was loaded.");
  const namespace = catalog.namespaces.find((item) => item.name === input.namespace);
  const key = namespace?.keys.find((item) => item.path.join(".") === input.keyPath.join("."));
  const relativeFile = key?.sourceFiles[input.locale];
  const range = key?.sourceRanges[input.locale];
  if (!key || !relativeFile || !range) throw new Error("TRANSLATION_VALUE_UNWRITABLE: The value is not a direct literal.");
  const known = catalog.sourceFiles.find((item) => item.file === relativeFile);
  const absolute = resolveWithinRoot(root, path.join(root, relativeFile), { rejectFinalSymlink: true });
  const source = fs.readFileSync(absolute, "utf8");
  if (!known || sha256(source) !== known.hash) throw new Error("TRANSLATION_CATALOG_CONFLICT: The source file changed on disk.");
  const next = `${source.slice(0, range.from)}${literal(input.value)}${source.slice(range.to)}`;
  writeTextFileAtomic(absolute, next);
  markSelfWrite(absolute);
  invalidateTranslationCatalogRegistry(root);
  const refreshed = await listProjectTranslationCatalogs(root);
  const nextCatalog = refreshed.catalogs.find((item) => item.id === input.catalogId);
  return { ok: true, sourceFile: relativeFile, sourceHash: nextCatalog?.sourceHash ?? sha256(next), value: input.value };
}

function setAtPath(target: Record<string, unknown>, pathParts: readonly string[], value: unknown): void {
  let current = target;
  pathParts.forEach((segment, index) => {
    if (index === pathParts.length - 1) current[segment] = value;
    else {
      const next = current[segment];
      current = next && typeof next === "object" && !Array.isArray(next)
        ? next as Record<string, unknown>
        : (current[segment] = {}) as Record<string, unknown>;
    }
  });
}

function namespaceValue(namespace: ProjectTranslationNamespace, locale: string): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const key of namespace.keys) if (key.values[locale] !== undefined) setAtPath(value, key.path, key.values[locale]);
  return value;
}

function inferFields(values: Record<string, unknown>[], prefix = ""): FieldSchema[] {
  const keys = [...new Set(values.flatMap((value) => Object.keys(value)))];
  return keys.map((key): FieldSchema => {
    const candidates = values.map((value) => value[key]).filter((value) => value !== undefined);
    const required = candidates.length === values.length;
    if (candidates.every((value) => value && typeof value === "object" && !Array.isArray(value))) {
      return {
        key,
        label: titleCase(key),
        type: "object",
        required,
        fields: inferFields(candidates as Record<string, unknown>[], prefix ? `${prefix}.${key}` : key),
      };
    }
    if (candidates.every((value) => typeof value === "boolean")) return { key, label: titleCase(key), type: "boolean", required };
    if (candidates.every((value) => typeof value === "number")) return { key, label: titleCase(key), type: "number", required };
    if (candidates.every((value) => typeof value === "string")) return { key, label: titleCase(key), type: "string", required };
    return { key, label: titleCase(key), type: "json", required };
  });
}

export async function assessProjectTranslationAdoption(projectPath: string, input: ProjectTranslationAdoptionInput): Promise<ProjectTranslationAdoptionAssessment> {
  const [{ readCollections }, { readSiteSettings }] = await Promise.all([
    import("../collections"),
    import("../siteSettings"),
  ]);
  const root = canonicalDirectory(projectPath);
  const result = await listProjectTranslationCatalogs(root);
  const catalog = result.catalogs.find((item) => item.id === input.catalogId);
  if (!catalog) throw new Error("TRANSLATION_CATALOG_NOT_FOUND: Refresh the project catalog and try again.");
  if (input.expectedCatalogHash && input.expectedCatalogHash !== catalog.sourceHash) throw new Error("TRANSLATION_CATALOG_CONFLICT: Review the catalog again.");
  const existing = readCollections(root).collections;
  const selected = new Set(input.namespaces);
  const namespaces = catalog.namespaces.filter((item) => selected.has(item.name)).map((namespace) => {
    const collectionName = slugify(`${catalog.label}-${namespace.name}`);
    return {
      namespace: namespace.name,
      label: namespace.label,
      collectionName,
      collectionLabel: `${namespace.label} translations`,
      schema: inferFields(catalog.locales.map((locale) => namespaceValue(namespace, locale))),
      locales: catalog.locales,
      issues: catalog.diagnostics.filter((issue) => issue.namespace === namespace.name),
      consumers: catalog.consumers.filter((consumer) => consumer.namespace === namespace.name),
      ...(existing.some((collection) => collection.name === collectionName) ? { conflict: `Collection ${collectionName} already exists.` } : {}),
    };
  });
  const localization = readSiteSettings(root).localization?.content;
  const settingsCompatible = Boolean(localization && catalog.locales.every((locale) => localization.locales.some((item) => item.code === locale && item.enabled)) && JSON.stringify(localization.resolver ?? { kind: "path-prefix" }) === JSON.stringify(catalog.resolver));
  const stable = { catalogId: catalog.id, catalogHash: catalog.sourceHash, defaultLocale: catalog.defaultLocale, settingsCompatible, namespaces };
  return {
    ...stable,
    previewHash: sha256(JSON.stringify(stable)),
    ...(!settingsCompatible ? { settingsReason: "Review and enable the detected locales and locale resolver in site settings before adoption." } : {}),
  };
}

export async function createProjectTranslationDrafts(projectPath: string, input: ProjectTranslationAdoptionInput & { expectedPreviewHash: string }): Promise<ProjectTranslationAdoptionResult> {
  const [{ readCollections }, { createEntry, updateEntry, writeCollectionsWithContentConfig }] = await Promise.all([
    import("../collections"),
    import("../cms"),
  ]);
  const root = canonicalDirectory(projectPath);
  const assessment = await assessProjectTranslationAdoption(root, input);
  if (assessment.previewHash !== input.expectedPreviewHash) throw new Error("TRANSLATION_CATALOG_CONFLICT: The adoption review is stale.");
  if (!assessment.settingsCompatible) throw new Error("TRANSLATION_LOCALES_NOT_CONFIGURED: Review detected localization before creating drafts.");
  const conflict = assessment.namespaces.find((item) => item.conflict);
  if (conflict) throw new Error(`CONFLICT: ${conflict.conflict}`);
  const catalog = (await listProjectTranslationCatalogs(root)).catalogs.find((item) => item.id === input.catalogId)!;
  const state = readCollections(root);
  const definitions = assessment.namespaces.map((item) => ({
    id: randomUUID(),
    name: item.collectionName,
    label: item.collectionLabel,
    kind: "config" as const,
    urlPattern: null,
    listPageFile: null,
    templatePageFile: null,
    schema: { fields: item.schema, version: 1 },
    supports: ["drafts", "revisions"] as import("../../shared/cms").CollectionSupport[],
    scope: "global" as const,
  }));
  writeCollectionsWithContentConfig(root, { collections: [...state.collections, ...definitions] });
  const targets: ProjectTranslationAdoptionResult["targets"] = [];
  for (const definition of definitions) {
    const reviewed = assessment.namespaces.find((item) => item.collectionName === definition.name)!;
    const namespace = catalog.namespaces.find((item) => item.name === reviewed.namespace)!;
    const sourceLocale = catalog.defaultLocale;
    let record = createEntry(root, {
      collectionId: definition.id,
      title: namespace.label,
      slug: slugify(namespace.name),
      locale: sourceLocale,
      frontmatter: namespaceValue(namespace, sourceLocale),
      status: "draft",
    });
    for (const locale of catalog.locales) {
      if (locale === sourceLocale) continue;
      record = updateEntry(root, {
        collectionId: definition.id,
        id: record.entry.id,
        version: record.entry.version,
        patch: {
          upsertLocale: {
            locale,
            title: namespace.label,
            slug: slugify(namespace.name),
            frontmatter: namespaceValue(namespace, locale),
            status: "draft",
            translationMeta: {
              method: "import",
              sourceLocale,
              sourceContentHash: catalog.sourceHash,
              generatedAt: new Date().toISOString(),
              translatedFieldPaths: namespace.keys.filter((key) => key.values[locale] !== undefined).map((key) => key.path.join(".")),
            },
          },
        },
      });
    }
    targets.push({ namespace: namespace.name, collectionId: definition.id, collectionName: definition.name, entryId: record.entry.id });
  }
  return { ok: true, sourceChanged: false, targets };
}

function ensureAstroContentImport(frontmatter: string): string {
  const pattern = /import\s*\{([^}]*)\}\s*from\s*["']astro:content["'];?/;
  const match = pattern.exec(frontmatter);
  if (!match) return `import { getCollection } from "astro:content";\n\n${frontmatter}`;
  const names = match[1]!.split(",").map((name) => name.trim()).filter(Boolean);
  if (names.some((name) => name.split(/\s+as\s+/)[0] === "getCollection")) return frontmatter;
  return frontmatter.replace(pattern, `import { ${[...names, "getCollection"].join(", ")} } from "astro:content";`);
}

function injectCutoverQueries(
  source: string,
  blocks: Array<{ id: string; source: string }>,
): string {
  if (!blocks.length) return source;
  const open = /^---\s*\r?\n/.exec(source);
  if (!open) throw new Error("TRANSLATION_CUTOVER_UNSUPPORTED: The Astro consumer has no frontmatter.");
  const closeAt = source.indexOf("\n---", open[0].length);
  if (closeAt < 0) throw new Error("TRANSLATION_CUTOVER_UNSUPPORTED: The Astro frontmatter is not safely delimited.");
  let frontmatter = source.slice(open[0].length, closeAt);
  frontmatter = ensureAstroContentImport(frontmatter);
  for (const block of blocks) {
    const start = `/* @aria-translation-cms:${block.id} */`;
    const end = `/* @aria-translation-cms-end:${block.id} */`;
    const replacement = `${start}\n${block.source}\n${end}`;
    const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
    frontmatter = pattern.test(frontmatter)
      ? frontmatter.replace(pattern, replacement)
      : `${frontmatter.trim()}\n\n${replacement}`;
  }
  return `${source.slice(0, open[0].length)}${frontmatter.trim()}${source.slice(closeAt)}`;
}

function cmsAccess(variable: string, keyPath: readonly string[]): string {
  return keyPath.reduce((current, segment) => `${current}?.[${JSON.stringify(segment)}]`, `${variable}?.data`);
}

/**
 * Rewrites only reviewed, hash-matched consumers. The source catalog remains
 * on disk and every replacement retains the original expression as fallback.
 */
export async function applyProjectTranslationCutover(
  projectPath: string,
  input: ProjectTranslationCutoverInput,
): Promise<ProjectTranslationCutoverResult> {
  const { readSiteSettings } = await import("../siteSettings");
  const root = canonicalDirectory(projectPath);
  const assessment = await assessProjectTranslationAdoption(root, input);
  if (assessment.previewHash !== input.expectedPreviewHash) throw new Error("TRANSLATION_CATALOG_CONFLICT: The cutover review is stale.");
  const catalog = (await listProjectTranslationCatalogs(root)).catalogs.find((item) => item.id === input.catalogId);
  if (!catalog || (input.expectedCatalogHash && catalog.sourceHash !== input.expectedCatalogHash)) {
    throw new Error("TRANSLATION_CATALOG_CONFLICT: The catalog changed after review.");
  }
  const selected = catalog.consumers.filter((consumer) => input.consumerIds.includes(consumer.id));
  if (selected.length !== new Set(input.consumerIds).size) throw new Error("TRANSLATION_CONSUMER_CONFLICT: One or more reviewed consumers no longer exist.");
  const settings = readSiteSettings(root).localization?.content;
  if (!settings) throw new Error("TRANSLATION_LOCALES_NOT_CONFIGURED: Review detected localization before cutover.");
  const enabledLocales = settings.locales.filter((locale) => locale.enabled).map((locale) => locale.code);
  for (const consumer of selected) {
    const key = catalog.namespaces.find((namespace) => namespace.name === consumer.namespace)?.keys.find((item) => item.path.join(".") === consumer.keyPath.join("."));
    if (!key) throw new Error(`TRANSLATION_KEY_NOT_FOUND: ${consumer.namespace}.${consumer.keyPath.join(".")}`);
    for (const locale of enabledLocales) {
      const candidates = [locale, ...fallbackChain(settings, locale)];
      if (!candidates.some((candidate) => key.values[candidate] !== undefined)) {
        throw new Error(`TRANSLATION_COVERAGE_INCOMPLETE: ${consumer.namespace}.${consumer.keyPath.join(".")} does not resolve for ${locale}.`);
      }
    }
  }

  const targetByNamespace = new Map(input.targets.map((target) => [target.namespace, target]));
  for (const namespace of new Set(selected.map((consumer) => consumer.namespace))) {
    if (!targetByNamespace.has(namespace)) throw new Error(`TRANSLATION_CUTOVER_TARGET_MISSING: ${namespace}`);
  }
  const changedFiles: string[] = [];
  const consumersByFile = new Map<string, ProjectTranslationConsumer[]>();
  for (const consumer of selected) consumersByFile.set(consumer.file, [...(consumersByFile.get(consumer.file) ?? []), consumer]);
  const sourceByFile = new Map<string, { absolute: string; source: string }>();
  for (const [relativeFile, consumers] of consumersByFile) {
    const absolute = resolveWithinRoot(root, path.join(root, relativeFile), { rejectFinalSymlink: true });
    const original = fs.readFileSync(absolute, "utf8");
    if (consumers.some((consumer) => consumer.sourceHash !== sha256(original))) {
      throw new Error(`TRANSLATION_CONSUMER_CONFLICT: ${relativeFile} changed after discovery.`);
    }
    sourceByFile.set(relativeFile, { absolute, source: original });
  }
  for (const [relativeFile, consumers] of consumersByFile) {
    const { absolute, source: original } = sourceByFile.get(relativeFile)!;
    const queryBlocks = new Map<string, { id: string; source: string }>();
    const replacements = consumers.map((consumer) => {
      const target = targetByNamespace.get(consumer.namespace);
      if (!target) throw new Error(`TRANSLATION_CUTOVER_TARGET_MISSING: ${consumer.namespace}`);
      const suffix = sha256(`${consumer.namespace}:${consumer.localeExpression}`).slice(0, 8);
      const variable = `ariaCms${identifier(consumer.namespace)}Translation${suffix}`;
      const entries = `${variable}Entries`;
      const locale = `${variable}Locale`;
      const candidateLocales = `${variable}Locales`;
      const fallbacks = `${variable}Fallbacks`;
      const fallbackMap = Object.fromEntries(enabledLocales.map((code) => [code, fallbackChain(settings, code)]));
      const id = `${catalog.id}:${consumer.namespace}:${suffix}`;
      queryBlocks.set(id, {
        id,
        source: [
          `const ${entries} = await getCollection(${JSON.stringify(target.collectionName)});`,
          `const ${locale} = ${consumer.localeExpression};`,
          `const ${fallbacks}: Record<string, string[]> = ${JSON.stringify(fallbackMap)};`,
          `const ${candidateLocales} = [${locale}, ...(${fallbacks}[${locale}] ?? []), ${JSON.stringify(catalog.defaultLocale)}];`,
          `const ${variable} = ${candidateLocales}.map((candidate) => ${entries}.find((entry) => entry.data.translationKey === ${JSON.stringify(target.entryId)} && entry.data.locale === candidate)).find(Boolean);`,
        ].join("\n"),
      });
      return {
        from: consumer.sourceRange.from,
        to: consumer.sourceRange.to,
        value: `${cmsAccess(variable, consumer.keyPath)} ?? /* @aria-translation-source-fallback */ (${consumer.expression})`,
      };
    }).sort((a, b) => b.from - a.from);
    let next = original;
    for (const replacement of replacements) next = `${next.slice(0, replacement.from)}${replacement.value}${next.slice(replacement.to)}`;
    next = injectCutoverQueries(next, [...queryBlocks.values()]);
    writeTextFileAtomic(absolute, next);
    markSelfWrite(absolute);
    changedFiles.push(relativeFile);
  }
  invalidateTranslationCatalogRegistry(root);
  return {
    ok: true,
    changedFiles,
    cutoverConsumers: selected.map((consumer) => consumer.id),
    retainedSourceFile: catalog.sourceFile,
  };
}
