import { serializeAstro } from "./serializeAstro";
import type { AstroImport, EditableNode } from "./types";

export const ARIA_COMPOSER_CLIPBOARD_MIME =
  "application/x-aria-astro-node+json";

export type ComposerClipboardClassRule = {
  name: string;
  css: string;
  sourceFile: string;
};

export type ComposerClipboardPayloadV1 = {
  version: 1;
  sourceProject: string;
  sourceFile: string;
  nodes: EditableNode[];
  imports: AstroImport[];
  classes: ComposerClipboardClassRule[];
  copiedAt: number;
};

export type ComposerClipboardFormats = {
  aria?: string;
  html?: string;
  text?: string;
};

export function encodeComposerClipboard(
  payload: ComposerClipboardPayloadV1,
): string {
  return JSON.stringify(payload);
}

export function decodeComposerClipboard(
  value: string | null | undefined,
): ComposerClipboardPayloadV1 | null {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ComposerClipboardPayloadV1>;
    if (
      parsed.version !== 1 ||
      typeof parsed.sourceProject !== "string" ||
      typeof parsed.sourceFile !== "string" ||
      !Array.isArray(parsed.nodes) ||
      !Array.isArray(parsed.imports) ||
      !Array.isArray(parsed.classes)
    ) {
      return null;
    }
    return parsed as ComposerClipboardPayloadV1;
  } catch {
    return null;
  }
}

export function serializeClipboardHtml(nodes: EditableNode[]): string {
  const source = serializeAstro({
    imports: [],
    extraFrontmatter: "",
    nodes,
    propSchema: [],
    slots: [],
    extendsTag: null,
  });
  return source.replace(/^---\s*\n---\s*\n?/, "").trim();
}

export function clipboardPlainText(nodes: readonly EditableNode[]): string {
  const out: string[] = [];
  const visit = (items: readonly EditableNode[]) => {
    for (const node of items) {
      if (node.kind === "text") out.push(node.value);
      else if (node.kind === "conditional") {
        visit(node.consequent);
        if (node.alternate) visit(node.alternate);
      } else if (node.kind === "map" || node.kind === "fragment") {
        visit(node.children);
      } else if (
        (node.kind === "element" ||
          node.kind === "component" ||
          node.kind === "slot") &&
        node.children
      ) {
        visit(node.children);
      }
    }
  };
  visit(nodes);
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export function looksLikeSourceCodePaste(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return (
    /^```/.test(text) ||
    /^(?:import|export)\s.+from\s+["']/.test(text) ||
    /<(?:html|body|div)[^>]*>/.test(text) && /&lt;[A-Za-z]/.test(text)
  );
}
