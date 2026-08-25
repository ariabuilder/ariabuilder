import { allocNodeId, locateAtPath } from "./mutate";
import { isComposerRichTextHost } from "./richText";
import type { AstroDocumentModel, EditableNode, MapNode, PropValue } from "./types";
import { detectAstroCollectionsAtPath } from "./collectionBindings";

export type CmsFilterOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "greaterThan"
  | "lessThan"
  | "exists";

export type CmsCollectionFilter = {
  field: string;
  operator: CmsFilterOperator;
  value?: string | number | boolean;
};

export type CmsCollectionQuery = {
  id: string;
  collection: string;
  variable?: string;
  entryVariable?: string;
  entrySlug?: string;
  filters?: CmsCollectionFilter[];
  sort?: { field: string; direction: "asc" | "desc" };
  limit?: number;
  offset?: number;
  status?: string;
  locale?: string;
  archiveFilter?: {
    mode: "relation" | "reference";
    field: string;
    contextVariable: string;
  };
};

export type ComposerCmsSelectionOwnership =
  | "managed"
  | "adoptable"
  | "custom"
  | "none";

export type ComposerCmsSelectionDescriptor = {
  path: string;
  collections: string[];
  collection: string | null;
  contexts: string[];
  contextVariable: string | null;
  field: string | null;
  bindingCount: number;
  ownership: ComposerCmsSelectionOwnership;
  managedQueryId: string | null;
  canBindText: boolean;
  canBindProps: boolean;
  canRepeat: boolean;
  textTargetPath: string | null;
  summary: string;
};

export type CmsBindingFormat =
  | "plain"
  | "date-short"
  | "date-long"
  | "number"
  | "url";

export type CmsContentExposure = "editable" | "locked" | "hidden";

export type DirectCmsTextBinding = {
  path: string;
  collection: string;
  entrySlug: string;
  contextVariable: string;
  field: string;
  relation?: CmsRelationTraversal;
  contentExposure: CmsContentExposure;
};

export type DirectCmsPropBinding = DirectCmsTextBinding & {
  propName: string;
};

export type CmsRelationTraversal = {
  sourceField: string;
  targetCollection: string;
  targetField: string;
  kind: "reference" | "relation";
  index?: number;
  lookupVariable: string;
};

export type CmsBinding = {
  contextVariable: string;
  field: string;
  relation?: CmsRelationTraversal;
  format?: CmsBindingFormat;
  contentExposure?: CmsContentExposure;
  fallback?: PropValue;
};

export type CmsMutationResult = {
  ok: boolean;
  selectPath?: string | null;
  reason?: string;
  queryVariable?: string;
};

const QUERY_START = (id: string) => `/* @aria-cms-query:${id} */`;
const QUERY_END = (id: string) => `/* @aria-cms-query-end:${id} */`;
const LOOKUP_START = (id: string) => `/* @aria-cms-lookup:${id} */`;
const LOOKUP_END = (id: string) => `/* @aria-cms-lookup-end:${id} */`;
const FALLBACK_MARKER = "/* @aria-cms-fallback */";
const FIELD_MARKER = (field: string) => `/* @aria-cms-field:${field.replace(/\*\//g, "")} */`;
const CONTENT_EXPOSURE_PATTERN = /\/\*\s*@aria-content:(editable|locked|hidden)\s*\*\/\s*/g;

function identifier(value: string, fallback = "value"): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_$]+/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const joined = words.map((word, index) =>
    index === 0
      ? word.replace(/^[^a-zA-Z_$]+/, "").replace(/^./, (char) => char.toLowerCase())
      : word.replace(/^./, (char) => char.toUpperCase()),
  ).join("");
  return /^[a-zA-Z_$][\w$]*$/.test(joined) ? joined : fallback;
}

function pascal(value: string): string {
  const id = identifier(value, "Collection");
  return id.replace(/^./, (char) => char.toUpperCase());
}

function js(value: unknown): string {
  return JSON.stringify(value);
}

function fieldAccess(variable: string, field: string): string {
  if (field === "id") return `${variable}?.id`;
  if (field === "slug") return `(${variable}?.data?.slug ?? ${variable}?.id)`;
  if (field === "body") return `${variable}?.body`;
  const segments = field.split(".").filter(Boolean);
  return segments.reduce(
    (expr, segment) => `${expr}?.[${js(segment)}]`,
    `${variable}?.data`,
  );
}

function plainFieldAccess(variable: string, field: string): string {
  return field.split(".").filter(Boolean).reduce(
    (expr, segment) => `${expr}?.[${js(segment)}]`,
    variable,
  );
}

function propFallback(value: PropValue | undefined): string | null {
  if (!value) return null;
  switch (value.type) {
    case "string": return js(value.value);
    case "expr": return `(${value.value})`;
    case "template-literal": return `\`${value.value.replace(/`/g, "\\`")}\``;
    case "bare": return "true";
    case "shorthand": return value.value;
    default: return null;
  }
}

function formatExpression(expression: string, format: CmsBindingFormat = "plain"): string {
  if (format === "date-short") return `new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(${expression}))`;
  if (format === "date-long") return `new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(${expression}))`;
  if (format === "number") return `new Intl.NumberFormat().format(Number(${expression}))`;
  if (format === "url") return `String(${expression})`;
  return expression;
}

export function compileCmsBindingExpression(binding: CmsBinding): string {
  const context = identifier(binding.contextVariable, "entry");
  const directSource = fieldAccess(context, binding.field);
  const relationId = binding.relation
    ? fieldAccess(context, binding.relation.sourceField)
    : "";
  const relatedId = binding.relation?.kind === "relation"
    ? `(Array.isArray(${relationId}) ? ${relationId}[${Math.max(0, Math.floor(binding.relation.index ?? 0))}] : undefined)`
    : relationId;
  const relatedKey = binding.relation
    ? `((${relatedId})?.id ?? (${relatedId})?.slug ?? (${relatedId})?.ariaEntryId ?? ${relatedId})`
    : "";
  const relatedEntry = binding.relation
    ? `${identifier(binding.relation.lookupVariable, "ariaCmsLookup")}.get(String(${relatedKey} ?? ""))`
    : "";
  const source = binding.relation
    ? plainFieldAccess(relatedEntry, binding.relation.targetField)
    : directSource;
  const formatted = formatExpression(source, binding.format);
  const fallback = propFallback(binding.fallback);
  const expression = fallback ? `${formatted} ?? ${FALLBACK_MARKER} ${fallback}` : formatted;
  const marked = binding.relation || binding.field.includes(".")
    ? `${FIELD_MARKER(binding.field)} ${expression}`
    : expression;
  return binding.contentExposure
    ? `/* @aria-content:${binding.contentExposure} */ ${marked}`
    : marked;
}

export function parseCmsContentExposure(expression: string): CmsContentExposure {
  CONTENT_EXPOSURE_PATTERN.lastIndex = 0;
  const value = CONTENT_EXPOSURE_PATTERN.exec(expression)?.[1];
  return value === "locked" || value === "hidden" ? value : "editable";
}

function withCmsContentExposure(
  expression: string,
  exposure: CmsContentExposure,
): string {
  CONTENT_EXPOSURE_PATTERN.lastIndex = 0;
  const source = expression.replace(CONTENT_EXPOSURE_PATTERN, "").trim();
  return exposure === "editable"
    ? source
    : `/* @aria-content:${exposure} */ ${source}`;
}

function ensureGetCollectionImport(frontmatter: string): string {
  const importRe = /import\s*\{([^}]*)\}\s*from\s*["']astro:content["'];?/;
  const match = importRe.exec(frontmatter);
  if (match) {
    const names = match[1]!.split(",").map((name) => name.trim()).filter(Boolean);
    if (names.some((name) => name.split(/\s+as\s+/)[0] === "getCollection")) return frontmatter;
    names.push("getCollection");
    return frontmatter.replace(importRe, `import { ${names.join(", ")} } from "astro:content";`);
  }
  return [`import { getCollection } from "astro:content";`, frontmatter].filter(Boolean).join("\n\n");
}

function filterExpression(variable: string, filter: CmsCollectionFilter): string {
  const field = fieldAccess(variable, filter.field);
  if (filter.operator === "exists") return `${field} != null`;
  if (filter.operator === "contains") return `String(${field} ?? "").includes(${js(filter.value ?? "")})`;
  const operator = filter.operator === "equals" ? "===" : filter.operator === "notEquals" ? "!==" : filter.operator === "greaterThan" ? ">" : "<";
  return `${field} ${operator} ${js(filter.value)}`;
}

function querySource(query: CmsCollectionQuery): { variable: string; entryVariable: string; source: string } {
  const suffix = identifier(query.id, "query").replace(/^./, (char) => char.toUpperCase());
  const variable = identifier(query.variable ?? `ariaCms${pascal(query.collection)}${suffix}`, "ariaCmsEntries");
  const entryVariable = identifier(query.entryVariable ?? "entry", "entry");
  let source = `await getCollection(${js(query.collection)})`;
  if (query.entrySlug) {
    source = `(${source}).find((${entryVariable}) => (${entryVariable}.data.slug ?? ${entryVariable}.id) === ${js(query.entrySlug)})`;
  } else {
    for (const filter of query.filters ?? []) {
      source = `(${source}).filter((${entryVariable}) => ${filterExpression(entryVariable, filter)})`;
    }
    if (query.status) {
      source = `(${source}).filter((${entryVariable}) => ${fieldAccess(entryVariable, "status")} === ${js(query.status)})`;
    }
    if (query.locale) {
      source = `(${source}).filter((${entryVariable}) => ${fieldAccess(entryVariable, "locale")} === ${js(query.locale)})`;
    }
    if (query.archiveFilter) {
      const field = fieldAccess(entryVariable, query.archiveFilter.field);
      const context = identifier(query.archiveFilter.contextVariable, "entry");
      const contextId = `(${context}?.id ?? ${context}?.data?.slug)`;
      source = query.archiveFilter.mode === "relation"
        ? `(${source}).filter((${entryVariable}) => Array.isArray(${field}) && ${field}.some((value) => (value?.id ?? value?.slug ?? value) === ${contextId}))`
        : `(${source}).filter((${entryVariable}) => (${field}?.id ?? ${field}?.slug ?? ${field}) === ${contextId})`;
    }
    if (query.sort) {
      const a = fieldAccess("a", query.sort.field);
      const b = fieldAccess("b", query.sort.field);
      const direction = query.sort.direction === "desc" ? -1 : 1;
      source = `(${source}).sort((a, b) => String(${a} ?? "").localeCompare(String(${b} ?? "")) * ${direction})`;
    }
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    if (query.limit && query.limit > 0) {
      source = `(${source}).slice(${offset}, ${offset + Math.floor(query.limit)})`;
    } else if (offset > 0) {
      source = `(${source}).slice(${offset})`;
    }
  }
  return { variable, entryVariable, source };
}

export function upsertCmsCollectionQuery(
  model: AstroDocumentModel,
  query: CmsCollectionQuery,
): { variable: string; entryVariable: string } {
  const compiled = querySource(query);
  const start = QUERY_START(query.id);
  const end = QUERY_END(query.id);
  const block = `${start}\nconst ${compiled.variable} = ${compiled.source};\n${end}`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  const imported = ensureGetCollectionImport(model.extraFrontmatter);
  model.extraFrontmatter = pattern.test(imported)
    ? imported.replace(pattern, block)
    : `${imported.trim()}${imported.trim() ? "\n\n" : ""}${block}`;
  return { variable: compiled.variable, entryVariable: compiled.entryVariable };
}

function lookupId(collection: string): string {
  return identifier(collection, "collection");
}

function lookupVariableForId(frontmatter: string, id: string): string | null {
  const pattern = new RegExp(`${escapeRegExp(LOOKUP_START(id))}\\s*const\\s+([a-zA-Z_$][\\w$]*)\\s*=`);
  return pattern.exec(frontmatter)?.[1] ?? null;
}

function uniqueLookupVariable(frontmatter: string, collection: string): string {
  const base = identifier(`aria cms ${collection} by id`, "ariaCmsEntriesById");
  if (!new RegExp(`\\b${escapeRegExp(base)}\\b`).test(frontmatter)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}${index}`;
    if (!new RegExp(`\\b${escapeRegExp(candidate)}\\b`).test(frontmatter)) return candidate;
  }
  return `${base}${Date.now().toString(36)}`;
}

/** Add or reuse an Astro lookup for one related collection. */
export function upsertCmsRelationLookup(
  model: AstroDocumentModel,
  collection: string,
): string {
  const id = lookupId(collection);
  const existing = lookupVariableForId(model.extraFrontmatter, id);
  if (existing) return existing;
  const variable = uniqueLookupVariable(model.extraFrontmatter, collection);
  const block = `${LOOKUP_START(id)}\nconst ${variable} = new Map((await getCollection(${js(collection)})).flatMap((entry) => {\n  const value = { ...entry.data, id: entry.id, slug: entry.data.slug ?? entry.id, title: entry.data.title ?? entry.id, body: entry.body, ariaEntryId: entry.data.ariaEntryId };\n  return [entry.id, entry.data.slug, entry.data.ariaEntryId].filter(Boolean).map((key) => [String(key), value]);\n}));\n${LOOKUP_END(id)}`;
  const imported = ensureGetCollectionImport(model.extraFrontmatter);
  model.extraFrontmatter = `${imported.trim()}${imported.trim() ? "\n\n" : ""}${block}`;
  return variable;
}

function removeUnusedGetCollectionImport(frontmatter: string): string {
  const importPattern = /import\s*\{([^}]*)\}\s*from\s*["']astro:content["'];?/;
  const match = importPattern.exec(frontmatter);
  if (!match?.[1]) return frontmatter;
  const names = match[1].split(",").map((name) => name.trim()).filter(Boolean);
  if (!names.includes("getCollection")) return frontmatter;
  const retained = names.filter((name) => name !== "getCollection");
  const replacement = retained.length
    ? `import { ${retained.join(", ")} } from "astro:content";`
    : "";
  const withoutImport = `${frontmatter.slice(0, match.index)}${replacement}${frontmatter.slice(match.index + match[0].length)}`;
  return /\bgetCollection\b/.test(withoutImport) ? frontmatter : withoutImport;
}

/** Remove managed lookups and queries whose variables are no longer used by the document. */
export function pruneUnusedCmsArtifacts(model: AstroDocumentModel): void {
  const serializedNodes = JSON.stringify(model.nodes);
  const lookupPattern = /\/\* @aria-cms-lookup:([^*]+) \*\*?\/[\s\S]*?\/\* @aria-cms-lookup-end:\1 \*\*?\//g;
  model.extraFrontmatter = model.extraFrontmatter.replace(lookupPattern, (block, id: string) => {
    const variable = lookupVariableForId(block, id.trim());
    return variable && serializedNodes.includes(variable) ? block : "";
  });
  const queryIds = [...model.extraFrontmatter.matchAll(/\/\* @aria-cms-query:([^*]+) \*\//g)]
    .map((match) => match[1]?.trim())
    .filter((id): id is string => Boolean(id));
  for (const id of queryIds) removeQueryBlock(model, id);
  model.extraFrontmatter = model.extraFrontmatter.replace(/\n{3,}/g, "\n\n").trim();
  if (!model.extraFrontmatter.includes("@aria-cms-query:") && !model.extraFrontmatter.includes("@aria-cms-lookup:")) {
    model.extraFrontmatter = removeUnusedGetCollectionImport(model.extraFrontmatter).trim();
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function queryVariableForId(frontmatter: string, id: string): string | null {
  const pattern = new RegExp(`${escapeRegExp(QUERY_START(id))}\\s*const\\s+([a-zA-Z_$][\\w$]*)\\s*=`);
  return pattern.exec(frontmatter)?.[1] ?? null;
}

function removeQueryBlock(model: AstroDocumentModel, id: string): void {
  const variable = queryVariableForId(model.extraFrontmatter, id);
  if (variable && JSON.stringify(model.nodes).includes(variable)) return;
  const pattern = new RegExp(`\\s*${escapeRegExp(QUERY_START(id))}[\\s\\S]*?${escapeRegExp(QUERY_END(id))}\\s*`);
  model.extraFrontmatter = model.extraFrontmatter.replace(pattern, "\n\n").trim();
  if (!model.extraFrontmatter.includes("@aria-cms-query:")) {
    model.extraFrontmatter = removeUnusedGetCollectionImport(model.extraFrontmatter)
      .replace(/^\s+|\s+$/g, "");
  }
}

export function bindCmsPropAtPath(
  model: AstroDocumentModel,
  path: string,
  propName: string,
  binding: CmsBinding,
): CmsMutationResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc || !(loc.node.kind === "element" || loc.node.kind === "component" || loc.node.kind === "slot" || loc.node.kind === "raw")) {
    return { ok: false, reason: "Selected node does not expose props." };
  }
  const current = loc.node.props[propName];
  loc.node.props[propName] = {
    type: "expr",
    value: compileCmsBindingExpression({ ...binding, fallback: binding.fallback ?? current }),
  };
  return { ok: true, selectPath: path };
}

export function bindCmsTextAtPath(
  model: AstroDocumentModel,
  path: string,
  binding: CmsBinding,
): CmsMutationResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc || !(loc.node.kind === "text" || loc.node.kind === "expr")) {
    return { ok: false, reason: "Select a text or expression node." };
  }
  const fallback: PropValue = binding.fallback ?? (
    loc.node.kind === "text"
      ? { type: "string", value: loc.node.value }
      : { type: "expr", value: loc.node.value.replace(/^\{|\}$/g, "") }
  );
  loc.list[loc.index] = {
    id: loc.node.id,
    kind: "expr",
    value: `{${compileCmsBindingExpression({ ...binding, fallback })}}`,
  };
  return { ok: true, selectPath: path };
}

function fallbackFromExpression(expression: string): PropValue | undefined {
  const managedMarker = expression.indexOf(FALLBACK_MARKER);
  const legacyMarker = expression.lastIndexOf(" ?? ");
  if (managedMarker < 0 && legacyMarker < 0) return undefined;
  const fallback = expression.slice(
    managedMarker >= 0
      ? managedMarker + FALLBACK_MARKER.length
      : legacyMarker + 4,
  ).trim();
  if (fallback.startsWith("`") && fallback.endsWith("`")) {
    return {
      type: "template-literal",
      value: fallback.slice(1, -1).replace(/\\`/g, "`"),
    };
  }
  try {
    const parsed = JSON.parse(fallback);
    if (typeof parsed === "string") return { type: "string", value: parsed };
    if (typeof parsed === "boolean" && parsed) return { type: "bare" };
    if (typeof parsed === "number") return { type: "expr", value: String(parsed) };
  } catch {
    // Preserve non-literal source as an expression.
  }
  return fallback ? { type: "expr", value: fallback.replace(/^\((.*)\)$/s, "$1") } : undefined;
}

export function unbindCmsPropAtPath(
  model: AstroDocumentModel,
  path: string,
  propName: string,
  queryId?: string,
): CmsMutationResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc || !(loc.node.kind === "element" || loc.node.kind === "component" || loc.node.kind === "slot" || loc.node.kind === "raw")) {
    return { ok: false, reason: "Selected node does not expose props." };
  }
  const current = loc.node.props[propName];
  if (current?.type !== "expr") return { ok: false, reason: "The selected prop is not a CMS expression." };
  const fallback = fallbackFromExpression(current.value);
  if (fallback) loc.node.props[propName] = fallback;
  else delete loc.node.props[propName];
  if (queryId) removeQueryBlock(model, queryId);
  return { ok: true, selectPath: path };
}

export function unbindCmsTextAtPath(
  model: AstroDocumentModel,
  path: string,
  queryId?: string,
): CmsMutationResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc || loc.node.kind !== "expr") return { ok: false, reason: "Select a bound expression node." };
  const fallback = fallbackFromExpression(loc.node.value.replace(/^\{|\}$/g, ""));
  if (!fallback) return { ok: false, reason: "This expression has no restorable fallback." };
  loc.list[loc.index] = fallback.type === "string"
    ? { id: loc.node.id, kind: "text", value: fallback.value }
    : { id: loc.node.id, kind: "expr", value: `{${fallback.type === "expr" ? fallback.value : "true"}}` };
  if (queryId) removeQueryBlock(model, queryId);
  return { ok: true, selectPath: path };
}

export function setCmsContentExposureAtPath(
  model: AstroDocumentModel,
  path: string,
  exposure: CmsContentExposure,
  propName?: string,
): CmsMutationResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc) return { ok: false, reason: "The bound target was not found." };
  if (propName) {
    if (!(loc.node.kind === "element" || loc.node.kind === "component" || loc.node.kind === "slot" || loc.node.kind === "raw")) {
      return { ok: false, reason: "The selected target does not expose props." };
    }
    const value = loc.node.props[propName];
    if (value?.type !== "expr" || !value.value.includes("@aria-cms-fallback")) {
      return { ok: false, reason: "Bind this property to CMS content before changing content-detail access." };
    }
    loc.node.props[propName] = { type: "expr", value: withCmsContentExposure(value.value, exposure) };
    return { ok: true, selectPath: path };
  }
  if (loc.node.kind !== "expr" || !loc.node.value.includes("@aria-cms-fallback")) {
    return { ok: false, reason: "Bind this text to CMS content before changing content-detail access." };
  }
  const inner = loc.node.value.replace(/^\{([\s\S]*)\}$/s, "$1");
  loc.node.value = `{${withCmsContentExposure(inner, exposure)}}`;
  return { ok: true, selectPath: path };
}

export function wrapNodeInCmsLoop(
  model: AstroDocumentModel,
  path: string,
  query: CmsCollectionQuery,
): CmsMutationResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc) return { ok: false, reason: "Selected node was not found." };
  if (loc.node.kind === "doctype") return { ok: false, reason: "Document nodes cannot repeat." };
  const { variable, entryVariable } = upsertCmsCollectionQuery(model, query);
  const map: MapNode = {
    id: allocNodeId(),
    kind: "map",
    head: `${variable}.map((${entryVariable}) => (`,
    children: [loc.node],
  };
  loc.list[loc.index] = map;
  return { ok: true, selectPath: path, queryVariable: variable };
}

export function unwrapCmsLoop(
  model: AstroDocumentModel,
  path: string,
  queryId?: string,
): CmsMutationResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc || loc.node.kind !== "map" || loc.node.children.length !== 1) {
    return { ok: false, reason: "Select a managed single-template collection loop." };
  }
  const projectDataFallback = /\?\?\s*\/\* @aria-cms-fallback \*\/\s*\(([\s\S]+)\)\)\.map(\([\s\S]*)$/.exec(loc.node.head);
  const queryVariable = projectDataFallback
    ? /\b([a-zA-Z_$][\w$]*)\?\.data\b/.exec(loc.node.head)?.[1]
    : /^\s*([a-zA-Z_$][\w$]*)\.map\s*\(/.exec(loc.node.head)?.[1];
  const managedQueryId = queryId ?? (
    queryVariable
      ? new RegExp(`/\\* @aria-cms-query:([^*]+) \\*/\\s*const\\s+${escapeRegExp(queryVariable)}\\s*=`)
          .exec(model.extraFrontmatter)?.[1]
      : undefined
  );
  if (projectDataFallback) {
    loc.node.head = `${projectDataFallback[1]!.trim()}.map${projectDataFallback[2]!}`;
    if (managedQueryId) removeQueryBlock(model, managedQueryId);
    return { ok: true, selectPath: path };
  }
  if (!managedQueryId) {
    return { ok: false, reason: "This is not an Aria-managed collection loop." };
  }
  loc.list[loc.index] = loc.node.children[0]!;
  if (managedQueryId) removeQueryBlock(model, managedQueryId);
  return { ok: true, selectPath: path };
}

export function detectCmsContext(model: AstroDocumentModel, path: string): string[] {
  const loc = locateAtPath(model.nodes, path);
  if (!loc) return [];
  const contexts = new Set<string>();
  const segments = path.split(".");
  for (let index = 1; index <= segments.length; index += 1) {
    const ancestor = locateAtPath(model.nodes, segments.slice(0, index).join("."))?.node;
    if (ancestor?.kind !== "map") continue;
    const match = /\.map\s*\(\s*\(?\s*([a-zA-Z_$][\w$]*)/.exec(ancestor.head);
    if (match?.[1]) contexts.add(match[1]);
  }
  const propsMatch = /const\s*\{([^}]+)\}\s*=\s*Astro\.props/.exec(model.extraFrontmatter);
  propsMatch?.[1]?.split(",").map((part) => identifier(part.split(":")[0]!.trim(), "")).filter(Boolean).forEach((name) => contexts.add(name));
  return [...contexts];
}

function mapReceiver(node: MapNode): string | null {
  return /^\s*([a-zA-Z_$][\w$]*)\.map\s*\(/.exec(node.head)?.[1] ?? null;
}

function managedQueryIdForVariable(frontmatter: string, variable: string): string | null {
  const pattern = new RegExp(`/\\* @aria-cms-query:([^*]+) \\*/\\s*const\\s+${escapeRegExp(variable)}\\s*=`);
  return pattern.exec(frontmatter)?.[1]?.trim() ?? null;
}

function exactCollectionStatement(
  frontmatter: string,
  variable: string,
): { statement: string; collection: string } | null {
  const pattern = new RegExp(
    `(^|\\n)([ \\t]*const\\s+${escapeRegExp(variable)}\\s*=\\s*await\\s+getCollection\\(\\s*(["'])([^"']+)\\3\\s*\\)\\s*;?[ \\t]*)(?=\\n|$)`,
  );
  const match = pattern.exec(frontmatter);
  return match?.[2] && match[4]
    ? { statement: match[2], collection: match[4] }
    : null;
}

function expressionPathForContext(expression: string, context: string): string | null {
  const match = new RegExp(`\\b${escapeRegExp(context)}\\?*\\.data\\b`).exec(expression);
  if (!match) return null;
  let tail = expression.slice(match.index + match[0].length);
  const segments: string[] = [];
  while (tail) {
    const bracket = /^\?*\.\[\s*(["'])([^"']+)\1\s*\]/.exec(tail);
    if (bracket?.[2]) {
      segments.push(bracket[2]);
      tail = tail.slice(bracket[0].length);
      continue;
    }
    const property = /^\?*\.([a-zA-Z_$][\w$]*)/.exec(tail);
    if (property?.[1]) {
      segments.push(property[1]);
      tail = tail.slice(property[0].length);
      continue;
    }
    break;
  }
  return segments.length ? segments.join(".") : null;
}

export function cmsBindingFieldFromExpression(expression: string, contexts: readonly string[] = []): string | null {
  const source = expression.replace(/^\{|\}$/g, "");
  const marked = /\/\*\s*@aria-cms-field:([^*]+?)\s*\*\//.exec(source)?.[1]?.trim();
  if (marked) return marked;
  for (const context of contexts) {
    const field = expressionPathForContext(source, context);
    if (field) return field;
    const escaped = escapeRegExp(context);
    if (new RegExp(`\\b${escaped}\\.(id|slug|body)\\b`).test(source)) {
      return new RegExp(`\\b${escaped}\\.(id|slug|body)\\b`).exec(source)?.[1] ?? null;
    }
  }
  return null;
}

function relationTraversalFromExpression(
  frontmatter: string,
  expression: string,
  contextVariable: string,
  field: string,
): CmsRelationTraversal | undefined {
  const lookupVariable = /\b([a-zA-Z_$][\w$]*)\.get\(\s*String\(/.exec(expression)?.[1];
  if (!lookupVariable) return undefined;
  const lookupPattern = new RegExp(
    `/\\* @aria-cms-lookup:[^*]+ \\*/[\\s\\S]*?const\\s+${escapeRegExp(lookupVariable)}\\s*=[\\s\\S]*?getCollection\\(\\s*(["'])([^"']+)\\1\\s*\\)`,
  );
  const targetCollection = lookupPattern.exec(frontmatter)?.[2];
  const sourceField = expressionPathForContext(expression, contextVariable);
  if (!targetCollection || !sourceField) return undefined;
  const kind = expression.includes("Array.isArray(") ? "relation" : "reference";
  const prefix = kind === "relation" ? `${sourceField}.0.` : `${sourceField}.`;
  const targetField = field.startsWith(prefix) ? field.slice(prefix.length) : "";
  if (!targetField) return undefined;
  return {
    sourceField,
    targetCollection,
    targetField,
    kind,
    ...(kind === "relation" ? { index: 0 } : {}),
    lookupVariable,
  };
}

function directEntrySlug(
  frontmatter: string,
  variable: string,
): { collection: string; entrySlug: string } | null {
  const queryId = managedQueryIdForVariable(frontmatter, variable);
  if (!queryId) return null;
  const blockPattern = new RegExp(
    `${escapeRegExp(QUERY_START(queryId))}\\s*const\\s+${escapeRegExp(variable)}\\s*=([\\s\\S]*?)${escapeRegExp(QUERY_END(queryId))}`,
  );
  const source = blockPattern.exec(frontmatter)?.[1] ?? "";
  const collection = /getCollection\(\s*(["'])([^"']+)\1\s*\)/.exec(source)?.[2];
  const entrySlug = /(?:\.data\??(?:\.slug|\.\[\s*["']slug["']\s*\])|\.slug|\.id)(?:\s*\?\?[^=]+)?\s*===\s*(["'])([^"']+)\1/.exec(source)?.[2];
  return collection && entrySlug ? { collection, entrySlug } : null;
}

const INLINE_TEXT_WRAPPER_TAGS = new Set([
  "abbr", "b", "bdi", "bdo", "cite", "code", "data", "del", "dfn",
  "em", "i", "ins", "kbd", "mark", "q", "ruby", "s", "samp", "small",
  "span", "strong", "sub", "sup", "time", "u", "var",
]);

function meaningfulChild(
  node: EditableNode,
): { node: EditableNode; index: number } | null {
  if (node.kind !== "element" && node.kind !== "component") return null;
  const children = (node.children ?? []).flatMap((child, index) =>
    child.kind === "text" && !child.value.trim() ? [] : [{ node: child, index }],
  );
  return children.length === 1 ? children[0]! : null;
}

function directManagedExpressionIndex(node: EditableNode): number | null {
  if (node.kind !== "element" && node.kind !== "component") return null;
  const indexes = (node.children ?? []).flatMap((child, index) =>
    child.kind === "expr" && child.value.includes("@aria-cms-fallback")
      ? [index]
      : [],
  );
  return indexes.length === 1 ? indexes[0]! : null;
}

/** Resolve one unambiguous text target without crossing a component or block boundary. */
export function resolveComposerTextTargetPath(
  model: AstroDocumentModel,
  selectedPath: string,
): string | null {
  let path = selectedPath;
  let node = locateAtPath(model.nodes, path)?.node ?? null;
  if (!node) return null;
  if (node.kind === "text" || node.kind === "expr") return path;

  const managedIndex = directManagedExpressionIndex(node);
  if (managedIndex != null) return `${path}.${managedIndex}`;

  const direct = meaningfulChild(node);
  if (!direct) return null;
  path = `${path}.${direct.index}`;
  node = direct.node;
  if (node.kind === "text" || node.kind === "expr") return path;

  const selected = locateAtPath(model.nodes, selectedPath)?.node;
  if (!isComposerRichTextHost(selected)) return null;
  while (
    node.kind === "element" &&
    INLINE_TEXT_WRAPPER_TAGS.has(node.name.toLowerCase())
  ) {
    const next = meaningfulChild(node);
    if (!next) return null;
    path = `${path}.${next.index}`;
    node = next.node;
    if (node.kind === "text" || node.kind === "expr") return path;
  }
  return null;
}

/** Resolve a managed single-entry CMS text binding without evaluating project code. */
export function resolveDirectCmsTextBinding(
  model: AstroDocumentModel,
  selectedPath: string,
): DirectCmsTextBinding | null {
  const path = resolveComposerTextTargetPath(model, selectedPath);
  if (!path) return null;
  const node = locateAtPath(model.nodes, path)?.node;
  if (node?.kind !== "expr") return null;
  const expression = node.value.replace(/^\{|\}$/g, "");
  const contextVariable = /\b([a-zA-Z_$][\w$]*)\?*\.data\b/.exec(expression)?.[1];
  const field = contextVariable ? cmsBindingFieldFromExpression(expression, [contextVariable]) : null;
  if (!contextVariable || !field) return null;
  const owner = directEntrySlug(model.extraFrontmatter, contextVariable);
  if (!owner) return null;
  return {
    path,
    collection: owner.collection,
    entrySlug: owner.entrySlug,
    contextVariable,
    field,
    relation: relationTraversalFromExpression(model.extraFrontmatter, expression, contextVariable, field),
    contentExposure: parseCmsContentExposure(node.value),
  };
}

/** Resolve a managed single-entry prop binding without evaluating project code. */
export function resolveDirectCmsPropBinding(
  model: AstroDocumentModel,
  selectedPath: string,
  propName: string,
): DirectCmsPropBinding | null {
  const selected = locateAtPath(model.nodes, selectedPath)?.node;
  if (!selected || !(selected.kind === "element" || selected.kind === "component" || selected.kind === "slot" || selected.kind === "raw")) {
    return null;
  }
  const prop = selected.props[propName];
  if (prop?.type !== "expr") return null;
  const expression = prop.value.replace(/^\{|\}$/g, "");
  const contextVariable = /\b([a-zA-Z_$][\w$]*)\?*\.data\b/.exec(expression)?.[1]
    ?? /\b([a-zA-Z_$][\w$]*)\.get\(/.exec(expression)?.[1];
  const field = cmsBindingFieldFromExpression(expression, contextVariable ? [contextVariable] : []);
  if (!contextVariable || !field) return null;
  const owner = directEntrySlug(model.extraFrontmatter, contextVariable);
  if (!owner) return null;
  return {
    path: selectedPath,
    propName,
    collection: owner.collection,
    entrySlug: owner.entrySlug,
    contextVariable,
    field,
    relation: relationTraversalFromExpression(model.extraFrontmatter, expression, contextVariable, field),
    contentExposure: parseCmsContentExposure(prop.value),
  };
}

function nodeChildren(node: import("./types").EditableNode): import("./types").EditableNode[] {
  if (node.kind === "conditional") return [...node.consequent, ...(node.alternate ?? [])];
  if (
    node.kind === "element" || node.kind === "component" || node.kind === "fragment" ||
    node.kind === "slot" || node.kind === "map"
  ) return node.children ?? [];
  return [];
}

function bindingCount(node: import("./types").EditableNode, contexts: readonly string[]): number {
  let count = 0;
  const expressions: string[] = [];
  if (node.kind === "expr") expressions.push(node.value);
  if (node.kind === "map") expressions.push(node.head);
  if ("props" in node) {
    for (const value of Object.values(node.props)) {
      if (value.type === "expr" || value.type === "shorthand") expressions.push(value.value);
    }
  }
  for (const expression of expressions) {
    if (contexts.some((context) => new RegExp(`\\b${escapeRegExp(context)}\\b`).test(expression))) count += 1;
  }
  for (const child of nodeChildren(node)) count += bindingCount(child, contexts);
  return count;
}

/** Semantic CMS state shared by Inspector, Layers, and the canvas toolbar. */
export function describeComposerCmsSelection(
  model: AstroDocumentModel,
  path: string,
): ComposerCmsSelectionDescriptor {
  const loc = locateAtPath(model.nodes, path);
  const node = loc?.node ?? null;
  const directTextBinding = resolveDirectCmsTextBinding(model, path);
  const contexts = [
    ...new Set([
      ...detectCmsContext(model, path),
      ...(directTextBinding ? [directTextBinding.contextVariable] : []),
    ]),
  ];
  const collections = [
    ...new Set([
      ...detectAstroCollectionsAtPath(model, path),
      ...(directTextBinding ? [directTextBinding.collection] : []),
    ]),
  ];
  let ownership: ComposerCmsSelectionOwnership = collections.length ? "custom" : "none";
  let managedQueryId: string | null = null;
  let collection = directTextBinding?.collection ?? collections[0] ?? null;
  if (directTextBinding) {
    ownership = "managed";
    managedQueryId = managedQueryIdForVariable(
      model.extraFrontmatter,
      directTextBinding.contextVariable,
    );
  }
  if (node?.kind === "map") {
    const receiver = mapReceiver(node);
    if (receiver) {
      managedQueryId = managedQueryIdForVariable(model.extraFrontmatter, receiver);
      if (managedQueryId) ownership = "managed";
      else {
        const statement = exactCollectionStatement(model.extraFrontmatter, receiver);
        if (statement) {
          ownership = "adoptable";
          collection ??= statement.collection;
        }
      }
    }
  }
  const field = directTextBinding?.field ?? (
    node?.kind === "expr"
      ? cmsBindingFieldFromExpression(node.value, contexts)
      : null
  );
  const count = node ? bindingCount(node, contexts) : 0;
  const label = collection
    ? collection.replace(/[-_]+/g, " ").replace(/^./, (value) => value.toUpperCase())
    : null;
  const summary = node?.kind === "map"
    ? label ? `${label} collection loop` : "Custom data loop"
    : field
      ? field.replace(/[-_]+/g, " ").replace(/^./, (value) => value.toUpperCase())
      : label
        ? `${label} content`
        : "Static content";
  return {
    path,
    collections,
    collection,
    contexts,
    contextVariable: contexts.at(-1) ?? null,
    field,
    bindingCount: count,
    ownership,
    managedQueryId,
    canBindText: Boolean(node && resolveComposerTextTargetPath(model, path)),
    canBindProps: Boolean(node && "props" in node),
    canRepeat: Boolean(node && (
      node.kind === "map" ||
      ((node.kind === "element" || node.kind === "component" || node.kind === "fragment" || node.kind === "slot") && node.children !== null)
    )),
    textTargetPath: node ? resolveComposerTextTargetPath(model, path) : null,
    summary,
  };
}

/** Adds managed boundaries only around a losslessly recognized bare getCollection query. */
export function adoptCmsLoop(
  model: AstroDocumentModel,
  path: string,
  requestedId?: string,
): CmsMutationResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc || loc.node.kind !== "map") return { ok: false, reason: "Select a collection loop." };
  const receiver = mapReceiver(loc.node);
  if (!receiver) return { ok: false, reason: "This loop receiver is not a single named collection query." };
  const existing = managedQueryIdForVariable(model.extraFrontmatter, receiver);
  if (existing) return { ok: true, selectPath: path, queryVariable: receiver };
  const exact = exactCollectionStatement(model.extraFrontmatter, receiver);
  if (!exact) {
    return { ok: false, reason: "Only a bare await getCollection() assignment can be adopted without changing custom code." };
  }
  const id = identifier(requestedId ?? `${loc.node.id}-${exact.collection}-adopted`, "ariaCmsAdopted");
  model.extraFrontmatter = model.extraFrontmatter.replace(
    exact.statement,
    `${QUERY_START(id)}\n${exact.statement}\n${QUERY_END(id)}`,
  );
  return { ok: true, selectPath: path, queryVariable: receiver };
}

function suggestedField(
  available: readonly string[],
  candidates: readonly string[],
): string | null {
  const byKey = new Map(available.map((field) => [field.toLowerCase(), field]));
  for (const candidate of candidates) {
    const exact = byKey.get(candidate.toLowerCase());
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const partial = available.find((field) => field.toLowerCase().includes(candidate.toLowerCase()));
    if (partial) return partial;
  }
  return null;
}

/** Apply conservative schema/name-based mappings to a selected card or structure. */
export function mapSuggestedCmsFieldsAtPath(
  model: AstroDocumentModel,
  path: string,
  contextVariable: string,
  availableFields: readonly string[],
): CmsMutationResult & { count: number } {
  const root = locateAtPath(model.nodes, path)?.node;
  if (!root) return { ok: false, reason: "The selected structure was not found.", count: 0 };
  let count = 0;

  const visit = (node: import("./types").EditableNode, nodePath: string, parentTag = "") => {
    if (node.kind === "element" || node.kind === "component") {
      const tag = node.kind === "element" ? node.name.toLowerCase() : "";
      if (tag === "img" || tag === "picture") {
        const src = suggestedField(availableFields, ["image", "cover", "thumbnail", "photo", "src"]);
        const alt = suggestedField(availableFields, ["alt", "title", "name"]);
        if (src && bindCmsPropAtPath(model, nodePath, "src", { contextVariable, field: src }).ok) count += 1;
        if (alt && bindCmsPropAtPath(model, nodePath, "alt", { contextVariable, field: alt }).ok) count += 1;
      }
      if (tag === "a") {
        const href = suggestedField(availableFields, ["url", "href", "link", "slug"]);
        if (href && bindCmsPropAtPath(model, nodePath, "href", { contextVariable, field: href, format: "url" }).ok) count += 1;
      }
      const children = node.children ?? [];
      for (let index = 0; index < children.length; index += 1) {
        visit(children[index]!, `${nodePath}.${index}`, tag);
      }
      return;
    }
    if (node.kind === "fragment" || node.kind === "slot" || node.kind === "map") {
      const children = node.children ?? [];
      for (let index = 0; index < children.length; index += 1) visit(children[index]!, `${nodePath}.${index}`, parentTag);
      return;
    }
    if (node.kind !== "text" && node.kind !== "expr") return;
    const field = /^h[1-6]$/.test(parentTag) || parentTag === "a"
      ? suggestedField(availableFields, ["title", "name", "label"])
      : parentTag === "time"
        ? suggestedField(availableFields, ["publishedAt", "publishedDate", "date", "updatedAt"])
        : suggestedField(availableFields, ["summary", "description", "excerpt", "body", "text"]);
    if (field && bindCmsTextAtPath(model, nodePath, { contextVariable, field }).ok) count += 1;
  };

  visit(root, path);
  return count
    ? { ok: true, selectPath: path, count }
    : { ok: false, selectPath: path, reason: "No compatible fields matched this structure.", count: 0 };
}
