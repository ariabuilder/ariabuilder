/**
 * Built-in HTML attribute schemas for plain elements (Stacki-shaped).
 * Same PropField shape as `extractPropSchema` so the inspector can share fields.
 */

import type { PropField } from "./types";

function field(
  name: string,
  type: PropField["type"],
  extras?: Partial<PropField>,
): PropField {
  return {
    name,
    type,
    optional: true,
    ...extras,
  };
}

/** Global HTML / Astro attributes shown for every element. */
export const GLOBAL_ATTR_FIELDS: PropField[] = [
  field("id", "string"),
  field("class", "string"),
  field("title", "string"),
  field("slot", "string"),
  field("role", "string"),
  field("tabindex", "number"),
  field("hidden", "boolean", { default: false }),
  field("popover", "enum", { options: ["auto", "hint", "manual"] }),
];

export const GLOBAL_ATTRS = new Set(GLOBAL_ATTR_FIELDS.map((f) => f.name));

const TAG_SCHEMAS: Record<string, PropField[]> = {
  html: [
    field("lang", "string"),
    field("dir", "enum", { options: ["ltr", "rtl", "auto"] }),
  ],
  meta: [
    field("charset", "string"),
    field("name", "string"),
    field("content", "string"),
    field("property", "string"),
    field("http-equiv", "string"),
  ],
  link: [
    field("rel", "string"),
    field("href", "string"),
    field("as", "string"),
    field("type", "string"),
    field("media", "string"),
    field("crossorigin", "string"),
  ],
  script: [
    field("src", "string"),
    field("type", "string"),
    field("async", "boolean", { default: false }),
    field("defer", "boolean", { default: false }),
    field("crossorigin", "string"),
  ],
  style: [
    field("type", "string"),
    field("media", "string"),
  ],
  button: [
    field("type", "enum", {
      options: ["submit", "button", "reset"],
      default: "submit",
    }),
    field("disabled", "boolean", { default: false }),
    field("name", "string"),
    field("popovertarget", "string"),
    field("popovertargetaction", "enum", {
      options: ["toggle", "show", "hide"],
      default: "toggle",
    }),
  ],
  details: [
    field("open", "boolean", { default: false }),
    field("name", "string"),
  ],
  dialog: [
    field("open", "boolean", { default: false }),
    field("closedby", "enum", { options: ["any", "closerequest", "none"] }),
  ],
  progress: [field("value", "number"), field("max", "number", { default: 1 })],
  meter: [
    field("value", "number"),
    field("min", "number"),
    field("max", "number", { default: 1 }),
    field("low", "number"),
    field("high", "number"),
    field("optimum", "number"),
  ],
  data: [field("value", "string")],
  time: [field("datetime", "string")],
  slot: [field("name", "string")],
  a: [
    field("href", "string"),
    field("target", "enum", {
      options: ["_self", "_blank", "_parent", "_top"],
      default: "_self",
    }),
    field("rel", "string"),
  ],
  input: [
    field("type", "enum", {
      options: [
        "text",
        "email",
        "password",
        "number",
        "search",
        "tel",
        "url",
        "checkbox",
        "radio",
        "date",
        "time",
        "file",
        "hidden",
        "range",
        "color",
      ],
      default: "text",
    }),
    field("name", "string"),
    field("value", "string"),
    field("placeholder", "string"),
    field("required", "boolean", { default: false }),
    field("disabled", "boolean", { default: false }),
  ],
  textarea: [
    field("name", "string"),
    field("placeholder", "string"),
    field("rows", "number", { default: 2 }),
    field("required", "boolean", { default: false }),
    field("disabled", "boolean", { default: false }),
  ],
  select: [
    field("name", "string"),
    field("multiple", "boolean", { default: false }),
    field("required", "boolean", { default: false }),
    field("disabled", "boolean", { default: false }),
  ],
  form: [
    field("action", "string"),
    field("method", "enum", {
      options: ["get", "post", "dialog"],
      default: "get",
    }),
  ],
  img: [
    field("src", "string"),
    field("alt", "string"),
    field("width", "number"),
    field("height", "number"),
    field("loading", "enum", {
      options: ["eager", "lazy"],
      default: "eager",
    }),
  ],
  iframe: [
    field("src", "string"),
    field("title", "string"),
    field("loading", "enum", {
      options: ["eager", "lazy"],
      default: "eager",
    }),
  ],
  video: [
    field("src", "string"),
    field("controls", "boolean", { default: false }),
    field("autoplay", "boolean", { default: false }),
    field("loop", "boolean", { default: false }),
    field("muted", "boolean", { default: false }),
    field("poster", "string"),
  ],
  audio: [
    field("src", "string"),
    field("controls", "boolean", { default: false }),
    field("autoplay", "boolean", { default: false }),
    field("loop", "boolean", { default: false }),
    field("muted", "boolean", { default: false }),
  ],
  label: [field("for", "string")],
  ol: [
    field("type", "enum", {
      options: ["1", "a", "A", "i", "I"],
      default: "1",
    }),
    field("start", "number", { default: 1 }),
    field("reversed", "boolean", { default: false }),
  ],
  th: [
    field("scope", "enum", {
      options: ["col", "row", "colgroup", "rowgroup"],
    }),
    field("colspan", "number", { default: 1 }),
    field("rowspan", "number", { default: 1 }),
  ],
  td: [
    field("colspan", "number", { default: 1 }),
    field("rowspan", "number", { default: 1 }),
  ],
  source: [
    field("src", "string"),
    field("type", "string"),
    field("media", "string"),
  ],
  option: [
    field("value", "string"),
    field("disabled", "boolean", { default: false }),
  ],
};

/** Tag-specific attrs only (no globals). */
export function getElementSchema(tag: string): PropField[] {
  return TAG_SCHEMAS[String(tag).toLowerCase()] ?? [];
}

/**
 * Full element inspector schema: globals + tag-specific, de-duped by name
 * (tag-specific wins when both define the same attr).
 */
export function getElementPropsSchema(tag: string): PropField[] {
  const specific = getElementSchema(tag);
  const names = new Set(specific.map((f) => f.name));
  return [
    ...GLOBAL_ATTR_FIELDS.filter((f) => !names.has(f.name)),
    ...specific,
  ];
}

export const HTML_TAGS = [
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "audio",
  "b",
  "body",
  "blockquote",
  "br",
  "button",
  "canvas",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "data",
  "datalist",
  "dd",
  "del",
  "details",
  "dfn",
  "dialog",
  "div",
  "dl",
  "dt",
  "em",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "head",
  "hgroup",
  "hr",
  "html",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "link",
  "main",
  "mark",
  "meta",
  "menu",
  "meter",
  "nav",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "picture",
  "pre",
  "progress",
  "q",
  "s",
  "samp",
  "script",
  "section",
  "select",
  "small",
  "source",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "template",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "track",
  "u",
  "ul",
  "var",
  "video",
  "wbr",
] as const;

/**
 * Palette HTML primitives Aria cares about in Phase 7
 * (broader HTML_TAGS remain for inspector / autocomplete).
 */
export const PALETTE_HTML_TAGS = [
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
] as const;

export type PaletteHtmlTag = (typeof PALETTE_HTML_TAGS)[number];

/** Elements that can never hold children. */
export const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Inline (phrasing) tags — the only element content a heading, paragraph,
 * or other text-level container may hold.
 */
export const PHRASING_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "button",
  "cite",
  "code",
  "data",
  "datalist",
  "del",
  "dfn",
  "em",
  "i",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "mark",
  "meter",
  "output",
  "picture",
  "progress",
  "q",
  "ruby",
  "s",
  "samp",
  "select",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "svg",
  "textarea",
  "time",
  // Astro `<slot />` is allowed wherever text is (layout headings).
  "slot",
  "u",
  "var",
  "wbr",
]);

/** Parents whose content model is phrasing-only. */
const TEXT_ONLY_PARENTS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "span",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "small",
  "code",
  "kbd",
  "samp",
  "sub",
  "sup",
  "mark",
  "abbr",
  "cite",
  "q",
  "dfn",
  "label",
  "legend",
  "summary",
  "dt",
  "figcaption",
  "caption",
  "option",
  "textarea",
  "title",
]);

/** Parents that accept only a fixed set of children. */
const ONLY_CHILDREN: Record<string, string[] | null> = {
  ul: ["li", "script", "template"],
  ol: ["li", "script", "template"],
  menu: ["li", "script", "template"],
  dl: ["dt", "dd", "div", "script", "template"],
  table: [
    "caption",
    "colgroup",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "script",
    "template",
  ],
  thead: ["tr", "script", "template"],
  tbody: ["tr", "script", "template"],
  tfoot: ["tr", "script", "template"],
  tr: ["td", "th", "script", "template"],
  colgroup: ["col", "template"],
  select: ["option", "optgroup", "hr", "script", "template"],
  optgroup: ["option", "script", "template"],
  picture: ["source", "img"],
  video: ["source", "track"],
  audio: ["source", "track"],
  figure: null, // flow content
};

/**
 * Whether `childTag` is valid markup directly inside `parentTag`.
 * Unknown / custom tags are permitted (better to allow than block a valid page).
 * Components are opaque — callers should skip this check for them.
 */
export function canContainTag(
  parentTag: string | null | undefined,
  childTag: string | null | undefined,
): boolean {
  const child = String(childTag || "").toLowerCase();
  if (!child) return true;
  // Page / document root — same flow rules as a generic container (reject
  // orphaned list/table parts like a bare <li>).
  let parent = String(parentTag || "").toLowerCase();
  if (!parent) parent = "div";
  if (VOID_TAGS.has(parent)) return false;

  const only = ONLY_CHILDREN[parent];
  if (Array.isArray(only)) return only.includes(child);

  if (TEXT_ONLY_PARENTS.has(parent)) return PHRASING_TAGS.has(child);
  // An <a> may wrap flow content, but never another link or button.
  if (parent === "a") return child !== "a" && child !== "button";
  if (parent === "button") {
    return (
      PHRASING_TAGS.has(child) && child !== "button" && child !== "a"
    );
  }
  // Flow parents: list/table parts are out of place without their parent.
  return ![
    "li",
    "dt",
    "dd",
    "tr",
    "td",
    "th",
    "thead",
    "tbody",
    "tfoot",
    "option",
    "optgroup",
  ].includes(child);
}
