import ts from "typescript";

export const CONFIG_IMPORT_MARKER = "aria:utility-manager:tailwind-import";
export const CONFIG_PLUGIN_MARKER = "aria:utility-manager:tailwind-plugin";
export const CONFIG_VITE_BEGIN = "aria:utility-manager:tailwind-vite-begin";
export const CONFIG_VITE_END = "aria:utility-manager:tailwind-vite-end";
export const CONFIG_PLUGINS_BEGIN = "aria:utility-manager:tailwind-plugins-begin";
export const CONFIG_PLUGINS_END = "aria:utility-manager:tailwind-plugins-end";

export type AstroConfigPatchMode =
  | "none"
  | "array-item"
  | "plugins-block"
  | "vite-block"
  | "created";

export type AstroConfigAnalysis = {
  configured: boolean;
  safeToPatch: boolean;
  localName: string | null;
  reason?: string;
};

export type AstroConfigPatch = {
  content: string;
  changed: boolean;
  importOwned: boolean;
  pluginPatch: AstroConfigPatchMode;
};

type LocatedConfig = {
  source: ts.SourceFile;
  object: ts.ObjectLiteralExpression | null;
  tailwindLocal: string | null;
  vite: ts.PropertyAssignment | null;
  plugins: ts.PropertyAssignment | null;
  viteConflict: boolean;
  pluginsConflict: boolean;
  identifiers: Set<string>;
  configured: boolean;
};

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  return null;
}

function property(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | null {
  for (const item of object.properties) {
    if (ts.isPropertyAssignment(item) && propertyName(item.name) === name) {
      return item;
    }
  }
  return null;
}

function hasNamedMember(
  object: ts.ObjectLiteralExpression,
  name: string,
): boolean {
  return object.properties.some((item) =>
    Boolean(item.name && propertyName(item.name) === name),
  );
}

function configObject(source: ts.SourceFile): ts.ObjectLiteralExpression | null {
  for (const statement of source.statements) {
    if (!ts.isExportAssignment(statement)) continue;
    const expression = statement.expression;
    if (ts.isObjectLiteralExpression(expression)) return expression;
    if (
      ts.isCallExpression(expression) &&
      expression.arguments.length === 1 &&
      ts.isObjectLiteralExpression(expression.arguments[0]!)
    ) {
      return expression.arguments[0]!;
    }
  }
  return null;
}

function locate(content: string, fileName = "astro.config.mjs"): LocatedConfig {
  const source = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true,
    /\.[cm]?ts$/.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  let tailwindLocal: string | null = null;
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "@tailwindcss/vite"
    ) {
      tailwindLocal = statement.importClause?.name?.text ?? null;
    }
  }
  const object = configObject(source);
  const vite = object ? property(object, "vite") : null;
  const viteConflict = Boolean(object && !vite && hasNamedMember(object, "vite"));
  const viteObject = vite && ts.isObjectLiteralExpression(vite.initializer)
    ? vite.initializer
    : null;
  const plugins = viteObject ? property(viteObject, "plugins") : null;
  const pluginsConflict = Boolean(
    viteObject && !plugins && hasNamedMember(viteObject, "plugins"),
  );
  const pluginArray = plugins && ts.isArrayLiteralExpression(plugins.initializer)
    ? plugins.initializer
    : null;
  const configured = Boolean(
    tailwindLocal && pluginArray?.elements.some((element) =>
      ts.isCallExpression(element) &&
      ts.isIdentifier(element.expression) &&
      element.expression.text === tailwindLocal,
    ),
  );
  const identifiers = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, collect);
  };
  collect(source);
  return {
    source,
    object,
    tailwindLocal,
    vite,
    plugins,
    viteConflict,
    pluginsConflict,
    identifiers,
    configured,
  };
}

export function analyzeAstroConfig(
  content: string,
  fileName?: string,
): AstroConfigAnalysis {
  const found = locate(content, fileName);
  if (found.configured) {
    return {
      configured: true,
      safeToPatch: true,
      localName: found.tailwindLocal,
    };
  }
  if (!found.object) {
    return {
      configured: false,
      safeToPatch: false,
      localName: found.tailwindLocal,
      reason: "Astro config must export a static object or defineConfig({...}).",
    };
  }
  if (found.viteConflict || found.pluginsConflict) {
    return {
      configured: false,
      safeToPatch: false,
      localName: found.tailwindLocal,
      reason: "The Vite configuration uses shorthand or method syntax and cannot be patched safely.",
    };
  }
  if (found.vite && !ts.isObjectLiteralExpression(found.vite.initializer)) {
    return {
      configured: false,
      safeToPatch: false,
      localName: found.tailwindLocal,
      reason: "The vite config is dynamic and cannot be patched safely.",
    };
  }
  if (found.plugins && !ts.isArrayLiteralExpression(found.plugins.initializer)) {
    return {
      configured: false,
      safeToPatch: false,
      localName: found.tailwindLocal,
      reason: "The Vite plugins list is dynamic and cannot be patched safely.",
    };
  }
  return {
    configured: false,
    safeToPatch: true,
    localName: found.tailwindLocal,
  };
}

function lineIndent(content: string, position: number): string {
  const start = content.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
  return content.slice(start, position).match(/^\s*/)?.[0] ?? "";
}

function childIndent(
  content: string,
  object: ts.ObjectLiteralExpression,
): string {
  const first = object.properties[0];
  if (first) return lineIndent(content, first.getStart());
  return `${lineIndent(content, object.getStart())}  `;
}

function addImportInsertion(source: ts.SourceFile): {
  position: number;
  text: string;
} {
  const imports = source.statements.filter(ts.isImportDeclaration);
  const position = imports.at(-1)?.end ?? 0;
  const prefix = position > 0 ? "\n" : "";
  return {
    position,
    text: `${prefix}import ariaTailwindcss from "@tailwindcss/vite"; // ${CONFIG_IMPORT_MARKER}\n`,
  };
}

function applyInsertions(
  content: string,
  insertions: Array<{ position: number; text: string }>,
): string {
  let next = content;
  for (const insertion of [...insertions].sort((a, b) => b.position - a.position)) {
    next = `${next.slice(0, insertion.position)}${insertion.text}${next.slice(insertion.position)}`;
  }
  return next;
}

export function patchAstroConfig(
  content: string,
  fileName = "astro.config.mjs",
): AstroConfigPatch {
  const found = locate(content, fileName);
  const analysis = analyzeAstroConfig(content, fileName);
  if (analysis.configured) {
    return {
      content,
      changed: false,
      importOwned: false,
      pluginPatch: "none",
    };
  }
  if (!analysis.safeToPatch || !found.object) {
    throw new Error(analysis.reason ?? "Astro config cannot be patched safely.");
  }

  const insertions: Array<{ position: number; text: string }> = [];
  let generatedLocal = "ariaTailwindcss";
  let suffix = 2;
  while (!found.tailwindLocal && found.identifiers.has(generatedLocal)) {
    generatedLocal = `ariaTailwindcss${suffix}`;
    suffix += 1;
  }
  const localName = found.tailwindLocal ?? generatedLocal;
  const importOwned = !found.tailwindLocal;
  if (importOwned) {
    const insertion = addImportInsertion(found.source);
    insertion.text = insertion.text.replace("ariaTailwindcss", localName);
    insertions.push(insertion);
  }

  let pluginPatch: AstroConfigPatchMode;
  if (!found.vite) {
    const indent = childIndent(content, found.object);
    insertions.push({
      position: found.object.getStart() + 1,
      text: [
        "\n",
        `${indent}// ${CONFIG_VITE_BEGIN}\n`,
        `${indent}vite: {\n`,
        `${indent}  plugins: [${localName}()],\n`,
        `${indent}},\n`,
        `${indent}// ${CONFIG_VITE_END}\n`,
      ].join(""),
    });
    pluginPatch = "vite-block";
  } else if (!found.plugins) {
    const viteObject = found.vite.initializer as ts.ObjectLiteralExpression;
    const indent = childIndent(content, viteObject);
    insertions.push({
      position: viteObject.getStart() + 1,
      text: [
        "\n",
        `${indent}// ${CONFIG_PLUGINS_BEGIN}\n`,
        `${indent}plugins: [${localName}()],\n`,
        `${indent}// ${CONFIG_PLUGINS_END}\n`,
      ].join(""),
    });
    pluginPatch = "plugins-block";
  } else {
    const array = found.plugins.initializer as ts.ArrayLiteralExpression;
    const indent = array.elements[0]
      ? lineIndent(content, array.elements[0]!.getStart())
      : `${lineIndent(content, found.plugins.getStart())}  `;
    insertions.push({
      position: array.getStart() + 1,
      text: `\n${indent}${localName}(), // ${CONFIG_PLUGIN_MARKER}\n`,
    });
    pluginPatch = "array-item";
  }

  return {
    content: applyInsertions(content, insertions),
    changed: true,
    importOwned,
    pluginPatch,
  };
}

export function createAstroConfigWithTailwind(): string {
  return [
    'import { defineConfig } from "astro/config";',
    `import ariaTailwindcss from "@tailwindcss/vite"; // ${CONFIG_IMPORT_MARKER}`,
    "",
    "export default defineConfig({",
    "  vite: {",
    "    plugins: [ariaTailwindcss()],",
    "  },",
    "});",
    "",
  ].join("\n");
}

function markerBlock(begin: string, end: string): RegExp {
  return new RegExp(
    `\\r?\\n[ \\t]*// ${begin}\\r?\\n[\\s\\S]*?^[ \\t]*// ${end}\\r?\\n`,
    "m",
  );
}

export function assertManagedAstroConfigIntact(
  content: string,
  mode: AstroConfigPatchMode,
  importOwned: boolean,
): void {
  if (importOwned && !content.includes(`// ${CONFIG_IMPORT_MARKER}`)) {
    throw new Error("The Aria-managed Tailwind import changed in the Astro config.");
  }
  if (mode === "array-item" && !content.includes(`// ${CONFIG_PLUGIN_MARKER}`)) {
    throw new Error("The Aria-managed Tailwind plugin entry changed in the Astro config.");
  }
  if (mode === "plugins-block" && !markerBlock(CONFIG_PLUGINS_BEGIN, CONFIG_PLUGINS_END).test(content)) {
    throw new Error("The Aria-managed Vite plugins block changed in the Astro config.");
  }
  if (mode === "vite-block" && !markerBlock(CONFIG_VITE_BEGIN, CONFIG_VITE_END).test(content)) {
    throw new Error("The Aria-managed Vite config block changed in the Astro config.");
  }
}

export function removeManagedAstroConfig(
  content: string,
  mode: AstroConfigPatchMode,
  importOwned: boolean,
): string {
  assertManagedAstroConfigIntact(content, mode, importOwned);
  let next = content;
  if (mode === "vite-block") {
    next = next.replace(markerBlock(CONFIG_VITE_BEGIN, CONFIG_VITE_END), "");
  } else if (mode === "plugins-block") {
    next = next.replace(markerBlock(CONFIG_PLUGINS_BEGIN, CONFIG_PLUGINS_END), "");
  } else if (mode === "array-item") {
    next = next.replace(
      new RegExp(`\\r?\\n[ \\t]*[A-Za-z_$][\\w$]*\\(\\),?[ \\t]*// ${CONFIG_PLUGIN_MARKER}\\r?\\n`, "m"),
      "",
    );
  }
  if (importOwned) {
    next = next.replace(
      new RegExp(`^.*@tailwindcss/vite.*// ${CONFIG_IMPORT_MARKER}\\r?\\n?`, "m"),
      "",
    );
  }
  return next.replace(/\n{3,}/g, "\n\n");
}
