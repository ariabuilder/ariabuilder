import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type {
  ProjectDataCatalogEditInput,
  ProjectDataCatalogEditResult,
  ProjectDataCatalogField,
  ProjectDataCatalogGroup,
  ProjectDataCatalogGroupId,
  ProjectDataCatalogInput,
  ProjectDataCatalogResult,
  ProjectDataCatalogRoot,
  ProjectDataCatalogSource,
  ProjectDataImportBinding,
} from "../../shared/composer/projectData";
import { PROJECT_DATA_FALLBACK_MARKER } from "../../shared/composer/projectDataBindings";
import { describeComposerCmsSelection } from "../../shared/composer/cmsBindings";
import { parseAstro } from "../../shared/composer/parseAstro";
import { nodeAtMarkerPath } from "../../shared/composer/paths";
import { parentPathOf } from "../../shared/composer/mutate";
import type { AstroDocumentModel, EditableNode, PropValue } from "../../shared/composer/types";
import { canonicalDirectory, resolveWithinRoot, writeTextFileAtomic } from "../pathSafety";
import { markSelfWrite } from "./selfWrite";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_FILES = 2_000;
const MAX_SCOPE_CONTEXTS = 10_000;
const PROJECT_DATA_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|json)$/i;
const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage", ".astro", ".git", "generated"]);

type DataShape = ProjectDataCatalogField["shape"];
type DataNode = {
  shape: DataShape;
  derivation: ProjectDataCatalogField["derivation"];
  expression: string;
  value?: unknown;
  sourceFile?: string;
  sourceHash?: string;
  sourceRange?: { from: number; to: number };
  rootExport?: string;
  reason?: string;
  children?: Map<string, DataNode>;
  items?: DataNode[];
};

type ImportRecord = { imported: string; specifier: string };
type VariableBindingRecord = { declaration: ts.VariableDeclaration; path: string[] };
type ModuleRecord = {
  root: string;
  absoluteFile: string;
  relativeFile: string;
  source: string;
  sourceFile: ts.SourceFile;
  offset: number;
  declarations: Map<string, ts.VariableDeclaration>;
  bindings: Map<string, VariableBindingRecord>;
  imports: Map<string, ImportRecord>;
  exports: Array<{ name: string; expression: ts.Expression }>;
  propsShape?: DataNode;
  compilerOptions: ts.CompilerOptions;
};

type HostProp = { value: PropValue; owner: ModuleRecord };
type ResolutionEnvironment = {
  moduleCache: Map<string, ModuleRecord>;
  hostProps: Map<string, Map<string, HostProp>>;
  lexical?: ReadonlyMap<string, DataNode>;
};

type RegistryRoot = {
  sourceFile: string;
  exportName: string;
  suggestedLocalName: string;
  node: DataNode;
};

type CachedRegistry = { generation: number; promise: Promise<RegistryRoot[]> };
const registryCache = new Map<string, CachedRegistry>();
const registryGeneration = new Map<string, number>();
const compilerOptionsCache = new Map<string, ts.CompilerOptions>();

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

function identifier(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_$]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const joined = cleaned.map((word, index) => index === 0
    ? word.replace(/^[^A-Za-z_$]+/, "").replace(/^./, (letter) => letter.toLowerCase())
    : word.replace(/^./, (letter) => letter.toUpperCase())).join("");
  return /^[A-Za-z_$][\w$]*$/.test(joined) ? joined : "ariaProjectData";
}

function readSmallFile(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= MAX_SOURCE_BYTES ? fs.readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
}

async function readSmallFileAsync(file: string): Promise<string | null> {
  try {
    const stat = await fs.promises.stat(file);
    return stat.isFile() && stat.size <= MAX_SOURCE_BYTES ? await fs.promises.readFile(file, "utf8") : null;
  } catch {
    return null;
  }
}

function compilerOptions(root: string): ts.CompilerOptions {
  const cached = compilerOptionsCache.get(root);
  if (cached) return cached;
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    const options = { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true, resolveJsonModule: true };
    compilerOptionsCache.set(root, options);
    return options;
  }
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const options = config.error
    ? { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true, resolveJsonModule: true }
    : ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath)).options;
  compilerOptionsCache.set(root, options);
  return options;
}

function scriptKind(file: string): ts.ScriptKind {
  if (/\.tsx$/i.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(file)) return ts.ScriptKind.JSX;
  if (/\.(?:js|mjs|cjs)$/i.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function frontmatter(source: string): { text: string; offset: number } {
  const match = /^(?:\uFEFF)?---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  return match?.[1] == null
    ? { text: "", offset: 0 }
    : { text: match[1], offset: match.index + match[0].indexOf(match[1]) };
}

function collectVariableBindings(
  record: ModuleRecord,
  declaration: ts.VariableDeclaration,
  name: ts.BindingName,
  bindingPath: string[] = [],
): void {
  if (ts.isIdentifier(name)) {
    if (bindingPath.length) record.bindings.set(name.text, { declaration, path: bindingPath });
    return;
  }
  for (let index = 0; index < name.elements.length; index += 1) {
    const element = name.elements[index];
    if (!element || ts.isOmittedExpression(element)) continue;
    const key = ts.isObjectBindingPattern(name)
      ? element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName) || ts.isNumericLiteral(element.propertyName))
        ? element.propertyName.text
        : ts.isIdentifier(element.name) ? element.name.text : null
      : String(index);
    if (key != null) collectVariableBindings(record, declaration, element.name, [...bindingPath, key]);
  }
}

function collectModule(record: ModuleRecord): void {
  for (const statement of record.sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      if (statement.importClause.name) record.imports.set(statement.importClause.name.text, { imported: "default", specifier });
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const item of bindings.elements) {
          record.imports.set(item.name.text, { imported: item.propertyName?.text ?? item.name.text, specifier });
        }
      }
    }
    if (ts.isVariableStatement(statement)) {
      const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      for (const declaration of statement.declarationList.declarations) {
        collectVariableBindings(record, declaration, declaration.name);
        if (ts.isIdentifier(declaration.name)) {
          record.declarations.set(declaration.name.text, declaration);
          if (exported && declaration.initializer) record.exports.push({ name: declaration.name.text, expression: declaration.initializer });
        }
      }
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      record.exports.push({ name: "default", expression: statement.expression });
    }
    if (ts.isInterfaceDeclaration(statement) && statement.name.text === "Props") {
      record.propsShape = typeMembersShape(statement.members, "Astro.props");
    }
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === "Props" && ts.isTypeLiteralNode(statement.type)) {
      record.propsShape = typeMembersShape(statement.type.members, "Astro.props");
    }
  }
}

function typeMembersShape(members: ts.NodeArray<ts.TypeElement>, expression: string): DataNode {
  const children = new Map<string, DataNode>();
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.type || !member.name) continue;
    const name = propertyName(member.name);
    if (name) children.set(name, typeNodeShape(member.type, `${expression}.${name}`));
  }
  return {
    shape: "object",
    derivation: "derived",
    expression,
    children,
    reason: "This component property has no concrete inline caller. Its declared shape is available.",
  };
}

function typeNodeShape(type: ts.TypeNode, expression: string): DataNode {
  if (type.kind === ts.SyntaxKind.StringKeyword) return { shape: "string", derivation: "derived", expression, reason: "Declared component property; select an inline instance to edit its value." };
  if (type.kind === ts.SyntaxKind.NumberKeyword) return { shape: "number", derivation: "derived", expression, reason: "Declared component property; select an inline instance to edit its value." };
  if (type.kind === ts.SyntaxKind.BooleanKeyword) return { shape: "boolean", derivation: "derived", expression, reason: "Declared component property; select an inline instance to edit its value." };
  if (ts.isArrayTypeNode(type)) {
    const item = typeNodeShape(type.elementType, `${expression}[0]`);
    return { shape: "array", derivation: "derived", expression, items: [item], reason: "Declared component collection; item values require an inline instance." };
  }
  if (ts.isTypeReferenceNode(type)) {
    const name = type.typeName.getText();
    if ((name === "Array" || name === "ReadonlyArray") && type.typeArguments?.[0]) {
      const item = typeNodeShape(type.typeArguments[0], `${expression}[0]`);
      return { shape: "array", derivation: "derived", expression, items: [item], reason: "Declared component collection; item values require an inline instance." };
    }
    if (/ImageMetadata|Image$/i.test(name)) return { shape: "object", derivation: "asset", expression, reason: "Declared project asset; select an inline instance to inspect its value." };
  }
  if (ts.isTypeLiteralNode(type)) return typeMembersShape(type.members, expression);
  if (ts.isUnionTypeNode(type)) {
    const candidates = type.types.filter((candidate) => candidate.kind !== ts.SyntaxKind.UndefinedKeyword && candidate.kind !== ts.SyntaxKind.NullKeyword);
    if (candidates[0]) return typeNodeShape(candidates[0], expression);
  }
  return unresolved(expression, "This declared component property has an unsupported shape.");
}

function parseModule(root: string, absoluteFile: string, sourceOverride?: string, astro = false): ModuleRecord | null {
  const safe = resolveWithinRoot(root, absoluteFile, { rejectFinalSymlink: true });
  const source = sourceOverride ?? readSmallFile(safe);
  if (source == null) return null;
  const parsed = astro ? frontmatter(source) : { text: source, offset: 0 };
  const sourceFile = ts.createSourceFile(
    astro ? `${safe}.frontmatter.ts` : safe,
    parsed.text,
    ts.ScriptTarget.Latest,
    true,
    astro ? ts.ScriptKind.TS : scriptKind(safe),
  );
  const record: ModuleRecord = {
    root,
    absoluteFile: safe,
    relativeFile: toPosix(path.relative(root, safe)),
    source,
    sourceFile,
    offset: parsed.offset,
    declarations: new Map(),
    bindings: new Map(),
    imports: new Map(),
    exports: [],
    propsShape: undefined,
    compilerOptions: compilerOptions(root),
  };
  collectModule(record);
  return record;
}

function parseJsonModule(root: string, absoluteFile: string, sourceOverride?: string): ModuleRecord | null {
  const safe = resolveWithinRoot(root, absoluteFile, { rejectFinalSymlink: true });
  const source = sourceOverride ?? readSmallFile(safe);
  if (source == null) return null;
  const parsed = ts.parseJsonText(safe, source);
  const statement = parsed.statements[0];
  if (!statement || !ts.isExpressionStatement(statement)) return null;
  return {
    root,
    absoluteFile: safe,
    relativeFile: toPosix(path.relative(root, safe)),
    source,
    sourceFile: parsed,
    offset: 0,
    declarations: new Map(),
    bindings: new Map(),
    imports: new Map(),
    exports: [{ name: "default", expression: statement.expression }],
    propsShape: undefined,
    compilerOptions: compilerOptions(root),
  };
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) || ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) current = current.expression;
  return current;
}

function expressionNode(expression: string): ts.Expression | null {
  const source = ts.createSourceFile("project-data-expression.ts", `const value = (${expression});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statement = source.statements[0];
  return statement && ts.isVariableStatement(statement) ? statement.declarationList.declarations[0]?.initializer ?? null : null;
}

function staticAccessExpression(expression: string): string | null {
  const parsed = expressionNode(expression);
  if (!parsed) return null;
  const parts: string[] = [];
  let current = unwrap(parsed);
  while (true) {
    if (ts.isIdentifier(current)) return accessExpression(current.text, parts.reverse());
    if (ts.isPropertyAccessExpression(current)) {
      parts.push(current.name.text);
      current = unwrap(current.expression);
      continue;
    }
    if (
      ts.isElementAccessExpression(current)
      && current.argumentExpression
      && (ts.isStringLiteral(current.argumentExpression) || ts.isNumericLiteral(current.argumentExpression))
    ) {
      parts.push(current.argumentExpression.text);
      current = unwrap(current.expression);
      continue;
    }
    return null;
  }
}

function expressionsEquivalent(left: string, right: string): boolean {
  if (left === right) return true;
  const normalizedLeft = staticAccessExpression(left);
  return normalizedLeft != null && normalizedLeft === staticAccessExpression(right);
}

function propertyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : null;
}

function sourceRange(record: ModuleRecord, node: ts.Node): { from: number; to: number } {
  return { from: record.offset + node.getStart(record.sourceFile), to: record.offset + node.getEnd() };
}

function unresolved(expression: string, reason: string): DataNode {
  return { shape: "unknown", derivation: "unresolved", expression, reason };
}

function literalNode(record: ModuleRecord, node: ts.Expression, expression: string, value: unknown): DataNode {
  const shape: DataShape = value === null ? "null" : typeof value === "string" ? "string" : typeof value === "number" ? "number" : "boolean";
  return {
    shape,
    derivation: "literal",
    expression,
    value,
    sourceFile: record.relativeFile,
    sourceHash: sha256(record.source),
    sourceRange: sourceRange(record, node),
  };
}

function resolveModuleFile(record: ModuleRecord, specifier: string): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("@")) return null;
  const resolved = ts.resolveModuleName(specifier, record.absoluteFile, record.compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
  const base = specifier.startsWith(".") ? path.resolve(path.dirname(record.absoluteFile), specifier) : null;
  const candidates = [resolved, base].filter((item): item is string => Boolean(item));
  const extensions = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".mts", ".cts", ".json", "/index.ts", "/index.js", "/index.json"];
  for (const candidate of candidates) {
    for (const extension of extensions) {
      const file = candidate.replace(/\.d\.ts$/, ".ts") + extension;
      try {
        const safe = resolveWithinRoot(record.root, file, { rejectFinalSymlink: true });
        if (fs.statSync(safe).isFile()) return safe;
      } catch {
        // Try the next statically resolved candidate.
      }
    }
  }
  return null;
}

function childAt(node: DataNode, key: string): DataNode {
  if (node.children?.has(key)) return node.children.get(key)!;
  if (node.items && /^\d+$/.test(key)) return node.items[Number(key)] ?? unresolved(`${node.expression}[${key}]`, "This array item is unavailable.");
  if (node.derivation === "asset" && key === "src") {
    return { ...node, shape: "string", expression: `${node.expression}.src` };
  }
  return unresolved(`${node.expression}.${key}`, `The field ${key} could not be resolved statically.`);
}

function atPath(node: DataNode, parts: readonly string[]): DataNode {
  return parts.reduce((current, part) => childAt(current, part), node);
}

function isAstroProps(node: ts.Expression): boolean {
  const current = unwrap(node);
  return ts.isPropertyAccessExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === "Astro" && current.name.text === "props";
}

function propValueNode(prop: HostProp, env: ResolutionEnvironment, seen: Set<string>): DataNode {
  if (prop.value.type === "string") return { shape: "string", derivation: "derived", expression: JSON.stringify(prop.value.value), value: prop.value.value, reason: "This component value is authored at its parent invocation." };
  if (prop.value.type === "bare") return { shape: "boolean", derivation: "derived", expression: "true", value: true, reason: "This component value is authored at its parent invocation." };
  if (prop.value.type === "template-literal") return { shape: "string", derivation: "derived", expression: `\`${prop.value.value}\``, value: prop.value.value, reason: "This component value is authored at its parent invocation." };
  if (prop.value.type !== "expr" && prop.value.type !== "shorthand") return unresolved(prop.value.value, "This component property is computed by its caller.");
  const parsed = expressionNode(prop.value.value);
  return parsed ? resolveExpression(parsed, prop.owner, env, prop.value.value, seen) : unresolved(prop.value.value, "This component property could not be parsed.");
}

function resolveIdentifier(name: string, record: ModuleRecord, env: ResolutionEnvironment, expression: string, seen: Set<string>): DataNode {
  const lexical = env.lexical?.get(name);
  if (lexical) return { ...lexical, expression };
  const key = `${record.absoluteFile}:${name}`;
  if (seen.has(key)) return unresolved(expression, "Circular project data was detected.");
  const nextSeen = new Set(seen).add(key);
  const declaration = record.declarations.get(name);
  if (declaration?.initializer) return resolveExpression(declaration.initializer, record, env, expression, nextSeen);
  const binding = record.bindings.get(name);
  if (binding?.declaration.initializer) {
    if (isAstroProps(binding.declaration.initializer)) {
      const host = env.hostProps.get(record.relativeFile)?.get(binding.path[0]!);
      return host
        ? atPath(propValueNode(host, env, nextSeen), binding.path.slice(1))
        : atPath(record.propsShape ?? unresolved("Astro.props", "This component property has no concrete inline caller or declared shape."), binding.path);
    }
    return atPath(resolveExpression(binding.declaration.initializer, record, env, expression, nextSeen), binding.path);
  }
  const imported = record.imports.get(name);
  if (!imported) return unresolved(expression, `The value ${name} is computed at runtime.`);
  const importedFile = resolveModuleFile(record, imported.specifier);
  if (!importedFile) {
    return { shape: "object", derivation: "asset", expression, value: imported.specifier, reason: "Imported project asset." };
  }
  if (!PROJECT_DATA_FILE.test(importedFile)) {
    return {
      shape: "object",
      derivation: "asset",
      expression,
      value: toPosix(path.relative(record.root, importedFile)),
      sourceFile: toPosix(path.relative(record.root, importedFile)),
      reason: "Imported project asset.",
    };
  }
  let module = env.moduleCache.get(importedFile);
  if (!module) {
    module = importedFile.endsWith(".json") ? parseJsonModule(record.root, importedFile) ?? undefined : parseModule(record.root, importedFile) ?? undefined;
    if (module) env.moduleCache.set(importedFile, module);
  }
  const exported = module?.exports.find((item) => item.name === imported.imported);
  if (!module || !exported) return unresolved(expression, `The import ${imported.specifier} could not be resolved.`);
  const resolved = resolveExpression(exported.expression, module, env, expression, nextSeen);
  resolved.rootExport = imported.imported;
  return resolved;
}

function scalarValue(node: DataNode): unknown {
  return node.shape === "string" || node.shape === "number" || node.shape === "boolean" || node.shape === "null" ? node.value : undefined;
}

function readOnlyShape(node: DataNode, expression: string, reason: string): DataNode {
  return {
    ...node,
    expression,
    derivation: node.derivation === "asset" ? "asset" : "derived",
    reason,
    ...(node.children ? { children: new Map([...node.children].map(([key, child]) => [key, readOnlyShape(child, child.expression, reason)])) } : {}),
    ...(node.items ? { items: node.items.map((item) => readOnlyShape(item, item.expression, reason)) } : {}),
  };
}

function evaluatePredicate(expression: ts.Expression, itemName: string, item: DataNode, record: ModuleRecord, env: ResolutionEnvironment): boolean | null {
  const current = unwrap(expression);
  if (ts.isParenthesizedExpression(current)) return evaluatePredicate(current.expression, itemName, item, record, env);
  if (ts.isBinaryExpression(current)) {
    const operator = current.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken || operator === ts.SyntaxKind.BarBarToken) {
      const left = evaluatePredicate(current.left, itemName, item, record, env);
      const right = evaluatePredicate(current.right, itemName, item, record, env);
      if (left == null || right == null) return null;
      return operator === ts.SyntaxKind.AmpersandAmpersandToken ? left && right : left || right;
    }
    if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(operator)) {
      const value = (node: ts.Expression): unknown => {
        const unwrapped = unwrap(node);
        if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) return unwrapped.text;
        if (ts.isNumericLiteral(unwrapped)) return Number(unwrapped.text);
        if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) return true;
        if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) return false;
        if (ts.isPropertyAccessExpression(unwrapped) && ts.isIdentifier(unwrapped.expression) && unwrapped.expression.text === itemName) return scalarValue(childAt(item, unwrapped.name.text));
        return undefined;
      };
      const left = value(current.left);
      const right = value(current.right);
      if (left === undefined || right === undefined) return null;
      const equal = left === right;
      return operator === ts.SyntaxKind.EqualsEqualsEqualsToken || operator === ts.SyntaxKind.EqualsEqualsToken ? equal : !equal;
    }
  }
  return null;
}

function resolveCall(current: ts.CallExpression, record: ModuleRecord, env: ResolutionEnvironment, expression: string, seen: Set<string>): DataNode {
  if (!ts.isPropertyAccessExpression(current.expression)) return unresolved(expression, "Function calls are not executed while inspecting project data.");
  const method = current.expression.name.text;
  const receiver = resolveExpression(current.expression.expression, record, env, current.expression.expression.getText(record.sourceFile), seen);
  if (!receiver.items) return readOnlyShape(receiver, expression, `The ${method} result is computed at runtime.`);
  if (method === "slice") {
    const bounds = current.arguments.map((argument) => ts.isNumericLiteral(unwrap(argument)) ? Number((unwrap(argument) as ts.NumericLiteral).text) : null);
    if (bounds.some((value) => value == null)) return readOnlyShape(receiver, expression, "Slice bounds are computed at runtime.");
    const items = receiver.items.slice(bounds[0] ?? 0, bounds[1] ?? undefined);
    return { ...receiver, expression, items, value: items.map((item) => item.value), derivation: "derived", reason: "Derived with static slice bounds." };
  }
  if (method === "filter") {
    const callback = current.arguments[0];
    if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) return readOnlyShape(receiver, expression, "The filter callback is computed at runtime.");
    const parameter = callback.parameters[0];
    if (!parameter || !ts.isIdentifier(parameter.name)) return readOnlyShape(receiver, expression, "The filter item is destructured or computed.");
    const body = ts.isBlock(callback.body)
      ? callback.body.statements.find(ts.isReturnStatement)?.expression
      : callback.body;
    if (!body) return readOnlyShape(receiver, expression, "The filter has no static result.");
    const itemName = parameter.name.text;
    const decisions = receiver.items.map((item) => evaluatePredicate(body, itemName, item, record, env));
    if (decisions.some((decision) => decision == null)) return readOnlyShape(receiver, expression, "The filter shape is known, but its exact items are computed.");
    const items = receiver.items.filter((_item, index) => decisions[index]);
    return { ...receiver, expression, items, value: items.map((item) => item.value), derivation: "derived", reason: "Derived with a static filter." };
  }
  return readOnlyShape(receiver, expression, `The ${method} transform is not executed. Its item shape is available, but exact values may differ.`);
}

function resolveExpression(
  expression: ts.Expression,
  record: ModuleRecord,
  env: ResolutionEnvironment,
  displayExpression = expression.getText(record.sourceFile),
  seen = new Set<string>(),
): DataNode {
  const current = unwrap(expression);
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) return literalNode(record, current, displayExpression, current.text);
  if (ts.isNumericLiteral(current)) return literalNode(record, current, displayExpression, Number(current.text));
  if (current.kind === ts.SyntaxKind.TrueKeyword) return literalNode(record, current, displayExpression, true);
  if (current.kind === ts.SyntaxKind.FalseKeyword) return literalNode(record, current, displayExpression, false);
  if (current.kind === ts.SyntaxKind.NullKeyword) return literalNode(record, current, displayExpression, null);
  if (ts.isPrefixUnaryExpression(current) && ts.isNumericLiteral(current.operand)) {
    const value = current.operator === ts.SyntaxKind.MinusToken ? -Number(current.operand.text) : Number(current.operand.text);
    return literalNode(record, current, displayExpression, value);
  }
  if (ts.isIdentifier(current)) return resolveIdentifier(current.text, record, env, displayExpression, seen);
  if (ts.isPropertyAccessExpression(current)) {
    const parent = resolveExpression(current.expression, record, env, current.expression.getText(record.sourceFile), seen);
    return { ...childAt(parent, current.name.text), expression: displayExpression };
  }
  if (ts.isElementAccessExpression(current) && current.argumentExpression && (ts.isStringLiteral(current.argumentExpression) || ts.isNumericLiteral(current.argumentExpression))) {
    const parent = resolveExpression(current.expression, record, env, current.expression.getText(record.sourceFile), seen);
    return { ...childAt(parent, current.argumentExpression.text), expression: displayExpression };
  }
  if (ts.isArrayLiteralExpression(current)) {
    const items = current.elements.map((item, index) => {
      const resolved = ts.isExpression(item) && !ts.isSpreadElement(item)
        ? resolveExpression(item, record, env, `${displayExpression}[${index}]`, seen)
        : unresolved(`${displayExpression}[${index}]`, "Spread and omitted array values are not inspected.");
      return resolved.sourceFile ? resolved : {
        ...resolved,
        sourceFile: record.relativeFile,
        sourceHash: sha256(record.source),
        sourceRange: sourceRange(record, item),
      };
    });
    return {
      shape: "array",
      derivation: items.some((item) => item.derivation === "unresolved") ? "derived" : "literal",
      expression: displayExpression,
      items,
      value: items.map((item) => item.value),
      sourceFile: record.relativeFile,
      sourceHash: sha256(record.source),
      sourceRange: sourceRange(record, current),
    };
  }
  if (ts.isObjectLiteralExpression(current)) {
    const children = new Map<string, DataNode>();
    for (const property of current.properties) {
      if (ts.isPropertyAssignment(property)) {
        const key = propertyName(property.name);
        if (key) {
          const child = resolveExpression(property.initializer, record, env, `${displayExpression}.${key}`, seen);
          children.set(key, child.sourceFile ? child : {
            ...child,
            sourceFile: record.relativeFile,
            sourceHash: sha256(record.source),
            sourceRange: sourceRange(record, property.initializer),
          });
        }
      } else if (ts.isShorthandPropertyAssignment(property)) {
        children.set(property.name.text, resolveIdentifier(property.name.text, record, env, `${displayExpression}.${property.name.text}`, seen));
      } else if (ts.isSpreadAssignment(property)) {
        const spread = resolveExpression(property.expression, record, env, property.expression.getText(record.sourceFile), seen);
        for (const [key, child] of spread.children ?? []) if (!children.has(key)) children.set(key, child);
      }
    }
    return {
      shape: "object",
      derivation: [...children.values()].some((item) => item.derivation === "unresolved") ? "derived" : "literal",
      expression: displayExpression,
      children,
      value: Object.fromEntries([...children].map(([key, child]) => [key, child.value])),
      sourceFile: record.relativeFile,
      sourceHash: sha256(record.source),
      sourceRange: sourceRange(record, current),
    };
  }
  if (ts.isCallExpression(current)) return resolveCall(current, record, env, displayExpression, seen);
  if (ts.isConditionalExpression(current)) {
    const left = resolveExpression(current.whenTrue, record, env, current.whenTrue.getText(record.sourceFile), seen);
    const right = resolveExpression(current.whenFalse, record, env, current.whenFalse.getText(record.sourceFile), seen);
    return left.shape === right.shape ? { ...left, expression: displayExpression, derivation: "derived", reason: "This value depends on a runtime condition." } : unresolved(displayExpression, "This value has different runtime shapes.");
  }
  return unresolved(displayExpression, "This value is computed at runtime.");
}

function accessExpression(receiver: string, parts: readonly string[]): string {
  return parts.reduce((value, part) => /^[A-Za-z_$][\w$]*$/.test(part) ? `${value}.${part}` : `${value}[${JSON.stringify(part)}]`, receiver);
}

function compatible(field: DataNode, input: ProjectDataCatalogInput): boolean {
  if (input.target.kind === "collection") return field.shape === "array";
  const prop = input.target.propName?.toLowerCase();
  if (!prop) return ["string", "number", "boolean", "null"].includes(field.shape);
  if (prop === "src" || prop === "poster") return field.derivation === "asset" || ["string", "object"].includes(field.shape);
  if (prop === "href" || prop === "url") return field.shape === "string";
  if (prop === "disabled" || prop === "checked" || prop.startsWith("aria-")) return field.shape === "boolean" || field.shape === "string";
  return ["string", "number", "boolean", "null"].includes(field.shape);
}

function fieldId(group: ProjectDataCatalogGroupId, expression: string, sourceFile?: string): string {
  return sha256(`${group}:${sourceFile ?? "page"}:${expression}`).slice(0, 20);
}

function descriptor(input: {
  group: ProjectDataCatalogGroupId;
  label: string;
  pathLabel: string;
  expression: string;
  node: DataNode;
  valuePath: string[];
  selectedItem?: number;
  itemCount?: number;
  importBinding?: ProjectDataImportBinding;
  compatible?: boolean;
}): ProjectDataCatalogField {
  const itemCount = input.itemCount ?? (Array.isArray(input.node.value) ? input.node.items?.length : undefined);
  return {
    id: fieldId(input.group, input.expression, input.node.sourceFile),
    group: input.group,
    label: input.label,
    pathLabel: input.pathLabel,
    expression: input.expression,
    shape: input.node.shape,
    derivation: input.node.derivation,
    valuePath: input.valuePath,
    value: input.node.value,
    compatible: input.compatible ?? true,
    bindable: (input.compatible ?? true) && input.node.derivation !== "unresolved",
    writable: input.node.derivation === "literal" && Boolean(input.node.sourceFile && input.node.sourceHash && input.node.sourceRange),
    ...(input.node.reason ? { reason: input.node.reason } : {}),
    ...(input.node.sourceFile ? { sourceFile: input.node.sourceFile } : {}),
    ...(input.node.sourceHash ? { sourceHash: input.node.sourceHash } : {}),
    ...(input.node.sourceRange ? { sourceRange: input.node.sourceRange } : {}),
    ...(input.node.rootExport ? { rootExport: input.node.rootExport } : {}),
    ...(itemCount == null ? {} : { itemCount }),
    ...(input.selectedItem == null ? {} : { selectedItem: input.selectedItem }),
    ...(input.importBinding ? { importBinding: input.importBinding } : {}),
  };
}

function flattenNode(input: {
  group: ProjectDataCatalogGroupId;
  rootLabel: string;
  receiver: string;
  node: DataNode;
  path?: string[];
  expressionPath?: string[];
  importBinding?: ProjectDataImportBinding;
  target: ProjectDataCatalogInput;
  selectedItem?: number;
  itemCount?: number;
}): ProjectDataCatalogField[] {
  const parts = input.path ?? [];
  const expressionParts = input.expressionPath ?? parts;
  if (input.target.target.kind === "text" && input.node.derivation === "asset") {
    return [descriptor({
      group: input.group,
      label: parts.length ? titleCase(parts.at(-1)!) : input.rootLabel,
      pathLabel: [input.rootLabel, ...parts.map(titleCase)].join(" · "),
      expression: `${accessExpression(input.receiver, expressionParts)}.src`,
      node: { ...input.node, shape: "string", expression: `${input.node.expression}.src` },
      valuePath: parts,
      importBinding: input.importBinding,
      selectedItem: input.selectedItem,
      itemCount: input.itemCount,
    })];
  }
  if (compatible(input.node, input.target)) {
    return [descriptor({
      group: input.group,
      label: parts.length ? titleCase(parts.at(-1)!) : input.rootLabel,
      pathLabel: [input.rootLabel, ...parts.map(titleCase)].join(" · "),
      expression: accessExpression(input.receiver, expressionParts),
      node: input.node,
      valuePath: parts,
      importBinding: input.importBinding,
      selectedItem: input.selectedItem,
      itemCount: input.itemCount,
    })];
  }
  if (input.node.children) {
    return [...input.node.children].flatMap(([key, child]) => flattenNode({
      ...input,
      node: child,
      path: [...parts, key],
      expressionPath: [...expressionParts, key],
    }));
  }
  if (input.node.derivation === "unresolved") {
    return [descriptor({
      group: input.group,
      label: parts.length ? titleCase(parts.at(-1)!) : input.rootLabel,
      pathLabel: [input.rootLabel, ...parts.map(titleCase)].join(" · "),
      expression: accessExpression(input.receiver, expressionParts),
      node: input.node,
      valuePath: parts,
      importBinding: input.importBinding,
      selectedItem: input.selectedItem,
      itemCount: input.itemCount,
      compatible: false,
    })];
  }
  return [];
}

function relativeImport(fromFile: string, toFile: string): string {
  const from = fromFile.split("/").slice(0, -1);
  const keepJson = toFile.endsWith(".json");
  const normalized = keepJson ? toFile : toFile.replace(/\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i, "");
  const to = normalized.split("/");
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
  const value = [...from.map(() => ".."), ...to].join("/");
  return value.startsWith(".") ? value : `./${value}`;
}

function currentRawExpression(model: AstroDocumentModel, input: ProjectDataCatalogInput, targetPath: string): string {
  const node = nodeAtMarkerPath(model.nodes, targetPath);
  let expression = "";
  if (input.target.kind === "collection" && node?.kind === "map") {
    const head = authoredMapHead(node.head);
    expression = /^(.*?)\.map\s*\(/s.exec(head)?.[1]?.trim() ?? head;
  }
  else if (input.target.kind === "text" && node?.kind === "expr") expression = node.value.replace(/^\{|\}$/g, "").trim();
  else if (input.target.kind === "prop" && node && "props" in node && input.target.propName) {
    const value = node.props[input.target.propName];
    if (value?.type === "expr") expression = value.value.trim();
  }
  return expression.trim();
}

function currentExpression(model: AstroDocumentModel, input: ProjectDataCatalogInput, targetPath: string): string {
  let expression = currentRawExpression(model, input, targetPath);
  const marker = expression.indexOf(PROJECT_DATA_FALLBACK_MARKER);
  if (marker >= 0) {
    const operator = expression.lastIndexOf("??", marker);
    if (operator >= 0) expression = expression.slice(0, operator).trim().replace(/^\(\s*/, "");
  }
  return expression.replace(/^\((.*)\)$/s, "$1").trim();
}

type MapScope = {
  receiver: string;
  parameter?: string;
  destructured?: Array<{ source: string; local: string }>;
  node: EditableNode;
};

function authoredMapHead(head: string): string {
  let value = head.trimStart();
  while (true) {
    const comment = /^\/\/[^\r\n]*(?:\r?\n|$)/.exec(value) ?? /^\/\*[\s\S]*?\*\/\s*/.exec(value);
    if (!comment) return value.trimStart();
    value = value.slice(comment[0].length).trimStart();
  }
}

function mapScopes(model: AstroDocumentModel, pathValue: string): MapScope[] {
  const scopes: MapScope[] = [];
  let path = pathValue;
  while (path) {
    const node = nodeAtMarkerPath(model.nodes, path);
    if (node?.kind === "map") {
      const head = authoredMapHead(node.head);
      const match = /^(.*?)\.map\s*\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)/.exec(head);
      if (match?.[1] && match[2]) scopes.push({ receiver: match[1].trim(), parameter: match[2], node });
      const destructured = /^(.*?)\.map\s*\(\s*(?:async\s*)?\(\s*\{([^}]*)\}/.exec(head);
      if (destructured?.[1] && destructured[2]) {
        const bindings = destructured[2].split(",").map((part) => part.trim()).filter(Boolean).flatMap((part) => {
          const [sourcePart, localPart] = part.split(":").map((value) => value.trim().replace(/\s*=.*$/, ""));
          const source = sourcePart?.replace(/^\.\.\./, "");
          const local = localPart || source;
          return source && local && /^[A-Za-z_$][\w$]*$/.test(source) && /^[A-Za-z_$][\w$]*$/.test(local)
            ? [{ source, local }]
            : [];
        });
        if (bindings.length) scopes.push({ receiver: destructured[1].trim(), destructured: bindings, node });
      }
    }
    path = parentPathOf(path) ?? "";
  }
  return scopes.reverse();
}

type MapScopeContext = {
  lexical: Map<string, DataNode>;
  scope: MapScope;
  item: DataNode;
  selectedIndex: number;
  itemCount?: number;
};

function bindScopeItem(scope: MapScope, item: DataNode, parent: ReadonlyMap<string, DataNode>): Map<string, DataNode> {
  const lexical = new Map(parent);
  if (scope.parameter) lexical.set(scope.parameter, item);
  for (const binding of scope.destructured ?? []) lexical.set(binding.local, childAt(item, binding.source));
  return lexical;
}

function selectedMapScopeContext(
  scopes: readonly MapScope[],
  page: ModuleRecord,
  env: ResolutionEnvironment,
  occurrence: number,
): MapScopeContext | null {
  let contexts: Array<{ lexical: Map<string, DataNode>; selected?: MapScopeContext }> = [{ lexical: new Map() }];
  for (const scope of scopes) {
    const next: Array<{ lexical: Map<string, DataNode>; selected: MapScopeContext }> = [];
    for (const context of contexts) {
      const receiverNode = expressionNode(scope.receiver);
      const scopedEnv: ResolutionEnvironment = { ...env, lexical: context.lexical };
      const collection = receiverNode ? resolveExpression(receiverNode, page, scopedEnv, scope.receiver) : null;
      if (!collection?.items?.length) continue;
      const itemCount = Array.isArray(collection.value) ? collection.items.length : undefined;
      for (let index = 0; index < collection.items.length; index += 1) {
        const item = collection.items[index]!;
        const lexical = bindScopeItem(scope, item, context.lexical);
        next.push({ lexical, selected: { lexical, scope, item, selectedIndex: index, ...(itemCount == null ? {} : { itemCount }) } });
        if (next.length >= MAX_SCOPE_CONTEXTS) break;
      }
      if (next.length >= MAX_SCOPE_CONTEXTS) break;
    }
    contexts = next;
    if (!contexts.length) return null;
  }
  const index = Math.min(Math.max(0, occurrence), contexts.length - 1);
  return contexts[index]?.selected ?? null;
}

async function hostEnvironment(root: string, input: ProjectDataCatalogInput, moduleCache: Map<string, ModuleRecord>): Promise<Map<string, Map<string, HostProp>>> {
  const output = new Map<string, Map<string, HostProp>>();
  const chain = input.instanceChain ?? [];
  for (let index = 0; index < chain.length; index += 1) {
    const segment = chain[index]!;
    const ownerAbsolute = resolveWithinRoot(root, path.join(root, segment.ownerFile), { rejectFinalSymlink: true });
    let owner = moduleCache.get(ownerAbsolute);
    if (!owner) {
      owner = parseModule(root, ownerAbsolute, undefined, true) ?? undefined;
      if (owner) moduleCache.set(ownerAbsolute, owner);
    }
    if (!owner) continue;
    const parsed = await parseAstro(owner.source, { filename: segment.ownerFile });
    if (!parsed.editable) continue;
    const host = nodeAtMarkerPath(parsed.model.nodes, segment.hostPath);
    if (!host || !("props" in host)) continue;
    const childFile = index + 1 < chain.length ? chain[index + 1]!.ownerFile : input.relativeFile;
    output.set(childFile, new Map(Object.entries(host.props).map(([name, value]) => [name, { value, owner }])));
  }
  return output;
}

async function projectRegistry(root: string, refresh = false): Promise<RegistryRoot[]> {
  if (refresh) invalidateProjectDataCatalogRegistry(root);
  const generation = registryGeneration.get(root) ?? 0;
  const cached = registryCache.get(root);
  if (cached?.generation === generation) return cached.promise;
  const promise = (async () => {
    const files: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      if (files.length >= MAX_SOURCE_FILES) return;
      let entries: fs.Dirent[] = [];
      try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (files.length >= MAX_SOURCE_FILES) break;
        if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolute);
        else if (PROJECT_DATA_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(absolute);
      }
    };
    await walk(path.join(root, "src"));
    const env: ResolutionEnvironment = { moduleCache: new Map(), hostProps: new Map() };
    const roots: RegistryRoot[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      const source = await readSmallFileAsync(file);
      if (source == null) continue;
      const record = file.endsWith(".json") ? parseJsonModule(root, file, source) : parseModule(root, file, source);
      if (!record) continue;
      env.moduleCache.set(record.absoluteFile, record);
      for (const exported of record.exports) {
        const resolved = resolveExpression(exported.expression, record, env, exported.name === "default" ? identifier(path.basename(file).replace(/\.[^.]+$/, "")) : exported.name);
        const node = resolved.sourceFile ? resolved : {
          ...resolved,
          sourceFile: record.relativeFile,
          sourceHash: sha256(record.source),
          sourceRange: sourceRange(record, exported.expression),
        };
        node.rootExport = exported.name;
        roots.push({
          sourceFile: record.relativeFile,
          exportName: exported.name,
          suggestedLocalName: exported.name === "default" ? identifier(path.basename(file).replace(/\.[^.]+$/, "")) : exported.name,
          node,
        });
      }
      // TypeScript parsing is synchronous. Yield between small batches so a
      // large source registry does not monopolize Electron's main loop.
      if (index + 1 < files.length) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return roots;
  })();
  registryCache.set(root, { generation, promise });
  return promise;
}

export function isProjectDataRegistryChange(relativeFile: string): boolean {
  return !relativeFile || PROJECT_DATA_FILE.test(relativeFile);
}

export function invalidateProjectDataCatalogRegistry(projectPath: string): void {
  const root = canonicalDirectory(projectPath);
  registryGeneration.set(root, (registryGeneration.get(root) ?? 0) + 1);
  registryCache.delete(root);
  compilerOptionsCache.delete(root);
}

export function disposeProjectDataCatalogRegistry(projectPath: string): void {
  const root = canonicalDirectory(projectPath);
  registryCache.delete(root);
  registryGeneration.delete(root);
  compilerOptionsCache.delete(root);
}

export async function listProjectData(projectPath: string, input: ProjectDataCatalogInput): Promise<ProjectDataCatalogResult> {
  const root = canonicalDirectory(projectPath);
  const absolute = resolveWithinRoot(root, path.join(root, input.relativeFile), { rejectFinalSymlink: true });
  const page = parseModule(root, absolute, input.source, true);
  if (!page) throw new Error("PROJECT_DATA_CATALOG_UNAVAILABLE: The open Astro document could not be inspected.");
  const parsed = await parseAstro(input.selectionSource ?? input.source, { filename: input.relativeFile });
  if (!parsed.editable) throw new Error("PROJECT_DATA_CATALOG_UNAVAILABLE: The open Astro document is not editable in Composer.");
  const model = parsed.model;
  const semanticTarget = describeComposerCmsSelection(model, input.selectionPath).textTargetPath;
  const targetPath = input.target.kind === "text" ? semanticTarget ?? input.selectionPath : input.selectionPath;
  const expression = currentExpression(model, input, targetPath);
  const managed = currentRawExpression(model, input, targetPath).includes(PROJECT_DATA_FALLBACK_MARKER);
  const moduleCache = new Map<string, ModuleRecord>([[page.absoluteFile, page]]);
  const env: ResolutionEnvironment = {
    moduleCache,
    hostProps: await hostEnvironment(root, input, moduleCache),
  };

  const groups: ProjectDataCatalogGroup[] = [
    { id: "current-item", label: "Current item", roots: [], fields: [] },
    { id: "page", label: "This page", roots: [], fields: [] },
    { id: "project", label: "Project files", roots: [], fields: [] },
  ];
  const currentGroup = groups[0]!;
  const pageGroup = groups[1]!;
  const projectGroup = groups[2]!;

  const scopeContext = input.target.kind === "collection"
    ? null
    : selectedMapScopeContext(mapScopes(model, targetPath), page, env, input.occurrence);
  if (scopeContext) {
      const { scope, item, selectedIndex, itemCount } = scopeContext;
      currentGroup.fields = scope.parameter
        ? flattenNode({
            group: "current-item",
            rootLabel: "Current item",
            receiver: scope.parameter,
            node: item,
            target: input,
            ...(itemCount == null ? {} : { selectedItem: selectedIndex, itemCount }),
          })
        : (scope.destructured ?? []).flatMap((binding) => flattenNode({
            group: "current-item",
            rootLabel: "Current item",
            receiver: binding.local,
            node: childAt(item, binding.source),
            path: [binding.source],
            expressionPath: [],
            target: input,
            ...(itemCount == null ? {} : { selectedItem: selectedIndex, itemCount }),
          }));
      if ("dataBinding" in scope.node && scope.node.kind === "map") {
        scope.node.dataBinding = {
          ownership: "project",
          label: titleCase(scope.receiver),
          ...(itemCount == null ? {} : { itemCount }),
        };
      }
  }

  for (const [name, declaration] of page.declarations) {
    if (!declaration.initializer || name.startsWith("ariaCms")) continue;
    const resolved = resolveExpression(declaration.initializer, page, env, name);
    const node = resolved.sourceFile ? resolved : {
      ...resolved,
      sourceFile: page.relativeFile,
      sourceHash: sha256(page.source),
      sourceRange: sourceRange(page, declaration.initializer),
    };
    pageGroup.fields.push(...flattenNode({ group: "page", rootLabel: titleCase(name), receiver: name, node, target: input }));
  }

  for (const [name, imported] of page.imports) {
    if (!imported.specifier.startsWith(".") || /\.(?:astro|vue|svelte)$/i.test(imported.specifier)) continue;
    const node = resolveIdentifier(name, page, env, name, new Set());
    pageGroup.fields.push(...flattenNode({ group: "page", rootLabel: titleCase(name), receiver: name, node, target: input }));
  }

  for (const rootData of await projectRegistry(root, input.refresh)) {
    if (rootData.sourceFile === input.relativeFile) continue;
    const binding: ProjectDataImportBinding = {
      sourceFile: rootData.sourceFile,
      exportName: rootData.exportName,
      specifier: relativeImport(input.relativeFile, rootData.sourceFile),
      suggestedLocalName: rootData.suggestedLocalName,
    };
    projectGroup.fields.push(...flattenNode({
      group: "project",
      rootLabel: `${titleCase(rootData.suggestedLocalName)} · ${rootData.sourceFile}`,
      receiver: rootData.suggestedLocalName,
      node: rootData.node,
      target: input,
      importBinding: binding,
    }));
  }

  for (const group of groups) {
    const seen = new Set<string>();
    group.fields = group.fields.filter((field) => {
      const key = `${field.expression}:${field.sourceFile ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((left, right) => left.pathLabel.localeCompare(right.pathLabel));
    const roots = new Map<string, ProjectDataCatalogRoot>();
    for (const field of group.fields) {
      const rootExpression = /^[A-Za-z_$][\w$]*/.exec(field.expression)?.[0] ?? field.expression;
      const rootId = fieldId(group.id, rootExpression, field.sourceFile);
      field.rootId = rootId;
      const existing = roots.get(rootId);
      if (existing) {
        existing.fieldIds.push(field.id);
        if (existing.itemCount == null && field.itemCount != null) existing.itemCount = field.itemCount;
      } else {
        roots.set(rootId, {
          id: rootId,
          group: group.id,
          label: field.pathLabel.split(" · ")[0] ?? field.label,
          expression: rootExpression,
          shape: field.expression === rootExpression ? field.shape : "object",
          fieldIds: [field.id],
          ...(field.sourceFile ? { sourceFile: field.sourceFile } : {}),
          ...(field.itemCount == null ? {} : { itemCount: field.itemCount }),
        });
      }
    }
    group.roots = [...roots.values()];
  }
  const sourceMap = new Map<string, ProjectDataCatalogSource>();
  for (const field of groups.flatMap((group) => group.fields)) {
    if (!field.sourceFile) continue;
    const existing = sourceMap.get(field.sourceFile);
    if (existing) {
      existing.editable ||= field.writable;
      if (!existing.sourceHash && field.sourceHash) existing.sourceHash = field.sourceHash;
      continue;
    }
    sourceMap.set(field.sourceFile, {
      id: sha256(field.sourceFile).slice(0, 20),
      file: field.sourceFile,
      kind: field.sourceFile.endsWith(".astro") ? "astro"
        : field.sourceFile.endsWith(".json") ? "json"
        : PROJECT_DATA_FILE.test(field.sourceFile) ? "module"
        : "asset",
      ...(field.sourceHash ? { sourceHash: field.sourceHash } : {}),
      editable: field.writable,
    });
  }
  const selected = groups.flatMap((group) => group.fields).find((field) => expressionsEquivalent(field.expression, expression));
  return {
    groups,
    sources: [...sourceMap.values()].sort((left, right) => left.file.localeCompare(right.file)),
    ...(selected ? { selectedFieldId: selected.id } : {}),
    ...(expression ? { expression } : {}),
    managed,
    targetPath,
    target: input.target,
    scannedAt: new Date().toISOString(),
  };
}

function serializeLiteral(value: ProjectDataCatalogEditInput["value"]): string {
  if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
    throw new Error("PROJECT_DATA_INVALID_VALUE: Project data must be a string, number, boolean, or null.");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("PROJECT_DATA_INVALID_VALUE: Enter a finite number.");
  }
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function validateLiteralReplacement(sourceLiteral: string, value: ProjectDataCatalogEditInput["value"]): void {
  const parsed = expressionNode(sourceLiteral);
  if (!parsed) throw new Error("PROJECT_DATA_UNWRITABLE: The selected source is no longer a literal value.");
  const current = unwrap(parsed);
  const expected = ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current) ? "string"
    : ts.isNumericLiteral(current) || (ts.isPrefixUnaryExpression(current) && ts.isNumericLiteral(current.operand)) ? "number"
    : current.kind === ts.SyntaxKind.TrueKeyword || current.kind === ts.SyntaxKind.FalseKeyword ? "boolean"
    : current.kind === ts.SyntaxKind.NullKeyword ? "null"
    : "unknown";
  if (expected === "unknown") throw new Error("PROJECT_DATA_UNWRITABLE: The selected source is no longer a literal value.");
  if (expected !== "null" && typeof value !== expected) {
    throw new Error(`PROJECT_DATA_INVALID_VALUE: This source value must remain a ${expected}.`);
  }
}

export function editProjectDataCatalogValue(projectPath: string, input: ProjectDataCatalogEditInput): ProjectDataCatalogEditResult {
  const root = canonicalDirectory(projectPath);
  const absolute = resolveWithinRoot(root, path.join(root, input.sourceFile), { rejectFinalSymlink: true });
  const source = fs.readFileSync(absolute, "utf8");
  if (sha256(source) !== input.expectedSourceHash) {
    throw new Error("PROJECT_DATA_CONFLICT: The data source changed on disk. Refresh Composer and try again.");
  }
  if (input.sourceRange.from < 0 || input.sourceRange.to > source.length || input.sourceRange.from >= input.sourceRange.to) {
    throw new Error("PROJECT_DATA_UNWRITABLE: The selected value no longer has a valid source range.");
  }
  validateLiteralReplacement(source.slice(input.sourceRange.from, input.sourceRange.to), input.value);
  const next = `${source.slice(0, input.sourceRange.from)}${serializeLiteral(input.value)}${source.slice(input.sourceRange.to)}`;
  writeTextFileAtomic(absolute, next);
  markSelfWrite(absolute);
  invalidateProjectDataCatalogRegistry(root);
  return { ok: true, sourceFile: input.sourceFile, sourceHash: sha256(next), value: input.value };
}
