/**
 * Aria authoring primitives — factories that emit editable Astro elements.
 *
 * Not a DSL sidecar: output is plain HTML/Astro with `data-aria-type` for
 * Composer identity and BEM classes (`aria-card`) for Design-managed look.
 */

import {
  allocNodeId,
  insertNodeAt,
  parentAcceptsChildAtPath,
  type InsertTarget,
  type MutateResult,
} from "./mutate";
import type {
  AstroDocumentModel,
  AstroPropMap,
  CommentNode,
  EditableNode,
  ElementNode,
} from "./types";
import { createAlertPresetIcon } from "./alertIcon";

export const COMPOSER_BLOCK_IDS = [
  "section",
  "container",
  "div",
  "component",
  "heading",
  "text",
  "rich-text",
  "span",
  "quote",
  "accordion",
  "popover",
  "dialog",
  "datalist",
  "progress",
  "meter",
  "divider",
  "button",
  "image",
  "video",
  "embed",
  "icon",
  "icon-list",
  "svg",
  "list",
  "link",
  "code",
  "comment",
  "pagination",
  "navigation",
  "input",
  "textarea",
  "select",
  "checkbox",
  "radio",
  "field",
  "card",
  "alert",
  "badge",
  "avatar",
] as const;

export type ComposerBlockId = (typeof COMPOSER_BLOCK_IDS)[number];
export type AriaPrimitiveId = Exclude<ComposerBlockId, "component">;

const LEGACY_COMPOSER_IMAGE_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360" viewBox="0 0 720 360"><rect width="720" height="360" fill="#e2e8f0"/><g fill="none" stroke="#64748b" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"><rect x="180" y="70" width="360" height="220" rx="16"/><circle cx="285" cy="145" r="24"/><path d="m210 255 90-90 70 70 45-45 95 65"/></g></svg>`;

/** Previous portable placeholder, retained only to recognize existing documents. */
export const LEGACY_COMPOSER_IMAGE_PLACEHOLDER_SRC =
  `data:image/svg+xml,${encodeURIComponent(LEGACY_COMPOSER_IMAGE_PLACEHOLDER_SVG)}`;

const LEGACY_BRANDED_COMPOSER_IMAGE_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360" viewBox="0 0 720 360"><defs><linearGradient id="bg" x1="80" y1="24" x2="646" y2="344" gradientUnits="userSpaceOnUse"><stop stop-color="#1d2322"/><stop offset="1" stop-color="#101312"/></linearGradient><radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(360 181) rotate(90) scale(220 410)" gradientUnits="userSpaceOnUse"><stop stop-color="#0d8177" stop-opacity=".2"/><stop offset="1" stop-color="#0d8177" stop-opacity="0"/></radialGradient><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#0d8177" fill-opacity=".18"/></pattern><linearGradient id="line" x1="204" y1="245" x2="516" y2="140" gradientUnits="userSpaceOnUse"><stop stop-color="#f8faf9" stop-opacity=".72"/><stop offset="1" stop-color="#0d8177"/></linearGradient></defs><rect width="720" height="360" fill="url(#bg)"/><rect width="720" height="360" fill="url(#glow)"/><rect width="720" height="360" fill="url(#grid)"/><rect x="160" y="70" width="400" height="220" rx="26" fill="#fff" fill-opacity=".035" stroke="#fff" stroke-opacity=".14"/><circle cx="278" cy="148" r="24" fill="#0d8177"/><path d="m199 249 102-94 72 67 52-45 96 72" fill="none" stroke="url(#line)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><path d="M199 249h322" stroke="#fff" stroke-opacity=".12" stroke-width="2" stroke-linecap="round"/><g transform="translate(647 302) scale(.06)" opacity=".78"><path d="M61.602 546.656C144.565 458.574 176.166 423.577 322.784 288.125C358.41 255.214 392.285 230.583 362.055 245.65C322.969 265.131 322.817 264.127 282.698 281.291C229.619 304 205.128 317.391 214.291 303.547C227.713 283.261 357.626 45.156 369.932 22.599C377.043 9.566 382.533-8.695 389.631 4.672C415.058 52.543 570.781 328.056 569.82 333.589C568.644 340.365 500.896 353.775 351.965 444.444C180.172 549.034 113.982 619.192 94.337 619.31C4.735 619.851-.631 623.478.047 615.963C.178 614.516 53.792 555.022 61.602 546.656Z" fill="#fff"/><path d="M584.066 548.881C544.013 489.26 499.979 429.669 501.274 424.258C502.159 420.558 571.447 388.452 589.526 381.077C599.671 376.936 598.649 383.859 644.073 464.24C650.764 476.084 725.613 608.542 726.522 612.965C727.89 619.644 723.093 619.337 641.544 619.297C626.736 619.288 629.6 612.98 584.066 548.881Z" fill="#0d8177"/></g></svg>`;

/** Short-lived branded placeholder, retained to recognize existing documents. */
export const LEGACY_BRANDED_COMPOSER_IMAGE_PLACEHOLDER_SRC =
  `data:image/svg+xml,${encodeURIComponent(LEGACY_BRANDED_COMPOSER_IMAGE_PLACEHOLDER_SVG)}`;

const COMPOSER_IMAGE_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360" viewBox="0 0 720 360"><style>.surface{fill:oklch(0.94 0 0)}.mountain{stroke:oklch(0.38 0.016 145.14 / .4)}@media (prefers-color-scheme:dark){.surface{fill:oklch(0.269 0 0)}.mountain{stroke:oklch(0.8 0 0 / .4)}}</style><rect class="surface" width="720" height="360"/><path class="mountain" d="m199 249 102-94 72 67 52-45 96 72" fill="none" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Portable default shown until a newly inserted image is connected to media. */
export const COMPOSER_IMAGE_PLACEHOLDER_SRC =
  `data:image/svg+xml,${encodeURIComponent(COMPOSER_IMAGE_PLACEHOLDER_SVG)}`;

export const ARIA_PRIMITIVE_IDS = COMPOSER_BLOCK_IDS.filter(
  (id): id is AriaPrimitiveId => id !== "component",
);

export type BlockDefinition = {
  id: ComposerBlockId;
  /** Root HTML tag — used for containment checks on insert / DnD. */
  rootTag: string | null;
  /** Palette display name. */
  label: string;
  category:
    | "container"
    | "content"
    | "interactive"
    | "media"
    | "navigation"
    | "form"
    | "display"
    | "project";
  /** Component is represented by the scanned project component inventory. */
  projectComponent?: boolean;
  inspector: readonly (
    | "content"
    | "typography"
    | "media"
    | "link"
    | "layout"
    | "code"
    | "svg"
  )[];
};

export type AriaPalettePrimitive = BlockDefinition & {
  id: AriaPrimitiveId;
  rootTag: string | null;
  /** Backward-compatible containment alias. */
  tag: string | null;
};

/** Central Composer block registry. Factories emit clean Astro/HTML nodes. */
export const BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  { id: "section", rootTag: "section", label: "Section", category: "container", inspector: ["layout"] },
  { id: "container", rootTag: "div", label: "Container", category: "container", inspector: ["layout"] },
  { id: "div", rootTag: "div", label: "Div", category: "container", inspector: ["layout"] },
  { id: "component", rootTag: null, label: "Component", category: "project", projectComponent: true, inspector: ["content", "layout"] },
  { id: "heading", rootTag: "h2", label: "Heading", category: "content", inspector: ["content", "typography"] },
  { id: "text", rootTag: "p", label: "Text", category: "content", inspector: ["content", "typography"] },
  { id: "rich-text", rootTag: "div", label: "Rich Text", category: "content", inspector: ["content", "typography", "layout"] },
  { id: "span", rootTag: "span", label: "Span", category: "content", inspector: ["content", "typography", "layout"] },
  { id: "quote", rootTag: "blockquote", label: "Quote", category: "content", inspector: ["content", "typography", "layout"] },
  { id: "accordion", rootTag: "details", label: "Accordion", category: "interactive", inspector: ["content", "layout"] },
  { id: "popover", rootTag: "div", label: "Popover", category: "interactive", inspector: ["content", "layout"] },
  { id: "dialog", rootTag: "div", label: "Dialog", category: "interactive", inspector: ["content", "layout"] },
  { id: "datalist", rootTag: "div", label: "Datalist", category: "interactive", inspector: ["content", "layout"] },
  { id: "progress", rootTag: "progress", label: "Progress", category: "interactive", inspector: ["content", "layout"] },
  { id: "meter", rootTag: "meter", label: "Meter", category: "interactive", inspector: ["content", "layout"] },
  { id: "divider", rootTag: "hr", label: "Divider", category: "content", inspector: ["layout"] },
  { id: "button", rootTag: "button", label: "Button", category: "content", inspector: ["content", "typography", "link"] },
  { id: "image", rootTag: "img", label: "Image", category: "media", inspector: ["media"] },
  { id: "video", rootTag: "video", label: "Video", category: "media", inspector: ["media"] },
  { id: "embed", rootTag: "iframe", label: "Embed", category: "media", inspector: ["media", "layout"] },
  { id: "icon", rootTag: "svg", label: "Icon", category: "media", inspector: ["svg"] },
  { id: "icon-list", rootTag: "ul", label: "Icon List", category: "content", inspector: ["content", "typography"] },
  { id: "svg", rootTag: "svg", label: "SVG", category: "media", inspector: ["svg"] },
  { id: "list", rootTag: "ul", label: "List", category: "content", inspector: ["content", "typography"] },
  { id: "link", rootTag: "a", label: "Link", category: "content", inspector: ["content", "typography", "link"] },
  { id: "code", rootTag: "pre", label: "Code", category: "content", inspector: ["code", "typography"] },
  { id: "comment", rootTag: null, label: "Comment", category: "content", inspector: ["code"] },
  { id: "pagination", rootTag: "nav", label: "Pagination", category: "navigation", inspector: ["content", "layout"] },
  { id: "navigation", rootTag: "nav", label: "Navigation", category: "navigation", inspector: ["content", "layout"] },
  { id: "input", rootTag: "div", label: "Input", category: "form", inspector: ["content", "layout"] },
  { id: "textarea", rootTag: "div", label: "Textarea", category: "form", inspector: ["content", "layout"] },
  { id: "select", rootTag: "div", label: "Select", category: "form", inspector: ["content", "layout"] },
  { id: "checkbox", rootTag: "div", label: "Checkbox", category: "form", inspector: ["content", "layout"] },
  { id: "radio", rootTag: "div", label: "Radio", category: "form", inspector: ["content", "layout"] },
  { id: "field", rootTag: "div", label: "Field", category: "form", inspector: ["content", "layout"] },
  { id: "card", rootTag: "article", label: "Card", category: "display", inspector: ["content", "layout"] },
  { id: "alert", rootTag: "div", label: "Alert", category: "display", inspector: ["content", "layout"] },
  { id: "badge", rootTag: "span", label: "Badge", category: "display", inspector: ["content", "typography"] },
  { id: "avatar", rootTag: "span", label: "Avatar", category: "display", inspector: ["media"] },
] as const;

/** Palette group “Aria”; project components render from the scan inventory. */
export const ARIA_PALETTE_PRIMITIVES: readonly AriaPalettePrimitive[] =
  BLOCK_DEFINITIONS.filter(
    (definition): definition is BlockDefinition & { id: AriaPrimitiveId } =>
      !definition.projectComponent,
  ).map((definition) => ({ ...definition, tag: definition.rootTag }));

export function isAriaPrimitiveId(value: string): value is AriaPrimitiveId {
  return (ARIA_PRIMITIVE_IDS as readonly string[]).includes(value);
}

export function ariaPrimitiveDef(
  id: AriaPrimitiveId,
): AriaPalettePrimitive | undefined {
  return ARIA_PALETTE_PRIMITIVES.find((p) => p.id === id);
}

export function composerBlockDef(
  id: ComposerBlockId,
): BlockDefinition | undefined {
  return BLOCK_DEFINITIONS.find((definition) => definition.id === id);
}

function strProp(value: string) {
  return { type: "string" as const, value };
}

function linkedElementId(name: string): string {
  return `aria-${name}-${allocNodeId()}`;
}

function textChild(value: string): ElementNode["children"] {
  return [{ id: allocNodeId(), kind: "text", value }];
}

function element(
  name: string,
  options: {
    props?: AstroPropMap;
    children?: EditableNode[] | null;
  } = {},
): ElementNode {
  return {
    id: allocNodeId(),
    kind: "element",
    name,
    props: options.props ?? {},
    children: options.children === undefined ? [] : options.children,
  };
}

function textElement(name: string, value: string, props?: AstroPropMap) {
  return element(name, { props, children: textChild(value) });
}

function classProp(...tokens: string[]) {
  return strProp(tokens.join(" "));
}

function labeledField(options: {
  label: string;
  hint?: string;
  check?: boolean;
  control: ElementNode;
}): ElementNode {
  const fieldId = linkedElementId("field");
  const control: ElementNode = {
    ...options.control,
    props: {
      ...options.control.props,
      id: strProp(fieldId),
    },
  };
  const label = textElement("label", options.label, {
    class: classProp("aria-field__label"),
    for: strProp(fieldId),
  });
  const children: EditableNode[] = options.check
    ? [control, label]
    : [label, control];
  if (options.hint) {
    children.push(
      textElement("p", options.hint, { class: classProp("aria-field__hint") }),
    );
  }
  return element("div", {
    props: {
      "data-aria-type": strProp("Field"),
      class: classProp(
        "aria-field",
        ...(options.check ? ["aria-field--check"] : []),
      ),
    },
    children,
  });
}

function listItem(value: string, icon = false): ElementNode {
  const children: EditableNode[] = [];
  if (icon) {
    children.push(
      textElement("span", "✓", { "aria-hidden": strProp("true") }),
    );
  }
  children.push(textElement("span", value));
  return element("li", { children });
}

function inlineSvg(type: "Icon" | "SVG"): ElementNode {
  return element("svg", {
    props: {
      "data-aria-type": strProp(type),
      viewBox: strProp("0 0 24 24"),
      fill: strProp("none"),
      stroke: strProp("currentColor"),
      "stroke-width": strProp("2"),
      "aria-hidden": strProp("true"),
    },
    children: [
      element("path", {
        props: {
          d: strProp(
            type === "Icon"
              ? "M12 3v18M3 12h18"
              : "M4 4h16v16H4z",
          ),
        },
        children: null,
      }),
    ],
  });
}

/**
 * Build an editable node tree for an Aria palette primitive.
 * Section includes an optional Container child for Design content max-width.
 */
type ElementAriaPrimitiveId = Exclude<AriaPrimitiveId, "comment">;

export function createAriaPrimitiveNode(id: "comment"): CommentNode;
export function createAriaPrimitiveNode(id: ElementAriaPrimitiveId): ElementNode;
export function createAriaPrimitiveNode(id: AriaPrimitiveId): ElementNode | CommentNode;
export function createAriaPrimitiveNode(id: AriaPrimitiveId): ElementNode | CommentNode {
  switch (id) {
    case "section":
      return element("section", {
        props: { "data-aria-type": strProp("Section") },
        children: [createAriaPrimitiveNode("container")],
      });
    case "container":
      return element("div", {
        props: { "data-aria-type": strProp("Container") },
        children: [],
      });
    case "div":
      return element("div");
    case "heading":
      return textElement("h2", "Heading");
    case "text":
      return textElement("p", "Text");
    case "rich-text":
      return element("div", {
        props: { "data-aria-type": strProp("RichText") },
        children: [textElement("p", "Rich text")],
      });
    case "span":
      return textElement("span", "Span");
    case "quote":
      return element("blockquote", {
        children: [
          textElement("p", "Quote"),
          textElement("cite", "Source"),
        ],
      });
    case "accordion":
      return element("details", {
        props: { open: { type: "bare" } },
        children: [
          textElement("summary", "Question"),
          textElement("p", "Answer"),
        ],
      });
    case "popover": {
      const popoverId = linkedElementId("popover");
      const titleId = linkedElementId("popover-title");
      return element("div", {
        children: [
          textElement("button", "Open popover", {
            type: strProp("button"),
            popovertarget: strProp(popoverId),
            "data-button-variant": strProp("primary"),
          }),
          element("div", {
            props: {
              id: strProp(popoverId),
              popover: { type: "bare" },
              "aria-labelledby": strProp(titleId),
              style: strProp("inset: auto; margin: 0.75rem; position-area: block-end span-inline-end; position-try-fallbacks: flip-block, flip-inline; width: min(24rem, calc(100vw - 2rem)); padding: 1rem; color: CanvasText; background: Canvas; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 0.75rem; box-shadow: 0 1rem 2.5rem color-mix(in srgb, CanvasText 18%, transparent)"),
            },
            children: [
              textElement("h2", "Popover title", {
                id: strProp(titleId),
                style: strProp("margin: 0 0 0.5rem; font: inherit; font-size: 1.125rem; font-weight: 600"),
              }),
              textElement("p", "Add helpful content, links, or actions here.", {
                style: strProp("margin: 0 0 1rem; line-height: 1.5"),
              }),
              textElement("button", "Close", {
                type: strProp("button"),
                popovertarget: strProp(popoverId),
                popovertargetaction: strProp("hide"),
                "data-button-variant": strProp("secondary"),
              }),
            ],
          }),
        ],
      });
    }
    case "dialog": {
      const dialogId = linkedElementId("dialog");
      return element("div", {
        children: [
          textElement("button", "Open dialog", {
            type: strProp("button"),
            command: strProp("show-modal"),
            commandfor: strProp(dialogId),
          }),
          element("dialog", {
            props: { id: strProp(dialogId) },
            children: [
              textElement("h2", "Dialog title"),
              textElement("p", "Dialog content"),
              element("form", {
                props: { method: strProp("dialog") },
                children: [
                  textElement("button", "Close", {
                    type: strProp("submit"),
                  }),
                ],
              }),
            ],
          }),
        ],
      });
    }
    case "datalist": {
      const inputId = linkedElementId("datalist-input");
      const listId = linkedElementId("datalist-options");
      return element("div", {
        children: [
          textElement("label", "Choose an option", {
            for: strProp(inputId),
          }),
          element("input", {
            props: {
              id: strProp(inputId),
              type: strProp("text"),
              list: strProp(listId),
            },
            children: null,
          }),
          element("datalist", {
            props: { id: strProp(listId) },
            children: [
              element("option", {
                props: { value: strProp("First option") },
                children: textChild("First option"),
              }),
              element("option", {
                props: { value: strProp("Second option") },
                children: textChild("Second option"),
              }),
            ],
          }),
        ],
      });
    }
    case "progress":
      return element("progress", {
        props: { value: strProp("50"), max: strProp("100") },
        children: textChild("50%"),
      });
    case "meter":
      return element("meter", {
        props: {
          min: strProp("0"),
          max: strProp("100"),
          value: strProp("50"),
        },
        children: textChild("50 out of 100"),
      });
    case "divider":
      return element("hr", { children: null });
    case "button":
      return textElement("button", "Button", {
        type: strProp("button"),
        "data-button-variant": strProp("primary"),
      });
    case "image":
      return element("img", {
        props: {
          src: strProp(COMPOSER_IMAGE_PLACEHOLDER_SRC),
          alt: strProp(""),
          loading: strProp("lazy"),
        },
        children: null,
      });
    case "video":
      return element("video", {
        props: { controls: { type: "bare" }, preload: strProp("metadata") },
        children: [],
      });
    case "embed":
      return element("iframe", {
        props: {
          src: strProp("about:blank"),
          title: strProp("Embedded content"),
          loading: strProp("lazy"),
        },
        children: [],
      });
    case "icon":
      return inlineSvg("Icon");
    case "icon-list":
      return element("ul", {
        props: { "data-aria-type": strProp("IconList") },
        children: [
          listItem("First item", true),
          listItem("Second item", true),
          listItem("Third item", true),
        ],
      });
    case "svg":
      return inlineSvg("SVG");
    case "list":
      return element("ul", {
        children: [
          textElement("li", "First item"),
          textElement("li", "Second item"),
          textElement("li", "Third item"),
        ],
      });
    case "link":
      return textElement("a", "Link", { href: strProp("/") });
    case "code":
      return element("pre", {
        children: [textElement("code", "const example = true;")],
      });
    case "comment":
      return {
        id: allocNodeId(),
        kind: "comment",
        value: " Comment ",
      };
    case "pagination":
      return element("nav", {
        props: {
          "aria-label": strProp("Pagination"),
          "data-aria-type": strProp("Pagination"),
        },
        children: [
          textElement("a", "Previous", { href: strProp("?page=1") }),
          textElement("a", "1", {
            href: strProp("?page=1"),
            "aria-current": strProp("page"),
          }),
          textElement("a", "2", { href: strProp("?page=2") }),
          textElement("a", "Next", { href: strProp("?page=2") }),
        ],
      });
    case "navigation":
      return element("nav", {
        props: {
          "aria-label": strProp("Main navigation"),
          "data-aria-type": strProp("Navigation"),
        },
        children: [
          element("ul", {
            children: [
              element("li", {
                children: [textElement("a", "Home", { href: strProp("/") })],
              }),
              element("li", {
                children: [
                  textElement("a", "About", { href: strProp("/about") }),
                ],
              }),
            ],
          }),
        ],
      });
    case "input":
      return labeledField({
        label: "Label",
        control: element("input", {
          props: { type: strProp("text") },
          children: null,
        }),
      });
    case "textarea":
      return labeledField({
        label: "Label",
        control: element("textarea", {
          props: { rows: strProp("3") },
          children: [],
        }),
      });
    case "select":
      return labeledField({
        label: "Label",
        control: element("select", {
          children: [
            textElement("option", "First option", { value: strProp("first") }),
            textElement("option", "Second option", { value: strProp("second") }),
          ],
        }),
      });
    case "checkbox":
      return labeledField({
        label: "Label",
        check: true,
        control: element("input", {
          props: { type: strProp("checkbox") },
          children: null,
        }),
      });
    case "radio": {
      const group = linkedElementId("radio");
      return labeledField({
        label: "Label",
        check: true,
        control: element("input", {
          props: { type: strProp("radio"), name: strProp(group) },
          children: null,
        }),
      });
    }
    case "field":
      return labeledField({
        label: "Label",
        hint: "Hint",
        control: element("input", {
          props: { type: strProp("text") },
          children: null,
        }),
      });
    case "card":
      return element("article", {
        props: {
          "data-aria-type": strProp("Card"),
          class: classProp("aria-card"),
        },
        children: [
          element("div", {
            props: { class: classProp("aria-card__media") },
            children: [
              element("img", {
                props: {
                  src: strProp(COMPOSER_IMAGE_PLACEHOLDER_SRC),
                  alt: strProp(""),
                  loading: strProp("lazy"),
                },
                children: null,
              }),
            ],
          }),
          element("header", {
            props: { class: classProp("aria-card__header") },
            children: [textElement("h3", "Card title")],
          }),
          element("div", {
            props: { class: classProp("aria-card__body") },
            children: [textElement("p", "Card body")],
          }),
          element("div", {
            props: { class: classProp("aria-card__actions") },
            children: [
              textElement("button", "Action", {
                type: strProp("button"),
                "data-button-variant": strProp("primary"),
              }),
            ],
          }),
        ],
      });
    case "alert":
      return element("div", {
        props: {
          "data-aria-type": strProp("Alert"),
          class: classProp("aria-alert", "aria-alert--info"),
          role: strProp("status"),
        },
        children: [
          createAlertPresetIcon("info"),
          textElement("p", "Alert title", { class: classProp("aria-alert__title") }),
          textElement("p", "Alert message", { class: classProp("aria-alert__body") }),
        ],
      });
    case "badge":
      return textElement("span", "Badge", {
        "data-aria-type": strProp("Badge"),
        class: classProp("aria-badge"),
      });
    case "avatar":
      return element("span", {
        props: {
          "data-aria-type": strProp("Avatar"),
          class: classProp("aria-avatar"),
        },
        children: [
          element("img", {
            props: {
              class: classProp("aria-avatar__image"),
              src: strProp(COMPOSER_IMAGE_PLACEHOLDER_SRC),
              alt: strProp(""),
            },
            children: null,
          }),
          textElement("span", "AA", {
            class: classProp("aria-avatar__fallback"),
            "aria-hidden": strProp("true"),
          }),
        ],
      });
    default: {
      const _exhaustive: never = id;
      throw new Error(`Unknown Aria primitive: ${String(_exhaustive)}`);
    }
  }
}

/** Insert an Aria primitive at `target` (containment uses the root HTML tag). */
export function insertAriaPrimitiveAt(
  model: AstroDocumentModel,
  id: AriaPrimitiveId,
  target: InsertTarget,
): MutateResult {
  const def = ariaPrimitiveDef(id);
  const childTag = def ? def.tag : "div";
  if (!parentAcceptsChildAtPath(model, target.parentPath, childTag)) {
    return {
      ok: false,
      selectPath: null,
      reason: "Invalid containment for insert target",
    };
  }
  const result = insertNodeAt(model, createAriaPrimitiveNode(id), target);
  if (result.ok && result.selectPath && id === "popover") {
    result.selectPath = `${result.selectPath}.1`;
  }
  return result;
}

export type BlankPageAstroOptions = {
  /** Frontmatter import line(s), e.g. `import '../styles/global.css';\\n`. */
  styleImport?: string;
  /**
   * When true (default), body contains one Section + Container so Design
   * managed CSS and Composer inserts have an editable scaffold.
   */
  withAriaScaffold?: boolean;
};

/**
 * Clean Astro source for a new Studio page — optimized for editable coverage.
 * Still plain `.astro` (no `.aria/composer/*.json` sidecar).
 */
export function blankPageAstroSource(
  options: BlankPageAstroOptions = {},
): string {
  const withScaffold = options.withAriaScaffold !== false;
  const styleImport = options.styleImport ?? "";
  const body = withScaffold
    ? `  <body>
    <section data-aria-type="Section">
      <div data-aria-type="Container"></div>
    </section>
  </body>`
    : `  <body></body>`;

  return `---
${styleImport}---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title></title>
  </head>
${body}
</html>
`;
}
