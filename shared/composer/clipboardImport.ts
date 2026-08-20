import DOMPurify from "isomorphic-dompurify";
import { createAriaPrimitiveNode } from "./ariaPrimitives";
import { parseAstro } from "./parseAstro";
import type { ComposerClipboardFormats } from "./clipboard";
import type { EditableNode, PropValue } from "./types";

export type ComposerClipboardImportKind = "source" | "html" | "text";

export type ComposerClipboardImportWarning =
  | "jsx-normalized"
  | "unsafe-content-removed"
  | "composer-markers-removed";

export type ComposerClipboardImportFailureCode =
  | "empty"
  | "invalid-source"
  | "unsupported-document"
  | "unsafe-source";

export type ComposerClipboardImportResult =
  | {
      ok: true;
      kind: ComposerClipboardImportKind;
      nodes: EditableNode[];
      warnings: ComposerClipboardImportWarning[];
    }
  | {
      ok: false;
      code: ComposerClipboardImportFailureCode;
      detail?: string;
    };

const SOURCE_TAG_PATTERN = /<!doctype\s+html\b|<\/?[A-Za-z][\w:.-]*(?:\s[^<>]*)?>/i;
const FULL_DOCUMENT_TAGS = new Set(["html", "head", "body"]);
const EXECUTABLE_EMBED_TAGS = new Set(["iframe", "object", "embed", "link", "meta"]);
const URL_PROPS = new Set(["href", "src", "poster", "action", "formaction", "xlink:href"]);
const COMPOSER_RUNTIME_ATTRS = new Set([
  "data-aria-s",
  "data-aria-e",
  "data-aria-p",
  "data-avb-s",
  "data-avb-e",
  "data-aria-motion-asset",
  "data-aria-composer-font-asset",
]);
const UNSAFE_STYLE_CSS_PATTERN =
  /expression\s*\(|javascript:|vbscript:|-moz-binding|@import\s+["']?\s*javascript:/i;

function uniqueWarnings(
  warnings: ComposerClipboardImportWarning[],
): ComposerClipboardImportWarning[] {
  return [...new Set(warnings)];
}

export function stripClipboardBom(value: string): string {
  return value.replace(/^\uFEFF/, "");
}

export function extractClipboardFragment(value: string): string {
  const start = value.indexOf("<!--StartFragment-->");
  if (start < 0) return value;
  const from = start + "<!--StartFragment-->".length;
  const end = value.indexOf("<!--EndFragment-->", from);
  return value.slice(from, end < 0 ? value.length : end).trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

/** Decode the single pre/code wrapper emitted by code editors on copy. */
export function unwrapEditorSourceHtml(value: string): string | null {
  const fragment = extractClipboardFragment(value).trim();
  const match = /<(pre|code)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(fragment);
  if (!match) return null;
  const before = fragment.slice(0, match.index);
  const after = fragment.slice(match.index + match[0].length);
  const wrapperOnly = `${before}${after}`
    .replace(/<\/?(?:html|body|div|span|p)\b[^>]*>/gi, "")
    .replace(/<!--[^]*?-->/g, "")
    .trim();
  if (wrapperOnly) return null;
  const decoded = decodeHtmlEntities(stripTags(match[2] ?? "")).trim();
  return SOURCE_TAG_PATTERN.test(decoded) ? decoded : null;
}

function stripCodeFence(value: string): { value: string; fenced: boolean } {
  const match = /^```(?:html|astro|jsx|tsx)?\s*\n([\s\S]*?)\n```\s*$/i.exec(
    value.trim(),
  );
  return match
    ? { value: stripClipboardBom(match[1] ?? "").trim(), fenced: true }
    : { value: stripClipboardBom(value).trim(), fenced: false };
}

function isFullDocumentSource(value: string, nodes: readonly EditableNode[]): boolean {
  if (/^\s*---(?:\r?\n|$)/.test(value)) return true;
  return nodes.some(
    (node) =>
      node.kind === "doctype" ||
      ((node.kind === "element" || node.kind === "raw") &&
        FULL_DOCUMENT_TAGS.has(node.name.toLowerCase())),
  );
}

function propIsUnsafeUrl(value: PropValue): boolean {
  if (value.type !== "string") return false;
  const normalized = value.value.trim().toLowerCase();
  return normalized.startsWith("javascript:") || normalized.startsWith("vbscript:");
}

function renameJsxProps(
  props: Record<string, PropValue>,
  warnings: ComposerClipboardImportWarning[],
): void {
  for (const [jsxName, astroName] of [
    ["className", "class"],
    ["htmlFor", "for"],
  ] as const) {
    const value = props[jsxName];
    if (!value) continue;
    if (!props[astroName]) props[astroName] = value;
    delete props[jsxName];
    warnings.push("jsx-normalized");
  }
}

function sanitizeNodeList(
  nodes: readonly EditableNode[],
  warnings: ComposerClipboardImportWarning[],
): EditableNode[] {
  const sanitized: EditableNode[] = [];
  for (const source of nodes) {
    const node = structuredClone(source) as EditableNode;
    const tag = "name" in node ? node.name.toLowerCase() : null;
    if (tag && EXECUTABLE_EMBED_TAGS.has(tag)) {
      warnings.push("unsafe-content-removed");
      continue;
    }
    if (node.kind === "raw" && tag === "style" && UNSAFE_STYLE_CSS_PATTERN.test(node.inner)) {
      warnings.push("unsafe-content-removed");
      continue;
    }
    if (
      node.kind === "element" ||
      node.kind === "component" ||
      node.kind === "fragment" ||
      node.kind === "slot" ||
      node.kind === "raw"
    ) {
      renameJsxProps(node.props, warnings);
      for (const [name, value] of Object.entries(node.props)) {
        const lower = name.toLowerCase();
        if (/^on/i.test(name) || lower === "srcdoc" || lower === "is") {
          delete node.props[name];
          warnings.push("unsafe-content-removed");
          continue;
        }
        if (
          COMPOSER_RUNTIME_ATTRS.has(lower) ||
          lower.startsWith("data-aria-composer-")
        ) {
          delete node.props[name];
          warnings.push("composer-markers-removed");
          continue;
        }
        if (URL_PROPS.has(lower) && propIsUnsafeUrl(value)) {
          delete node.props[name];
          warnings.push("unsafe-content-removed");
        }
      }
    }

    if (node.kind === "conditional") {
      node.consequent = sanitizeNodeList(node.consequent, warnings);
      if (node.alternate) {
        node.alternate = sanitizeNodeList(node.alternate, warnings);
      }
    } else if (node.kind === "map" || node.kind === "fragment") {
      node.children = sanitizeNodeList(node.children, warnings);
    } else if (
      (node.kind === "element" || node.kind === "component" || node.kind === "slot") &&
      Array.isArray(node.children)
    ) {
      node.children = sanitizeNodeList(node.children, warnings);
    }
    sanitized.push(node);
  }
  return sanitized;
}

function containsRuntimeScript(nodes: readonly EditableNode[]): boolean {
  for (const node of nodes) {
    if (node.kind === "raw" && node.name.toLowerCase() === "script") return true;
    if (node.kind === "conditional") {
      if (
        containsRuntimeScript(node.consequent) ||
        containsRuntimeScript(node.alternate ?? [])
      ) return true;
    } else if (node.kind === "map" || node.kind === "fragment") {
      if (containsRuntimeScript(node.children)) return true;
    } else if (
      (node.kind === "element" || node.kind === "component" || node.kind === "slot") &&
      Array.isArray(node.children) &&
      containsRuntimeScript(node.children)
    ) {
      return true;
    }
  }
  return false;
}

async function parseSourceCandidate(
  value: string,
): Promise<ComposerClipboardImportResult> {
  const parsed = await parseAstro(value);
  if (!parsed.editable) {
    return { ok: false, code: "invalid-source", detail: parsed.reason };
  }
  if (
    parsed.model.imports.length > 0 ||
    parsed.model.extraFrontmatter.trim() ||
    isFullDocumentSource(value, parsed.model.nodes)
  ) {
    return { ok: false, code: "unsupported-document" };
  }
  if (containsRuntimeScript(parsed.model.nodes)) {
    return { ok: false, code: "unsafe-source" };
  }
  if (!parsed.model.nodes.some((node) => node.kind !== "text" && node.kind !== "comment")) {
    return { ok: false, code: "invalid-source" };
  }
  const warnings: ComposerClipboardImportWarning[] = [];
  const nodes = sanitizeNodeList(parsed.model.nodes, warnings);
  if (!nodes.length) return { ok: false, code: "unsafe-source" };
  return { ok: true, kind: "source", nodes, warnings: uniqueWarnings(warnings) };
}

async function parseHtmlCandidate(
  value: string,
): Promise<ComposerClipboardImportResult | null> {
  const fragment = extractClipboardFragment(value).trim();
  if (!fragment) return null;
  const warnings: ComposerClipboardImportWarning[] = [];
  const safeStyles: string[] = [];
  const withStylePlaceholders = fragment.replace(
    /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
    (_match, inner: string) => {
      if (UNSAFE_STYLE_CSS_PATTERN.test(inner)) {
        warnings.push("unsafe-content-removed");
        return "";
      }
      const index = safeStyles.push(`<style>${inner}</style>`) - 1;
      return `<span data-aria-paste-style="${index}"></span>`;
    },
  );
  let clean = DOMPurify.sanitize(withStylePlaceholders, {
    FORBID_TAGS: ["script", "iframe", "object", "embed", "meta", "link"],
    FORBID_ATTR: ["srcdoc"],
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: true,
  });
  if (DOMPurify.removed.length) warnings.push("unsafe-content-removed");
  clean = clean.replace(
    /<span\s+data-aria-paste-style="(\d+)"\s*><\/span>/g,
    (_match, index: string) => safeStyles[Number(index)] ?? "",
  );
  if (!clean.trim()) {
    return {
      ok: false,
      code: "unsafe-source",
      detail: "The clipboard HTML contained no safe elements to paste.",
    };
  }
  const parsed = await parseAstro(`---\n---\n${clean}`);
  if (!parsed.editable) {
    return { ok: false, code: "invalid-source", detail: parsed.reason };
  }
  if (!parsed.model.nodes.length) return null;
  const nodes = sanitizeNodeList(parsed.model.nodes, warnings);
  if (!nodes.length) {
    return {
      ok: false,
      code: "unsafe-source",
      detail: "The clipboard HTML contained no safe elements to paste.",
    };
  }
  return { ok: true, kind: "html", nodes, warnings: uniqueWarnings(warnings) };
}

/** Convert external clipboard flavors into the same Astro nodes used by Code view. */
export async function importExternalComposerClipboard(
  formats: ComposerClipboardFormats,
): Promise<ComposerClipboardImportResult> {
  const plain = stripCodeFence(formats.text ?? "");
  if ((plain.fenced || SOURCE_TAG_PATTERN.test(plain.value)) && plain.value) {
    return parseSourceCandidate(plain.value);
  }

  const editorSource = unwrapEditorSourceHtml(formats.html ?? "");
  if (editorSource) return parseSourceCandidate(editorSource);

  const html = await parseHtmlCandidate(formats.html ?? "");
  if (html) return html;

  if (!plain.value) return { ok: false, code: "empty" };
  const node = createAriaPrimitiveNode("text");
  if (node.children?.[0]?.kind === "text") {
    node.children[0].value = plain.value;
  }
  return { ok: true, kind: "text", nodes: [node], warnings: [] };
}
