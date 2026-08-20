import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { FieldSchema } from "../../shared/cms";
import type {
  ComposerDataBinding,
  ComposerDataInspectionInput,
  ComposerDataInspectionResult,
  ComposerProjectDataEditInput,
  ComposerProjectDataEditResult,
  ProjectDataAdoptionAssessment,
  ProjectDataAdoptionField,
  ProjectDataAdoptionInput,
  ProjectDataCutoverInput,
  ProjectDataCutoverResult,
  ProjectDataConsumerAssessment,
} from "../../shared/composer/projectData";
import { canonicalDirectory, resolveWithinRoot, writeTextFileAtomic } from "../pathSafety";
import { readCollections } from "../collections";
import { createEntry, writeCollectionsWithContentConfig } from "../cms";

type ModuleContext = {
  root: string;
  absoluteFile: string;
  relativeFile: string;
  source: string;
  file: ts.SourceFile;
  compilerOptions: ts.CompilerOptions;
};

type Reference = {
  context: ModuleContext;
  rootNode: ts.Expression;
  rootExport: string;
  valuePath: string[];
};

type Evaluated = {
  value: unknown;
  ranges: Map<string, { from: number; to: number }>;
};

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

function slugify(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project-data";
}

function compilerOptions(root: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) return { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true };
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) return { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true };
  return ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath)).options;
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function moduleContext(root: string, absoluteFile: string, source?: string): ModuleContext {
  const safe = resolveWithinRoot(root, absoluteFile, { rejectFinalSymlink: true });
  const text = source ?? fs.readFileSync(safe, "utf8");
  return {
    root,
    absoluteFile: safe,
    relativeFile: toPosix(path.relative(root, safe)),
    source: text,
    file: ts.createSourceFile(safe, text, ts.ScriptTarget.Latest, true, scriptKind(safe)),
    compilerOptions: compilerOptions(root),
  };
}

function astroFrontmatter(source: string): string {
  const match = /^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  return match?.[1] ?? "";
}

function astroContext(root: string, relativeFile: string, source: string): ModuleContext {
  const absolute = resolveWithinRoot(root, path.join(root, relativeFile), {
    allowMissing: false,
    rejectFinalSymlink: true,
  });
  const frontmatter = astroFrontmatter(source);
  return {
    root,
    absoluteFile: absolute,
    relativeFile: toPosix(path.relative(root, absolute)),
    source: frontmatter,
    file: ts.createSourceFile(`${absolute}.frontmatter.ts`, frontmatter, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    compilerOptions: compilerOptions(root),
  };
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) current = current.expression;
  return current;
}

function expressionNode(expression: string): ts.Expression | null {
  const source = ts.createSourceFile(
    "expression.ts",
    `const __aria_value = (${expression});`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statement = source.statements[0];
  return statement && ts.isVariableStatement(statement)
    ? statement.declarationList.declarations[0]?.initializer ?? null
    : null;
}

function bindingKey(element: ts.BindingElement): string | null {
  if (element.propertyName) {
    if (ts.isIdentifier(element.propertyName) || ts.isStringLiteral(element.propertyName)) return element.propertyName.text;
    return null;
  }
  return ts.isIdentifier(element.name) ? element.name.text : null;
}

function findVariable(context: ModuleContext, name: string): ts.VariableDeclaration | ts.BindingElement | null {
  let found: ts.VariableDeclaration | ts.BindingElement | null = null;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isVariableDeclaration(node)) {
      if (ts.isIdentifier(node.name) && node.name.text === name) found = node;
      if (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name)) {
        const findElement = (pattern: ts.BindingPattern): ts.BindingElement | undefined => {
          for (const item of pattern.elements) {
            if (ts.isOmittedExpression(item)) continue;
            if (ts.isIdentifier(item.name) && item.name.text === name) return item;
            if (ts.isObjectBindingPattern(item.name) || ts.isArrayBindingPattern(item.name)) {
              const nested = findElement(item.name);
              if (nested) return nested;
            }
          }
          return undefined;
        };
        const element = findElement(node.name);
        if (element) found = element;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(context.file);
  return found;
}

function findImportBinding(context: ModuleContext, name: string): { specifier: string; imported: string } | null {
  for (const statement of context.file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.importClause.name?.text === name) {
      return { specifier: statement.moduleSpecifier.text, imported: "default" };
    }
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      const element = bindings.elements.find((item) => item.name.text === name);
      if (element) return {
        specifier: statement.moduleSpecifier.text,
        imported: element.propertyName?.text ?? element.name.text,
      };
    }
  }
  return null;
}

function resolveModule(context: ModuleContext, specifier: string): ModuleContext | null {
  const resolved = ts.resolveModuleName(
    specifier,
    context.absoluteFile,
    context.compilerOptions,
    ts.sys,
  ).resolvedModule?.resolvedFileName;
  const candidates = [
    resolved,
    path.resolve(path.dirname(context.absoluteFile), specifier),
  ].filter((item): item is string => Boolean(item));
  const extensions = ["", ".ts", ".tsx", ".js", ".mjs", ".mts", ".cts", ".json.ts", "/index.ts"];
  for (const candidate of candidates) {
    for (const extension of extensions) {
      const file = candidate.replace(/\.d\.ts$/, ".ts") + extension;
      try {
        if (fs.statSync(file).isFile()) return moduleContext(context.root, file);
      } catch { /* next candidate */ }
    }
  }
  return null;
}

function defaultExport(context: ModuleContext): { name: string; node: ts.Expression } | null {
  for (const statement of context.file.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
    const expression = unwrap(statement.expression);
    if (ts.isIdentifier(expression)) {
      const declaration = findVariable(context, expression.text);
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return { name: expression.text, node: declaration.initializer };
      }
    }
    return { name: "default", node: expression };
  }
  return null;
}

function namedExport(context: ModuleContext, name: string): { name: string; node: ts.Expression } | null {
  const declaration = findVariable(context, name);
  if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
    const statement = declaration.parent.parent;
    if (ts.isVariableStatement(statement) && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      return { name, node: declaration.initializer };
    }
  }
  for (const statement of context.file.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    const element = statement.exportClause.elements.find((item) => item.name.text === name);
    if (!element) continue;
    const local = element.propertyName?.text ?? element.name.text;
    const localDeclaration = findVariable(context, local);
    if (localDeclaration && ts.isVariableDeclaration(localDeclaration) && localDeclaration.initializer) {
      return { name, node: localDeclaration.initializer };
    }
  }
  return null;
}

function resolveReference(node: ts.Expression, context: ModuleContext, seen = new Set<string>()): Reference | null {
  const current = unwrap(node);
  if (ts.isPropertyAccessExpression(current)) {
    const parent = resolveReference(current.expression, context, seen);
    return parent ? { ...parent, valuePath: [...parent.valuePath, current.name.text] } : null;
  }
  if (
    ts.isElementAccessExpression(current) &&
    current.argumentExpression &&
    (ts.isStringLiteral(current.argumentExpression) || ts.isNumericLiteral(current.argumentExpression))
  ) {
    const parent = resolveReference(current.expression, context, seen);
    return parent ? { ...parent, valuePath: [...parent.valuePath, current.argumentExpression.text] } : null;
  }
  if (!ts.isIdentifier(current)) return null;
  const key = `${context.absoluteFile}:${current.text}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const declaration = findVariable(context, current.text);
  if (declaration && ts.isBindingElement(declaration)) {
    const segments: string[] = [];
    let element: ts.BindingElement = declaration;
    let owner: ts.Node = element.parent.parent;
    while (true) {
      const keyName = bindingKey(element);
      if (!keyName) return null;
      segments.unshift(keyName);
      if (ts.isVariableDeclaration(owner)) break;
      if (!ts.isBindingElement(owner)) return null;
      element = owner;
      owner = element.parent.parent;
    }
    const variable = owner;
    if (!variable.initializer) return null;
    const parent = resolveReference(variable.initializer, context, seen);
    return parent ? { ...parent, valuePath: [...parent.valuePath, ...segments] } : null;
  }
  if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
    const referenced = resolveReference(declaration.initializer, context, seen);
    return referenced ?? {
      context,
      rootNode: declaration.initializer,
      rootExport: ts.isIdentifier(declaration.name) ? declaration.name.text : "data",
      valuePath: [],
    };
  }

  const importBinding = findImportBinding(context, current.text);
  if (!importBinding) return null;
  const imported = resolveModule(context, importBinding.specifier);
  const exported = imported && (importBinding.imported === "default"
    ? defaultExport(imported)
    : namedExport(imported, importBinding.imported));
  return imported && exported ? {
    context: imported,
    rootNode: exported.node,
    rootExport: exported.name,
    valuePath: [],
  } : null;
}

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function evaluate(node: ts.Expression, context: ModuleContext, ranges = new Map<string, { from: number; to: number }>(), valuePath: string[] = [], seen = new Set<ts.Node>()): unknown {
  const current = unwrap(node);
  if (seen.has(current)) throw new Error("Circular local data is not editable");
  seen.add(current);
  const rangeKey = valuePath.join(".");
  ranges.set(rangeKey, { from: current.getStart(context.file), to: current.getEnd() });
  try {
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) return current.text;
    if (ts.isNumericLiteral(current)) return Number(current.text);
    if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (current.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(current) && ts.isNumericLiteral(current.operand)) {
      const number = Number(current.operand.text);
      return current.operator === ts.SyntaxKind.MinusToken ? -number : number;
    }
    if (ts.isArrayLiteralExpression(current)) {
      return current.elements.map((element, index) => {
        if (!ts.isExpression(element) || ts.isSpreadElement(element)) throw new Error("Spread and omitted array values are not editable");
        return evaluate(element, context, ranges, [...valuePath, String(index)], seen);
      });
    }
    if (ts.isObjectLiteralExpression(current)) {
      const output: Record<string, unknown> = {};
      for (const property of current.properties) {
        if (ts.isPropertyAssignment(property)) {
          const key = propertyName(property.name);
          if (!key) throw new Error("Computed object keys are not editable");
          output[key] = evaluate(property.initializer, context, ranges, [...valuePath, key], seen);
        } else if (ts.isShorthandPropertyAssignment(property)) {
          const declaration = findVariable(context, property.name.text);
          if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer) throw new Error("Unresolved shorthand property");
          output[property.name.text] = evaluate(declaration.initializer, context, ranges, [...valuePath, property.name.text], seen);
        } else {
          throw new Error("Methods, accessors, and spreads are not editable project data");
        }
      }
      return output;
    }
    if (ts.isIdentifier(current)) {
      const declaration = findVariable(context, current.text);
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return evaluate(declaration.initializer, context, ranges, valuePath, seen);
      }
    }
    throw new Error("The value is computed at runtime");
  } finally {
    seen.delete(current);
  }
}

function evaluateReference(reference: Reference): Evaluated {
  const ranges = new Map<string, { from: number; to: number }>();
  return { value: evaluate(reference.rootNode, reference.context, ranges), ranges };
}

function valueAtPath(value: unknown, valuePath: readonly string[]): unknown {
  return valuePath.reduce<unknown>((current, key) => {
    if (Array.isArray(current)) return current[Number(key)];
    if (current && typeof current === "object") return (current as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

function shapeOf(value: unknown): ComposerDataBinding["shape"] {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value && typeof value === "object") return "object";
  return "unknown";
}

function receiverExpression(expression: string): string {
  const trimmed = expression.trim().replace(/^\{|\}$/g, "").trim();
  const map = /^(.*?)\.map\s*\(/s.exec(trimmed);
  return map?.[1]?.trim() || trimmed;
}

function computedBinding(expression: string, reason: string, ownership: ComposerDataBinding["ownership"] = "computed"): ComposerDataBinding {
  return {
    ownership,
    expression,
    displayName: ownership === "cms" ? "Aria CMS data" : "Computed expression",
    valuePath: [],
    shape: "unknown",
    writable: false,
    reason,
  };
}

export function inspectComposerProjectData(projectPath: string, input: ComposerDataInspectionInput): ComposerDataInspectionResult {
  const root = canonicalDirectory(projectPath);
  const expression = receiverExpression(input.expression);
  if (/@aria-cms|\bariaCms[A-Z_$]/.test(expression)) {
    return { binding: computedBinding(input.expression, "This value is managed by Aria CMS.", "cms") };
  }
  const parsed = expressionNode(expression);
  if (!parsed) return { binding: computedBinding(input.expression, "Aria could not parse this expression.") };
  const context = astroContext(root, input.relativeFile, input.source);
  const reference = resolveReference(parsed, context);
  if (!reference) return { binding: computedBinding(input.expression, "This expression is computed or its source could not be resolved safely.") };
  try {
    const evaluated = evaluateReference(reference);
    const selected = valueAtPath(evaluated.value, reference.valuePath);
    const sourceHash = sha256(reference.context.source);
    const range = evaluated.ranges.get(reference.valuePath.join("."));
    const rootValue = evaluated.value && typeof evaluated.value === "object" && !Array.isArray(evaluated.value)
      ? evaluated.value as Record<string, unknown>
      : undefined;
    return {
      binding: {
        ownership: "project",
        expression: input.expression,
        displayName: reference.valuePath.length
          ? reference.valuePath.map(titleCase).join(" ")
          : titleCase(reference.rootExport),
        valuePath: reference.valuePath,
        shape: shapeOf(selected),
        ...(Array.isArray(selected) ? { itemCount: selected.length } : {}),
        value: selected,
        writable: Boolean(range),
        sourceFile: reference.context.relativeFile,
        sourceHash,
        sourceRange: range,
        rootExport: reference.rootExport,
        ...(rootValue ? { rootValue } : {}),
      },
    };
  } catch (error) {
    return { binding: computedBinding(input.expression, error instanceof Error ? error.message : String(error)) };
  }
}

function inferField(key: string, value: unknown): ProjectDataAdoptionField {
  const warnings: string[] = [];
  let field: FieldSchema;
  if (typeof value === "string") field = { key, label: titleCase(key), type: "string" };
  else if (typeof value === "number") field = { key, label: titleCase(key), type: Number.isInteger(value) ? "integer" : "number" };
  else if (typeof value === "boolean") field = { key, label: titleCase(key), type: "boolean" };
  else if (Array.isArray(value)) {
    if (value.length === 0) {
      field = { key, label: titleCase(key), type: "json" };
      warnings.push(`${titleCase(key)} is empty, so Aria cannot infer its item fields.`);
    } else if (value.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      const keys = [...new Set(value.flatMap((item) => Object.keys(item as Record<string, unknown>)))];
      field = { key, label: titleCase(key), type: "repeater", fields: keys.map((child) => inferField(child, (value[0] as Record<string, unknown>)[child]).field) };
    } else if (value.every((item) => ["string", "number", "boolean"].includes(typeof item))) {
      const kinds = new Set(value.map((item) => typeof item));
      if (kinds.size === 1) {
        field = {
          key,
          label: titleCase(key),
          type: "repeater",
          fields: [inferField("value", value[0]).field],
          repeaterDisplay: { titleFieldKey: "value", addButtonLabel: `Add ${titleCase(key)} item` },
        };
      } else {
        field = { key, label: titleCase(key), type: "json" };
        warnings.push(`${titleCase(key)} contains mixed scalar types and will use a JSON field.`);
      }
    } else {
      field = { key, label: titleCase(key), type: "json" };
      warnings.push(`${titleCase(key)} contains mixed or nested array values and will use a JSON field.`);
    }
  } else if (value && typeof value === "object") {
    field = {
      key,
      label: titleCase(key),
      type: "object",
      fields: Object.entries(value as Record<string, unknown>).map(([child, childValue]) => inferField(child, childValue).field),
    };
  } else {
    field = { key, label: titleCase(key), type: "json" };
    warnings.push(`${titleCase(key)} has no concrete literal type and will use a JSON field.`);
  }
  return { field, selected: true, warnings };
}

function cmsValue(field: FieldSchema, value: unknown): unknown {
  if (field.type === "repeater" && Array.isArray(value) && field.fields?.length === 1 && field.fields[0]?.key === "value") {
    return value.map((item) => ({ value: item }));
  }
  if (field.type === "repeater" && Array.isArray(value)) {
    return value.map((item) => item && typeof item === "object"
      ? Object.fromEntries((field.fields ?? []).map((child) => [child.key, cmsValue(child, (item as Record<string, unknown>)[child.key])]))
      : item);
  }
  if (field.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries((field.fields ?? []).map((child) => [child.key, cmsValue(child, (value as Record<string, unknown>)[child.key])]));
  }
  return value;
}

async function astroExpressions(source: string): Promise<Array<{ expression: string; from: number; to: number }>> {
  const expressions: Array<{ expression: string; from: number; to: number }> = [];
  const frontmatter = /^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(source);
  const start = frontmatter?.[0].length ?? 0;
  let depth = 0;
  let open = -1;
  let quote: "\"" | "'" | "`" | null = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") {
      if (depth === 0) open = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && open >= 0) {
        const raw = source.slice(open + 1, index);
        const expression = raw.trim();
        const leading = raw.indexOf(expression);
        if (expression) expressions.push({
          expression,
          from: open + 1 + leading,
          to: open + 1 + leading + expression.length,
        });
        open = -1;
      }
    }
  }
  return expressions;
}

async function scanConsumers(root: string, sourceFile: string, rootExport: string): Promise<ProjectDataConsumerAssessment[]> {
  const src = path.join(root, "src");
  const results: ProjectDataConsumerAssessment[] = [];
  const walk = async (directory: string): Promise<void> => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) { await walk(absolute); continue; }
      if (!/\.(?:astro|ts|tsx|js|jsx|mjs|mts)$/.test(entry.name)) continue;
      const source = fs.readFileSync(absolute, "utf8");
      const sourceStem = path.basename(sourceFile).replace(/\.(?:ts|tsx|js|mjs|mts)$/, "").replace(/\.json$/, "");
      if (!source.includes(rootExport) && !source.includes(sourceStem)) continue;
      const file = toPosix(path.relative(root, absolute));
      for (const candidate of file.endsWith(".astro") ? await astroExpressions(source) : []) {
        const expression = candidate.expression;
        const inspected = file.endsWith(".astro")
          ? inspectComposerProjectData(root, { relativeFile: file, source, expression }).binding
          : computedBinding(expression, "Only Astro consumers can be cut over automatically.");
        const transformations = /\.(?:filter|reduce|sort|slice)\s*\(/.test(expression);
        const safe = inspected.ownership === "project" && inspected.sourceFile === sourceFile && !transformations;
        results.push({
          id: sha256(`${file}:${candidate.from}:${expression}`).slice(0, 16),
          file,
          expression,
          valuePath: inspected.valuePath,
          status: safe ? "safe" : inspected.ownership === "project" ? "manual" : "unresolved",
          sourceHash: sha256(source),
          sourceRange: { from: candidate.from, to: candidate.to },
          ...(!safe ? { reason: transformations ? "This consumer transforms the source data." : inspected.reason ?? "The data path could not be proven." } : {}),
        });
      }
    }
  };
  await walk(src);
  return results;
}

function fieldAtPath(fields: readonly FieldSchema[], valuePath: readonly string[]): FieldSchema | null {
  let current = fields.find((field) => field.key === valuePath[0]);
  for (const segment of valuePath.slice(1)) current = current?.fields?.find((field) => field.key === segment);
  return current ?? null;
}

function cmsAccess(variable: string, valuePath: readonly string[]): string {
  return valuePath.reduce(
    (expression, segment, index) => `${expression}${index === 0 ? "?.data" : ""}?.[${JSON.stringify(segment)}]`,
    variable,
  );
}

function identifier(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_$]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const joined = cleaned.map((word, index) => index === 0
    ? word.replace(/^[^a-zA-Z_$]+/, "").replace(/^./, (character) => character.toLowerCase())
    : word.replace(/^./, (character) => character.toUpperCase())).join("");
  return /^[a-zA-Z_$][\w$]*$/.test(joined) ? joined : "ariaCmsProjectData";
}

function injectGetCollection(frontmatter: string): string {
  const importPattern = /import\s*\{([^}]*)\}\s*from\s*["']astro:content["'];?/;
  const match = importPattern.exec(frontmatter);
  if (!match) return `import { getCollection } from "astro:content";\n${frontmatter}`;
  const names = match[1]!.split(",").map((name) => name.trim()).filter(Boolean);
  if (!names.some((name) => name.split(/\s+as\s+/)[0] === "getCollection")) names.push("getCollection");
  return frontmatter.replace(importPattern, `import { ${names.join(", ")} } from "astro:content";`);
}

function injectCmsEntryQuery(source: string, collectionName: string, entrySlug: string, variable: string): string {
  const match = /^(\uFEFF?---\s*\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(source);
  if (!match) throw new Error("PROJECT_DATA_CUTOVER_UNSAFE: Astro frontmatter is required for CMS bindings.");
  const marker = `/* @aria-cms-query:project-data-${collectionName} */`;
  const end = `/* @aria-cms-query-end:project-data-${collectionName} */`;
  const query = `${marker}\nconst ${variable} = (await getCollection(${JSON.stringify(collectionName)})).find((entry) => (entry.data.slug ?? entry.id) === ${JSON.stringify(entrySlug)});\n${end}`;
  let frontmatter = injectGetCollection(match[2]!);
  const existing = new RegExp(`${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  frontmatter = existing.test(frontmatter)
    ? frontmatter.replace(existing, query)
    : `${frontmatter.trimEnd()}\n\n${query}`;
  return `${match[1]}${frontmatter}${match[3]}${source.slice(match[0].length)}`;
}

function cutoverExpression(
  expression: string,
  valuePath: readonly string[],
  fields: readonly FieldSchema[],
  variable: string,
): string {
  const receiver = receiverExpression(expression);
  const access = cmsAccess(variable, valuePath);
  const field = fieldAtPath(fields, valuePath);
  const scalarRepeater = field?.type === "repeater" && field.fields?.length === 1 && field.fields[0]?.key === "value";
  const bound = scalarRepeater ? `${access}?.map((item) => item?.value)` : access;
  const fallback = `${bound} ?? /* @aria-cms-fallback */ (${receiver})`;
  const mapIndex = expression.indexOf(`${receiver}.map`);
  return mapIndex >= 0
    ? `${expression.slice(0, mapIndex)}(${fallback}).map${expression.slice(mapIndex + receiver.length + 4)}`
    : fallback;
}

export async function applyProjectDataCutover(projectPath: string, input: ProjectDataCutoverInput): Promise<ProjectDataCutoverResult> {
  const root = canonicalDirectory(projectPath);
  const assessment = await assessProjectDataAdoption(root, input);
  if (assessment.previewHash !== input.expectedPreviewHash) {
    throw new Error("PROJECT_DATA_CONFLICT: The adoption assessment changed. Review consumers again.");
  }
  const chosen = new Set(input.consumerIds);
  const consumers = assessment.consumers.filter((consumer) => chosen.has(consumer.id));
  if (consumers.some((consumer) => consumer.status !== "safe")) {
    throw new Error("PROJECT_DATA_CUTOVER_UNSAFE: Only proven consumers can be cut over automatically.");
  }
  const fields = assessment.fields.filter((item) => item.selected).map((item) => item.field);
  const variable = identifier(`aria cms ${assessment.collectionName}`);
  const changedFiles: string[] = [];
  const byFile = new Map<string, ProjectDataConsumerAssessment[]>();
  for (const consumer of consumers) byFile.set(consumer.file, [...(byFile.get(consumer.file) ?? []), consumer]);
  for (const [file, fileConsumers] of byFile) {
    const absolute = resolveWithinRoot(root, path.join(root, file), { rejectFinalSymlink: true });
    const source = fs.readFileSync(absolute, "utf8");
    if (fileConsumers.some((consumer) => consumer.sourceHash !== sha256(source))) {
      throw new Error(`PROJECT_DATA_CONFLICT: ${file} changed after the migration review.`);
    }
    let next = source;
    for (const consumer of [...fileConsumers].sort((a, b) => b.sourceRange!.from - a.sourceRange!.from)) {
      const range = consumer.sourceRange!;
      const current = next.slice(range.from, range.to);
      if (current !== consumer.expression) throw new Error(`PROJECT_DATA_CONFLICT: ${file} no longer contains the reviewed expression.`);
      next = `${next.slice(0, range.from)}${cutoverExpression(current, consumer.valuePath, fields, variable)}${next.slice(range.to)}`;
    }
    next = injectCmsEntryQuery(next, assessment.collectionName, assessment.entrySlug, variable);
    writeTextFileAtomic(absolute, next);
    changedFiles.push(file);
  }
  return {
    ok: true,
    changedFiles,
    cutoverConsumers: consumers.map((consumer) => consumer.id),
    retainedSourceFile: assessment.sourceFile,
  };
}

export async function assessProjectDataAdoption(projectPath: string, input: ProjectDataAdoptionInput): Promise<ProjectDataAdoptionAssessment> {
  const root = canonicalDirectory(projectPath);
  const inspection = inspectComposerProjectData(root, input).binding;
  if (inspection.ownership !== "project" || !inspection.rootValue || !inspection.sourceFile || !inspection.sourceHash || !inspection.rootExport) {
    throw new Error("PROJECT_DATA_UNRESOLVED: Aria can only adopt a statically resolved project-owned object.");
  }
  const defaultName = slugify(inspection.rootExport === "default"
    ? path.basename(inspection.sourceFile).replace(/\.(?:ts|tsx|js|mjs|mts)$/, "")
    : inspection.rootExport);
  const collectionName = slugify(input.collectionName ?? defaultName);
  const collectionLabel = (input.collectionLabel ?? titleCase(collectionName)).trim();
  const entryTitle = (input.entryTitle ?? collectionLabel).trim();
  const entrySlug = slugify(input.entrySlug ?? collectionName);
  const selected = input.selectedFields ? new Set(input.selectedFields) : null;
  const fields = Object.entries(inspection.rootValue).map(([key, value]) => {
    const inferred = inferField(key, value);
    return { ...inferred, selected: selected ? selected.has(key) : true };
  });
  const frontmatter = Object.fromEntries(fields.filter((item) => item.selected).map((item) => [
    item.field.key,
    cmsValue(item.field, inspection.rootValue![item.field.key]),
  ]));
  const selectedKeys = new Set(fields.filter((item) => item.selected).map((item) => item.field.key));
  const consumers = (await scanConsumers(root, inspection.sourceFile, inspection.rootExport)).map((consumer) =>
    consumer.valuePath[0] && !selectedKeys.has(consumer.valuePath[0])
      ? { ...consumer, status: "manual" as const, reason: "The referenced top-level field is not selected for adoption." }
      : consumer,
  );
  const stable = {
    sourceHash: inspection.sourceHash,
    sourceFile: inspection.sourceFile,
    rootExport: inspection.rootExport,
    collectionName,
    collectionLabel,
    entryTitle,
    entrySlug,
    fields,
    frontmatter,
    consumers,
  };
  return {
    ...stable,
    previewHash: sha256(JSON.stringify(stable)),
    warnings: fields.flatMap((item) => item.warnings),
  };
}

function serializeLiteral(value: ComposerProjectDataEditInput["value"]): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

export function editComposerProjectData(projectPath: string, input: ComposerProjectDataEditInput): ComposerProjectDataEditResult {
  const root = canonicalDirectory(projectPath);
  const inspection = inspectComposerProjectData(root, input).binding;
  if (inspection.ownership !== "project" || !inspection.sourceFile || !inspection.sourceHash) {
    throw new Error("PROJECT_DATA_UNWRITABLE: This value is not editable project data.");
  }
  if (inspection.sourceHash !== input.expectedSourceHash) {
    throw new Error("PROJECT_DATA_CONFLICT: The data source changed on disk. Refresh Composer and try again.");
  }
  const sourceFile = resolveWithinRoot(root, path.join(root, inspection.sourceFile), { rejectFinalSymlink: true });
  const context = moduleContext(root, sourceFile);
  const parsed = expressionNode(receiverExpression(input.expression));
  const astro = astroContext(root, input.relativeFile, input.source);
  const reference = parsed && resolveReference(parsed, astro);
  if (!reference || reference.context.absoluteFile !== context.absoluteFile) throw new Error("PROJECT_DATA_UNWRITABLE: The source could not be resolved again.");
  const evaluated = evaluateReference(reference);
  const range = evaluated.ranges.get(input.valuePath.join("."));
  if (!range) throw new Error("PROJECT_DATA_UNWRITABLE: The selected value is not a direct literal.");
  const next = `${context.source.slice(0, range.from)}${serializeLiteral(input.value)}${context.source.slice(range.to)}`;
  writeTextFileAtomic(sourceFile, next);
  return {
    ok: true,
    sourceFile: inspection.sourceFile,
    sourceHash: sha256(next),
    value: input.value,
  };
}

export function adoptionCollectionId(): string {
  return randomUUID();
}

export async function createProjectDataDraft(
  projectPath: string,
  input: ProjectDataAdoptionInput,
): Promise<import("../../shared/composer/projectData").ProjectDataAdoptionResult> {
  const root = canonicalDirectory(projectPath);
  const assessment = await assessProjectDataAdoption(root, input);
  if (!input.expectedPreviewHash || input.expectedPreviewHash !== assessment.previewHash) {
    throw new Error("PROJECT_DATA_CONFLICT: The adoption preview is stale. Review the source again before creating the draft.");
  }
  const state = readCollections(root);
  if (state.collections.some((item) => item.name === assessment.collectionName)) {
    throw new Error(`CONFLICT: Collection name already exists: ${assessment.collectionName}`);
  }
  const collectionId = adoptionCollectionId();
  const collection = {
    id: collectionId,
    name: assessment.collectionName,
    label: assessment.collectionLabel,
    kind: "config" as const,
    urlPattern: null,
    listPageFile: null,
    templatePageFile: null,
    schema: {
      fields: assessment.fields.filter((item) => item.selected).map((item) => item.field),
      version: 1,
    },
    supports: ["drafts", "revisions"] as import("../../shared/cms").CollectionSupport[],
    scope: "global" as const,
  };
  writeCollectionsWithContentConfig(root, { collections: [...state.collections, collection] });
  const record = createEntry(root, {
    collectionId,
    title: assessment.entryTitle,
    slug: assessment.entrySlug,
    frontmatter: assessment.frontmatter,
    status: "draft",
  });
  return {
    ok: true,
    collectionId,
    collectionName: assessment.collectionName,
    entryId: record.entry.id,
    entrySlug: record.locales[0]?.slug ?? assessment.entrySlug,
    status: "draft",
    sourceChanged: false,
  };
}
