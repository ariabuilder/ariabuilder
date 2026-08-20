import { splitClassNames } from "./classAttr";
import { canContainTag } from "./elementSchemas";
import {
  applyListPresentation,
  clearListPresentation,
  resolveListMarker,
  syncListMarkerForMode,
} from "./listStyle";
import {
  allocNodeId,
  locateAtPath,
  parentAcceptsChildAtPath,
  parentPathOf,
  type MutateResult,
} from "./mutate";
import { nodeAtMarkerPath } from "./paths";
import type {
  AstroDocumentModel,
  AstroPropMap,
  ComponentNode,
  EditableNode,
  ElementNode,
  PropField,
  PropValue,
} from "./types";
import { clearManagedNativeButtonIconAuthoring } from "./buttonIcon";

export type ElementInspectorSection =
  | "content"
  | "typography"
  | "image"
  | "link"
  | "list"
  | "icon-list"
  | "button"
  | "video"
  | "code"
  | "svg"
  | "icon"
  | "navigation"
  | "nav-item"
  | "variant";

export type ElementInspectorTarget = {
  selectedPath: string;
  selectedNode: EditableNode;
  primaryPath: string;
  primaryNode: EditableNode;
  linkPath: string | null;
  linkNode: ElementNode | null;
  emptyLinkWrapperPath: string | null;
  emptyLinkWrapperNode: ElementNode | null;
  listPath: string | null;
  listNode: ElementNode | null;
  listItemPath: string | null;
  listItemNode: ElementNode | null;
  sections: ElementInspectorSection[];
};

export type ElementLinkValue = {
  href: PropValue;
  target?: PropValue;
  rel?: PropValue;
  title?: PropValue;
  download?: PropValue;
};

export type ElementListMode = "unordered" | "ordered" | "description";

const TEXT_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "label", "a", "button",
]);
const LINKABLE_TAGS = new Set([
  ...TEXT_TAGS,
  "img", "picture", "figure", "div", "section", "article", "aside", "header", "footer", "main",
]);
const INTERACTIVE_TAGS = new Set([
  "a", "button", "details", "dialog", "embed", "iframe", "input", "select", "textarea", "video", "audio",
]);
const LINK_PROP_NAMES = new Set(["href", "target", "rel", "title", "download"]);

function isEmptyLinkWrapper(node: ElementNode): boolean {
  return node.name.toLowerCase() === "a" && Object.keys(node.props).length === 0;
}

function hasNonLinkProps(node: ElementNode): boolean {
  return Object.keys(node.props).some((name) => !LINK_PROP_NAMES.has(name));
}

function propString(node: ElementNode | ComponentNode, name: string): string {
  const prop = node.props[name];
  return prop?.type === "string" ? prop.value : "";
}

function elementAt(model: AstroDocumentModel, path: string | null): ElementNode | null {
  if (!path) return null;
  const node = nodeAtMarkerPath(model.nodes, path);
  return node?.kind === "element" ? node : null;
}

function ancestors(path: string): string[] {
  const result: string[] = [];
  let candidate: string | null = path;
  while (candidate) {
    result.push(candidate);
    candidate = parentPathOf(candidate);
  }
  return result;
}

function nearestElement(
  model: AstroDocumentModel,
  paths: readonly string[],
  predicate: (node: ElementNode) => boolean,
): { path: string; node: ElementNode } | null {
  for (const path of paths) {
    const node = elementAt(model, path);
    if (node && predicate(node)) return { path, node };
  }
  return null;
}

function isIcon(node: ElementNode): boolean {
  return propString(node, "data-aria-type").toLowerCase() === "icon";
}

function isIconList(node: ElementNode): boolean {
  return propString(node, "data-aria-type").toLowerCase() === "iconlist";
}

function hasSingleText(node: ElementNode): boolean {
  return Boolean(
    Array.isArray(node.children)
      && node.children.length === 1
      && node.children[0]?.kind === "text",
  );
}

export type ComposerButtonNode = ElementNode | ComponentNode;

export type ComposerButtonPropNames = {
  variant: string;
  size: string;
  label: string;
  icon: string | null;
  iconPosition: string;
  iconGap: string;
  iconSize: string;
  iconColor: string;
  iconSpaceBetween: string;
  href: string;
  ariaLabel: string;
};

export type ComposerAvatarChildRef = {
  node: ElementNode;
  path: string;
  index: number;
};

export type ComposerAvatarParts = {
  image: ComposerAvatarChildRef | null;
  fallback: ComposerAvatarChildRef | null;
};

function elementClassTokens(node: ElementNode): string[] {
  const value = node.props.class;
  return value?.type === "string" ? splitClassNames(value.value) : [];
}

export function isComposerAvatarNode(
  node: EditableNode | null | undefined,
): node is ElementNode {
  return composerAriaType(node) === "avatar";
}

export function isComposerAlertNode(
  node: EditableNode | null | undefined,
): node is ElementNode {
  return composerAriaType(node) === "alert";
}

export function isComposerBadgeNode(
  node: EditableNode | null | undefined,
): node is ElementNode {
  return composerAriaType(node) === "badge";
}

function composerAriaType(node: EditableNode | null | undefined): string {
  if (!node || node.kind !== "element") return "";
  return propString(node, "data-aria-type")
    .replace(/[-_\s]+/g, "")
    .toLowerCase();
}

function avatarChildRef(
  parentPath: string,
  children: readonly EditableNode[],
  predicate: (child: ElementNode, index: number) => boolean,
): ComposerAvatarChildRef | null {
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child?.kind !== "element" || !predicate(child, index)) continue;
    return {
      node: child,
      index,
      path: parentPath ? `${parentPath}.${index}` : String(index),
    };
  }
  return null;
}

/** Inner image and initials nodes for an Avatar primitive. */
export function resolveComposerAvatarParts(
  node: EditableNode | null | undefined,
  selectedPath: string,
): ComposerAvatarParts | null {
  if (!isComposerAvatarNode(node) || !Array.isArray(node.children)) return null;
  const image = avatarChildRef(
    selectedPath,
    node.children,
    (child) =>
      child.name.toLowerCase() === "img"
      || elementClassTokens(child).includes("aria-avatar__image"),
  );
  const fallback = avatarChildRef(
    selectedPath,
    node.children,
    (child, index) =>
      index !== image?.index
      && (
        elementClassTokens(child).includes("aria-avatar__fallback")
        || child.name.toLowerCase() === "span"
      ),
  );
  return { image, fallback };
}

/**
 * Resolve authorable buttons without depending on the rendered iframe shape.
 * Native buttons and button-styled anchors use HTML attributes; Astro button
 * components keep their component prop contract in the source document.
 */
export function isComposerButtonNode(
  node: EditableNode | null | undefined,
): node is ComposerButtonNode {
  if (!node || (node.kind !== "element" && node.kind !== "component")) return false;
  const ariaType = propString(node, "data-aria-type")
    .replace(/[-_\s]+/g, "")
    .toLowerCase();
  if (ariaType === "button" || node.props["data-button-variant"] != null) return true;
  if (node.kind === "element") return node.name.toLowerCase() === "button";
  const componentName = node.name.split(".").at(-1) ?? node.name;
  return /button$/i.test(componentName);
}

/**
 * Match the Button editor to the selected Astro component's real public prop
 * contract. Existing authored props win, followed by extracted schema fields,
 * so components using `style`/`link` do not accidentally receive
 * `variant`/`href` props from the Inspector.
 */
export function resolveComposerButtonPropNames(
  node: ComposerButtonNode,
  schemaFields: readonly Pick<PropField, "name">[] = [],
): ComposerButtonPropNames {
  if (node.kind === "element") {
    return {
      variant: "data-button-variant",
      size: "data-button-size",
      label: "label",
      icon: null,
      iconPosition: "data-button-icon-position",
      iconGap: "data-button-icon-gap",
      iconSize: "data-button-icon-size",
      iconColor: "data-button-icon-color",
      iconSpaceBetween: "data-button-icon-space-between",
      href: "href",
      ariaLabel: "aria-label",
    };
  }

  const schemaNames = new Set(schemaFields.map((field) => field.name));
  const contractNames = new Set([...schemaNames, ...Object.keys(node.props)]);
  const usesStyleLinkContract = ["style", "link", "modal", "elevated", "classes"]
    .some((name) => contractNames.has(name));
  const resolveName = (candidates: readonly string[], fallback: string): string =>
    candidates.find((name) => node.props[name] != null)
    ?? candidates.find((name) => schemaNames.has(name))
    ?? fallback;

  return {
    variant: resolveName(
      ["data-button-variant", "variant", "style"],
      usesStyleLinkContract ? "style" : "variant",
    ),
    size: resolveName(["size"], "size"),
    label: resolveName(["label"], "label"),
    icon: resolveName(["icon"], "icon"),
    iconPosition: resolveName(["iconPosition"], "iconPosition"),
    iconGap: resolveName(["iconGap"], "iconGap"),
    iconSize: resolveName(["iconSize"], "iconSize"),
    iconColor: resolveName(["iconColor"], "iconColor"),
    iconSpaceBetween: resolveName(["iconSpaceBetween"], "iconSpaceBetween"),
    href: resolveName(["href", "link"], usesStyleLinkContract ? "link" : "href"),
    ariaLabel: resolveName(["ariaLabel", "aria-label"], "ariaLabel"),
  };
}

export function resolveElementInspectorTarget(
  model: AstroDocumentModel,
  selectedPath: string,
): ElementInspectorTarget | null {
  const selectedNode = nodeAtMarkerPath(model.nodes, selectedPath);
  if (!selectedNode) return null;
  const paths = ancestors(selectedPath);
  const selectedElement = selectedNode.kind === "element" ? selectedNode : null;
  const link = nearestElement(model, paths, (node) => node.name.toLowerCase() === "a");
  const emptyLinkWrapper = link && isEmptyLinkWrapper(link.node) ? link : null;
  let list = nearestElement(model, paths, (node) => ["ul", "ol", "dl"].includes(node.name.toLowerCase()));
  const listItem = nearestElement(model, paths, (node) => ["li", "dt", "dd"].includes(node.name.toLowerCase()));
  const sections: ElementInspectorSection[] = [];
  const tag = selectedElement?.name.toLowerCase() ?? "";
  const isButton = isComposerButtonNode(selectedNode);
  if (selectedElement && ["li", "dt", "dd"].includes(tag)) {
    const nestedIndex = (selectedElement.children ?? []).findIndex(
      (child) => child.kind === "element" && ["ul", "ol", "dl"].includes(child.name.toLowerCase()),
    );
    const nested = nestedIndex >= 0 ? selectedElement.children?.[nestedIndex] : null;
    if (nested?.kind === "element") {
      list = { path: `${selectedPath}.${nestedIndex}`, node: nested };
    }
  }

  if (
    selectedElement
    && (hasSingleText(selectedElement) || TEXT_TAGS.has(tag))
    && !isComposerAvatarNode(selectedElement)
  ) {
    sections.push("content");
  }
  if (selectedElement && TEXT_TAGS.has(tag)) sections.push("typography");
  if (tag === "img" || tag === "picture" || isComposerAvatarNode(selectedElement)) {
    sections.push("image");
  }
  if (isComposerAlertNode(selectedElement) || isComposerBadgeNode(selectedElement)) {
    sections.push("variant");
  }
  if (tag === "video") sections.push("video");
  if (isButton) sections.push("button");
  if (tag === "pre" || tag === "code") sections.push("code");
  if (tag === "svg") sections.push(isIcon(selectedElement!) ? "icon" : "svg");
  if (tag === "nav") sections.push("navigation");
  if (listItem) sections.push("nav-item");
  if (!isButton && (link || listItem || (selectedElement && LINKABLE_TAGS.has(tag)))) sections.push("link");
  if (list) sections.push(isIconList(list.node) ? "icon-list" : "list");

  return {
    selectedPath,
    selectedNode,
    primaryPath: selectedPath,
    primaryNode: selectedNode,
    linkPath: link?.path ?? null,
    linkNode: link?.node ?? null,
    emptyLinkWrapperPath: emptyLinkWrapper?.path ?? null,
    emptyLinkWrapperNode: emptyLinkWrapper?.node ?? null,
    listPath: list?.path ?? null,
    listNode: list?.node ?? null,
    listItemPath: listItem?.path ?? null,
    listItemNode: listItem?.node ?? null,
    sections: [...new Set(sections)],
  };
}

function visitElements(node: EditableNode, visitor: (element: ElementNode) => boolean): boolean {
  if (node.kind === "element") {
    if (visitor(node)) return true;
    for (const child of node.children ?? []) if (visitElements(child, visitor)) return true;
  } else if (node.kind === "conditional") {
    for (const child of node.consequent) if (visitElements(child, visitor)) return true;
    for (const child of node.alternate ?? []) if (visitElements(child, visitor)) return true;
  } else if (["component", "fragment", "slot", "map"].includes(node.kind)) {
    const children = "children" in node && Array.isArray(node.children) ? node.children : [];
    for (const child of children) if (visitElements(child, visitor)) return true;
  }
  return false;
}

function setLinkProps(node: ElementNode, value: ElementLinkValue | null) {
  for (const name of ["href", "target", "rel", "title", "download"]) delete node.props[name];
  if (!value) return;
  node.props.href = value.href;
  if (value.target) node.props.target = value.target;
  if (value.rel) node.props.rel = value.rel;
  if (value.title) node.props.title = value.title;
  if (value.download) node.props.download = value.download;
}

/** Wrap `node` without stealing its identity from the live canvas. */
function wrapNodeInLink(node: EditableNode, value: ElementLinkValue): ElementNode {
  const wrapper: ElementNode = {
    id: allocNodeId(),
    kind: "element",
    name: "a",
    props: {},
    children: [node],
  };
  setLinkProps(wrapper, value);
  return wrapper;
}

function isButtonLike(node: ElementNode): boolean {
  return isComposerButtonNode(node);
}

export function setElementLinkAtPath(
  model: AstroDocumentModel,
  selectedPath: string,
  value: ElementLinkValue | null,
  options: { scope?: "row" | "text" } = {},
): MutateResult {
  const context = resolveElementInspectorTarget(model, selectedPath);
  if (!context) {
    return { ok: false, selectPath: selectedPath, reason: "Link target is unavailable" };
  }
  if (context.primaryNode.kind === "element" && isButtonLike(context.primaryNode)) {
    const primary = context.primaryNode;
    primary.name = value ? "a" : "button";
    delete primary.props.type;
    delete primary.props.disabled;
    setLinkProps(primary, value);
    if (!value) primary.props.type = { type: "string", value: "button" };
    return { ok: true, selectPath: selectedPath };
  }
  if (context.linkNode && context.linkPath) {
    if (value) {
      setLinkProps(context.linkNode, value);
      return { ok: true, selectPath: selectedPath };
    }
    if (hasNonLinkProps(context.linkNode)) {
      return {
        ok: false,
        selectPath: selectedPath,
        reason: "A link wrapper with non-link attributes must be edited in code",
      };
    }
    const linkLoc = locateAtPath(model.nodes, context.linkPath);
    if (!linkLoc || !Array.isArray(context.linkNode.children) || context.linkNode.children.length !== 1) {
      return { ok: false, selectPath: selectedPath, reason: "Only a single-child link wrapper can be removed" };
    }
    const child = context.linkNode.children[0]!;
    linkLoc.list.splice(linkLoc.index, 1, child);
    return {
      ok: true,
      selectPath: child.kind === "element"
        ? context.linkPath
        : parentPathOf(context.linkPath),
    };
  }

  if (context.primaryNode.kind !== "element") {
    return { ok: false, selectPath: selectedPath, reason: "Link target is unavailable" };
  }
  const primary = context.primaryNode;

  if (!value) return { ok: true, selectPath: selectedPath };
  const tag = primary.name.toLowerCase();
  if (["li", "dt", "dd"].includes(tag)) {
    if (!Array.isArray(primary.children)) {
      return { ok: false, selectPath: selectedPath, reason: "List item content is unavailable" };
    }
    if (visitElements(primary, (node) => node !== primary && INTERACTIVE_TAGS.has(node.name.toLowerCase()))) {
      return { ok: false, selectPath: selectedPath, reason: "List item already contains interactive content" };
    }
    if (options.scope === "text") {
      const index = primary.children.findIndex((child) => child.kind === "text" || (child.kind === "element" && TEXT_TAGS.has(child.name.toLowerCase())));
      if (index < 0) return { ok: false, selectPath: selectedPath, reason: "No text content is available to link" };
      primary.children.splice(index, 1, wrapNodeInLink(primary.children[index]!, value));
      return { ok: true, selectPath: `${selectedPath}.${index}` };
    }
    const wrapper: ElementNode = { id: allocNodeId(), kind: "element", name: "a", props: {}, children: primary.children };
    setLinkProps(wrapper, value);
    primary.children = [wrapper];
    return { ok: true, selectPath: `${selectedPath}.0` };
  }
  if (!LINKABLE_TAGS.has(tag)) {
    return { ok: false, selectPath: selectedPath, reason: `A <${tag}> cannot be linked from Inspector` };
  }
  if (visitElements(primary, (node) => node !== primary && INTERACTIVE_TAGS.has(node.name.toLowerCase()))) {
    return { ok: false, selectPath: selectedPath, reason: "Link target contains an interactive descendant" };
  }
  const parentPath = parentPathOf(selectedPath);
  if (!parentAcceptsChildAtPath(model, parentPath, "a") || !canContainTag("a", tag)) {
    return { ok: false, selectPath: selectedPath, reason: "Link wrapper is invalid in this location" };
  }
  const loc = locateAtPath(model.nodes, selectedPath);
  if (!loc) return { ok: false, selectPath: selectedPath, reason: "Link target is unavailable" };
  loc.list.splice(loc.index, 1, wrapNodeInLink(primary, value));
  return { ok: true, selectPath: selectedPath };
}

function textNode(value: string): EditableNode {
  return { id: allocNodeId(), kind: "text", value };
}

function element(name: string, children: EditableNode[], props: AstroPropMap = {}): ElementNode {
  return { id: allocNodeId(), kind: "element", name, props, children };
}

function listMode(node: ElementNode): ElementListMode {
  return node.name.toLowerCase() === "ol" ? "ordered" : node.name.toLowerCase() === "dl" ? "description" : "unordered";
}

function isBlockListContent(node: EditableNode): node is ElementNode {
  return node.kind === "element" && !PHRASING_LIST_CONTENT.has(node.name.toLowerCase());
}

const PHRASING_LIST_CONTENT = new Set([
  "a", "abbr", "b", "br", "code", "em", "i", "img", "mark", "small",
  "span", "strong", "sub", "sup", "u",
]);

function ordinaryItemToDescription(node: EditableNode): EditableNode {
  if (node.kind !== "element" || node.name.toLowerCase() !== "li") return node;
  const children = node.children ?? [];
  const blockChildren = children.filter(isBlockListContent);
  if (blockChildren.length < 2 || blockChildren.length !== children.length) {
    node.name = "dt";
    return node;
  }
  node.name = "div";
  blockChildren.forEach((child, index) => {
    child.name = index === 0 ? "dt" : "dd";
  });
  return node;
}

function descriptionChildToOrdinary(node: EditableNode): EditableNode {
  if (node.kind !== "element") return node;
  const tag = node.name.toLowerCase();
  if (tag === "dt" || tag === "dd") {
    node.name = "li";
    return node;
  }
  if (tag !== "div") return node;
  node.name = "li";
  for (const child of node.children ?? []) {
    if (child.kind === "element" && ["dt", "dd"].includes(child.name.toLowerCase())) {
      child.name = "div";
    }
  }
  return node;
}

function descriptionChildrenToOrdinary(children: EditableNode[]): EditableNode[] {
  const next: EditableNode[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child?.kind !== "element" || child.name.toLowerCase() !== "dt") {
      if (child) next.push(descriptionChildToOrdinary(child));
      continue;
    }
    const descriptions: ElementNode[] = [];
    let cursor = index + 1;
    while (cursor < children.length) {
      const candidate = children[cursor];
      if (candidate?.kind !== "element" || candidate.name.toLowerCase() !== "dd") break;
      descriptions.push(candidate);
      cursor += 1;
    }
    if (!descriptions.length) {
      next.push(descriptionChildToOrdinary(child));
      continue;
    }
    child.name = "div";
    for (const description of descriptions) description.name = "div";
    next.push(element("li", [child, ...descriptions]));
    index = cursor - 1;
  }
  return next;
}

export function convertElementListAtPath(
  model: AstroDocumentModel,
  selectedPath: string,
  mode: ElementListMode,
  options?: { syncPresentation?: boolean },
): MutateResult {
  const context = resolveElementInspectorTarget(model, selectedPath);
  const list = context?.listNode;
  const path = context?.listPath;
  if (!list || !path || !Array.isArray(list.children)) {
    return { ok: false, selectPath: selectedPath, reason: "List target is unavailable" };
  }
  const current = listMode(list);
  if (current === mode) return { ok: true, selectPath: path };
  const fromMarker = current === "description"
    ? (mode === "ordered" ? "decimal" : "none")
    : resolveListMarker(list, current);
  const syncPresentation = options?.syncPresentation !== false;
  if (mode !== "description" && current !== "description") {
    list.name = mode === "ordered" ? "ol" : "ul";
    if (syncPresentation) syncListMarkerForMode(list, mode, fromMarker);
    return { ok: true, selectPath: path };
  }
  if (mode === "description") {
    list.name = "dl";
    list.children = list.children.map(ordinaryItemToDescription);
    if (syncPresentation) syncListMarkerForMode(list, mode, fromMarker);
    return { ok: true, selectPath: path };
  }

  list.name = mode === "ordered" ? "ol" : "ul";
  list.children = descriptionChildrenToOrdinary(list.children);
  if (syncPresentation) syncListMarkerForMode(list, mode, fromMarker);
  return { ok: true, selectPath: path };
}

export function applyElementListStyleAtPath(
  model: AstroDocumentModel,
  selectedPath: string,
  next: { type?: string; position?: string },
): MutateResult {
  const context = resolveElementInspectorTarget(model, selectedPath);
  const list = context?.listNode;
  const path = context?.listPath;
  if (!list || !path) {
    return { ok: false, selectPath: selectedPath, reason: "List target is unavailable" };
  }
  if (!applyListPresentation(list, next)) {
    return { ok: false, selectPath: path, reason: "List style is expression-bound" };
  }
  return { ok: true, selectPath: path };
}

export function resetElementListAtPath(
  model: AstroDocumentModel,
  selectedPath: string,
): MutateResult {
  const converted = convertElementListAtPath(model, selectedPath, "unordered");
  if (!converted.ok) return converted;
  const path = converted.selectPath ?? selectedPath;
  const list = elementAt(model, path);
  if (!list) {
    return { ok: false, selectPath: path, reason: "List is unavailable" };
  }
  clearListPresentation(list);
  return { ok: true, selectPath: path };
}

export function addElementListItemAtPath(
  model: AstroDocumentModel,
  selectedPath: string,
): MutateResult {
  const context = resolveElementInspectorTarget(model, selectedPath);
  const list = context?.listNode;
  const path = context?.listPath;
  if (!list || !path || !Array.isArray(list.children)) {
    return { ok: false, selectPath: selectedPath, reason: "List target is unavailable" };
  }
  const ordinal = list.children.length + 1;
  if (listMode(list) === "description") {
    const group = element("div", [
      element("dt", [textNode(`Term ${ordinal}`)]),
      element("dd", [textNode(`Description ${ordinal}`)]),
    ]);
    list.children.push(group);
  } else {
    list.children.push(element("li", [textNode(`Item ${ordinal}`)]));
  }
  return { ok: true, selectPath: `${path}.${list.children.length - 1}` };
}

const BUTTON_OWNED_PROPS = [
  "data-button-variant",
  "disabled",
  "aria-label",
] as const;

export function resetElementButtonAtPath(
  model: AstroDocumentModel,
  selectedPath: string,
): MutateResult {
  const node = elementAt(model, selectedPath);
  if (!node || !Array.isArray(node.children)) {
    return { ok: false, selectPath: selectedPath, reason: "Button is unavailable" };
  }
  for (const name of BUTTON_OWNED_PROPS) delete node.props[name];
  clearManagedNativeButtonIconAuthoring(node);
  return { ok: true, selectPath: selectedPath };
}

export function addNavigationItemAtPath(
  model: AstroDocumentModel,
  selectedPath: string,
): MutateResult {
  const nav = elementAt(model, selectedPath);
  if (!nav || nav.name.toLowerCase() !== "nav" || !Array.isArray(nav.children)) {
    return { ok: false, selectPath: selectedPath, reason: "Navigation is unavailable" };
  }
  const listIndex = nav.children.findIndex(
    (child) => child.kind === "element" && ["ul", "ol"].includes(child.name.toLowerCase()),
  );
  const list = listIndex >= 0 ? nav.children[listIndex] : null;
  if (list?.kind !== "element" || !Array.isArray(list.children)) {
    return { ok: false, selectPath: selectedPath, reason: "Navigation list is unavailable" };
  }
  const index = list.children.length;
  list.children.push(element("li", [
    element("a", [textNode(`Item ${index + 1}`)], {
      href: { type: "string", value: "/" },
    }),
  ]));
  return { ok: true, selectPath: `${selectedPath}.${listIndex}.${index}.0` };
}

export function replaceSvgElementAtPath(
  model: AstroDocumentModel,
  selectedPath: string,
  replacement: ElementNode,
): MutateResult {
  const loc = locateAtPath(model.nodes, selectedPath);
  if (!loc || loc.node.kind !== "element" || loc.node.name.toLowerCase() !== "svg" || replacement.name.toLowerCase() !== "svg") {
    return { ok: false, selectPath: selectedPath, reason: "SVG target is unavailable" };
  }
  replacement.id = loc.node.id;
  loc.list.splice(loc.index, 1, replacement);
  return { ok: true, selectPath: selectedPath };
}
