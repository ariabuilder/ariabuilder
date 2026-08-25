import type {
  AttributeNode,
  Node as CompilerNode,
  DiagnosticMessage,
} from "@astrojs/compiler/types";
import { parse } from "@astrojs/compiler";
import { formatBailReason } from "./bail";
import { INLINE_TAGS, RAW_ELEMENTS, VOID_ELEMENTS } from "./constants";
import { extractPropSchema } from "./props";
import type {
  AstroDocumentModel,
  AstroImport,
  EditableNode,
  ParseAstroOptions,
  ParseAstroResult,
  AstroPropMap,
  ComposerSourceRange,
  PropValue,
} from "./types";
import { parseManagedConditionExpression } from "../conditions/astro";
import { decodeAstroText } from "./astroText";

/** Mirrors @astrojs/compiler DiagnosticSeverity.Error (not re-exported from package entry). */
const DIAGNOSTIC_ERROR = 1;

type PositionedCompilerNode = CompilerNode & {
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

type ParseMappingContext = {
  nextId: number;
  sourceByteToUtf16: number[];
};

/**
 * Astro compiler positions are UTF-8 byte offsets. CodeMirror positions are
 * UTF-16 string offsets, so build the conversion table once per parse.
 */
function createParseMappingContext(source: string): ParseMappingContext {
  const encoded = new TextEncoder();
  const table: number[] = [0];
  let byteOffset = 0;
  let utf16Offset = 0;
  for (const character of source) {
    const byteLength = encoded.encode(character).length;
    for (let index = 0; index < byteLength; index += 1) {
      table[byteOffset + index] = utf16Offset;
    }
    byteOffset += byteLength;
    utf16Offset += character.length;
    table[byteOffset] = utf16Offset;
  }
  return { nextId: 1, sourceByteToUtf16: table };
}

function makeId(context: ParseMappingContext): string {
  return `n${context.nextId++}`;
}

function sourceRangeFor(
  context: ParseMappingContext,
  node: CompilerNode,
): ComposerSourceRange | undefined {
  const position = (node as PositionedCompilerNode).position;
  const start = position?.start?.offset;
  const end = position?.end?.offset;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  const from = context.sourceByteToUtf16[Math.max(0, Math.floor(start!))];
  const to = context.sourceByteToUtf16[Math.max(0, Math.floor(end!))];
  if (from == null || to == null || to < from) return undefined;
  return { from, to };
}

const DEFAULT_IMPORT_RE =
  /import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g;

function splitFrontmatter(value: string): {
  imports: AstroImport[];
  extraFrontmatter: string;
} {
  const imports: AstroImport[] = [];
  let extra = value;
  DEFAULT_IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DEFAULT_IMPORT_RE.exec(value)) !== null) {
    imports.push({ name: m[1]!, path: m[2]! });
    extra = extra.replace(m[0], "");
  }
  return { imports, extraFrontmatter: extra.trim() };
}

function mapAttribute(attr: AttributeNode): { name: string; value: PropValue } {
  switch (attr.kind) {
    case "quoted":
      return { name: attr.name, value: { type: "string", value: attr.value } };
    case "expression":
      return {
        name: attr.name,
        value: { type: "expr", value: attr.value.trim() },
      };
    case "empty":
      return { name: attr.name, value: { type: "bare" } };
    case "spread":
      return {
        name: `...${attr.name}`,
        value: { type: "spread", value: attr.name },
      };
    case "shorthand":
      return {
        name: attr.name,
        value: { type: "shorthand", value: attr.name },
      };
    case "template-literal":
      return {
        name: attr.name,
        value: { type: "template-literal", value: attr.value },
      };
    default:
      return {
        name: attr.name,
        value: { type: "expr", value: attr.value || attr.name },
      };
  }
}

function mapAttributes(attrs: AttributeNode[] | undefined): AstroPropMap {
  const props: AstroPropMap = {};
  for (const attr of attrs ?? []) {
    const mapped = mapAttribute(attr);
    props[mapped.name] = mapped.value;
  }
  return props;
}

function isWhitespaceOnlyText(node: EditableNode): boolean {
  return node.kind === "text" && !node.value.trim();
}

function trimStructuralWhitespace(
  context: ParseMappingContext,
  nodes: EditableNode[],
): EditableNode[] {
  // Keep significant text; drop pure indent whitespace between block nodes.
  // Boundary spaces inside inline runs are preserved by serialize's inline path.
  const out: EditableNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (isWhitespaceOnlyText(n)) {
      const prev = out[out.length - 1];
      const next = nodes[i + 1];
      const betweenBlocks =
        prev &&
        next &&
        prev.kind !== "text" &&
        next.kind !== "text" &&
        !isInlineish(prev) &&
        !isInlineish(next);
      if (betweenBlocks) continue;
      // Collapse pure whitespace text to a single space when adjacent to inline.
      if (
        (prev && isInlineish(prev)) ||
        (next && isInlineish(next))
      ) {
        out.push({
          id: makeId(context),
          kind: "text",
          value: " ",
          sourceRange: n.sourceRange,
        });
      }
      continue;
    }
    out.push(n);
  }
  return out;
}

function isSimpleInlineExpr(n: EditableNode): boolean {
  return (
    n.kind === "expr" &&
    /^\{[^{}]*\}$/.test(n.value) &&
    !n.value.includes("<")
  );
}

function isInlineish(n: EditableNode): boolean {
  if (n.kind === "text") return true;
  // Only simple interpolations count as inline — block exprs/maps must not
  // attract preserved spacer text nodes (breaks pretty-print round-trip).
  if (isSimpleInlineExpr(n)) return true;
  return n.kind === "element" && INLINE_TAGS.has(n.name.toLowerCase());
}

function serializeExprChild(node: CompilerNode): string {
  switch (node.type) {
    case "text":
      return node.value;
    case "element":
    case "component":
    case "custom-element":
    case "fragment": {
      const tag = node as {
        name: string;
        attributes: AttributeNode[];
        children: CompilerNode[];
      };
      const attrs = serializeCompilerAttrs(tag.attributes);
      const name = node.type === "fragment" && !tag.name ? "" : tag.name;
      if (node.type === "fragment" && !tag.name) {
        const inner = tag.children.map(serializeExprChild).join("");
        return `<>${inner}</>`;
      }
      if (
        tag.children.length === 0 ||
        (node.type !== "fragment" &&
          VOID_ELEMENTS.has(name.toLowerCase()))
      ) {
        return `<${name}${attrs} />`;
      }
      const inner = tag.children.map(serializeExprChild).join("");
      return `<${name}${attrs}>${inner}</${name}>`;
    }
    case "expression": {
      const inner = (node.children ?? []).map(serializeExprChild).join("");
      return `{${inner}}`;
    }
    case "comment":
      return `<!--${node.value}-->`;
    default:
      return "";
  }
}

function serializeCompilerAttrs(attrs: AttributeNode[]): string {
  const parts: string[] = [];
  for (const attr of attrs ?? []) {
    if (attr.kind === "empty") parts.push(attr.name);
    else if (attr.kind === "quoted") {
      parts.push(`${attr.name}="${attr.value.replace(/"/g, "&quot;")}"`);
    } else if (attr.kind === "expression") {
      parts.push(`${attr.name}={${attr.value}}`);
    } else if (attr.kind === "spread") {
      parts.push(`{...${attr.name}}`);
    } else if (attr.kind === "shorthand") {
      parts.push(`{${attr.name}}`);
    } else if (attr.kind === "template-literal") {
      parts.push(`${attr.name}={\`${attr.value}\`}`);
    }
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function mapChildren(
  context: ParseMappingContext,
  nodes: CompilerNode[] | undefined,
): EditableNode[] {
  const mapped = (nodes ?? [])
    .map((n) => mapNode(context, n))
    .filter((n): n is EditableNode => n != null);
  return trimStructuralWhitespace(context, mapped);
}

function isTemplateChild(node: CompilerNode | undefined): boolean {
  return (
    node?.type === "element" ||
    node?.type === "component" ||
    node?.type === "fragment" ||
    node?.type === "custom-element"
  );
}

function tryMapStructuredExpression(
  context: ParseMappingContext,
  children: CompilerNode[],
): EditableNode | null {
  // Map: text "….map((…) => (" + template nodes + text "))"
  if (children.length >= 2) {
    const first = children[0];
    const last = children[children.length - 1];
    if (first?.type === "text" && last?.type === "text") {
      const headMatch = first.value.match(
        /^([\s\S]*?\.map\(\s*\([^)]*\)\s*=>\s*\()\s*$/,
      );
      const tailOk = /^\s*\)\s*\)\s*$/.test(last.value);
      if (headMatch && tailOk) {
        const body = children.slice(1, -1);
        return {
          id: makeId(context),
          kind: "map",
          sourceRange: sourceRangeFor(context, first),
          // Keep line boundaries in the callback header. Collapsing all
          // whitespace makes a leading `//` comment consume the `.map(...)`
          // call, leaving its rendered children outside the callback scope.
          head: headMatch[1]!.trim(),
          children: mapChildren(context, body),
        };
      }
    }
  }

  const significant = children.filter(
    (c) => !(c.type === "text" && !c.value.trim()),
  );

  // Parenthesized managed/multi-node && branch.
  if (significant[0]?.type === "text" && significant.at(-1)?.type === "text") {
    const start = significant[0].value.match(/^([\s\S]*?)\s*&&\s*\(\s*$/);
    const end = significant.at(-1) as CompilerNode & { type: "text"; value: string };
    if (start && /^\s*\)\s*$/.test(end.value)) {
      const body = significant.slice(1, -1);
      if (body.length > 0 && body.every((child) => child.type !== "text" || !child.value.trim())) {
        const consequent = mapChildren(context, body);
        if (consequent.length > 0) {
          const test = start[1]!.trim();
          return {
            id: makeId(context),
            kind: "conditional",
            mode: "and",
            test,
            condition: parseManagedConditionExpression(test) ?? undefined,
            consequent,
          };
        }
      }
    }
  }

  // Parenthesized multi-node ternary branches, including an empty `: null`
  // alternate created by Composer before content is dropped into Otherwise.
  if (significant[0]?.type === "text") {
    const start = significant[0].value.match(/^([\s\S]*?)\s*\?\s*\(\s*$/);
    if (start) {
      const nullTailIndex = significant.findIndex((child, index) =>
        index > 0 && child.type === "text" && /^\s*\)\s*:\s*null\s*$/.test(child.value),
      );
      if (nullTailIndex > 1 && nullTailIndex === significant.length - 1) {
        const consequent = mapChildren(context, significant.slice(1, nullTailIndex));
        if (consequent.length > 0) {
          const test = start[1]!.trim();
          return {
            id: makeId(context),
            kind: "conditional",
            mode: "ternary",
            test,
            condition: parseManagedConditionExpression(test) ?? undefined,
            consequent,
            alternate: [],
          };
        }
      }

      const separatorIndex = significant.findIndex((child, index) =>
        index > 0 && child.type === "text" && /^\s*\)\s*:\s*\(\s*$/.test(child.value),
      );
      const last = significant.at(-1);
      if (
        separatorIndex > 1
        && last?.type === "text"
        && /^\s*\)\s*$/.test(last.value)
        && separatorIndex < significant.length - 2
      ) {
        const consequent = mapChildren(context, significant.slice(1, separatorIndex));
        const alternate = mapChildren(context, significant.slice(separatorIndex + 1, -1));
        if (consequent.length > 0 && alternate.length > 0) {
          const test = start[1]!.trim();
          return {
            id: makeId(context),
            kind: "conditional",
            mode: "ternary",
            test,
            condition: parseManagedConditionExpression(test) ?? undefined,
            consequent,
            alternate,
          };
        }
      }
    }
  }

  // && conditional:
  //   {cond && <Tag/>}  or  {cond && (<Tag/>)}
  if (significant[0]?.type === "text" && isTemplateChild(significant[1])) {
    const bare = significant[0].value.match(/^([\s\S]*?)\s*&&\s*$/);
    const paren = significant[0].value.match(/^([\s\S]*?)\s*&&\s*\(\s*$/);
    if (bare && significant.length === 2) {
      const consequent = mapNode(context, significant[1]!);
      if (consequent) {
        return {
          id: makeId(context),
          kind: "conditional",
          mode: "and",
          test: bare[1]!.trim(),
          condition: parseManagedConditionExpression(bare[1]!.trim()) ?? undefined,
          consequent: [consequent],
        };
      }
    }
    if (
      paren &&
      significant.length === 3 &&
      significant[2]?.type === "text" &&
      /^\s*\)\s*$/.test(significant[2].value)
    ) {
      const consequent = mapNode(context, significant[1]!);
      if (consequent) {
        return {
          id: makeId(context),
          kind: "conditional",
          mode: "and",
          test: paren[1]!.trim(),
          condition: parseManagedConditionExpression(paren[1]!.trim()) ?? undefined,
          consequent: [consequent],
        };
      }
    }
  }

  // Ternary:
  //   {cond ? <A/> : <B/>}  or  {cond ? (<A/>) : (<B/>)}
  if (
    significant[0]?.type === "text" &&
    isTemplateChild(significant[1]) &&
    significant[2]?.type === "text" &&
    isTemplateChild(significant[3])
  ) {
    const testMatch = significant[0].value.match(/^([\s\S]*?)\s*\?\s*\(?\s*$/);
    const colonOk = /^\s*\)?\s*:\s*\(?\s*$/.test(significant[2].value);
    const trailing =
      significant.length === 4 ||
      (significant.length === 5 &&
        significant[4]?.type === "text" &&
        /^\s*\)?\s*$/.test(significant[4].value));
    if (testMatch && colonOk && trailing) {
      const consequent = mapNode(context, significant[1]!);
      const alternate = mapNode(context, significant[3]!);
      if (consequent && alternate) {
        return {
          id: makeId(context),
          kind: "conditional",
          mode: "ternary",
          test: testMatch[1]!.trim(),
          condition: parseManagedConditionExpression(testMatch[1]!.trim()) ?? undefined,
          consequent: [consequent],
          alternate: [alternate],
        };
      }
    }
  }

  return null;
}

function mapExpression(
  context: ParseMappingContext,
  node: CompilerNode & { type: "expression" },
): EditableNode {
  const structured = tryMapStructuredExpression(context, node.children ?? []);
  if (structured) {
    structured.sourceRange = sourceRangeFor(context, node);
    return structured;
  }

  const inner = (node.children ?? []).map(serializeExprChild).join("");
  return {
    id: makeId(context),
    kind: "expr",
    sourceRange: sourceRangeFor(context, node),
    value: `{${inner}}`,
  };
}

function mapTag(
  context: ParseMappingContext,
  node: CompilerNode & {
    type: "element" | "component" | "custom-element" | "fragment";
    name: string;
    attributes: AttributeNode[];
    children: CompilerNode[];
  },
): EditableNode {
  const props = mapAttributes(node.attributes);
  const name = node.name;

  if (node.type === "element" && name === "slot") {
    const kids = node.children ?? [];
    return {
      id: makeId(context),
      kind: "slot",
      sourceRange: sourceRangeFor(context, node),
      props,
      children:
        kids.length === 0
          ? null
          : mapChildren(context, kids),
    };
  }

  if (node.type === "element" && RAW_ELEMENTS.has(name.toLowerCase())) {
    const inner = (node.children ?? [])
      .map((c) => (c.type === "text" ? c.value : serializeExprChild(c)))
      .join("");
    return {
      id: makeId(context),
      kind: "raw",
      sourceRange: sourceRangeFor(context, node),
      name,
      props,
      inner,
    };
  }

  if (node.type === "fragment") {
    return {
      id: makeId(context),
      kind: "fragment",
      sourceRange: sourceRangeFor(context, node),
      name: name || "",
      props,
      children: mapChildren(context, node.children),
    };
  }

  const isComponent =
    node.type === "component" || node.type === "custom-element";
  const kind = isComponent ? "component" : "element";
  const kids = node.children ?? [];
  const voidEl =
    !isComponent && VOID_ELEMENTS.has(name.toLowerCase());

  let children: EditableNode[] | null;
  if (voidEl) {
    children = null;
  } else if (kids.length === 0) {
    // Compiler does not distinguish self-closing from empty paired tags.
    // Prefer self-closing for components; paired empty for HTML elements.
    children = isComponent ? null : [];
  } else {
    children = mapChildren(context, kids);
  }

  return {
    id: makeId(context),
    kind,
    sourceRange: sourceRangeFor(context, node),
    name,
    props,
    children,
  };
}

function mapNode(
  context: ParseMappingContext,
  node: CompilerNode,
): EditableNode | null {
  switch (node.type) {
    case "frontmatter":
      return null;
    case "text": {
      if (node.value === "") return null;
      return {
        id: makeId(context),
        kind: "text",
        sourceRange: sourceRangeFor(context, node),
        value: decodeAstroText(node.value),
      };
    }
    case "comment":
      return {
        id: makeId(context),
        kind: "comment",
        sourceRange: sourceRangeFor(context, node),
        value: node.value,
      };
    case "doctype":
      return {
        id: makeId(context),
        kind: "doctype",
        sourceRange: sourceRangeFor(context, node),
        value: node.value,
      };
    case "expression":
      return mapExpression(context, node);
    case "element":
    case "component":
    case "custom-element":
    case "fragment":
      return mapTag(context, node);
    default:
      // Unknown compiler node → opaque expr-like preservation via comment skip
      return null;
  }
}

function markDynamicTags(
  nodes: EditableNode[],
  importsByName: Record<string, AstroImport>,
): void {
  for (const n of nodes) {
    if (
      (n.kind === "component" || n.kind === "element") &&
      n.kind === "component" &&
      !importsByName[n.name]
    ) {
      n.dynamicTag = true;
    }
    if (n.kind === "map" || n.kind === "fragment") {
      markDynamicTags(n.children, importsByName);
    } else if (n.kind === "conditional") {
      markDynamicTags(n.consequent, importsByName);
      if (n.alternate) markDynamicTags(n.alternate, importsByName);
    } else if (
      (n.kind === "element" ||
        n.kind === "component" ||
        n.kind === "slot") &&
      Array.isArray(n.children)
    ) {
      markDynamicTags(n.children, importsByName);
    }
  }
}

function tagLayout(
  nodes: EditableNode[],
  importsByName: Record<string, AstroImport>,
): void {
  const significant = nodes.filter((n) => n.kind !== "comment" && n.kind !== "doctype");
  let wrapper: EditableNode | null = null;
  if (
    significant.length === 1 &&
    significant[0]!.kind === "component" &&
    significant[0]!.children !== null
  ) {
    wrapper = significant[0]!;
  } else if (significant.length > 1) {
    const layoutish = significant.filter(
      (n) =>
        n.kind === "component" &&
        n.children !== null &&
        /layout/i.test(importsByName[n.name]?.path ?? ""),
    );
    if (layoutish.length === 1) wrapper = layoutish[0]!;
  }
  if (wrapper && (wrapper.kind === "component" || wrapper.kind === "element")) {
    wrapper.id = "layout";
  }
}

function hasErrorDiagnostics(diagnostics: DiagnosticMessage[]): boolean {
  return diagnostics.some((d) => d.severity === DIAGNOSTIC_ERROR);
}

function isMarkdownOrMdx(filename: string | undefined): boolean {
  if (!filename) return false;
  return /\.(md|mdx)$/i.test(filename);
}

/**
 * Parse `.astro` source into an editable document model.
 * Uses `@astrojs/compiler` `parse()` — not a regex scanner.
 */
export async function parseAstro(
  source: string,
  options: ParseAstroOptions = {},
): Promise<ParseAstroResult> {
  if (isMarkdownOrMdx(options.filename)) {
    const bail = {
      code: "markdown_mdx" as const,
      what: `Markdown/MDX files are not visually editable (${options.filename})`,
    };
    return {
      editable: false,
      compilerValid: false,
      reason: formatBailReason(bail),
      source,
      bail,
    };
  }

  let parseResult;
  try {
    parseResult = await parse(source, { position: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const bail = {
      code: "parse_exception" as const,
      what: message,
    };
    return {
      editable: false,
      compilerValid: false,
      reason: formatBailReason(bail),
      source,
      bail,
    };
  }

  if (hasErrorDiagnostics(parseResult.diagnostics)) {
    const first = parseResult.diagnostics.find(
      (d) => d.severity === DIAGNOSTIC_ERROR,
    )!;
    const bail = {
      code: "compiler_error" as const,
      what: first.text,
      line: first.location?.line,
      near: source.split("\n")[(first.location?.line ?? 1) - 1]?.trim(),
    };
    return {
      editable: false,
      compilerValid: false,
      reason: formatBailReason(bail),
      source,
      bail,
    };
  }

  try {
    const root = parseResult.ast;
    let frontmatterValue = "";
    const bodyNodes: CompilerNode[] = [];
    for (const child of root.children ?? []) {
      if (child.type === "frontmatter") {
        frontmatterValue = child.value ?? "";
      } else {
        bodyNodes.push(child);
      }
    }

    const { imports, extraFrontmatter } = splitFrontmatter(frontmatterValue);
    const mappingContext = createParseMappingContext(source);
    const nodes = mapChildren(mappingContext, bodyNodes);
    const importsByName = Object.fromEntries(imports.map((i) => [i.name, i]));
    markDynamicTags(nodes, importsByName);
    tagLayout(nodes, importsByName);

    const schema = extractPropSchema(source);
    const model: AstroDocumentModel = {
      imports,
      extraFrontmatter,
      nodes,
      propSchema: schema.fields,
      slots: schema.slots,
      extendsTag: schema.extendsTag,
    };

    return { editable: true, compilerValid: true, source, model };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const bail = {
      code: "parse_exception" as const,
      what: message,
    };
    return {
      editable: false,
      compilerValid: true,
      reason: formatBailReason(bail),
      source,
      bail,
    };
  }
}
