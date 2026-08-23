import {
  ARIA_MARKER_END,
  ARIA_MARKER_START,
  INLINE_TAGS,
} from "./constants";
import type {
  AstroDocumentModel,
  AstroPropMap,
  EditableNode,
  PropValue,
} from "./types";
import { managedConditionExpression } from "../conditions/astro";

function serializePropValue(name: string, v: PropValue): string {
  if (v.type === "bare") return name;
  if (v.type === "spread") return `{...${v.value}}`;
  if (v.type === "shorthand") return `{${v.value}}`;
  if (v.type === "expr") return `${name}={${v.value}}`;
  if (v.type === "template-literal") return `${name}={\`${v.value}\`}`;
  return `${name}="${String(v.value).replace(/"/g, "&quot;")}"`;
}

export function serializeAttrs(props: AstroPropMap | undefined): string {
  const parts: string[] = [];
  for (const [name, v] of Object.entries(props ?? {}) as Array<
    [string, PropValue]
  >) {
    parts.push(serializePropValue(name, v));
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function isSimpleExpr(n: EditableNode): boolean {
  return (
    n.kind === "expr" &&
    /^\{[^{}]*\}$/.test(n.value) &&
    !n.value.includes("<")
  );
}

function isInlineRun(nodes: EditableNode[]): boolean {
  return (
    nodes.length > 0 &&
    nodes.every(
      (n) =>
        n.kind === "text" ||
        isSimpleExpr(n) ||
        (n.kind === "element" &&
          INLINE_TAGS.has(n.name.toLowerCase()) &&
          (n.children === null ||
            n.children.length === 0 ||
            isInlineRun(n.children))),
    )
  );
}

function inlineString(nodes: EditableNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.kind === "text") out += n.value;
    else if (n.kind === "expr") out += n.value;
    else if (n.kind === "element") {
      if (n.children === null || n.children.length === 0) {
        out +=
          n.name === "br"
            ? "<br />"
            : `<${n.name}${serializeAttrs(n.props)} />`;
      } else {
        out += `<${n.name}${serializeAttrs(n.props)}>${inlineString(n.children)}</${n.name}>`;
      }
    }
  }
  return out;
}

/**
 * Dev-preview equivalent of `inlineString` that gives every Layers-visible
 * inline child its own marker identity without inserting rendered whitespace.
 * Inline elements own their phrasing descendants because Layers projects the
 * element (for example, a CTA link), not its otherwise-hidden text child.
 * Marker templates are stripped by the design client before interaction, so
 * clean disk serialization and the resulting phrasing DOM stay unchanged.
 */
function inlineStringMarked(
  nodes: EditableNode[],
  parentPath: string,
  trimEdges = false,
): string {
  const contents = nodes.map((node) => inlineString([node]));

  if (trimEdges) {
    for (let index = 0; index < contents.length; index += 1) {
      contents[index] = contents[index]!.trimStart();
      if (contents[index]) break;
    }
    for (let index = contents.length - 1; index >= 0; index -= 1) {
      contents[index] = contents[index]!.trimEnd();
      if (contents[index]) break;
    }
  }

  return contents.map((content, index) => {
    const path = `${parentPath}.${index}`;
    return `<template ${ARIA_MARKER_START}="${path}"></template>${content}<template ${ARIA_MARKER_END}="${path}"></template>`;
  }).join("");
}

function serializeFrontmatter(model: AstroDocumentModel): string[] {
  const lines = ["---"];
  for (const imp of model.imports) {
    lines.push(`import ${imp.name} from '${imp.path}';`);
  }
  if (model.extraFrontmatter) {
    if (model.imports.length) lines.push("");
    lines.push(model.extraFrontmatter);
  }
  lines.push("---");
  return lines;
}

export function serializeNode(
  node: EditableNode,
  indent: string,
  lines: string[],
): void {
  switch (node.kind) {
    case "text":
      lines.push(indent + node.value);
      return;
    case "expr": {
      const exprLines = node.value.split("\n");
      lines.push(indent + exprLines[0]);
      for (let i = 1; i < exprLines.length; i++) lines.push(exprLines[i]!);
      return;
    }
    case "map":
      lines.push(`${indent}{`);
      lines.push(`${indent}  ${node.head}`);
      for (const child of node.children) {
        serializeNode(child, `${indent}    `, lines);
      }
      lines.push(`${indent}  ))`);
      lines.push(`${indent}}`);
      return;
    case "conditional": {
      const conditionTest = node.condition
        ? managedConditionExpression(node.condition) ?? node.test
        : node.test;
      const isSingleTag = (nodes: EditableNode[]) =>
        nodes.length === 1 &&
        (nodes[0]!.kind === "element" ||
          nodes[0]!.kind === "component" ||
          nodes[0]!.kind === "fragment" ||
          nodes[0]!.kind === "slot");

      if (node.mode === "and" && isSingleTag(node.consequent)) {
        // Prefer idiomatic `{cond && <Tag />}` so re-parse stays structured.
        const tagLines: string[] = [];
        serializeNode(node.consequent[0]!, "", tagLines);
        const tag = tagLines.join("\n").trim();
        if (!tag.includes("\n")) {
          lines.push(`${indent}{${conditionTest} && ${tag}}`);
          return;
        }
      }

      if (node.mode === "and") {
        lines.push(`${indent}{${conditionTest} && (`);
        for (const child of node.consequent) {
          serializeNode(child, `${indent}  `, lines);
        }
        lines.push(`${indent})}`);
      } else if ((node.alternate ?? []).length === 0) {
        lines.push(`${indent}{${conditionTest} ? (`);
        for (const child of node.consequent) {
          serializeNode(child, `${indent}  `, lines);
        }
        lines.push(`${indent}) : null}`);
      } else if (
        isSingleTag(node.consequent) &&
        isSingleTag(node.alternate ?? [])
      ) {
        const a: string[] = [];
        const b: string[] = [];
        serializeNode(node.consequent[0]!, "", a);
        serializeNode(node.alternate![0]!, "", b);
        const left = a.join("\n").trim();
        const right = b.join("\n").trim();
        if (!left.includes("\n") && !right.includes("\n")) {
          lines.push(`${indent}{${conditionTest} ? ${left} : ${right}}`);
          return;
        }
        lines.push(`${indent}{${conditionTest} ? (`);
        for (const child of node.consequent) {
          serializeNode(child, `${indent}  `, lines);
        }
        lines.push(`${indent}) : (`);
        for (const child of node.alternate ?? []) {
          serializeNode(child, `${indent}  `, lines);
        }
        lines.push(`${indent})}`);
      } else {
        lines.push(`${indent}{${conditionTest} ? (`);
        for (const child of node.consequent) {
          serializeNode(child, `${indent}  `, lines);
        }
        lines.push(`${indent}) : (`);
        for (const child of node.alternate ?? []) {
          serializeNode(child, `${indent}  `, lines);
        }
        lines.push(`${indent})}`);
      }
      return;
    }
    case "comment":
      lines.push(`${indent}<!--${node.value}-->`);
      return;
    case "doctype":
      lines.push(`${indent}<!DOCTYPE ${node.value}>`);
      return;
    case "raw": {
      lines.push(`${indent}<${node.name}${serializeAttrs(node.props)}>`);
      const inner = node.inner.replace(/^\r?\n/, "").replace(/\s+$/, "");
      if (inner) lines.push(inner);
      lines.push(`${indent}</${node.name}>`);
      return;
    }
    case "slot": {
      const attrs = serializeAttrs(node.props);
      if (node.children === null) {
        lines.push(`${indent}<slot${attrs} />`);
        return;
      }
      if (node.children.length === 0) {
        lines.push(`${indent}<slot${attrs}></slot>`);
        return;
      }
      lines.push(`${indent}<slot${attrs}>`);
      for (const child of node.children) serializeNode(child, `${indent}  `, lines);
      lines.push(`${indent}</slot>`);
      return;
    }
    case "fragment": {
      // ?raw chunk resolution attaches editable children for the canvas, but
      // disk serialize must keep the Fragment self-closing (chunk write-back
      // is a later phase). Same contract as component + chunkFile.
      if (node.chunkFile || node.chunkAggregate) {
        lines.push(
          `${indent}<${node.name || "Fragment"}${serializeAttrs(node.props)} />`,
        );
        return;
      }
      const open = node.name ? `<${node.name}${serializeAttrs(node.props)}>` : "<>";
      const close = node.name ? `</${node.name}>` : "</>";
      if (node.children.length === 0) {
        lines.push(`${indent}${open}${close}`);
        return;
      }
      if (isInlineRun(node.children)) {
        lines.push(
          `${indent}${open}${inlineString(node.children).trim()}${close}`,
        );
        return;
      }
      lines.push(`${indent}${open}`);
      for (const child of node.children) {
        serializeNode(child, `${indent}  `, lines);
      }
      lines.push(`${indent}${close}`);
      return;
    }
    case "element":
    case "component": {
      if (
        node.kind === "component" &&
        (node.chunkFile || node.chunkAggregate)
      ) {
        lines.push(`${indent}<${node.name}${serializeAttrs(node.props)} />`);
        return;
      }
      const attrs = serializeAttrs(node.props);
      if (node.children === null) {
        lines.push(`${indent}<${node.name}${attrs} />`);
        return;
      }
      if (node.children.length === 0) {
        lines.push(`${indent}<${node.name}${attrs}></${node.name}>`);
        return;
      }
      if (isInlineRun(node.children)) {
        lines.push(
          `${indent}<${node.name}${attrs}>${inlineString(node.children).trim()}</${node.name}>`,
        );
        return;
      }
      lines.push(`${indent}<${node.name}${attrs}>`);
      for (const child of node.children) {
        serializeNode(child, `${indent}  `, lines);
      }
      lines.push(`${indent}</${node.name}>`);
      return;
    }
    default: {
      const _exhaustive: never = node;
      void _exhaustive;
    }
  }
}

/**
 * Serialize model to clean idiomatic `.astro` for disk.
 * Markers are NEVER emitted.
 */
export function serializeAstro(model: AstroDocumentModel): string {
  const lines = serializeFrontmatter(model);
  for (const node of model.nodes) serializeNode(node, "", lines);
  return `${lines.join("\n")}\n`;
}

function slotAttrFor(node: EditableNode): string {
  if (
    node.kind !== "element" &&
    node.kind !== "component" &&
    node.kind !== "fragment" &&
    node.kind !== "slot"
  ) {
    return "";
  }
  const slotVal = node.props?.slot;
  if (slotVal && slotVal.type === "string" && slotVal.value) {
    return ` slot="${slotVal.value}"`;
  }
  return "";
}

function serializeNodeMarked(
  node: EditableNode,
  indent: string,
  lines: string[],
  path: string,
): void {
  const slotAttr = slotAttrFor(node);
  lines.push(
    `${indent}<template${slotAttr} ${ARIA_MARKER_START}="${path}"></template>`,
  );

  if (
    (node.kind === "component" || node.kind === "element") &&
    !(node.kind === "component" && (node.chunkFile || node.chunkAggregate)) &&
    Array.isArray(node.children) &&
    node.children.length > 0 &&
    isInlineRun(node.children)
  ) {
    const attrs = serializeAttrs(node.props);
    lines.push(
      `${indent}<${node.name}${attrs}>${inlineStringMarked(
        node.children,
        path,
        true,
      )}</${node.name}>`,
    );
  } else if (
    (node.kind === "component" || node.kind === "element") &&
    !(
      node.kind === "component" &&
      (node.chunkFile || node.chunkAggregate)
    ) &&
    Array.isArray(node.children) &&
    !(node.children.length > 0 && isInlineRun(node.children))
  ) {
    const attrs = serializeAttrs(node.props);
    lines.push(`${indent}<${node.name}${attrs}>`);
    node.children.forEach((child, i) =>
      serializeNodeMarked(child, `${indent}  `, lines, `${path}.${i}`),
    );
    lines.push(`${indent}</${node.name}>`);
  } else if (
    node.kind === "fragment" &&
    !node.chunkFile &&
    !node.chunkAggregate &&
    !(node.children.length > 0 && isInlineRun(node.children))
  ) {
    const open = node.name ? `<${node.name}${serializeAttrs(node.props)}>` : "<>";
    const close = node.name ? `</${node.name}>` : "</>";
    lines.push(`${indent}${open}`);
    node.children.forEach((child, i) =>
      serializeNodeMarked(child, `${indent}  `, lines, `${path}.${i}`),
    );
    lines.push(`${indent}${close}`);
  } else if (node.kind === "map") {
    lines.push(`${indent}{`);
    lines.push(`${indent}  ${node.head}`);
    node.children.forEach((child, i) =>
      serializeNodeMarked(child, `${indent}    `, lines, `${path}.${i}`),
    );
    lines.push(`${indent}  ))`);
    lines.push(`${indent}}`);
  } else if (node.kind === "conditional") {
    const conditionTest = node.condition
      ? managedConditionExpression(node.condition) ?? node.test
      : node.test;
    if (node.condition) {
      const writeBranch = (
        branch: "t" | "f",
        children: EditableNode[],
        activeExpression: string,
      ) => {
        lines.push(`${indent}    <template data-aria-condition-start="${path}:${branch}" data-aria-condition-active={String(Boolean(${activeExpression}))}></template>`);
        children.forEach((child, i) =>
          serializeNodeMarked(child, `${indent}    `, lines, `${path}.${branch}.${i}`),
        );
        lines.push(`${indent}    <template data-aria-condition-end="${path}:${branch}"></template>`);
      };
      lines.push(`${indent}{Astro.url.searchParams.get("aria-design") === "1" ? (`);
      lines.push(`${indent}  <>`);
      writeBranch("t", node.consequent, conditionTest);
      writeBranch("f", node.alternate ?? [], `!(${conditionTest})`);
      lines.push(`${indent}  </>`);
      lines.push(`${indent}) : (${conditionTest} ? (`);
      node.consequent.forEach((child) => serializeNode(child, `${indent}  `, lines));
      if (node.mode === "ternary" && (node.alternate?.length ?? 0) > 0) {
        lines.push(`${indent}) : (`);
        node.alternate!.forEach((child) => serializeNode(child, `${indent}  `, lines));
        lines.push(`${indent}))}`);
      } else {
        lines.push(`${indent}) : null)}`);
      }
    } else if (node.mode === "and") {
      lines.push(`${indent}{${conditionTest} && (`);
      node.consequent.forEach((child, i) =>
        serializeNodeMarked(child, `${indent}  `, lines, `${path}.${i}`),
      );
      lines.push(`${indent})}`);
    } else {
      lines.push(`${indent}{${conditionTest} ? (`);
      node.consequent.forEach((child, i) =>
        serializeNodeMarked(child, `${indent}  `, lines, `${path}.t.${i}`),
      );
      lines.push(`${indent}) : (`);
      (node.alternate ?? []).forEach((child, i) =>
        serializeNodeMarked(child, `${indent}  `, lines, `${path}.f.${i}`),
      );
      lines.push(`${indent})}`);
    }
  } else if (node.kind === "slot" && Array.isArray(node.children)) {
    const attrs = serializeAttrs(node.props);
    lines.push(`${indent}<slot${attrs}>`);
    node.children.forEach((child, i) =>
      serializeNodeMarked(child, `${indent}  `, lines, `${path}.${i}`),
    );
    lines.push(`${indent}</slot>`);
  } else {
    serializeNode(node, indent, lines);
  }

  lines.push(
    `${indent}<template${slotAttr} ${ARIA_MARKER_END}="${path}"></template>`,
  );
}

/**
 * Dev-only marked serialize for the Vite marker plugin.
 * Wraps nodes in `<template data-aria-s/e="path">` pairs.
 * `prefix` namespaces paths for component drill-in (e.g. `src/components/Card.astro|`).
 */
export function serializeAstroMarked(
  model: AstroDocumentModel,
  prefix = "",
): string {
  const lines = serializeFrontmatter(model);
  model.nodes.forEach((node, i) =>
    serializeNodeMarked(node, "", lines, `${prefix}${i}`),
  );
  return `${lines.join("\n")}\n`;
}
