import ts from "typescript";
import type { AstroCollectionBinding } from "../../shared/composer/types";

type Binding = AstroCollectionBinding;

const MANY_METHODS = new Set([
  "concat", "filter", "flat", "flatMap", "map", "reverse", "slice", "sort",
  "toReversed", "toSorted", "toSpliced", "with",
]);
const ONE_METHODS = new Set(["at", "find", "findLast", "pop", "shift"]);

function frontmatterOf(source: string): string {
  const normalized = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const match = /^\s*---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/.exec(normalized);
  return match?.[1] ?? "";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function merge(...bindings: Array<Binding | null>): Binding | null {
  const present = bindings.filter((binding): binding is Binding => Boolean(binding));
  if (!present.length) return null;
  const cardinalities = new Set(present.map((binding) => binding.cardinality));
  return {
    collections: unique(present.flatMap((binding) => binding.collections)),
    cardinality: cardinalities.size === 1 ? present[0]!.cardinality : "unknown",
    dynamic: present.some((binding) => binding.dynamic),
  };
}

function equal(a: Binding | undefined, b: Binding): boolean {
  return Boolean(
    a &&
    a.cardinality === b.cardinality &&
    Boolean(a.dynamic) === Boolean(b.dynamic) &&
    a.collections.join("\0") === b.collections.join("\0"),
  );
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAwaitExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function returnedExpression(node: ts.FunctionLikeDeclaration): ts.Expression | null {
  if (!node.body) return null;
  if (!ts.isBlock(node.body)) return node.body;
  const returns: ts.Expression[] = [];
  const visit = (candidate: ts.Node) => {
    if (candidate !== node.body && ts.isFunctionLike(candidate)) return;
    if (ts.isReturnStatement(candidate) && candidate.expression) returns.push(candidate.expression);
    ts.forEachChild(candidate, visit);
  };
  visit(node.body);
  return returns.length === 1 ? returns[0]! : null;
}

/**
 * Analyze native Astro Content Collection calls without importing or executing
 * project code. The result is attached to the Composer model only.
 */
export function analyzeAstroCollectionProvenance(
  source: string,
  options?: { props?: Record<string, Binding> },
): Record<string, Binding> {
  const frontmatter = frontmatterOf(source);
  if (!frontmatter.trim()) return {};
  const file = ts.createSourceFile("composer-frontmatter.ts", frontmatter, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const apiNames = new Map<string, string>();
  const namespaces = new Set<string>();
  const stringConstants = new Map<string, string>();
  const declarations: Array<{ name: ts.BindingName; expression: ts.Expression }> = [];
  const helpers = new Map<string, ts.Expression>();

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "astro:content") {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const specifier of bindings.elements) {
          apiNames.set(specifier.name.text, specifier.propertyName?.text ?? specifier.name.text);
        }
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const returned = returnedExpression(statement);
      if (returned) helpers.set(statement.name.text, returned);
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue;
      declarations.push({ name: declaration.name, expression: declaration.initializer });
      if (ts.isIdentifier(declaration.name)) {
        const literal = unwrap(declaration.initializer);
        if (ts.isStringLiteralLike(literal)) stringConstants.set(declaration.name.text, literal.text);
        if (ts.isArrowFunction(literal) || ts.isFunctionExpression(literal)) {
          const returned = returnedExpression(literal);
          if (returned) helpers.set(declaration.name.text, returned);
        }
      }
    }
  }

  const bindings = new Map<string, Binding>();
  for (const [prop, binding] of Object.entries(options?.props ?? {})) {
    bindings.set(`Astro.props.${prop}`, binding);
  }
  for (const declaration of declarations) {
    const initializer = unwrap(declaration.expression);
    if (!ts.isObjectBindingPattern(declaration.name) || !ts.isPropertyAccessExpression(initializer)) continue;
    if (!ts.isIdentifier(initializer.expression) || initializer.expression.text !== "Astro" || initializer.name.text !== "props") continue;
    for (const element of declaration.name.elements) {
      const propName = element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
        ? element.propertyName.text
        : ts.isIdentifier(element.name) ? element.name.text : null;
      if (!propName || !ts.isIdentifier(element.name)) continue;
      const binding = options?.props?.[propName];
      if (binding) bindings.set(element.name.text, binding);
    }
  }
  const resolvingHelpers = new Set<string>();

  const collectionName = (expression: ts.Expression | undefined): { names: string[]; dynamic: boolean } => {
    if (!expression) return { names: [], dynamic: true };
    const candidate = unwrap(expression);
    if (ts.isStringLiteralLike(candidate)) return { names: [candidate.text], dynamic: false };
    if (ts.isIdentifier(candidate) && stringConstants.has(candidate.text)) {
      return { names: [stringConstants.get(candidate.text)!], dynamic: false };
    }
    return { names: [], dynamic: true };
  };

  const evaluate = (input: ts.Expression): Binding | null => {
    const expression = unwrap(input);
    if (ts.isIdentifier(expression)) return bindings.get(expression.text) ?? null;
    if (ts.isPropertyAccessExpression(expression)) {
      const direct = bindings.get(expression.getText(file));
      if (direct) return direct;
    }
    if (ts.isConditionalExpression(expression)) return merge(evaluate(expression.whenTrue), evaluate(expression.whenFalse));
    if (ts.isBinaryExpression(expression)) return merge(evaluate(expression.left), evaluate(expression.right));
    if (ts.isArrayLiteralExpression(expression)) {
      const value = merge(...expression.elements.filter(ts.isExpression).map(evaluate));
      return value ? { ...value, cardinality: "many" } : null;
    }
    if (!ts.isCallExpression(expression)) return null;

    let api: string | null = null;
    if (ts.isIdentifier(expression.expression)) {
      api = apiNames.get(expression.expression.text) ?? null;
      if (!api && helpers.has(expression.expression.text) && !resolvingHelpers.has(expression.expression.text)) {
        resolvingHelpers.add(expression.expression.text);
        const result = evaluate(helpers.get(expression.expression.text)!);
        resolvingHelpers.delete(expression.expression.text);
        return result;
      }
    } else if (ts.isPropertyAccessExpression(expression.expression)) {
      const owner = unwrap(expression.expression.expression);
      if (ts.isIdentifier(owner) && namespaces.has(owner.text)) api = expression.expression.name.text;
      if (
        !api &&
        ts.isIdentifier(owner) &&
        owner.text === "Promise" &&
        (expression.expression.name.text === "all" || expression.expression.name.text === "allSettled")
      ) {
        const value = merge(...expression.arguments.map(evaluate));
        return value ? { ...value, cardinality: "many" } : null;
      }
      if (!api) {
        const base = evaluate(expression.expression.expression);
        if (base) {
          const method = expression.expression.name.text;
          if (MANY_METHODS.has(method)) return { ...base, cardinality: "many" };
          if (ONE_METHODS.has(method)) return { ...base, cardinality: "one" };
          return base;
        }
      }
    }

    if (api === "getCollection") {
      const collection = collectionName(expression.arguments[0]);
      return { collections: collection.names, cardinality: "many", dynamic: collection.dynamic || undefined };
    }
    if (api === "getEntry" || api === "getEntryBySlug") {
      const first = expression.arguments[0];
      const objectArgument = first ? unwrap(first) : null;
      if (objectArgument && ts.isObjectLiteralExpression(objectArgument)) {
        const property = objectArgument.properties.find((item) =>
          ts.isPropertyAssignment(item) && ((ts.isIdentifier(item.name) || ts.isStringLiteralLike(item.name)) && item.name.text === "collection"),
        );
        const collection = property && ts.isPropertyAssignment(property)
          ? collectionName(property.initializer)
          : { names: [], dynamic: true };
        return { collections: collection.names, cardinality: "one", dynamic: collection.dynamic || undefined };
      }
      const collection = collectionName(first);
      return { collections: collection.names, cardinality: "one", dynamic: collection.dynamic || undefined };
    }
    if (api === "getEntries") {
      const value = merge(...expression.arguments.map(evaluate));
      return value ? { ...value, cardinality: "many" } : { collections: [], cardinality: "many", dynamic: true };
    }
    return null;
  };

  const assign = (name: ts.BindingName, value: Binding): boolean => {
    let changed = false;
    if (ts.isIdentifier(name)) {
      if (!equal(bindings.get(name.text), value)) {
        bindings.set(name.text, value);
        changed = true;
      }
      return changed;
    }
    if (ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (!ts.isOmittedExpression(element) && assign(element.name, { ...value, cardinality: "one" })) changed = true;
      }
    }
    return changed;
  };

  for (let pass = 0; pass < Math.max(2, declarations.length + 1); pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      const value = evaluate(declaration.expression);
      if (value && assign(declaration.name, value)) changed = true;
    }
    if (!changed) break;
  }

  return Object.fromEntries([...bindings.entries()].map(([name, binding]) => [name, {
    ...binding,
    collections: unique(binding.collections),
  }]));
}
