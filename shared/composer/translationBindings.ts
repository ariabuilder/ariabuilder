import { locateAtPath } from "./mutate";
import type { AstroDocumentModel, PropValue } from "./types";
import type { ProjectLocaleResolver, ProjectTranslationBinding } from "./projectTranslations";

export const TRANSLATION_FALLBACK_MARKER = "/* @aria-translation-fallback */";

export type TranslationContext = {
  catalogVariable: string;
  contextVariable: string;
  localeExpression: string;
  namespace: string;
  managed: boolean;
};

export type TranslationContextOptions = {
  catalogId: string;
  catalogExportName: string;
  importPath: string;
  namespace: string;
  locales: string[];
  defaultLocale: string;
  resolver: ProjectLocaleResolver;
};

export type TranslationMutationResult = { ok: true; selectPath: string } | { ok: false; reason: string };

function identifier(value: string, fallback = "translations"): string {
  const normalized = value.replace(/[^A-Za-z0-9_$]+(.)?/g, (_match, next: string | undefined) => next?.toUpperCase() ?? "");
  const valid = /^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`;
  return valid || fallback;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function access(receiver: string, keyPath: readonly string[]): string {
  return keyPath.reduce((value, key) => `${value}?.[${JSON.stringify(key)}]`, receiver);
}

function serializeFallback(value: PropValue | undefined): string {
  if (!value) return "undefined";
  if (value.type === "string") return JSON.stringify(value.value);
  if (value.type === "bare") return "true";
  if (value.type === "template-literal") return `\`${value.value.replace(/`/g, "\\`")}\``;
  if (value.type === "expr") return `(${value.value.replace(/^\{|\}$/g, "")})`;
  return "undefined";
}

export function compileTranslationBindingExpression(
  binding: Pick<ProjectTranslationBinding, "contextVariable" | "keyPath"> & { fallback?: PropValue },
): string {
  return `${access(binding.contextVariable, binding.keyPath)} ?? ${TRANSLATION_FALLBACK_MARKER} ${serializeFallback(binding.fallback)}`;
}

export function detectTranslationContexts(frontmatter: string): TranslationContext[] {
  const contexts: TranslationContext[] = [];
  const managedPattern = /\/\* @aria-translation-context:[^:\s]+:([^\s*]+) \*\/([\s\S]*?)\/\* @aria-translation-context-end:[^:]+:\1 \*\//g;
  for (const match of frontmatter.matchAll(managedPattern)) {
    const declaration = /const\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\[([^\]]+)\s+as\s+keyof\s+typeof/.exec(match[2]!);
    if (!declaration) continue;
    contexts.push({
      contextVariable: declaration[1]!,
      catalogVariable: declaration[2]!,
      localeExpression: declaration[3]!.trim(),
      namespace: match[1]!,
      managed: true,
    });
  }
  const aliasPattern = /const\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\[([^\]]+)\](?:\?|)\.([A-Za-z_$][\w$]*)\s*;?/g;
  for (const match of frontmatter.matchAll(aliasPattern)) {
    if (contexts.some((context) => context.contextVariable === match[1])) continue;
    contexts.push({
      contextVariable: match[1]!,
      catalogVariable: match[2]!,
      localeExpression: match[3]!.trim(),
      namespace: match[4]!,
      managed: frontmatter.slice(Math.max(0, (match.index ?? 0) - 240), match.index).includes("@aria-translation-context:"),
    });
  }
  return contexts;
}

function addImport(frontmatter: string, options: TranslationContextOptions, catalogVariable: string): string {
  const escapedPath = escapeRegExp(options.importPath);
  const named = new RegExp(`import\\s*\\{[^}]*\\b${escapeRegExp(options.catalogExportName)}\\b[^}]*\\}\\s*from\\s*["']${escapedPath}["']`);
  const defaultImport = new RegExp(`import\\s+${escapeRegExp(catalogVariable)}\\s+from\\s*["']${escapedPath}["']`);
  if ((options.catalogExportName === "default" ? defaultImport : named).test(frontmatter)) return frontmatter;
  const statement = options.catalogExportName === "default"
    ? `import ${catalogVariable} from ${JSON.stringify(options.importPath)};`
    : `import { ${options.catalogExportName}${catalogVariable === options.catalogExportName ? "" : ` as ${catalogVariable}`} } from ${JSON.stringify(options.importPath)};`;
  return `${frontmatter.trim()}${frontmatter.trim() ? "\n" : ""}/* @aria-translation-import:${options.catalogId} */ ${statement}`;
}

export function ensureTranslationContext(
  model: AstroDocumentModel,
  options: TranslationContextOptions,
): TranslationContext {
  const existing = detectTranslationContexts(model.extraFrontmatter).find((context) => context.namespace === options.namespace);
  if (existing) return existing;
  const catalogVariable = identifier(options.catalogExportName === "default" ? "translations" : options.catalogExportName);
  const contextVariable = identifier(`aria${options.namespace[0]?.toUpperCase() ?? ""}${options.namespace.slice(1)}Translations`);
  const localeVariable = identifier(`${contextVariable}Locale`);
  const rawLocale = options.resolver.kind === "query-param"
    ? `Astro.url.searchParams.get(${JSON.stringify(options.resolver.parameter)})`
    : `Astro.currentLocale ?? Astro.url.pathname.split("/").filter(Boolean)[0]`;
  const block = [
    `/* @aria-translation-context:${options.catalogId}:${options.namespace} */`,
    `const ${localeVariable}Candidate = ${rawLocale};`,
    `const ${localeVariable} = ${JSON.stringify(options.locales)}.includes(${localeVariable}Candidate ?? "") ? ${localeVariable}Candidate : ${JSON.stringify(options.defaultLocale)};`,
    `const ${contextVariable} = ${catalogVariable}[${localeVariable} as keyof typeof ${catalogVariable}]?.[${JSON.stringify(options.namespace)}] ?? ${catalogVariable}[${JSON.stringify(options.defaultLocale)}]?.[${JSON.stringify(options.namespace)}];`,
    `/* @aria-translation-context-end:${options.catalogId}:${options.namespace} */`,
  ].join("\n");
  const imported = addImport(model.extraFrontmatter, options, catalogVariable);
  model.extraFrontmatter = `${imported.trim()}${imported.trim() ? "\n\n" : ""}${block}`;
  return { catalogVariable, contextVariable, localeExpression: localeVariable, namespace: options.namespace, managed: true };
}

export function bindTranslationPropAtPath(
  model: AstroDocumentModel,
  path: string,
  propName: string,
  binding: ProjectTranslationBinding,
): TranslationMutationResult {
  const location = locateAtPath(model.nodes, path);
  if (!location || !(location.node.kind === "element" || location.node.kind === "component" || location.node.kind === "slot" || location.node.kind === "raw")) {
    return { ok: false, reason: "Selected node does not expose properties." };
  }
  const current = location.node.props[propName];
  location.node.props[propName] = { type: "expr", value: compileTranslationBindingExpression({ ...binding, fallback: current }) };
  return { ok: true, selectPath: path };
}

export function bindTranslationTextAtPath(
  model: AstroDocumentModel,
  path: string,
  binding: ProjectTranslationBinding,
): TranslationMutationResult {
  const location = locateAtPath(model.nodes, path);
  if (!location || !(location.node.kind === "text" || location.node.kind === "expr")) {
    return { ok: false, reason: "Select a text or expression node." };
  }
  const fallback: PropValue = location.node.kind === "text"
    ? { type: "string", value: location.node.value }
    : { type: "expr", value: location.node.value.replace(/^\{|\}$/g, "") };
  location.list[location.index] = {
    id: location.node.id,
    kind: "expr",
    value: `{${compileTranslationBindingExpression({ ...binding, fallback })}}`,
  };
  return { ok: true, selectPath: path };
}

function fallbackFromExpression(expression: string): PropValue | null {
  const at = expression.indexOf(TRANSLATION_FALLBACK_MARKER);
  if (at < 0) return null;
  const fallback = expression.slice(at + TRANSLATION_FALLBACK_MARKER.length).trim();
  try {
    const value = JSON.parse(fallback);
    if (typeof value === "string") return { type: "string", value };
    if (value === true) return { type: "bare" };
    if (typeof value === "number" || typeof value === "boolean") return { type: "expr", value: String(value) };
  } catch {
    // Non-JSON fallbacks remain source expressions.
  }
  if (fallback.startsWith("(") && fallback.endsWith(")")) return { type: "expr", value: fallback.slice(1, -1) };
  if (fallback.startsWith("`") && fallback.endsWith("`")) return { type: "template-literal", value: fallback.slice(1, -1).replace(/\\`/g, "`") };
  return fallback === "undefined" ? null : { type: "expr", value: fallback };
}

function removeUnusedManagedContext(model: AstroDocumentModel, contextVariable: string): void {
  if (JSON.stringify(model.nodes).includes(contextVariable)) return;
  const context = detectTranslationContexts(model.extraFrontmatter).find((item) => item.contextVariable === contextVariable && item.managed);
  if (!context) return;
  const marker = `@aria-translation-context:[^:\\s]+:${escapeRegExp(context.namespace)}`;
  model.extraFrontmatter = model.extraFrontmatter
    .replace(new RegExp(`\\s*/\\* ${marker} \\*/[\\s\\S]*?/\\* @aria-translation-context-end:[^:]+:${escapeRegExp(context.namespace)} \\*/\\s*`), "\n")
    .trim();
  if (!model.extraFrontmatter.includes("@aria-translation-context:")) {
    model.extraFrontmatter = model.extraFrontmatter.replace(/\s*\/\* @aria-translation-import:[^ ]+ \*\/\s*import[^;]+;\s*/g, "\n").trim();
  }
}

export function unbindTranslationPropAtPath(model: AstroDocumentModel, path: string, propName: string): TranslationMutationResult {
  const location = locateAtPath(model.nodes, path);
  if (!location || !("props" in location.node)) return { ok: false, reason: "Selected node does not expose properties." };
  const current = location.node.props[propName];
  if (current?.type !== "expr") return { ok: false, reason: "The property is not translation-bound." };
  const fallback = fallbackFromExpression(current.value);
  const contextVariable = /^([A-Za-z_$][\w$]*)/.exec(current.value)?.[1];
  if (fallback) location.node.props[propName] = fallback;
  else delete location.node.props[propName];
  if (contextVariable) removeUnusedManagedContext(model, contextVariable);
  return { ok: true, selectPath: path };
}

export function unbindTranslationTextAtPath(model: AstroDocumentModel, path: string): TranslationMutationResult {
  const location = locateAtPath(model.nodes, path);
  if (!location || location.node.kind !== "expr") return { ok: false, reason: "Select a translation-bound expression." };
  const expression = location.node.value.replace(/^\{|\}$/g, "");
  const fallback = fallbackFromExpression(expression);
  if (!fallback) return { ok: false, reason: "This binding has no restorable fallback." };
  const contextVariable = /^([A-Za-z_$][\w$]*)/.exec(expression)?.[1];
  location.list[location.index] = fallback.type === "string"
    ? { id: location.node.id, kind: "text", value: fallback.value }
    : { id: location.node.id, kind: "expr", value: `{${fallback.type === "expr" ? fallback.value : "true"}}` };
  if (contextVariable) removeUnusedManagedContext(model, contextVariable);
  return { ok: true, selectPath: path };
}
