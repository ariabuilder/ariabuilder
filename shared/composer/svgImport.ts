import DOMPurify from "isomorphic-dompurify";
import { allocNodeId } from "./mutate";
import type { EditableNode, ElementNode, PropValue } from "./types";

export type SanitizedSvgResult =
  | { ok: true; node: ElementNode }
  | { ok: false; error: string };

const URL_PRESENTATION_ATTRS = new Set([
  "clip-path", "cursor", "fill", "filter", "marker", "marker-end",
  "marker-mid", "marker-start", "mask", "stroke",
]);

function safeFragmentUrl(value: string): boolean {
  return /^url\(\s*["']?#[^)"']+["']?\s*\)$/i.test(value.trim());
}

function domNodeToEditable(node: Node): EditableNode | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent ?? "";
    return value.trim() ? { id: allocNodeId(), kind: "text", value } : null;
  }
  if (!(node instanceof Element)) return null;
  const props: Record<string, PropValue> = {};
  for (const attr of [...node.attributes]) {
    const name = attr.name.toLowerCase();
    const value = attr.value.trim();
    if (name.startsWith("on")) continue;
    if ((name === "href" || name === "xlink:href") && value && !value.startsWith("#")) continue;
    if (name === "style" && /url\s*\(/i.test(value)) continue;
    if (URL_PRESENTATION_ATTRS.has(name) && /url\s*\(/i.test(value) && !safeFragmentUrl(value)) continue;
    props[attr.name] = { type: "string", value: attr.value };
  }
  return {
    id: allocNodeId(),
    kind: "element",
    // SVG element names are case-sensitive (`linearGradient`, `clipPath`).
    name: node.tagName,
    props,
    children: [...node.childNodes]
      .map(domNodeToEditable)
      .filter((child): child is EditableNode => Boolean(child)),
  };
}

/** Sanitize uploaded SVG before it becomes executable Astro source. */
export function parseSanitizedSvg(source: string): SanitizedSvgResult {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, error: "The selected SVG is empty." };
  const clean = DOMPurify.sanitize(trimmed, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "style", "foreignObject", "iframe", "object", "embed"],
    FORBID_ATTR: ["srcdoc"],
    ADD_TAGS: ["use"],
    ADD_ATTR: ["href", "xlink:href"],
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: true,
  });
  const document = new DOMParser().parseFromString(clean, "image/svg+xml");
  const root = document.documentElement;
  if (root.tagName.toLowerCase() !== "svg" || root.querySelector("parsererror")) {
    return { ok: false, error: "The selected file is not valid SVG markup." };
  }
  const node = domNodeToEditable(root);
  return node?.kind === "element"
    ? { ok: true, node }
    : { ok: false, error: "The selected SVG could not be converted." };
}
