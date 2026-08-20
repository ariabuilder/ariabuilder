/**
 * Normalize model-authored Composer node payloads into EditableNode trees.
 *
 * Tool JSON Schemas stay non-recursive (z.unknown / z.record) so strict
 * providers do not reject $ref. This module is the real contract boundary:
 * semantic trees without IDs, demo-style {tag,type,children} aliases, and
 * primitive shortcuts become Astro EditableNode values with allocated IDs.
 */

import {
  ARIA_PRIMITIVE_IDS,
  createAriaPrimitiveNode,
  isAriaPrimitiveId,
  type AriaPrimitiveId,
} from "./ariaPrimitives";
import { VOID_TAGS } from "./elementSchemas";
import { allocNodeId, cloneNodeWithNewIds } from "./mutate";
import type {
  AstroPropMap,
  EditableNode,
  ElementNode,
  PropValue,
} from "./types";

export type AgentNodeNormalizationPath = Array<string | number>;

export interface AgentNodeNormalizationIssue {
  path: AgentNodeNormalizationPath;
  message: string;
}

export type AgentNodeNormalizationResult =
  | { ok: true; node: EditableNode }
  | { ok: false; issues: AgentNodeNormalizationIssue[] };

export type AgentNodeTreeNormalizationResult =
  | { ok: true; nodes: EditableNode[] }
  | { ok: false; issues: AgentNodeNormalizationIssue[] };

type MutableRecord = Record<string, unknown>;

const EDITABLE_KINDS = new Set([
  "element",
  "component",
  "fragment",
  "text",
  "comment",
  "expr",
  "map",
  "conditional",
  "raw",
  "doctype",
  "slot",
]);

const TEXT_LIKE_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "span",
  "a",
  "button",
  "label",
  "li",
  "summary",
  "cite",
  "strong",
  "em",
  "code",
]);

function isRecord(value: unknown): value is MutableRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function appendPath(
  path: AgentNodeNormalizationPath,
  segment: string | number,
): AgentNodeNormalizationPath {
  return [...path, segment];
}

function splitClassTokens(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function uniqueTokens(tokens: readonly string[]): string[] {
  return Array.from(new Set(tokens));
}

function strProp(value: string): PropValue {
  return { type: "string", value };
}

function collectLegacyClassTokens(
  source: MutableRecord,
  props: MutableRecord,
): string[] {
  const tokens: string[] = [];
  for (const value of [
    source.className,
    source.class,
    props.className,
    props.class,
  ]) {
    if (typeof value === "string") tokens.push(...splitClassTokens(value));
  }
  delete source.className;
  delete source.class;
  delete props.className;
  delete props.class;
  return uniqueTokens(tokens);
}

function coercePropValue(
  value: unknown,
  path: AgentNodeNormalizationPath,
  issues: AgentNodeNormalizationIssue[],
): PropValue | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === null) return { type: "bare" };
  if (typeof value === "string") return strProp(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return strProp(String(value));
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    issues.push({
      path,
      message: "Property values must be strings, booleans, or PropValue objects.",
    });
    return undefined;
  }
  if (value.type === "bare") return { type: "bare" };
  if (
    (value.type === "string" ||
      value.type === "expr" ||
      value.type === "spread" ||
      value.type === "shorthand" ||
      value.type === "template-literal") &&
    typeof value.value === "string"
  ) {
    return { type: value.type, value: value.value };
  }
  issues.push({ path, message: "Unrecognized Composer property value." });
  return undefined;
}

function normalizeProps(
  raw: unknown,
  legacyClassTokens: readonly string[],
  path: AgentNodeNormalizationPath,
  issues: AgentNodeNormalizationIssue[],
): AstroPropMap {
  const props: AstroPropMap = {};
  if (raw !== undefined && !isRecord(raw)) {
    issues.push({ path, message: "props must be an object." });
    return props;
  }
  if (isRecord(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (key === "class" || key === "className") continue;
      const coerced = coercePropValue(value, appendPath(path, key), issues);
      if (coerced) props[key] = coerced;
    }
  }
  if (legacyClassTokens.length > 0) {
    const existing =
      props.class?.type === "string" ? splitClassTokens(props.class.value) : [];
    props.class = strProp(
      uniqueTokens([...existing, ...legacyClassTokens]).join(" "),
    );
  }
  return props;
}

function resolvePrimitiveId(source: MutableRecord): AriaPrimitiveId | null {
  for (const key of ["primitive", "block", "blockId"] as const) {
    const value = source[key];
    if (typeof value === "string" && isAriaPrimitiveId(value.trim().toLowerCase())) {
      return value.trim().toLowerCase() as AriaPrimitiveId;
    }
  }
  const typeHint =
    typeof source.type === "string"
      ? source.type.trim().toLowerCase()
      : typeof source.tag === "string"
        ? source.tag.trim().toLowerCase()
        : null;
  if (typeHint && isAriaPrimitiveId(typeHint)) return typeHint;
  return null;
}

function resolveElementName(source: MutableRecord): string | null {
  if (typeof source.name === "string" && source.name.trim()) {
    return source.name.trim();
  }
  if (typeof source.tag === "string" && source.tag.trim()) {
    return source.tag.trim();
  }
  if (typeof source.type === "string" && source.type.trim()) {
    const type = source.type.trim();
    if (!EDITABLE_KINDS.has(type.toLowerCase()) && !isAriaPrimitiveId(type.toLowerCase())) {
      return type;
    }
    if (isAriaPrimitiveId(type.toLowerCase())) {
      // Primitive ids that map to HTML tags (section/div/…) are handled by
      // createAriaPrimitiveNode; return null so that path wins.
      return null;
    }
  }
  return null;
}

function textValueFromSource(source: MutableRecord): string | null {
  for (const key of ["value", "text", "content"] as const) {
    if (typeof source[key] === "string") return source[key] as string;
  }
  return null;
}

function applyTextOverrides(
  node: ElementNode,
  source: MutableRecord,
): ElementNode {
  const text = textValueFromSource(source);
  if (text == null) return node;
  if (!node.children || node.children.length === 0) {
    return {
      ...node,
      children: [{ id: allocNodeId(), kind: "text", value: text }],
    };
  }
  if (node.children.length === 1 && node.children[0]?.kind === "text") {
    return {
      ...node,
      children: [{ ...node.children[0], value: text }],
    };
  }
  return node;
}

function mergePropsOntoNode(
  node: ElementNode,
  props: AstroPropMap,
): ElementNode {
  if (Object.keys(props).length === 0) return node;
  return {
    ...node,
    props: { ...node.props, ...props },
  };
}

function normalizeChildren(
  raw: unknown,
  path: AgentNodeNormalizationPath,
  issues: AgentNodeNormalizationIssue[],
): EditableNode[] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw === "string") {
    return [{ id: allocNodeId(), kind: "text", value: raw }];
  }
  if (!Array.isArray(raw)) {
    issues.push({ path, message: "children must be an array, string, or null." });
    return [];
  }
  const children: EditableNode[] = [];
  for (const [index, child] of raw.entries()) {
    if (typeof child === "string") {
      children.push({ id: allocNodeId(), kind: "text", value: child });
      continue;
    }
    const normalized = normalizeNodeCandidate(
      child,
      appendPath(path, index),
      issues,
    );
    if (normalized) children.push(normalized);
  }
  return children;
}

function normalizeNodeCandidate(
  input: unknown,
  path: AgentNodeNormalizationPath,
  issues: AgentNodeNormalizationIssue[],
): EditableNode | null {
  if (typeof input === "string") {
    return { id: allocNodeId(), kind: "text", value: input };
  }
  if (!isRecord(input)) {
    issues.push({ path, message: "Node must be an object." });
    return null;
  }

  const source: MutableRecord = { ...input };
  const rawProps = source.props;
  const propsBag: MutableRecord =
    rawProps === undefined ? {} : isRecord(rawProps) ? { ...rawProps } : {};
  if (rawProps !== undefined && !isRecord(rawProps)) {
    issues.push({
      path: appendPath(path, "props"),
      message: "props must be an object.",
    });
  }

  const legacyClassTokens = collectLegacyClassTokens(source, propsBag);
  const props = normalizeProps(
    propsBag,
    legacyClassTokens,
    appendPath(path, "props"),
    issues,
  );

  const kindHint =
    typeof source.kind === "string" ? source.kind.trim().toLowerCase() : null;

  if (
    kindHint === "text" ||
    (source.type === "text" && !source.tag && !source.name)
  ) {
    const value = textValueFromSource(source) ?? "";
    return { id: allocNodeId(), kind: "text", value };
  }

  if (kindHint === "comment") {
    return {
      id: allocNodeId(),
      kind: "comment",
      value: textValueFromSource(source) ?? "",
    };
  }

  if (kindHint === "expr") {
    const value = textValueFromSource(source) ?? "";
    return {
      id: allocNodeId(),
      kind: "expr",
      value: value.startsWith("{") ? value : `{${value}}`,
    };
  }

  if (kindHint === "fragment") {
    const children = normalizeChildren(
      source.children,
      appendPath(path, "children"),
      issues,
    );
    return {
      id: allocNodeId(),
      kind: "fragment",
      name: typeof source.name === "string" ? source.name : "",
      props,
      children: children ?? [],
    };
  }

  if (kindHint === "slot") {
    const children = normalizeChildren(
      source.children,
      appendPath(path, "children"),
      issues,
    );
    return {
      id: allocNodeId(),
      kind: "slot",
      props,
      children: children === undefined ? [] : children,
    };
  }

  if (kindHint === "component") {
    const name =
      typeof source.name === "string" && source.name.trim()
        ? source.name.trim()
        : typeof source.type === "string"
          ? source.type.trim()
          : "";
    if (!name) {
      issues.push({
        path: appendPath(path, "name"),
        message: "Component nodes require a name.",
      });
      return null;
    }
    const children = normalizeChildren(
      source.children,
      appendPath(path, "children"),
      issues,
    );
    return {
      id: allocNodeId(),
      kind: "component",
      name,
      props,
      children: children === undefined ? null : children,
    };
  }

  const primitiveId = resolvePrimitiveId(source);
  if (primitiveId && (!kindHint || kindHint === "element")) {
    let node = createAriaPrimitiveNode(primitiveId);
    if (node.kind === "comment") {
      const value = textValueFromSource(source);
      return cloneNodeWithNewIds(
        value == null ? node : { ...node, value },
        { rewriteDomIds: true },
      );
    }
    node = mergePropsOntoNode(node, props);
    node = applyTextOverrides(node, source);
    if (source.children !== undefined) {
      const children = normalizeChildren(
        source.children,
        appendPath(path, "children"),
        issues,
      );
      if (children !== undefined) {
        node = { ...node, children };
      }
    }
    return cloneNodeWithNewIds(node, { rewriteDomIds: true });
  }

  const elementName = resolveElementName(source);
  if (kindHint === "element" || elementName) {
    const name = elementName ?? "div";
    const lower = name.toLowerCase();
    const isComponentLike = /^[A-Z]/.test(name);
    if (isComponentLike) {
      const children = normalizeChildren(
        source.children,
        appendPath(path, "children"),
        issues,
      );
      return {
        id: allocNodeId(),
        kind: "component",
        name,
        props,
        children: children === undefined ? null : children,
      };
    }

    const children = normalizeChildren(
      source.children,
      appendPath(path, "children"),
      issues,
    );
    let node: ElementNode = {
      id: allocNodeId(),
      kind: "element",
      name: lower,
      props,
      children:
        children === undefined
          ? VOID_TAGS.has(lower)
            ? null
            : TEXT_LIKE_TAGS.has(lower)
              ? [
                  {
                    id: allocNodeId(),
                    kind: "text",
                    value: textValueFromSource(source) ?? "",
                  },
                ]
              : []
          : children,
    };
    if (children === undefined) node = applyTextOverrides(node, source);
    return node;
  }

  if (kindHint && EDITABLE_KINDS.has(kindHint)) {
    issues.push({
      path: appendPath(path, "kind"),
      message: `Unsupported or incomplete Composer kind for agent insert: ${kindHint}.`,
    });
    return null;
  }

  issues.push({
    path,
    message:
      "Unrecognized node. Provide kind/name, tag/type, or a known Aria primitive id.",
  });
  return null;
}

export function normalizeAgentNodeForInsert(
  input: unknown,
): AgentNodeNormalizationResult {
  const issues: AgentNodeNormalizationIssue[] = [];
  const node = normalizeNodeCandidate(input, [], issues);
  if (!node || issues.length > 0) {
    return {
      ok: false,
      issues:
        issues.length > 0
          ? issues
          : [{ path: [], message: "Node could not be normalized." }],
    };
  }
  return {
    ok: true,
    node: cloneNodeWithNewIds(node, { rewriteDomIds: true }),
  };
}

export function normalizeAgentNodeTreeForInsert(
  input: readonly unknown[],
): AgentNodeTreeNormalizationResult {
  const nodes: EditableNode[] = [];
  const issues: AgentNodeNormalizationIssue[] = [];

  for (const [index, node] of input.entries()) {
    const normalized = normalizeAgentNodeForInsert(node);
    if (normalized.ok) {
      nodes.push(normalized.node);
      continue;
    }
    for (const issue of normalized.issues) {
      issues.push({
        path: [index, ...issue.path],
        message: issue.message,
      });
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, nodes };
}

export function formatAgentNodeNormalizationIssues(
  issues: readonly AgentNodeNormalizationIssue[],
): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "node";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

/** Catalog payload for aria_list_element_types. */
export function listComposerElementTypes() {
  return {
    primitives: ARIA_PRIMITIVE_IDS.map((id) => {
      const node = createAriaPrimitiveNode(id);
      return {
        id,
        kind: "primitive" as const,
        rootTag: node.kind === "element" ? node.name : null,
        insertHint: { primitive: id },
      };
    }),
    htmlTags: [
      "div",
      "section",
      "p",
      "h1",
      "h2",
      "h3",
      "a",
      "img",
      "button",
      "span",
      "ul",
      "li",
    ].map((tag) => ({
      id: tag,
      kind: "html" as const,
      rootTag: tag,
      insertHint: { kind: "element", name: tag },
    })),
  };
}

/** Cross-element affordances for aria_get_node_capabilities. */
export function getComposerNodeCapabilities() {
  return {
    authoring: {
      idsOptional: true,
      preferredShapes: [
        { primitive: "section" },
        { kind: "element", name: "section", children: [] },
        { tag: "div", children: ["Text"] },
      ],
      unsupportedModelFields: ["type-only BuilderNode trees without kind/tag"],
    },
    mutations: {
      text: true,
      tag: true,
      props: true,
      classes: true,
      motion: true,
      mediaAttach: true,
      responsiveClassNames: true,
      dataBinding: true,
      containerLoop: true,
    },
    containment: {
      voidTags: [...VOID_TAGS],
      note: "Use parentAcceptsChild rules in Composer; invalid inserts return INVALID_INPUT.",
    },
    classes: {
      breakpoints: ["base", "sm", "md", "lg", "xl", "2xl"],
      shapes: [
        { classes: ["flex", "gap-4"] },
        { add: ["md:flex"], remove: ["hidden"] },
        { classNames: { base: ["flex"], md: ["grid", "grid-cols-2"] } },
      ],
    },
  };
}
