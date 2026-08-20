import { PHRASING_TAGS } from "./elementSchemas";
import { allocNodeId, parentPathOf } from "./mutate";
import { nodeAtMarkerPath } from "./paths";
import { parseStyleAttr } from "./styleAttr";
import type {
  AstroDocumentModel,
  AstroPropMap,
  EditableNode,
  ElementNode,
  PropValue,
} from "./types";

export type ComposerRichTextMode = "inline" | "block";

export type ComposerRichTextJson = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: ComposerRichTextJson[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
};

export type ComposerRichTextDocument = {
  mode: ComposerRichTextMode;
  json: ComposerRichTextJson;
  lockedNodes: Record<string, EditableNode>;
};

const INLINE_HOST_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "button", "label", "summary", "figcaption", "dt", "dd", "li",
  "span", "a",
]);

export const COMPOSER_VISUAL_TAGS = new Set(["img", "picture", "svg"]);

export function isComposerVisualTag(tag: string | null | undefined): boolean {
  return Boolean(tag && COMPOSER_VISUAL_TAGS.has(tag.toLowerCase()));
}

export function isComposerVisualElement(node: EditableNode | null | undefined): boolean {
  return Boolean(node?.kind === "element" && COMPOSER_VISUAL_TAGS.has(node.name.toLowerCase()));
}

const BLOCK_TAGS = new Set(["p", "h2", "h3", "h4", "blockquote", "ul", "ol"]);
const MARK_TAGS: Record<string, string> = {
  strong: "bold",
  b: "bold",
  em: "italic",
  i: "italic",
  u: "underline",
  s: "strike",
  del: "strike",
  code: "code",
};

function stringProp(node: ElementNode, name: string): string | null {
  const value = node.props[name];
  return value?.type === "string" ? value.value : null;
}

function normalizedAriaType(node: EditableNode): string {
  if (node.kind !== "element") return "";
  return (stringProp(node, "data-aria-type") ?? "")
    .replace(/[-_\s]+/g, "")
    .toLowerCase();
}

export function isComposerRichTextBlock(node: ElementNode): boolean;
export function isComposerRichTextBlock(
  node: EditableNode | null | undefined,
): node is ElementNode;
export function isComposerRichTextBlock(node: EditableNode | null | undefined): boolean {
  return Boolean(node?.kind === "element" && normalizedAriaType(node) === "richtext");
}

export function composerRichTextMode(
  node: EditableNode | null | undefined,
): ComposerRichTextMode | null {
  if (!node || node.kind !== "element" || !Array.isArray(node.children)) return null;
  if (isComposerRichTextBlock(node)) return "block";
  const tag = node.name.toLowerCase();
  if (!INLINE_HOST_TAGS.has(tag)) return null;
  // Widget hosts (links, avatars, other spans wrapping visuals or flow) must
  // not swallow those children as one inline editor. That would fold the
  // image from selection and render it as a locked Content token.
  // Text-flow hosts (p, headings, button, …) may still mix phrasing images.
  const swallowsAuthorableChild = node.children.some((child) =>
    !canAppearInsideComposerRichText(child) || isComposerVisualElement(child)
  );
  if (
    swallowsAuthorableChild &&
    (tag === "a" || tag === "span" || normalizedAriaType(node) === "avatar")
  ) {
    return null;
  }
  return "inline";
}

export function isComposerRichTextHost(node: ElementNode): boolean;
export function isComposerRichTextHost(
  node: EditableNode | null | undefined,
): node is ElementNode;
export function isComposerRichTextHost(
  node: EditableNode | null | undefined,
): boolean {
  return composerRichTextMode(node) !== null;
}

function cloneNode<T extends EditableNode>(node: T): T {
  return JSON.parse(JSON.stringify(node)) as T;
}

function nodeLabel(node: EditableNode): string {
  if (node.kind === "expr") return node.value.replace(/\s+/g, " ").trim() || "Expression";
  if (node.kind === "component") return `<${node.name}>`;
  if (node.kind === "element") return `<${node.name}>`;
  if (node.kind === "map") return "Collection";
  if (node.kind === "conditional") return "Conditional";
  if (node.kind === "slot") return "<slot>";
  if (node.kind === "comment") return "Comment";
  return node.kind;
}

function lockedJson(
  node: EditableNode,
  display: "inline" | "block",
  lockedNodes: Record<string, EditableNode>,
): ComposerRichTextJson {
  const token = node.id || allocNodeId();
  lockedNodes[token] = cloneNode(node);
  return {
    type: display === "inline" ? "composerLockedInline" : "composerLockedBlock",
    attrs: {
      token,
      label: nodeLabel(node),
      removable: isComposerVisualElement(node),
    },
  };
}

function propsAreEmpty(props: AstroPropMap): boolean {
  return Object.keys(props).length === 0;
}

function staticLinkAttrs(node: ElementNode): Record<string, unknown> | null {
  if (node.name.toLowerCase() !== "a") return null;
  const allowed = new Set(["href", "target", "rel", "title"]);
  const attrs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node.props)) {
    if (!allowed.has(name) || value.type !== "string") return null;
    attrs[name] = value.value;
  }
  return attrs;
}

function staticTextColor(node: ElementNode): string | null {
  if (node.name.toLowerCase() !== "span") return null;
  const propEntries = Object.entries(node.props);
  if (propEntries.length !== 1 || propEntries[0]?.[0] !== "style") return null;
  const style = propEntries[0][1];
  if (style.type !== "string") return null;
  const declarations = parseStyleAttr(style.value);
  const entries = Object.entries(declarations);
  return entries.length === 1 && entries[0]?.[0] === "color"
    ? entries[0][1] || null
    : null;
}

/** Static `<span>` wrappers stay editable; expression-bound props stay locked. */
function staticSpanAttrs(node: ElementNode): Record<string, string> | null {
  if (node.name.toLowerCase() !== "span") return null;
  const attrs: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.props)) {
    if (value.type !== "string") return null;
    attrs[name] = value.value;
  }
  return attrs;
}

function appendMark(
  nodes: ComposerRichTextJson[],
  mark: { type: string; attrs?: Record<string, unknown> },
): ComposerRichTextJson[] {
  return nodes.map((node) => {
    if (node.type === "text") return { ...node, marks: [...(node.marks ?? []), mark] };
    return node;
  });
}

function containsLocked(nodes: readonly ComposerRichTextJson[]): boolean {
  return nodes.some((node) =>
    node.type === "composerLockedInline" || node.type === "composerLockedBlock",
  );
}

function childSourcePath(parent: string, index: number): string {
  return parent ? `${parent}.${index}` : String(index);
}

function inlineToJson(
  nodes: readonly EditableNode[],
  lockedNodes: Record<string, EditableNode>,
  parentSourcePath: string,
): ComposerRichTextJson[] {
  const result: ComposerRichTextJson[] = [];
  for (const [index, node] of nodes.entries()) {
    const sourcePath = childSourcePath(parentSourcePath, index);
    if (node.kind === "text") {
      if (node.value) result.push({
        type: "text",
        text: node.value,
        marks: [{ type: "composerSourceText", attrs: { sourcePath } }],
      });
      continue;
    }
    if (node.kind !== "element") {
      result.push(lockedJson(node, "inline", lockedNodes));
      continue;
    }
    const tag = node.name.toLowerCase();
    if (tag === "br" && propsAreEmpty(node.props)) {
      result.push({ type: "hardBreak" });
      continue;
    }
    const children = Array.isArray(node.children) ? node.children : [];
    const mark = MARK_TAGS[tag];
    if (mark && propsAreEmpty(node.props)) {
      const converted = inlineToJson(children, lockedNodes, sourcePath);
      if (containsLocked(converted)) result.push(lockedJson(node, "inline", lockedNodes));
      else result.push(...appendMark(converted, {
        type: mark,
        attrs: { sourcePath },
      }));
      continue;
    }
    const textColor = staticTextColor(node);
    if (textColor) {
      const converted = inlineToJson(children, lockedNodes, sourcePath);
      if (containsLocked(converted)) result.push(lockedJson(node, "inline", lockedNodes));
      else result.push(...appendMark(converted, {
        type: "textColor",
        attrs: { color: textColor, sourcePath },
      }));
      continue;
    }
    const linkAttrs = staticLinkAttrs(node);
    if (linkAttrs) {
      const converted = inlineToJson(children, lockedNodes, sourcePath);
      if (containsLocked(converted)) result.push(lockedJson(node, "inline", lockedNodes));
      else {
        result.push(...appendMark(converted, {
          type: "link",
          attrs: { ...linkAttrs, sourcePath },
        }));
      }
      continue;
    }
    const spanAttrs = staticSpanAttrs(node);
    if (spanAttrs) {
      const converted = inlineToJson(children, lockedNodes, sourcePath);
      if (containsLocked(converted) || !converted.some((item) => item.type === "text")) {
        result.push(lockedJson(node, "inline", lockedNodes));
      } else {
        result.push(...appendMark(converted, {
          type: "composerSpan",
          attrs: { htmlAttrs: spanAttrs, sourcePath },
        }));
      }
      continue;
    }
    result.push(lockedJson(node, "inline", lockedNodes));
  }
  return result;
}

function paragraphJson(
  children: readonly EditableNode[],
  lockedNodes: Record<string, EditableNode>,
  sourcePath: string,
): ComposerRichTextJson {
  return { type: "paragraph", content: inlineToJson(children, lockedNodes, sourcePath) };
}

function listItemToJson(
  node: ElementNode,
  lockedNodes: Record<string, EditableNode>,
  sourcePath: string,
): ComposerRichTextJson {
  const children = node.children ?? [];
  const hasBlocks = children.some(
    (child) => child.kind === "element" && BLOCK_TAGS.has(child.name.toLowerCase()),
  );
  return {
    type: "listItem",
    content: hasBlocks
      ? blocksToJson(children, lockedNodes, sourcePath)
      : [paragraphJson(children, lockedNodes, sourcePath)],
  };
}

function blockToJson(
  node: EditableNode,
  lockedNodes: Record<string, EditableNode>,
  sourcePath: string,
): ComposerRichTextJson {
  if (node.kind !== "element") return lockedJson(node, "block", lockedNodes);
  const tag = node.name.toLowerCase();
  if (!BLOCK_TAGS.has(tag) || !propsAreEmpty(node.props)) {
    return lockedJson(node, "block", lockedNodes);
  }
  const children = node.children ?? [];
  if (tag === "p") return paragraphJson(children, lockedNodes, sourcePath);
  if (/^h[2-4]$/.test(tag)) {
    return {
      type: "heading",
      attrs: { level: Number(tag.slice(1)) },
      content: inlineToJson(children, lockedNodes, sourcePath),
    };
  }
  if (tag === "blockquote") {
    const content = blocksToJson(children, lockedNodes, sourcePath);
    return { type: "blockquote", content: content.length ? content : [paragraphJson([], lockedNodes, sourcePath)] };
  }
  if (!children.every(
    (child) => child.kind === "element" &&
      child.name.toLowerCase() === "li" &&
      propsAreEmpty(child.props),
  )) {
    return lockedJson(node, "block", lockedNodes);
  }
  const items = children.map((child, index) => {
    const childPath = childSourcePath(sourcePath, index);
    if (child.kind === "element" && child.name.toLowerCase() === "li" && propsAreEmpty(child.props)) {
      return listItemToJson(child, lockedNodes, childPath);
    }
    return lockedJson(child, "block", lockedNodes);
  });
  return { type: tag === "ul" ? "bulletList" : "orderedList", content: items };
}

function blocksToJson(
  nodes: readonly EditableNode[],
  lockedNodes: Record<string, EditableNode>,
  parentSourcePath: string,
): ComposerRichTextJson[] {
  return nodes.map((node, index) =>
    blockToJson(node, lockedNodes, childSourcePath(parentSourcePath, index))
  );
}

export function composerRichTextToJson(node: ElementNode): ComposerRichTextDocument {
  const mode = composerRichTextMode(node);
  if (!mode) throw new Error("Node is not a Composer rich-text host");
  const lockedNodes: Record<string, EditableNode> = {};
  const children = node.children ?? [];
  return {
    mode,
    lockedNodes,
    json: {
      type: "doc",
      content: mode === "block"
        ? blocksToJson(children, lockedNodes, "")
        : [paragraphJson(children, lockedNodes, "")],
    },
  };
}

function strProp(value: unknown): PropValue | undefined {
  return typeof value === "string" && value ? { type: "string", value } : undefined;
}

function element(name: string, children: EditableNode[] | null, props: AstroPropMap = {}): ElementNode {
  return { id: allocNodeId(), kind: "element", name, props, children };
}

function wrapMarks(text: string, marks: ComposerRichTextJson["marks"]): EditableNode {
  let current: EditableNode = { id: allocNodeId(), kind: "text", value: text };
  for (const mark of [...(marks ?? [])].reverse()) {
    if (mark.type === "composerSpan") {
      const htmlAttrs = mark.attrs?.htmlAttrs;
      const props: AstroPropMap = {};
      if (htmlAttrs && typeof htmlAttrs === "object" && !Array.isArray(htmlAttrs)) {
        for (const [name, value] of Object.entries(htmlAttrs)) {
          if (typeof value === "string" && value) props[name] = { type: "string", value };
        }
      }
      current = element("span", [current], props);
      continue;
    }
    if (mark.type === "textColor") {
      const color = mark.attrs?.color;
      if (typeof color === "string" && color) current = element("span", [current], {
        style: { type: "string", value: `color: ${color}` },
      });
      continue;
    }
    if (mark.type === "link") {
      const attrs = mark.attrs ?? {};
      const props: AstroPropMap = {};
      for (const name of ["href", "target", "rel", "title"] as const) {
        const value = strProp(attrs[name]);
        if (value) props[name] = value;
      }
      current = element("a", [current], props);
      continue;
    }
    const tag = ({
      bold: "strong",
      italic: "em",
      underline: "u",
      strike: "s",
      code: "code",
    } as Record<string, string>)[mark.type];
    if (tag) current = element(tag, [current]);
  }
  return current;
}

function lockedNode(
  json: ComposerRichTextJson,
  lockedNodes: Readonly<Record<string, EditableNode>>,
): EditableNode | null {
  const token = json.attrs?.token;
  return typeof token === "string" && lockedNodes[token]
    ? cloneNode(lockedNodes[token]!)
    : null;
}

function jsonInlineToNodes(
  content: readonly ComposerRichTextJson[] | undefined,
  lockedNodes: Readonly<Record<string, EditableNode>>,
): EditableNode[] {
  const nodes: EditableNode[] = [];
  for (const item of content ?? []) {
    if (item.type === "text" && typeof item.text === "string") {
      nodes.push(wrapMarks(item.text, item.marks));
    } else if (item.type === "hardBreak") {
      nodes.push(element("br", null));
    } else if (item.type === "composerLockedInline") {
      const original = lockedNode(item, lockedNodes);
      if (original) nodes.push(original);
    }
  }
  return nodes;
}

function jsonListItemToNode(
  item: ComposerRichTextJson,
  lockedNodes: Readonly<Record<string, EditableNode>>,
): ElementNode {
  const content = item.content ?? [];
  if (content.length === 1 && content[0]?.type === "paragraph") {
    return element("li", jsonInlineToNodes(content[0].content, lockedNodes));
  }
  return element("li", jsonBlocksToNodes(content, lockedNodes));
}

function jsonBlockToNode(
  item: ComposerRichTextJson,
  lockedNodes: Readonly<Record<string, EditableNode>>,
): EditableNode | null {
  if (item.type === "composerLockedBlock") return lockedNode(item, lockedNodes);
  if (item.type === "paragraph") return element("p", jsonInlineToNodes(item.content, lockedNodes));
  if (item.type === "heading") {
    const level = Number(item.attrs?.level);
    const safeLevel = level >= 2 && level <= 4 ? level : 2;
    return element(`h${safeLevel}`, jsonInlineToNodes(item.content, lockedNodes));
  }
  if (item.type === "blockquote") {
    return element("blockquote", jsonBlocksToNodes(item.content, lockedNodes));
  }
  if (item.type === "bulletList" || item.type === "orderedList") {
    return element(
      item.type === "bulletList" ? "ul" : "ol",
      (item.content ?? []).map((child) =>
        child.type === "listItem"
          ? jsonListItemToNode(child, lockedNodes)
          : element("li", [lockedNode(child, lockedNodes)].filter(Boolean) as EditableNode[]),
      ),
    );
  }
  return null;
}

function jsonBlocksToNodes(
  content: readonly ComposerRichTextJson[] | undefined,
  lockedNodes: Readonly<Record<string, EditableNode>>,
): EditableNode[] {
  return (content ?? [])
    .map((item) => jsonBlockToNode(item, lockedNodes))
    .filter((node): node is EditableNode => node !== null);
}

export function composerRichTextFromJson(
  document: ComposerRichTextDocument,
  json: ComposerRichTextJson,
): EditableNode[] {
  if (document.mode === "block") return jsonBlocksToNodes(json.content, document.lockedNodes);
  const paragraph = json.content?.find((item) => item.type === "paragraph");
  return jsonInlineToNodes(paragraph?.content, document.lockedNodes);
}

function childrenOf(node: EditableNode): EditableNode[] {
  if (node.kind === "conditional") {
    return node.mode === "ternary"
      ? [...node.consequent, ...(node.alternate ?? [])]
      : node.consequent;
  }
  if (
    node.kind === "element" || node.kind === "component" ||
    node.kind === "fragment" || node.kind === "slot" || node.kind === "map"
  ) {
    return node.children ?? [];
  }
  return [];
}

export function composerRichTextPlainText(node: EditableNode): string {
  const parts: string[] = [];
  const visit = (candidate: EditableNode) => {
    if (candidate.kind === "text") parts.push(candidate.value);
    else if (candidate.kind === "expr") parts.push(candidate.value);
    else {
      const blockBoundary = candidate.kind === "element" &&
        ["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li", "ul", "ol"]
          .includes(candidate.name.toLowerCase());
      for (const child of childrenOf(candidate)) visit(child);
      if (blockBoundary) parts.push(" ");
    }
  };
  visit(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

export function composerRichTextOwnerPath(
  model: AstroDocumentModel,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  let candidate: string | null = path;
  let owner: string | null = null;
  while (candidate) {
    const node = nodeAtMarkerPath(model.nodes, candidate);
    if (isComposerRichTextHost(node)) owner = candidate;
    candidate = parentPathOf(candidate);
  }
  return owner ?? path;
}

export function canAppearInsideComposerRichText(node: EditableNode): boolean {
  return node.kind === "text" || node.kind === "expr" || node.kind === "component" ||
    (node.kind === "element" && PHRASING_TAGS.has(node.name.toLowerCase()));
}
