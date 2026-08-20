import {
  allocNodeId,
  deleteNodeAtPath,
  ensureComponentImport,
  locateAtPath,
  type InsertTarget,
  type MutateResult,
} from "./mutate";
import type {
  AstroDocumentModel,
  AstroPropMap,
  ComponentNode,
  EditableNode,
  FragmentNode,
  PropField,
  SlotNode,
} from "./types";

export const COMPOSER_DEFAULT_SLOT_ID = "default" as const;

export type ComposerLayoutSlotDefinition = {
  id: string;
  /** Null identifies Astro's unnamed/default slot. */
  name: string | null;
  label: string;
  path: string;
  fallbackNodes: EditableNode[];
  hasFallback: boolean;
  transferredTo: string | null;
  static: boolean;
  mutable: boolean;
};

export type ComposerLayoutContract = {
  slots: ComposerLayoutSlotDefinition[];
  defaultSlot: ComposerLayoutSlotDefinition | null;
  namedSlots: ComposerLayoutSlotDefinition[];
  diagnostics: string[];
};

export type ComposerPageSlotGroupKind =
  | "default"
  | "named"
  | "fallback"
  | "unresolved";

export type ComposerPageSlotGroup = {
  id: string;
  name: string | null;
  label: string;
  kind: ComposerPageSlotGroupKind;
  layoutSlotPath: string | null;
  assignmentPaths: string[];
  fragmentPath: string | null;
  insertTarget: InsertTarget;
  fallbackNodes: EditableNode[];
  usingFallback: boolean;
  readOnly: boolean;
};

export type ComposerPageSlotProjection = {
  layoutPath: string;
  layoutName: string;
  groups: ComposerPageSlotGroup[];
};

export type ComposerAssignLayoutOptions = {
  name: string;
  importPath: string;
  props?: AstroPropMap;
  withAriaScaffold?: boolean;
};

const RESERVED_SLOT_NAMES = new Set([COMPOSER_DEFAULT_SLOT_ID, "page-content"]);

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function propString(node: EditableNode, name: string): string | null {
  if (!("props" in node)) return null;
  const value = node.props[name];
  if (value?.type !== "string") return null;
  return value.value.trim() || null;
}

function childEntries(
  node: EditableNode,
  path: string,
): Array<{ node: EditableNode; path: string }> {
  if (node.kind === "conditional") {
    if (node.mode === "ternary") {
      return [
        ...node.consequent.map((child, index) => ({
          node: child,
          path: `${path}.t.${index}`,
        })),
        ...(node.alternate ?? []).map((child, index) => ({
          node: child,
          path: `${path}.f.${index}`,
        })),
      ];
    }
    return node.consequent.map((child, index) => ({
      node: child,
      path: `${path}.${index}`,
    }));
  }
  if (
    node.kind === "element" ||
    node.kind === "component" ||
    node.kind === "fragment" ||
    node.kind === "slot" ||
    node.kind === "map"
  ) {
    return (node.children ?? []).map((child, index) => ({
      node: child,
      path: `${path}.${index}`,
    }));
  }
  return [];
}

export function isValidComposerSlotName(name: string): boolean {
  return (
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) &&
    !RESERVED_SLOT_NAMES.has(name)
  );
}

/** Derive the ordered, static slot contract from real layout source. */
export function buildComposerLayoutContract(
  model: AstroDocumentModel,
): ComposerLayoutContract {
  const slots: ComposerLayoutSlotDefinition[] = [];
  const diagnostics: string[] = [];
  const names = new Set<string>();

  const visitNode = (node: EditableNode, path: string) => {
      if (node.kind === "slot") {
        const rawName = node.props.name;
        const isDefault = rawName == null;
        const name = isDefault ? null : propString(node, "name");
        const staticName = isDefault || Boolean(name);
        const transferredTo = propString(node, "slot");
        if (!staticName) {
          diagnostics.push(`Dynamic slot at ${path} is read-only.`);
        } else if (name && !isValidComposerSlotName(name)) {
          diagnostics.push(`Slot \"${name}\" at ${path} must use kebab-case.`);
        } else if (names.has(name ?? COMPOSER_DEFAULT_SLOT_ID)) {
          diagnostics.push(
            `${name ? `Slot \"${name}\"` : "Page content slot"} is duplicated at ${path}.`,
          );
        } else {
          names.add(name ?? COMPOSER_DEFAULT_SLOT_ID);
        }
        slots.push({
          id: name ?? COMPOSER_DEFAULT_SLOT_ID,
          name,
          label: name ? titleCase(name) : "Page content",
          path,
          fallbackNodes: node.children ?? [],
          hasFallback: Boolean(node.children?.length),
          transferredTo,
          static: staticName,
          mutable: Boolean(name && staticName && isValidComposerSlotName(name)),
        });
      }
      for (const child of childEntries(node, path)) {
        visitNode(child.node, child.path);
      }
  };
  model.nodes.forEach((node, index) => visitNode(node, String(index)));

  return {
    slots,
    defaultSlot:
      slots.find((slot) => slot.name === null && slot.static) ?? null,
    namedSlots: slots.filter((slot) => slot.name !== null && slot.static),
    diagnostics,
  };
}

function layoutInvocation(
  model: AstroDocumentModel,
): { node: ComponentNode; path: string } | null {
  const explicit = model.nodes.findIndex(
    (node) => node.kind === "component" && node.id === "layout",
  );
  if (explicit >= 0) {
    return { node: model.nodes[explicit] as ComponentNode, path: String(explicit) };
  }
  const significant = model.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.kind !== "comment" && node.kind !== "doctype");
  if (significant.length !== 1 || significant[0]!.node.kind !== "component") {
    return null;
  }
  const candidate = significant[0]!;
  const component = candidate.node as ComponentNode;
  const imported = model.imports.find((entry) => entry.name === component.name);
  if (!imported || !/layout/i.test(imported.path)) return null;
  return { node: component, path: String(candidate.index) };
}

function assignmentName(node: EditableNode): string | null {
  return propString(node, "slot");
}

/** Project a layout invocation's immediate children into ordered editor regions. */
export function buildComposerPageSlotGroups(
  model: AstroDocumentModel,
  contract: ComposerLayoutContract,
): ComposerPageSlotProjection | null {
  const invocation = layoutInvocation(model);
  if (!invocation) return null;
  const children = invocation.node.children ?? [];
  const byName = new Map<string, number[]>();
  const defaultIndexes: number[] = [];
  children.forEach((child, index) => {
    const name = assignmentName(child);
    if (name) {
      const indexes = byName.get(name) ?? [];
      indexes.push(index);
      byName.set(name, indexes);
    } else {
      defaultIndexes.push(index);
    }
  });

  const groupFor = (
    definition: ComposerLayoutSlotDefinition,
  ): ComposerPageSlotGroup => {
    const indexes = definition.name
      ? (byName.get(definition.name) ?? [])
      : defaultIndexes;
    const fragmentIndex = indexes.find((index) => {
      const child = children[index];
      return child?.kind === "fragment" && assignmentName(child) === definition.name;
    });
    const fragmentPath =
      fragmentIndex == null ? null : `${invocation.path}.${fragmentIndex}`;
    const assignmentPaths = indexes.map((index) => `${invocation.path}.${index}`);
    const usingFallback = indexes.length === 0 && definition.hasFallback;
    return {
      id: definition.id,
      name: definition.name,
      label: definition.label,
      kind: usingFallback
        ? "fallback"
        : definition.name
          ? "named"
          : "default",
      layoutSlotPath: definition.path,
      assignmentPaths,
      fragmentPath,
      insertTarget: {
        parentPath: fragmentPath ?? invocation.path,
        index:
          fragmentIndex == null
            ? children.length
            : ((children[fragmentIndex] as FragmentNode).children?.length ?? 0),
      },
      fallbackNodes: definition.fallbackNodes,
      usingFallback,
      readOnly: usingFallback,
    };
  };

  const validNames = new Set(contract.namedSlots.map((slot) => slot.name));
  const unresolvedNames = [...byName.keys()].filter((name) => !validNames.has(name));
  const groups = contract.slots.filter((slot) => slot.static).map(groupFor);
  if (unresolvedNames.length) {
    const indexes = unresolvedNames.flatMap((name) => byName.get(name) ?? []);
    groups.push({
      id: "unresolved",
      name: null,
      label: "Unresolved slots",
      kind: "unresolved",
      layoutSlotPath: null,
      assignmentPaths: indexes.map((index) => `${invocation.path}.${index}`),
      fragmentPath: null,
      insertTarget: { parentPath: invocation.path, index: children.length },
      fallbackNodes: [],
      usingFallback: false,
      readOnly: false,
    });
  }
  return {
    layoutPath: invocation.path,
    layoutName: invocation.node.name,
    groups,
  };
}

function normalizeProjectFile(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

function resolveImportFile(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
    return normalizeProjectFile(`src/${specifier.slice(2)}`);
  }
  if (!specifier.startsWith(".")) return null;
  const parts = normalizeProjectFile(fromFile).split("/");
  parts.pop();
  for (const part of specifier.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return normalizeProjectFile(parts.join("/"));
}

function withoutAstroExtension(value: string): string {
  return normalizeProjectFile(value).replace(/\.astro$/i, "");
}

/** True when the page's authoritative layout invocation resolves to this file. */
export function composerPageUsesLayoutFile(
  model: AstroDocumentModel,
  pageFile: string,
  layoutFile: string,
): boolean {
  const invocation = layoutInvocation(model);
  if (!invocation) return false;
  const imported = model.imports.find((entry) => entry.name === invocation.node.name);
  if (!imported) return false;
  const resolved = resolveImportFile(pageFile, imported.path);
  return Boolean(
    resolved && withoutAstroExtension(resolved) === withoutAstroExtension(layoutFile),
  );
}

function slotNode(name: string | null): SlotNode {
  return {
    id: allocNodeId(),
    kind: "slot",
    props: name ? { name: { type: "string", value: name } } : {},
    children: null,
  };
}

export function insertComposerLayoutSlot(
  model: AstroDocumentModel,
  name: string | null,
  target: InsertTarget,
): MutateResult {
  const contract = buildComposerLayoutContract(model);
  if (name == null && contract.defaultSlot) {
    return { ok: false, selectPath: contract.defaultSlot.path, reason: "Page content already exists" };
  }
  if (name != null) {
    if (!isValidComposerSlotName(name)) {
      return { ok: false, selectPath: null, reason: "Slot names must use unique kebab-case" };
    }
    if (contract.namedSlots.some((slot) => slot.name === name)) {
      return { ok: false, selectPath: null, reason: `Slot \"${name}\" already exists` };
    }
  }
  const list = target.parentPath == null
    ? model.nodes
    : (() => {
        const parent = locateAtPath(model.nodes, target.parentPath!);
        if (!parent) return null;
        const node = parent.node;
        if (
          node.kind === "element" ||
          node.kind === "component" ||
          node.kind === "fragment" ||
          node.kind === "slot" ||
          node.kind === "map"
        ) {
          if (node.children == null) node.children = [];
          return node.children;
        }
        return null;
      })();
  if (!list) return { ok: false, selectPath: null, reason: "Invalid slot target" };
  const index = Math.max(0, Math.min(target.index, list.length));
  list.splice(index, 0, slotNode(name));
  const path = target.parentPath == null ? String(index) : `${target.parentPath}.${index}`;
  return { ok: true, selectPath: path };
}

export function renameComposerLayoutSlot(
  model: AstroDocumentModel,
  path: string,
  nextName: string,
): MutateResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc || loc.node.kind !== "slot") {
    return { ok: false, selectPath: path, reason: "Slot not found" };
  }
  if (!propString(loc.node, "name")) {
    return { ok: false, selectPath: path, reason: "Page content cannot be renamed" };
  }
  if (!isValidComposerSlotName(nextName)) {
    return { ok: false, selectPath: path, reason: "Slot names must use kebab-case" };
  }
  const duplicate = buildComposerLayoutContract(model).namedSlots.some(
    (slot) => slot.path !== path && slot.name === nextName,
  );
  if (duplicate) {
    return { ok: false, selectPath: path, reason: `Slot \"${nextName}\" already exists` };
  }
  loc.node.props.name = { type: "string", value: nextName };
  return { ok: true, selectPath: path };
}

export function deleteComposerLayoutSlot(
  model: AstroDocumentModel,
  path: string,
): MutateResult {
  const loc = locateAtPath(model.nodes, path);
  if (!loc || loc.node.kind !== "slot") {
    return { ok: false, selectPath: path, reason: "Slot not found" };
  }
  if (!propString(loc.node, "name")) {
    return { ok: false, selectPath: path, reason: "Page content cannot be deleted" };
  }
  return deleteNodeAtPath(model, path);
}

function stripSlotProp(node: EditableNode): void {
  if ("props" in node) delete node.props.slot;
}

export function renameComposerPageSlotAssignments(
  model: AstroDocumentModel,
  from: string,
  to: string,
): number {
  const invocation = layoutInvocation(model);
  if (!invocation?.node.children) return 0;
  let changed = 0;
  for (const child of invocation.node.children) {
    if (assignmentName(child) !== from || !("props" in child)) continue;
    child.props.slot = { type: "string", value: to };
    changed += 1;
  }
  return changed;
}

/** Remove a named page assignment while preserving its authored content in-place. */
export function unwrapComposerPageSlotAssignments(
  model: AstroDocumentModel,
  name: string,
): number {
  const invocation = layoutInvocation(model);
  if (!invocation?.node.children) return 0;
  const next: EditableNode[] = [];
  let changed = 0;
  for (const child of invocation.node.children) {
    if (assignmentName(child) !== name) {
      next.push(child);
      continue;
    }
    changed += 1;
    if (child.kind === "fragment") {
      next.push(...child.children);
    } else {
      stripSlotProp(child);
      next.push(child);
    }
  }
  invocation.node.children = next;
  return changed;
}

function canonicalFragment(name: string, children: EditableNode[]): FragmentNode {
  return {
    id: allocNodeId(),
    kind: "fragment",
    name: "Fragment",
    props: { slot: { type: "string", value: name } },
    children,
  };
}

/** Normalize one named page region to Astro's zero-DOM Fragment form. */
export function normalizeComposerPageSlotGroup(
  model: AstroDocumentModel,
  name: string,
): MutateResult {
  const invocation = layoutInvocation(model);
  if (!invocation) return { ok: false, selectPath: null, reason: "Layout invocation not found" };
  const children = invocation.node.children ?? (invocation.node.children = []);
  const indexes = children
    .map((child, index) => ({ child, index }))
    .filter(({ child }) => assignmentName(child) === name);
  if (
    indexes.length === 1 &&
    indexes[0]!.child.kind === "fragment" &&
    indexes[0]!.child.name === "Fragment"
  ) {
    return { ok: true, selectPath: `${invocation.path}.${indexes[0]!.index}` };
  }
  const contents: EditableNode[] = [];
  for (const { child } of indexes) {
    if (child.kind === "fragment") contents.push(...child.children);
    else {
      stripSlotProp(child);
      contents.push(child);
    }
  }
  const insertAt = indexes[0]?.index ?? children.length;
  for (const { index } of [...indexes].reverse()) children.splice(index, 1);
  children.splice(insertAt, 0, canonicalFragment(name, contents));
  return { ok: true, selectPath: `${invocation.path}.${insertAt}` };
}

/** Rewrite immediate page assignments when moving content between slot regions. */
export function assignComposerPageNodesToSlot(
  model: AstroDocumentModel,
  paths: readonly string[],
  slotName: string | null,
  targetIndex?: number,
): MutateResult {
  const invocation = layoutInvocation(model);
  if (!invocation) return { ok: false, selectPath: null, reason: "Layout invocation not found" };
  if (slotName && !isValidComposerSlotName(slotName)) {
    return { ok: false, selectPath: null, reason: "Invalid slot name" };
  }
  const unique = [...new Set(paths)].filter(
    (path) =>
      path.startsWith(`${invocation.path}.`) &&
      !paths.some((other) => other !== path && path.startsWith(`${other}.`)),
  );
  if (!unique.length) return { ok: false, selectPath: null, reason: "No page nodes selected" };
  const ordered = unique
    .map((path) => ({ path, loc: locateAtPath(model.nodes, path) }))
    .filter((entry): entry is { path: string; loc: NonNullable<ReturnType<typeof locateAtPath>> } => Boolean(entry.loc))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  if (ordered.length !== unique.length) {
    return { ok: false, selectPath: null, reason: "A selected node no longer exists" };
  }
  const moved = ordered.map((entry) => entry.loc.node);
  const removals = [...ordered].sort((a, b) => b.path.localeCompare(a.path, undefined, { numeric: true }));
  for (const { loc } of removals) loc.list.splice(loc.index, 1);

  const children = invocation.node.children ?? (invocation.node.children = []);
  if (!slotName) {
    const flattened = moved.flatMap((node) => {
      if (node.kind === "fragment" && assignmentName(node)) return node.children;
      stripSlotProp(node);
      return [node];
    });
    const defaultPositions = children
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => assignmentName(node) == null)
      .map(({ index }) => index);
    const requested = Math.max(0, targetIndex ?? defaultPositions.length);
    const start = requested < defaultPositions.length
      ? defaultPositions[requested]!
      : children.length;
    children.splice(start, 0, ...flattened);
    return {
      ok: true,
      selectPath: `${invocation.path}.${start}`,
      selectPaths: flattened.map((_, index) => `${invocation.path}.${start + index}`),
    };
  }

  const existing = children.findIndex(
    (node) => node.kind === "fragment" && assignmentName(node) === slotName,
  );
  let fragment: FragmentNode;
  let fragmentIndex: number;
  if (existing >= 0) {
    fragment = children[existing] as FragmentNode;
    fragmentIndex = existing;
  } else {
    fragment = canonicalFragment(slotName, []);
    fragmentIndex = children.length;
    children.push(fragment);
  }
  const flattened = moved.flatMap((node) => {
    if (node.kind === "fragment" && assignmentName(node)) return node.children;
    stripSlotProp(node);
    return [node];
  });
  const start = Math.max(
    0,
    Math.min(targetIndex ?? fragment.children.length, fragment.children.length),
  );
  fragment.children.splice(start, 0, ...flattened);
  return {
    ok: true,
    selectPath: `${invocation.path}.${fragmentIndex}.${start}`,
    selectPaths: flattened.map(
      (_, index) => `${invocation.path}.${fragmentIndex}.${start + index}`,
    ),
  };
}

function ariaScaffold(): EditableNode {
  return {
    id: allocNodeId(),
    kind: "element",
    name: "section",
    props: { "data-aria-type": { type: "string", value: "Section" } },
    children: [
      {
        id: allocNodeId(),
        kind: "element",
        name: "div",
        props: { "data-aria-type": { type: "string", value: "Container" } },
        children: [],
      },
    ],
  };
}

function pageOwnedContent(model: AstroDocumentModel): EditableNode[] {
  const html = model.nodes.find(
    (node) => node.kind === "element" && node.name.toLowerCase() === "html",
  );
  if (html?.kind === "element") {
    const body = (html.children ?? []).find(
      (node) => node.kind === "element" && node.name.toLowerCase() === "body",
    );
    if (body?.kind === "element") return body.children ?? [];
  }
  return model.nodes.filter((node) => node.kind !== "doctype");
}

export function assignComposerPageLayout(
  model: AstroDocumentModel,
  options: ComposerAssignLayoutOptions,
): MutateResult {
  if (!options.name.trim() || !options.importPath.trim()) {
    return { ok: false, selectPath: null, reason: "Layout import is required" };
  }
  const existing = layoutInvocation(model);
  const content = existing?.node.children ?? pageOwnedContent(model);
  ensureComponentImport(model, options.name.trim(), options.importPath.trim());
  const children = content.length
    ? content
    : options.withAriaScaffold === false
      ? []
      : [ariaScaffold()];
  const wrapper: ComponentNode = {
    id: "layout",
    kind: "component",
    name: options.name.trim(),
    props: options.props ?? {},
    children,
  };
  model.nodes = [wrapper];
  return { ok: true, selectPath: "0" };
}

export function removeComposerPageLayout(
  model: AstroDocumentModel,
): MutateResult {
  const invocation = layoutInvocation(model);
  if (!invocation) return { ok: false, selectPath: null, reason: "Page has no layout" };
  const importName = invocation.node.name;
  model.nodes = invocation.node.children ?? [];
  const stillUsed = (nodes: EditableNode[]): boolean =>
    nodes.some((node) => {
      if (node.kind === "component" && node.name === importName) return true;
      return childEntries(node, "0").some(({ node: child }) => stillUsed([child]));
    });
  if (!stillUsed(model.nodes)) {
    model.imports = model.imports.filter((entry) => entry.name !== importName);
  }
  return { ok: true, selectPath: model.nodes.length ? "0" : null };
}

export function blankLayoutAstroSource(): string {
  return `---
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
  </head>
  <body>
    <slot />
  </body>
</html>
`;
}

function serializeCreationProp(name: string, value: AstroPropMap[string]): string {
  if (value.type === "bare") return name;
  if (value.type === "expr") return `${name}={${value.value}}`;
  if (value.type === "spread") return `{...${value.value}}`;
  if (value.type === "shorthand") return `{${value.value}}`;
  if (value.type === "template-literal") return `${name}={\`${value.value}\`}`;
  return `${name}=${JSON.stringify(value.value)}`;
}

/** Last path segment of a page name, title-cased (`blog/my-post` → `My Post`). */
export function titleFromPageFileName(fileName: string): string {
  const segment =
    fileName.replace(/\.astro$/i, "").split("/").filter(Boolean).pop() ??
    fileName;
  const titled = segment
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return titled || "Page";
}

/** Local calendar date as `YYYY-MM-DD` for date inputs and `new Date(...)`. */
export function todayDateInputValue(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function datePropExpression(isoDate: string): string {
  return `new Date(${JSON.stringify(`${isoDate}T00:00:00`)})`;
}

/**
 * Fill serializable required layout props so a new page can render.
 * CollectionEntry layouts (Astro blog `BlogPost`) declare props only via
 * destructure — without this, `<BlogPost>` ships no `pubDate` and crashes.
 */
export function seedLayoutCreationProps(input: {
  fields: readonly PropField[];
  props?: AstroPropMap;
  pageName: string;
  now?: Date;
}): { props: AstroPropMap; missingRequired: string[] } {
  const props: AstroPropMap = { ...input.props };
  const missingRequired: string[] = [];
  const fallback = titleFromPageFileName(input.pageName);
  const today = todayDateInputValue(input.now);
  for (const field of input.fields) {
    if (field.optional || field.default !== undefined) continue;
    if (props[field.name] != null) continue;
    if (field.type === "enum") {
      const option = field.options?.[0];
      if (!option) {
        missingRequired.push(field.name);
        continue;
      }
      props[field.name] = { type: "string", value: option };
      continue;
    }
    if (field.type === "string") {
      props[field.name] = { type: "string", value: fallback };
      continue;
    }
    if (field.type === "date") {
      props[field.name] = { type: "expr", value: datePropExpression(today) };
      continue;
    }
    if (field.type === "number") {
      props[field.name] = { type: "expr", value: "0" };
      continue;
    }
    if (field.type === "boolean") {
      props[field.name] = { type: "bare" };
      continue;
    }
    missingRequired.push(field.name);
  }
  return { props, missingRequired };
}

export function blankPageWithLayoutAstroSource(input: {
  layoutName: string;
  layoutImport: string;
  props?: AstroPropMap;
  styleImport?: string;
}): string {
  const attrs = Object.entries(input.props ?? {})
    .map(([name, value]) => serializeCreationProp(name, value))
    .join(" ");
  return `---
import ${input.layoutName} from '${input.layoutImport}';
${input.styleImport ?? ""}---

<${input.layoutName}${attrs ? ` ${attrs}` : ""}>
  <section data-aria-type="Section">
    <div data-aria-type="Container"></div>
  </section>
</${input.layoutName}>
`;
}
