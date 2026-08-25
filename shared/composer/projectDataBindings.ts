import { locateAtPath } from "./mutate";
import type { ProjectDataCatalogField, ProjectDataImportBinding } from "./projectData";
import type { AstroDocumentModel, PropValue } from "./types";

export const PROJECT_DATA_FALLBACK_MARKER = "/* @aria-project-fallback */";
const PROJECT_DATA_FALLBACK_TYPE_MARKER = "@aria-project-fallback-type";

export type ProjectDataMutationResult =
  | { ok: true; selectPath: string }
  | { ok: false; reason: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identifier(value: string): string {
  const words = value
    .replace(/[^A-Za-z0-9_$]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const joined = words.map((word, index) => index === 0
    ? word.replace(/^[^A-Za-z_$]+/, "").replace(/^./, (letter) => letter.toLowerCase())
    : word.replace(/^./, (letter) => letter.toUpperCase())).join("");
  return /^[A-Za-z_$][\w$]*$/.test(joined) ? joined : "ariaProjectData";
}

function usedIdentifiers(model: AstroDocumentModel): Set<string> {
  const source = `${model.extraFrontmatter}\n${JSON.stringify(model.nodes)}`;
  return new Set([...source.matchAll(/\b[A-Za-z_$][\w$]*\b/g)].map((match) => match[0]));
}

function importMarker(binding: ProjectDataImportBinding): string {
  return `project-data-${binding.sourceFile.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${binding.exportName}`;
}

export function ensureProjectDataImport(
  model: AstroDocumentModel,
  binding: ProjectDataImportBinding,
): string {
  const marker = importMarker(binding);
  const markerPattern = new RegExp(`/\\* @aria-project-import:${escapeRegExp(marker)}:([A-Za-z_$][\\w$]*) \\*/`);
  const existing = markerPattern.exec(model.extraFrontmatter);
  if (existing?.[1]) return existing[1];

  const used = usedIdentifiers(model);
  const base = identifier(binding.suggestedLocalName);
  let localName = base;
  let suffix = 2;
  while (used.has(localName)) localName = `${base}${suffix++}`;
  const statement = binding.exportName === "default"
    ? `import ${localName} from ${JSON.stringify(binding.specifier)};`
    : `import { ${binding.exportName}${binding.exportName === localName ? "" : ` as ${localName}`} } from ${JSON.stringify(binding.specifier)};`;
  const block = `/* @aria-project-import:${marker}:${localName} */ ${statement}`;
  model.extraFrontmatter = `${model.extraFrontmatter.trim()}${model.extraFrontmatter.trim() ? "\n" : ""}${block}`;
  return localName;
}

function serializeFallback(value: PropValue | undefined): string {
  if (!value) return "undefined";
  if (value.type === "string") return JSON.stringify(value.value);
  if (value.type === "bare") return "true";
  if (value.type === "template-literal") return `\`${value.value.replace(/`/g, "\\`")}\``;
  if (value.type === "expr") return `(${value.value.replace(/^\{|\}$/g, "")})`;
  if (value.type === "shorthand") return `/* ${PROJECT_DATA_FALLBACK_TYPE_MARKER}:shorthand */ (${value.value})`;
  return "undefined";
}

function boundExpression(expression: string, fallback: PropValue | undefined): string {
  return `${expression} ?? ${PROJECT_DATA_FALLBACK_MARKER} ${serializeFallback(fallback)}`;
}

function expressionForField(model: AstroDocumentModel, field: ProjectDataCatalogField): string {
  if (!field.importBinding) return field.expression;
  const localName = ensureProjectDataImport(model, field.importBinding);
  const tail = field.valuePath.map((segment) => `?.[${JSON.stringify(segment)}]`).join("");
  return `${localName}${tail}`;
}

function authoredMapReceiver(head: string): { value: string; from: number; to: number } | null {
  let from = head.length - head.trimStart().length;
  let value = head.slice(from);
  while (true) {
    const comment = /^\/\/[^\r\n]*(?:\r?\n|$)/.exec(value) ?? /^\/\*[\s\S]*?\*\/\s*/.exec(value);
    if (!comment) {
      const raw = /^(.*?)\.map\s*\(/s.exec(value)?.[1];
      const receiver = raw?.trim();
      if (!raw || !receiver) return null;
      const receiverStart = raw.indexOf(receiver);
      return { value: receiver, from: from + receiverStart, to: from + receiverStart + receiver.length };
    }
    from += comment[0].length;
    value = head.slice(from);
    const whitespace = value.length - value.trimStart().length;
    from += whitespace;
    value = head.slice(from);
  }
}

function fallbackFromExpression(expression: string): PropValue | null {
  const at = expression.indexOf(PROJECT_DATA_FALLBACK_MARKER);
  if (at < 0) return null;
  let fallback = expression.slice(at + PROJECT_DATA_FALLBACK_MARKER.length).trim();
  const typed = new RegExp(`^/\\* ${PROJECT_DATA_FALLBACK_TYPE_MARKER}:([a-z-]+) \\*/\\s*`).exec(fallback);
  if (typed) {
    fallback = fallback.slice(typed[0].length).trim();
    if (typed[1] === "shorthand") {
      const value = fallback.startsWith("(") && fallback.endsWith(")") ? fallback.slice(1, -1).trim() : fallback;
      return /^[A-Za-z_$][\w$]*$/.test(value) ? { type: "shorthand", value } : null;
    }
  }
  try {
    const value = JSON.parse(fallback);
    if (typeof value === "string") return { type: "string", value };
    if (value === true) return { type: "bare" };
    if (typeof value === "number" || typeof value === "boolean") return { type: "expr", value: String(value) };
  } catch {
    // Source expressions remain expressions.
  }
  if (fallback.startsWith("(") && fallback.endsWith(")")) {
    return { type: "expr", value: fallback.slice(1, -1) };
  }
  if (fallback.startsWith("`") && fallback.endsWith("`")) {
    return { type: "template-literal", value: fallback.slice(1, -1).replace(/\\`/g, "`") };
  }
  return fallback === "undefined" ? null : { type: "expr", value: fallback };
}

function pruneProjectDataImports(model: AstroDocumentModel): void {
  const pattern = /\s*\/\* @aria-project-import:([^:]+):([A-Za-z_$][\w$]*) \*\/\s*import[^;]+;?/g;
  const nodes = JSON.stringify(model.nodes);
  model.extraFrontmatter = model.extraFrontmatter.replace(pattern, (full, _marker: string, localName: string) =>
    new RegExp(`\\b${escapeRegExp(localName)}\\b`).test(nodes) ? full : "").trim();
}

export function bindProjectDataTextAtPath(
  model: AstroDocumentModel,
  path: string,
  field: ProjectDataCatalogField,
): ProjectDataMutationResult {
  const location = locateAtPath(model.nodes, path);
  if (!location || (location.node.kind !== "text" && location.node.kind !== "expr")) {
    return { ok: false, reason: "Select a text or expression node." };
  }
  const existingExpression = location.node.kind === "expr" ? location.node.value.replace(/^\{|\}$/g, "") : "";
  const fallback: PropValue = fallbackFromExpression(existingExpression) ?? (location.node.kind === "text"
    ? { type: "string", value: location.node.value }
    : { type: "expr", value: existingExpression });
  location.list[location.index] = {
    id: location.node.id,
    kind: "expr",
    value: `{${boundExpression(expressionForField(model, field), fallback)}}`,
  };
  pruneProjectDataImports(model);
  return { ok: true, selectPath: path };
}

export function bindProjectDataPropAtPath(
  model: AstroDocumentModel,
  path: string,
  propName: string,
  field: ProjectDataCatalogField,
): ProjectDataMutationResult {
  const location = locateAtPath(model.nodes, path);
  if (!location || !("props" in location.node)) {
    return { ok: false, reason: "Selected node does not expose properties." };
  }
  const current = location.node.props[propName];
  if (current?.type === "spread") {
    return { ok: false, reason: "Spread properties cannot be replaced with a project data binding." };
  }
  const fallback = current?.type === "expr" ? fallbackFromExpression(current.value) ?? current : current;
  location.node.props[propName] = {
    type: "expr",
    value: boundExpression(expressionForField(model, field), fallback),
  };
  pruneProjectDataImports(model);
  return { ok: true, selectPath: path };
}

export function bindProjectDataMapAtPath(
  model: AstroDocumentModel,
  path: string,
  field: ProjectDataCatalogField,
): ProjectDataMutationResult {
  const location = locateAtPath(model.nodes, path);
  if (!location || location.node.kind !== "map") return { ok: false, reason: "Select a data loop." };
  const receiver = authoredMapReceiver(location.node.head);
  if (!receiver) return { ok: false, reason: "The loop source could not be identified." };
  const originalReceiver = receiver.value.includes(PROJECT_DATA_FALLBACK_MARKER)
    ? new RegExp(`/\\* @aria-project-fallback \\*/\\s*\\(([\\s\\S]*)\\)\\)$`).exec(receiver.value)?.[1]?.trim() ?? receiver.value
    : receiver.value;
  const next = expressionForField(model, field);
  location.node.head = `${location.node.head.slice(0, receiver.from)}(${next} ?? ${PROJECT_DATA_FALLBACK_MARKER} (${originalReceiver}))${location.node.head.slice(receiver.to)}`;
  pruneProjectDataImports(model);
  return { ok: true, selectPath: path };
}

export function unbindProjectDataTextAtPath(model: AstroDocumentModel, path: string): ProjectDataMutationResult {
  const location = locateAtPath(model.nodes, path);
  if (!location || location.node.kind !== "expr") return { ok: false, reason: "Select a project-data expression." };
  const fallback = fallbackFromExpression(location.node.value.replace(/^\{|\}$/g, ""));
  if (!fallback) return { ok: false, reason: "This binding has no restorable value." };
  location.list[location.index] = fallback.type === "string"
    ? { id: location.node.id, kind: "text", value: fallback.value }
    : fallback.type === "template-literal"
      ? { id: location.node.id, kind: "expr", value: `{\`${fallback.value.replace(/`/g, "\\`")}\`}` }
      : { id: location.node.id, kind: "expr", value: `{${"value" in fallback ? fallback.value : "true"}}` };
  pruneProjectDataImports(model);
  return { ok: true, selectPath: path };
}

export function unbindProjectDataPropAtPath(model: AstroDocumentModel, path: string, propName: string): ProjectDataMutationResult {
  const location = locateAtPath(model.nodes, path);
  if (!location || !("props" in location.node)) return { ok: false, reason: "Selected node does not expose properties." };
  const current = location.node.props[propName];
  if (current?.type !== "expr") return { ok: false, reason: "The property is not bound to project data." };
  const fallback = fallbackFromExpression(current.value);
  if (fallback) location.node.props[propName] = fallback;
  else delete location.node.props[propName];
  pruneProjectDataImports(model);
  return { ok: true, selectPath: path };
}

export function unbindProjectDataMapAtPath(model: AstroDocumentModel, path: string): ProjectDataMutationResult {
  const location = locateAtPath(model.nodes, path);
  if (!location || location.node.kind !== "map") return { ok: false, reason: "Select a data loop." };
  const receiver = authoredMapReceiver(location.node.head);
  if (!receiver?.value.includes(PROJECT_DATA_FALLBACK_MARKER)) return { ok: false, reason: "The loop has no restorable data source." };
  const fallback = new RegExp(`/\\* @aria-project-fallback \\*/\\s*\\(([\\s\\S]*)\\)\\)$`).exec(receiver.value)?.[1]?.trim();
  if (!fallback) return { ok: false, reason: "The original loop source could not be restored." };
  location.node.head = `${location.node.head.slice(0, receiver.from)}${fallback}${location.node.head.slice(receiver.to)}`;
  pruneProjectDataImports(model);
  return { ok: true, selectPath: path };
}
