import { VOID_TAGS } from "./elementSchemas";
import { ARIA_LAYER_LABEL_ATTR } from "./constants";
import type { StructureKind } from "./paths";
import type { AstroCollectionBinding, AstroDocumentModel, EditableNode, ElementNode } from "./types";
import {
  astroCollectionBindingForNode,
  mergeAstroCollectionBindings,
  type AstroCollectionBindingMap,
} from "./collectionBindings";
import {
  buildComposerPageSlotGroups,
  type ComposerLayoutContract,
} from "./layoutAuthoring";
import type { InsertTarget } from "./mutate";
import { parseNodeMotion } from "./motion";
import type { ComposerComponentInstanceSegment } from "./componentAuthoring";
import {
  evaluateConditionSet,
  formatConditionSet,
  type ConditionEvaluationContext,
  type ConditionResult,
} from "../conditions";
import {
  composerRichTextPlainText,
  isComposerRichTextBlock,
  isComposerRichTextHost,
  isComposerVisualElement,
} from "./richText";
import { detectTranslationContexts } from "./translationBindings";

export type ComposerLayerRegion = "content" | "document";

export type ComposerLayerAddress = {
  file: string;
  path: string;
};

export type ComposerLayerInstanceRef = {
  /** Exact page-to-parent invocation chain for the active rendered instance. */
  chain: ComposerComponentInstanceSegment[];
  occurrence: number;
  hostPath: string;
};

export type ComposerLayerSemanticType =
  | "section"
  | "container"
  | "component"
  | "heading"
  | "text"
  | "richtext"
  | "button"
  | "popover"
  | "image"
  | "video"
  | "icon"
  | "list"
  | "listitem"
  | "link"
  | "code"
  | "navigation"
  | "field"
  | "card"
  | "alert"
  | "badge"
  | "avatar"
  | "document"
  | "html"
  | "head"
  | "body"
  | "meta"
  | "slot"
  | "map"
  | "conditional"
  | "fragment"
  | "default";

export type ComposerLayerRow = {
  /** Exact marker path in the real Astro source model. */
  path: string;
  /** Unique visible-tree identity. */
  treeKey: string;
  address?: ComposerLayerAddress;
  instance?: ComposerLayerInstanceRef;
  /** Visible context owned by a file other than the active mutable document. */
  contextOnly?: boolean;
  /** Editor-only grouping row such as invocation Slot content. */
  synthetic?: boolean;
  /** Presentation-only root for the component/layout currently being edited. */
  activeDocumentRoot?: boolean;
  /** Page-level layout selector shown separately from document metadata. */
  pageLayout?: boolean;
  /** Editor-only disclosure group with no corresponding Astro source node. */
  presentationOnly?: boolean;
  /** Source remains selectable but structural mutations are intentionally disabled. */
  sourceLocked?: boolean;
  id: string;
  kind: StructureKind;
  region: ComposerLayerRegion;
  tag?: string;
  semanticType: ComposerLayerSemanticType;
  label: string;
  /** Literal source-oriented label used by tooltips and search. */
  sourceLabel: string;
  /** Full normalized Astro comment text for the Layers hover preview. */
  commentPreview?: string;
  searchText: string;
  children: ComposerLayerRow[];
  isDocumentShell: boolean;
  draggable: boolean;
  deletable: boolean;
  canAcceptChildren: boolean;
  /** Direct Aria Motion configuration authored on this source node. */
  hasMotion?: boolean;
  /** Direct CMS prop/text binding or managed collection loop. */
  hasCmsBinding?: boolean;
  /** Native Astro collection names known for this binding. */
  cmsCollections?: string[];
  /** Whether the CMS source is Aria-managed or preserved custom Astro. */
  cmsOwnership?: "managed" | "custom";
  /** Direct and descendant CMS bindings represented by this row. */
  cmsBindingCount?: number;
  /** Project translation namespace/key represented by this expression row. */
  translationBinding?: { namespace: string; keyPath: string[] };
  /** Non-CMS expression that may resolve to project-owned data. */
  hasDataBinding?: boolean;
  /** Managed condition evaluation in the current authoring context. */
  conditionStatus?: ConditionResult | "custom";
  conditionSummary?: string;
  /** Real source insertion target for editor-only grouping rows. */
  insertTarget?: InsertTarget;
  /** Page slot identity for editor-only slot-group rows. */
  slotName?: string | null;
};

export type ComposerLayerTreeProjection = {
  content: ComposerLayerRow[];
  document: ComposerLayerRow[];
  /** Actual Astro parent receiving root-level Content inserts. */
  contentParentPath: string | null;
};

export type ComposerLayerDropPosition = "before" | "inside" | "after";

export type ComposerLayerDropCandidate = {
  position: ComposerLayerDropPosition;
  targetPath: string | null;
  parentPath: string | null;
  index: number;
  valid: boolean;
  reason?: string;
  slotName?: string | null;
};

export type ComposerLayerDragSession = {
  source: "layers" | "palette" | "components";
  sourcePaths: string[];
  candidate: ComposerLayerDropCandidate | null;
};

const TEXT_PREVIEW_TAGS = new Set([
  "a",
  "button",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "p",
  "span",
  "title",
]);

const SHELL_TAGS = new Set(["html", "head", "body"]);

function childrenOf(node: EditableNode): EditableNode[] {
  if (node.kind === "conditional") {
    return node.mode === "ternary"
      ? [...node.consequent, ...(node.alternate ?? [])]
      : node.consequent;
  }
  if (
    node.kind === "element" ||
    node.kind === "component" ||
    node.kind === "fragment" ||
    node.kind === "slot" ||
    node.kind === "map"
  ) {
    return Array.isArray(node.children) ? node.children : [];
  }
  return [];
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
  return childrenOf(node).map((child, index) => ({
    node: child,
    path: `${path}.${index}`,
  }));
}

function propString(node: EditableNode, key: string): string | null {
  if (!("props" in node)) return null;
  const value = node.props[key];
  if (value?.type !== "string") return null;
  const trimmed = value.value.trim();
  return trimmed || null;
}

function staticText(node: EditableNode): string | null {
  const parts: string[] = [];
  const visit = (candidate: EditableNode): boolean => {
    if (candidate.kind === "text") {
      const value = candidate.value.replace(/\s+/g, " ").trim();
      if (value) parts.push(value);
      return true;
    }
    if (candidate.kind === "comment") return true;
    // Expressions and structural descendants make a parent preview misleading.
    if (
      candidate.kind === "expr" ||
      candidate.kind === "map" ||
      candidate.kind === "conditional" ||
      candidate.kind === "raw"
    ) {
      return false;
    }
    for (const child of childrenOf(candidate)) {
      if (!visit(child)) return false;
    }
    return true;
  };

  if (!visit(node) || parts.length === 0) return null;
  const value = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!value) return null;
  return value.length > 30 ? `${value.slice(0, 29)}…` : value;
}

function semanticTypeFor(node: EditableNode): ComposerLayerSemanticType {
  if (node.kind === "doctype") return "document";
  if (node.kind === "component") return "component";
  if (node.kind === "slot") return "slot";
  if (node.kind === "map") return "map";
  if (node.kind === "conditional") return "conditional";
  if (node.kind === "fragment") return "fragment";
  if (node.kind === "text") return "text";
  if (node.kind === "expr" || node.kind === "comment") return "code";
  if (node.kind !== "element" && node.kind !== "raw") return "default";

  const ariaType = propString(node, "data-aria-type")?.toLowerCase();
  if (ariaType) {
    if (ariaType === "richtext" || ariaType === "rich-text") return "richtext";
    if (ariaType === "iconlist") return "list";
    if (ariaType === "pagination") return "navigation";
    if (ariaType === "field") return "field";
    if (ariaType === "card") return "card";
    if (ariaType === "alert") return "alert";
    if (ariaType === "badge") return "badge";
    if (ariaType === "avatar") return "avatar";
    if (
      [
        "section",
        "container",
        "heading",
        "text",
        "button",
        "image",
        "video",
        "icon",
        "list",
        "link",
        "code",
        "navigation",
      ].includes(ariaType)
    ) {
      return ariaType as ComposerLayerSemanticType;
    }
  }

  const tag = node.name.toLowerCase();
  if (node.kind === "element" && node.props.popover != null) return "popover";
  if (node.kind === "element" && isPopoverGroup(node)) return "popover";
  if (tag === "html" || tag === "head" || tag === "body") return tag;
  if (tag === "meta" || tag === "link") return "meta";
  if (tag === "section" || tag === "main" || tag === "header" || tag === "footer") {
    return tag === "section" ? "section" : "container";
  }
  if (tag === "div" || tag === "aside" || tag === "article") return "container";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "p" || tag === "span" || tag === "strong" || tag === "em") return "text";
  if (tag === "button") return "button";
  if (tag === "img" || tag === "picture") return "image";
  if (tag === "video" || tag === "audio") return "video";
  if (tag === "svg") return "icon";
  if (tag === "ul" || tag === "ol" || tag === "dl") return "list";
  if (tag === "li" || tag === "dt" || tag === "dd") return "listitem";
  if (tag === "a") return "link";
  if (tag === "code" || tag === "pre" || tag === "script" || tag === "style") return "code";
  if (tag === "nav") return "navigation";
  return "default";
}

function isPopoverGroup(node: ElementNode): boolean {
  if (!Array.isArray(node.children)) return false;
  const targets = new Set(node.children
    .filter((child): child is ElementNode => child.kind === "element" && child.props.popover != null)
    .map((child) => propString(child, "id"))
    .filter((id): id is string => Boolean(id)));
  return targets.size > 0 && node.children.some(
    (child) => child.kind === "element"
      && child.name.toLowerCase() === "button"
      && Boolean(propString(child, "popovertarget") && targets.has(propString(child, "popovertarget")!)),
  );
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sourceLabelFor(node: EditableNode): string {
  if (node.kind === "doctype") return "<!doctype>";
  if (node.kind === "text") return "Text";
  if (node.kind === "comment") return "Comment";
  if (node.kind === "expr") return "Expression";
  if (node.kind === "map") return "Map expression";
  if (node.kind === "conditional") return "Conditional expression";
  if (node.kind === "fragment") return node.name ? `<${node.name}>` : "Fragment";
  if (node.kind === "slot") return "<slot>";
  if ("name" in node) return `<${node.name}>`;
  return "Node";
}

function labelForLayer(node: EditableNode, semantic: ComposerLayerSemanticType): string {
  if (node.kind === "doctype") return "Doctype";
  if (node.kind === "component") return titleCase(node.name);
  if (node.kind === "text") {
    const text = node.value.replace(/\s+/g, " ").trim();
    return text.length > 30 ? `${text.slice(0, 29)}…` : text || "Text";
  }
  if (node.kind === "comment") return "Comment";
  if (node.kind === "expr") {
    const value = node.value.replace(/\s+/g, " ").trim();
    return value.length > 30 ? `${value.slice(0, 29)}…` : value || "Expression";
  }
  if (node.kind === "map") {
    if (node.dataBinding) {
      return node.dataBinding.itemCount == null
        ? node.dataBinding.label
        : `${node.dataBinding.label} · ${node.dataBinding.itemCount} items`;
    }
    const receiver = /^\s*([a-zA-Z_$][\w$]*(?:\??\.[a-zA-Z_$][\w$]*)*)\.map\s*\(/.exec(node.head)?.[1];
    if (receiver) return `${titleCase(receiver.split(".").at(-1)!.replace(/\?$/, ""))} data`;
    return "Data loop";
  }
  if (node.kind === "conditional") return "Conditional";
  if (node.kind === "fragment") return "Fragment";
  if (node.kind === "slot") return propString(node, "name") ? titleCase(propString(node, "name")!) : "Page content";
  if (node.kind === "element" && node.props.popover != null) return "Popover content";
  if (node.kind === "element" && isPopoverGroup(node)) return "Popover";
  const ariaType = propString(node, "data-aria-type");
  if (isComposerRichTextBlock(node)) return "Rich Text";
  if (ariaType) return ariaType;
  const tag = node.name.toLowerCase();
  if (tag === "title") return "Page title";
  const preview = TEXT_PREVIEW_TAGS.has(tag) ? staticText(node) : null;
  if (preview) return preview;
  if (tag === "img") return propString(node, "alt") ?? "Image";
  if (tag === "meta") {
    const name = propString(node, "name")?.toLowerCase();
    const property = propString(node, "property")?.toLowerCase();
    if (name === "description") return "Search description";
    if (name === "theme-color") return "Theme color";
    if (name === "viewport") return "Viewport";
    if (name === "generator") return "Generator";
    if (property?.startsWith("og:")) {
      return `Open Graph ${titleCase(property.slice(3))}`;
    }
    if (name?.startsWith("twitter:")) {
      return `Twitter ${titleCase(name.slice(8))}`;
    }
    return propString(node, "name") ?? propString(node, "property") ?? "Meta";
  }
  if (tag === "link") {
    const rel = propString(node, "rel")?.toLowerCase();
    if (rel?.includes("icon")) return "Site icon";
    if (rel === "preconnect") return "Preconnect";
    if (rel === "stylesheet") return "Stylesheet";
    return rel ? titleCase(rel) : "Link";
  }
  const semanticLabels: Partial<Record<ComposerLayerSemanticType, string>> = {
    section: "Section",
    container: tag === "div" ? "Container" : titleCase(tag),
    heading: "Heading",
    text: "Text",
    richtext: "Rich Text",
    button: "Button",
    popover: "Popover content",
    image: "Image",
    video: titleCase(tag),
    icon: tag === "svg" ? "SVG" : "Icon",
    list: "List",
    listitem: "List Item",
    link: "Link",
    code: titleCase(tag),
    navigation: "Navigation",
    field: "Field",
    card: "Card",
    alert: "Alert",
    badge: "Badge",
    avatar: "Avatar",
    html: "HTML",
    head: "Head",
    body: "Body",
    meta: "Meta",
  };
  return semanticLabels[semantic] ?? titleCase(node.name);
}

function customLayerLabel(node: EditableNode): string | null {
  const label = propString(node, ARIA_LAYER_LABEL_ATTR)?.trim();
  return label ? label.slice(0, 100) : null;
}

function shouldFoldTextChildren(node: EditableNode): boolean {
  return isComposerRichTextHost(node);
}

function canNodeAcceptChildren(node: EditableNode): boolean {
  if (node.kind === "component" || node.kind === "fragment" || node.kind === "slot" || node.kind === "map") {
    return true;
  }
  if (node.kind !== "element") return false;
  return !VOID_TAGS.has(node.name.toLowerCase());
}

type BuildRowOptions = {
  omitBodyChildren?: boolean;
  collectionBindings?: AstroCollectionBindingMap;
  conditionContext?: ConditionEvaluationContext;
  managedQueryVariables?: ReadonlySet<string>;
  cmsOwnershipContext?: "managed" | "custom";
  translationContexts?: Record<string, string>;
};

function translationField(
  node: EditableNode,
  contexts: Record<string, string> | undefined,
): { namespace: string; keyPath: string[] } | null {
  if (node.kind !== "expr" || !contexts) return null;
  const expression = node.value.replace(/^\{|\}$/g, "").split("@aria-translation-fallback")[0]!.trim();
  const receiver = /^([A-Za-z_$][\w$]*)/.exec(expression)?.[1];
  const namespace = receiver && contexts[receiver];
  if (!receiver || !namespace) return null;
  const keyPath: string[] = [];
  const accessPattern = /\?\.\[(["'])(.*?)\1\]|\?\.([A-Za-z_$][\w$]*)|\.([A-Za-z_$][\w$]*)/g;
  for (const match of expression.slice(receiver.length).matchAll(accessPattern)) {
    keyPath.push(match[2] ?? match[3] ?? match[4]!);
  }
  return keyPath.length ? { namespace, keyPath } : null;
}

function conditionBranchRow(
  node: Extract<EditableNode, { kind: "conditional" }>,
  path: string,
  branch: "shown" | "otherwise",
  region: ComposerLayerRegion,
  options: BuildRowOptions,
): ComposerLayerRow {
  const shown = branch === "shown";
  const list = shown ? node.consequent : (node.alternate ?? []);
  const parentPath = node.mode === "ternary"
    ? `${path}.${shown ? "t" : "f"}`
    : path;
  const children = list
    .map((child, index) => buildRow(child, `${parentPath}.${index}`, region, options))
    .filter((row): row is ComposerLayerRow => row !== null);
  const label = shown ? "Shown content" : "Otherwise content";
  const treeKey = `condition-branch:${path}:${branch}`;
  return {
    path: parentPath,
    treeKey,
    id: treeKey,
    kind: "fragment",
    region,
    semanticType: "fragment",
    label,
    sourceLabel: shown ? "Condition matches" : "Condition does not match",
    searchText: `${label} condition branch ${path}`.toLowerCase(),
    children,
    isDocumentShell: false,
    draggable: false,
    deletable: false,
    canAcceptChildren: true,
    synthetic: true,
    presentationOnly: true,
    insertTarget: { parentPath, index: list.length },
  };
}

function propsForIndicators(node: EditableNode) {
  return node.kind === "element" ||
    node.kind === "component" ||
    node.kind === "slot" ||
    node.kind === "raw"
    ? node.props
    : null;
}

function directCmsBinding(
  node: EditableNode,
  bindings: AstroCollectionBindingMap,
): AstroCollectionBinding | null {
  const native = astroCollectionBindingForNode(node, bindings);
  const hasFallback = node.kind === "expr" && node.value.includes("@aria-cms-fallback") ||
    Boolean(propsForIndicators(node) && Object.values(propsForIndicators(node)!).some(
      (prop) => prop.type === "expr" && prop.value.includes("@aria-cms-fallback"),
    )) ||
    Boolean(node.kind === "element" && Array.isArray(node.children) && node.children.some(
      (child) => child.kind === "expr" && child.value.includes("@aria-cms-fallback"),
    ));
  return mergeAstroCollectionBindings([
    native,
    hasFallback ? { collections: [], cardinality: "unknown", dynamic: true } : null,
  ]);
}

function cmsQueryBindings(frontmatter: string): Record<string, AstroCollectionBinding> {
  const bindings: Record<string, AstroCollectionBinding> = {};
  const pattern = /\/\* @aria-cms-query:[^*]+ \*\/\s*const\s+([a-zA-Z_$][\w$]*)\s*=([^;\n]+)/g;
  for (const match of frontmatter.matchAll(pattern)) {
    if (!match[1]) continue;
    const collection = /getCollection\(\s*["']([^"']+)["']\s*\)/.exec(match[2] ?? "")?.[1];
    bindings[match[1]] = {
      collections: collection ? [collection] : [],
      cardinality: "unknown",
      dynamic: !collection || undefined,
    };
  }
  return bindings;
}

function managedCmsQueryVariables(frontmatter: string): Set<string> {
  return new Set(Object.keys(cmsQueryBindings(frontmatter)));
}

function cmsFieldLabel(node: EditableNode): string | null {
  if (node.kind !== "expr") return null;
  const source = node.value.replace(/\?/g, "");
  const match = /\.data(?:\[(["'])([^"']+)\1\]|\.([a-zA-Z_$][\w$]*))/.exec(source);
  const field = match?.[2] ?? match?.[3];
  return field ? titleCase(field) : null;
}

function cmsSemanticLabel(
  node: EditableNode,
  binding: AstroCollectionBinding | null,
): string | null {
  if (!binding || node.kind === "element") return null;
  const collection = binding.collections[0]
    ? titleCase(binding.collections[0])
    : null;
  if (node.kind === "map") return collection ? `${collection} collection loop` : "CMS collection loop";
  return cmsFieldLabel(node) ?? (collection ? `${collection} content` : null);
}

function buildRow(
  node: EditableNode,
  path: string,
  region: ComposerLayerRegion,
  options: BuildRowOptions = {},
): ComposerLayerRow | null {
  if (node.kind === "text" && !node.value.trim()) return null;
  const tag = "name" in node ? node.name.toLowerCase() : undefined;
  const semanticType = semanticTypeFor(node);
  const isDocumentShell =
    region === "document" &&
    (node.kind === "doctype" || Boolean(tag && SHELL_TAGS.has(tag)));
  const sourceLabel = sourceLabelFor(node);
  const bindings = options.collectionBindings ?? {};
  const cmsBinding = directCmsBinding(node, bindings);
  const richTextPreview = isComposerRichTextHost(node) && !(cmsBinding && node.kind === "element")
    ? composerRichTextPlainText(node)
    : "";
  const baseLabel = isComposerRichTextBlock(node)
    ? "Rich Text"
    : richTextPreview
      ? richTextPreview.length > 30 ? `${richTextPreview.slice(0, 29)}…` : richTextPreview
      : labelForLayer(node, semanticType);
  const commentPreview = node.kind === "comment"
    ? node.value.replace(/\r\n?/g, "\n").trim()
    : undefined;
  const foldRichTextChildren = shouldFoldTextChildren(node);
  const omitAllChildren = options?.omitBodyChildren === true && tag === "body";
  const translationBinding = translationField(node, options.translationContexts);
  const label = customLayerLabel(node) ?? (
    translationBinding
      ? `${translationBinding.namespace}.${translationBinding.keyPath.join(".")}`
      : cmsSemanticLabel(node, cmsBinding) ?? baseLabel
  );
  const callbackVariable = node.kind === "map"
    ? /\.map\s*\(\s*(?:async\s*)?\(?\s*([a-zA-Z_$][\w$]*)/.exec(node.head)?.[1]
    : null;
  const receiverVariable = node.kind === "map"
    ? /^\s*([a-zA-Z_$][\w$]*)\.map\s*\(/.exec(node.head)?.[1] ?? null
    : null;
  const cmsOwnership = cmsBinding
    ? receiverVariable && options.managedQueryVariables?.has(receiverVariable)
      ? "managed" as const
      : options.cmsOwnershipContext ?? "custom" as const
    : undefined;
  const childOptions = cmsBinding && callbackVariable
    ? {
        ...options,
        collectionBindings: {
          ...bindings,
          [callbackVariable]: { ...cmsBinding, cardinality: "one" as const },
        },
        cmsOwnershipContext: cmsOwnership,
      }
    : options;
  const children = omitAllChildren
    ? []
    : node.kind === "conditional"
      ? [
          conditionBranchRow(node, path, "shown", region, childOptions),
          ...(node.mode === "ternary" ? [conditionBranchRow(node, path, "otherwise", region, childOptions)] : []),
        ]
      : childEntries(node, path)
        .filter(({ node: child }) => !foldRichTextChildren || isComposerVisualElement(child))
        .map(({ node: child, path: childPath }) =>
          buildRow(child, childPath, region, childOptions),
        )
        .filter((row): row is ComposerLayerRow => row !== null);
  const descendantCmsBindings = children.reduce(
    (total, child) => total + (child.cmsBindingCount ?? 0),
    0,
  );
  const cmsBindingCount = (cmsBinding ? 1 : 0) + descendantCmsBindings;

  return {
    path,
    treeKey: path,
    id: node.id,
    kind: node.kind,
    region,
    tag,
    semanticType,
    label,
    sourceLabel,
    commentPreview: commentPreview || undefined,
    searchText: `${label} ${richTextPreview} ${sourceLabel} ${commentPreview ?? ""} ${cmsBinding?.collections.join(" ") ?? ""} ${tag ?? ""} ${path}`.toLowerCase(),
    children,
    isDocumentShell,
    draggable: !isDocumentShell,
    // Slot deletion is a layout-contract operation that may touch many pages;
    // it is intentionally routed through the Slot inspector, not generic delete.
    deletable: !isDocumentShell && node.kind !== "slot",
    canAcceptChildren:
      region === "document"
        ? tag === "head"
        : canNodeAcceptChildren(node),
    hasMotion: Boolean(
      propsForIndicators(node) && parseNodeMotion(propsForIndicators(node)!).enabled,
    ),
    hasCmsBinding: Boolean(cmsBinding),
    cmsCollections: cmsBinding?.collections.length ? cmsBinding.collections : undefined,
    cmsOwnership,
    cmsBindingCount: cmsBindingCount || undefined,
    translationBinding: translationBinding ?? undefined,
    hasDataBinding: node.kind === "map" && !cmsBinding,
    conditionStatus: node.kind === "conditional"
      ? node.condition
        ? evaluateConditionSet(node.condition, options.conditionContext ?? { providers: {} })
        : "custom"
      : undefined,
    conditionSummary: node.kind === "conditional"
      ? node.condition ? formatConditionSet(node.condition) : "Custom condition — edit in Code"
      : undefined,
  };
}

/**
 * Bind a source-only component projection to the exact rendered occurrence
 * entered on the canvas. The visible tree remains the active Astro document;
 * instance metadata only disambiguates selection across repeated invocations.
 */
export function scopeComposerLayerTreeToInstance(
  tree: ComposerLayerTreeProjection,
  instance: ComposerLayerInstanceRef,
): ComposerLayerTreeProjection {
  const scopeRows = (rows: readonly ComposerLayerRow[]): ComposerLayerRow[] =>
    rows.map((row) => ({
      ...row,
      instance: {
        chain: [...instance.chain],
        occurrence: instance.occurrence,
        hostPath: instance.hostPath,
      },
      children: scopeRows(row.children),
    }));

  return {
    ...tree,
    content: scopeRows(tree.content),
    document: scopeRows(tree.document),
  };
}

/**
 * Add one presentation-only root named after the active component/layout.
 * Its children remain the exact mutable Astro source rows, and root-level
 * insert/reorder operations resolve through `insertTarget` rather than the
 * synthetic marker path.
 */
export function wrapComposerLayerTreeInActiveDocument(
  tree: ComposerLayerTreeProjection,
  input: {
    file: string;
    name: string;
    kind: "component" | "layout";
  },
): ComposerLayerTreeProjection {
  const treeKey = `active-document:${input.file}`;
  const wrapper: ComposerLayerRow = {
    path: "@active-document",
    treeKey,
    id: treeKey,
    kind: "fragment",
    region: "content",
    semanticType: "component",
    label: input.name,
    sourceLabel: `${input.kind} · ${input.file}`,
    searchText: `${input.name} ${input.kind} ${input.file}`.toLowerCase(),
    children: tree.content,
    isDocumentShell: false,
    draggable: false,
    deletable: false,
    canAcceptChildren: true,
    contextOnly: true,
    synthetic: true,
    activeDocumentRoot: true,
    insertTarget: {
      parentPath: tree.contentParentPath,
      index: tree.content.length,
    },
  };

  return {
    ...tree,
    content: [wrapper],
  };
}

function buildRows(
  nodes: EditableNode[],
  region: ComposerLayerRegion,
  parentPath: string | null,
  options: BuildRowOptions = {},
): ComposerLayerRow[] {
  return nodes
    .map((node, index) => {
      const path = parentPath == null ? String(index) : `${parentPath}.${index}`;
      return buildRow(node, path, region, options);
    })
    .filter((row): row is ComposerLayerRow => row !== null);
}

const ADVANCED_HEAD_LABELS = new Set([
  "Viewport",
  "Generator",
  "Meta",
  "Preconnect",
  "Dns Prefetch",
  "Preload",
  "Modulepreload",
  "Stylesheet",
  "Script",
  "Style",
  "ClientRouter",
  "Client Router",
]);

function findDocumentHead(rows: readonly ComposerLayerRow[]): ComposerLayerRow | null {
  for (const row of rows) {
    if (row.semanticType === "head") return row;
    const nested = findDocumentHead(row.children);
    if (nested) return nested;
  }
  return null;
}

/**
 * Present document metadata as a user-facing Head rather than a literal
 * doctype/html/body tree. Technical runtime entries remain available under a
 * single Advanced head disclosure without changing their source paths.
 */
function projectDocumentHead(rows: readonly ComposerLayerRow[]): ComposerLayerRow[] {
  const head = findDocumentHead(rows);
  if (!head) return [];

  const standard: ComposerLayerRow[] = [];
  const advanced: ComposerLayerRow[] = [];
  for (const child of head.children) {
    if (ADVANCED_HEAD_LABELS.has(child.label)) advanced.push(child);
    else standard.push(child);
  }

  if (!advanced.length) return [{ ...head, children: standard }];

  const advancedKey = `document-advanced:${head.treeKey}`;
  return [{
    ...head,
    children: [
      ...standard,
      {
        path: `@${advancedKey}`,
        treeKey: advancedKey,
        id: advancedKey,
        kind: "fragment",
        region: "document",
        semanticType: "code",
        label: "Advanced head",
        sourceLabel: "Technical document metadata",
        searchText: `advanced head technical metadata ${advanced.map((row) => row.searchText).join(" ")}`,
        children: advanced,
        isDocumentShell: true,
        draggable: false,
        deletable: false,
        canAcceptChildren: false,
        synthetic: true,
        presentationOnly: true,
        insertTarget: {
          parentPath: head.path,
          index: head.children.length,
        },
      },
    ],
  }];
}

function lockContextTree(
  row: ComposerLayerRow,
  prefix: string,
  sourceFile?: string | null,
): ComposerLayerRow {
  return {
    ...row,
    treeKey: `${prefix}:${row.treeKey}`,
    address: sourceFile ? { file: sourceFile, path: row.path } : row.address,
    contextOnly: true,
    draggable: false,
    deletable: false,
    children: row.children.map((child) => lockContextTree(child, prefix, sourceFile)),
  };
}

function lockUnexpectedSourceTree(row: ComposerLayerRow): ComposerLayerRow {
  return {
    ...row,
    sourceLocked: true,
    draggable: false,
    deletable: false,
    canAcceptChildren: false,
    children: row.children.map(lockUnexpectedSourceTree),
  };
}

function outsidePageContentGroup(
  model: AstroDocumentModel,
  contentParentPath: string,
  options: BuildRowOptions,
): ComposerLayerRow | null {
  const rows: ComposerLayerRow[] = [];
  const visit = (node: EditableNode, path: string) => {
    if (path === contentParentPath || path.startsWith(`${contentParentPath}.`)) return;
    if (node.kind === "doctype" || node.kind === "comment") return;
    if (node.kind === "text" && !node.value.trim()) return;
    if (node.kind === "element") {
      const tag = node.name.toLowerCase();
      if (tag === "head") return;
      if (tag === "html" || tag === "body") {
        for (const child of childEntries(node, path)) visit(child.node, child.path);
        return;
      }
    }
    const row = buildRow(node, path, "document", options);
    if (row) rows.push(lockUnexpectedSourceTree(row));
  };
  model.nodes.forEach((node, index) => visit(node, String(index)));
  if (!rows.length) return null;

  const treeKey = "document:outside-page-content";
  return {
    path: "@outside-page-content",
    treeKey,
    id: treeKey,
    kind: "fragment",
    region: "document",
    semanticType: "document",
    label: "Outside page content",
    sourceLabel: "Renderable source outside the page body or layout content root",
    searchText: `outside page content orphan source ${rows.map((row) => row.searchText).join(" ")}`,
    children: rows,
    isDocumentShell: true,
    draggable: false,
    deletable: false,
    canAcceptChildren: false,
    synthetic: true,
    presentationOnly: true,
    sourceLocked: true,
  };
}

/**
 * Default Layers Content parent for a direct HTML page (`html → body`).
 * Fragment pages (no `<html>`) return null — insert at `model.nodes` root.
 */
export function resolveDirectPageContentParentPath(
  model: AstroDocumentModel,
): string | null {
  const htmlIndex = model.nodes.findIndex(
    (node) => node.kind === "element" && node.name.toLowerCase() === "html",
  );
  const htmlNode = htmlIndex >= 0 ? model.nodes[htmlIndex] : null;
  if (!htmlNode || htmlNode.kind !== "element" || !Array.isArray(htmlNode.children)) {
    return null;
  }
  const bodyIndex = htmlNode.children.findIndex(
    (node) => node.kind === "element" && node.name.toLowerCase() === "body",
  );
  return bodyIndex >= 0 ? `${htmlIndex}.${bodyIndex}` : null;
}

/**
 * Content parent for a layout-using page: the root layout component whose
 * children fill `<slot />` (between header/footer in the layout file).
 * Mirrors layoutAuthoring's invocation detection without importing it (cycle).
 */
export function resolveLayoutPageContentParentPath(
  model: AstroDocumentModel,
): string | null {
  const explicit = model.nodes.findIndex(
    (node) => node.kind === "component" && node.id === "layout",
  );
  if (explicit >= 0) return String(explicit);

  const significant = model.nodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => node.kind !== "comment" && node.kind !== "doctype");
  if (significant.length !== 1 || significant[0]!.node.kind !== "component") {
    return null;
  }
  const candidate = significant[0]!;
  const component = candidate.node;
  if (component.kind !== "component") return null;
  const imported = model.imports.find((entry) => entry.name === component.name);
  if (!imported || !/layout/i.test(imported.path)) return null;
  return String(candidate.index);
}

/**
 * Prefer body (direct HTML) or layout invocation (layout pages). Null means
 * a fragment page — insert at the document root.
 */
export function resolvePageContentParentPath(
  model: AstroDocumentModel,
): string | null {
  return (
    resolveDirectPageContentParentPath(model) ??
    resolveLayoutPageContentParentPath(model)
  );
}

/** True when `path` is the content parent or a descendant under it. */
export function isComposerContentPath(
  path: string,
  contentParentPath: string | null,
): boolean {
  if (!contentParentPath) return true;
  return path === contentParentPath || path.startsWith(`${contentParentPath}.`);
}

/**
 * Project an Astro document into the two visual Layers regions without
 * changing, cloning, or annotating source nodes.
 */
export function buildComposerLayerTree(
  model: AstroDocumentModel,
  options?: {
    layoutContract?: ComposerLayoutContract | null;
    layoutModel?: AstroDocumentModel | null;
    layoutFile?: string | null;
    pageDocument?: boolean;
    conditionContext?: ConditionEvaluationContext;
  },
): ComposerLayerTreeProjection {
  const rowOptions: BuildRowOptions = {
    collectionBindings: {
      ...cmsQueryBindings(model.extraFrontmatter),
      ...(model.collectionBindings ?? {}),
    },
    conditionContext: options?.conditionContext,
    managedQueryVariables: managedCmsQueryVariables(model.extraFrontmatter),
    translationContexts: Object.fromEntries(
      detectTranslationContexts(model.extraFrontmatter).map((context) => [context.contextVariable, context.namespace]),
    ),
  };
  const pageSlots = options?.layoutContract
    ? buildComposerPageSlotGroups(model, options.layoutContract)
    : null;
  if (pageSlots) {
    const invocation = locateInvocation(model, pageSlots.layoutPath);
    if (invocation) {
      const content = pageSlots.groups.map((group) => {
        const assignmentRows = group.assignmentPaths.flatMap((path) => {
          const loc = locateNode(model.nodes, path);
          if (!loc) return [];
          if (
            group.name &&
            loc.node.kind === "fragment" &&
            propString(loc.node, "slot") === group.name
          ) {
            return childEntries(loc.node, path)
              .map(({ node, path: childPath }) => buildRow(node, childPath, "content", rowOptions))
              .filter((row): row is ComposerLayerRow => Boolean(row));
          }
          const row = buildRow(loc.node, path, "content", rowOptions);
          return row ? [row] : [];
        });
        const fallbackRows: ComposerLayerRow[] = group.usingFallback
          ? group.fallbackNodes
              .map((node, index) => {
                const row = buildRow(
                  node,
                  `${group.layoutSlotPath ?? "fallback"}.${index}`,
                  "content",
                  rowOptions,
                );
                if (!row) return null;
                return lockContextTree(
                  row,
                  `slot:${group.id}:fallback`,
                  options?.layoutFile,
                );
              })
              .filter((row): row is NonNullable<typeof row> => row !== null)
          : [];
        return {
          path: pageSlots.layoutPath,
          treeKey: `slot-group:${group.id}`,
          id: `slot-group:${group.id}`,
          kind: "fragment" as const,
          region: "content" as const,
          semanticType: "slot" as const,
          label: group.usingFallback
            ? `${group.label} · Using layout default`
            : group.label,
          sourceLabel: group.name ? `slot=${group.name}` : "default slot",
          searchText: `${group.label} ${group.name ?? "page content"}`.toLowerCase(),
          children: [...assignmentRows, ...fallbackRows],
          isDocumentShell: false,
          draggable: false,
          deletable: false,
          canAcceptChildren: !group.readOnly && group.kind !== "unresolved",
          synthetic: true,
          contextOnly: true,
          insertTarget: group.insertTarget,
          slotName: group.name,
        } satisfies ComposerLayerRow;
      });

      let inherited: ComposerLayerRow[] = [];
      if (options?.layoutModel) {
        inherited = projectDocumentHead(buildComposerLayerTree(options.layoutModel).document).map((row) =>
          lockContextTree(row, "layout-shell", options.layoutFile),
        );
      }
      const layoutRow: ComposerLayerRow = {
        path: pageSlots.layoutPath,
        treeKey: `layout:${pageSlots.layoutPath}`,
        id: invocation.id,
        kind: "component",
        region: "document",
        tag: invocation.name.toLowerCase(),
        semanticType: "component",
        label: pageSlots.layoutName,
        sourceLabel: `<${pageSlots.layoutName}>`,
        searchText: `layout ${pageSlots.layoutName}`.toLowerCase(),
        children: [],
        isDocumentShell: true,
        draggable: false,
        deletable: false,
        canAcceptChildren: false,
        pageLayout: true,
      };
      const outside = outsidePageContentGroup(model, pageSlots.layoutPath, rowOptions);
      return {
        content,
        document: [layoutRow, ...inherited, ...(outside ? [outside] : [])],
        contentParentPath: pageSlots.layoutPath,
      };
    }
  }

  const bodyPath = resolveDirectPageContentParentPath(model);
  if (!bodyPath) {
    return {
      content: buildRows(model.nodes, "content", null, rowOptions),
      document: options?.pageDocument ? [noneLayoutRow()] : [],
      contentParentPath: null,
    };
  }

  const bodyLoc = locateNode(model.nodes, bodyPath);
  const bodyNode = bodyLoc?.node ?? null;

  const documentShell = model.nodes
    .map((node, index) =>
      buildRow(node, String(index), "document", {
        ...rowOptions,
        omitBodyChildren: true,
      }),
    )
    .filter((row): row is ComposerLayerRow => row !== null);
  const document = projectDocumentHead(documentShell);
  if (options?.pageDocument) document.unshift(noneLayoutRow());
  const outside = outsidePageContentGroup(model, bodyPath, rowOptions);
  if (outside) document.push(outside);

  return {
    content:
      bodyNode?.kind === "element" && Array.isArray(bodyNode.children)
        ? buildRows(bodyNode.children, "content", bodyPath, rowOptions)
        : [],
    document,
    contentParentPath: bodyPath,
  };
}

function noneLayoutRow(): ComposerLayerRow {
  return {
    path: "@layout",
    treeKey: "layout:none",
    id: "layout:none",
    kind: "fragment",
    region: "document",
    semanticType: "component",
    label: "No layout",
    sourceLabel: "Direct page",
    searchText: "layout none direct page",
    children: [],
    isDocumentShell: true,
    draggable: false,
    deletable: false,
    canAcceptChildren: false,
    synthetic: true,
    contextOnly: false,
    pageLayout: true,
  };
}

function locateNode(
  nodes: EditableNode[],
  path: string,
): { node: EditableNode } | null {
  const parts = path.split(".");
  let list = nodes;
  let node: EditableNode | undefined;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (part === "t" || part === "f") {
      if (!node || node.kind !== "conditional") return null;
      list = part === "t" ? node.consequent : (node.alternate ?? []);
      continue;
    }
    const numeric = Number(part);
    if (!Number.isInteger(numeric)) return null;
    node = list[numeric];
    if (!node) return null;
    if (index < parts.length - 1) {
      if (node.kind === "conditional") list = node.consequent;
      else if (
        node.kind === "element" ||
        node.kind === "component" ||
        node.kind === "fragment" ||
        node.kind === "slot" ||
        node.kind === "map"
      ) list = node.children ?? [];
      else return null;
    }
  }
  return node ? { node } : null;
}

function locateInvocation(
  model: AstroDocumentModel,
  path: string,
): Extract<EditableNode, { kind: "component" }> | null {
  const located = locateNode(model.nodes, path)?.node;
  return located?.kind === "component" ? located : null;
}

/** Resolve aria-demo-style edge/inside targeting for a compact layer row. */
export function resolveComposerLayerDropPosition(metrics: {
  clientY: number;
  top: number;
  height: number;
  allowInside: boolean;
}): ComposerLayerDropPosition {
  if (
    !Number.isFinite(metrics.clientY) ||
    !Number.isFinite(metrics.top) ||
    !Number.isFinite(metrics.height) ||
    metrics.height <= 0
  ) {
    throw new TypeError("Layer drop metrics require a positive finite height");
  }
  const offset = Math.min(Math.max(metrics.clientY - metrics.top, 0), metrics.height);
  if (!metrics.allowInside) return offset < metrics.height / 2 ? "before" : "after";
  const edge = Math.min(
    metrics.height * 0.42,
    Math.max(8, Math.min(14, metrics.height * 0.32)),
  );
  if (offset <= edge) return "before";
  if (offset >= metrics.height - edge) return "after";
  return "inside";
}
