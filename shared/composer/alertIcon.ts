import { isAriaBemBlockClass, isAriaBemElementClass } from "./ariaBem";
import { joinClassNames, splitClassNames } from "./classAttr";
import { allocNodeId } from "./mutate";
import type { AstroPropMap, ElementNode, PropValue } from "./types";

export const ARIA_ALERT_ICON_ATTR = "data-aria-alert-icon";
export const ARIA_ALERT_ICON_CLASS = "aria-alert__icon";

export const ARIA_ALERT_PRESETS = ["info", "success", "warning", "danger"] as const;
export type AriaAlertPreset = (typeof ARIA_ALERT_PRESETS)[number];

type SvgShape = {
  name: "circle" | "path";
  props: AstroPropMap;
};

function str(value: string): PropValue {
  return { type: "string", value };
}

function classTokens(node: ElementNode): string[] {
  const value = node.props.class;
  return value?.type === "string" ? splitClassNames(value.value) : [];
}

function propString(node: ElementNode, name: string): string {
  const value = node.props[name];
  return value?.type === "string" ? value.value : "";
}

function svgChild(shape: SvgShape): ElementNode {
  return {
    id: allocNodeId(),
    kind: "element",
    name: shape.name,
    props: shape.props,
    children: null,
  };
}

const PRESET_SHAPES: Record<AriaAlertPreset, readonly SvgShape[]> = {
  info: [
    { name: "circle", props: { cx: str("12"), cy: str("12"), r: str("10") } },
    { name: "path", props: { d: str("M12 16v-4") } },
    { name: "path", props: { d: str("M12 8h.01") } },
  ],
  success: [
    { name: "circle", props: { cx: str("12"), cy: str("12"), r: str("10") } },
    { name: "path", props: { d: str("m9 12 2 2 4-4") } },
  ],
  warning: [
    { name: "path", props: { d: str("m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3") } },
    { name: "path", props: { d: str("M12 9v4") } },
    { name: "path", props: { d: str("M12 17h.01") } },
  ],
  danger: [
    { name: "circle", props: { cx: str("12"), cy: str("12"), r: str("10") } },
    { name: "path", props: { d: str("M12 8v4") } },
    { name: "path", props: { d: str("M12 16h.01") } },
  ],
};

export function isAriaAlertPreset(value: string | null | undefined): value is AriaAlertPreset {
  return Boolean(value && (ARIA_ALERT_PRESETS as readonly string[]).includes(value));
}

export function isAlertIconElement(node: ElementNode): boolean {
  return classTokens(node).includes(ARIA_ALERT_ICON_CLASS);
}

export function isManagedAlertPresetIcon(node: ElementNode): boolean {
  return isAlertIconElement(node) && isAriaAlertPreset(propString(node, ARIA_ALERT_ICON_ATTR));
}

export function alertIconChild(alert: ElementNode): { node: ElementNode; index: number } | null {
  const children = alert.children ?? [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child?.kind === "element" && isAlertIconElement(child)) {
      return { node: child, index };
    }
  }
  return null;
}

export function createAlertPresetIcon(preset: AriaAlertPreset): ElementNode {
  return {
    id: allocNodeId(),
    kind: "element",
    name: "svg",
    props: {
      "data-aria-type": str("Icon"),
      class: str(ARIA_ALERT_ICON_CLASS),
      [ARIA_ALERT_ICON_ATTR]: str(preset),
      viewBox: str("0 0 24 24"),
      width: str("18"),
      height: str("18"),
      fill: str("none"),
      stroke: str("currentColor"),
      "stroke-width": str("2"),
      "stroke-linecap": str("round"),
      "stroke-linejoin": str("round"),
      "aria-hidden": str("true"),
    },
    children: PRESET_SHAPES[preset].map(svgChild),
  };
}

const ICON_OWNED_PROPS = [
  "class", "src", "alt", "role", "aria-label", "aria-hidden",
  "viewBox", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "focusable", "width", "height", ARIA_ALERT_ICON_ATTR,
] as const;

function retainedBemClass(node: ElementNode): string[] {
  return classTokens(node).filter((name) => isAriaBemElementClass(name) || isAriaBemBlockClass(name));
}

/** Rewrite an Icon element from the picker without dropping BEM element classes. */
export function applyComposerIconElement(node: ElementNode, value: string): void {
  const bem = retainedBemClass(node);
  const ariaLabel = node.props["aria-label"];
  const retained: AstroPropMap = { ...node.props };
  for (const name of ICON_OWNED_PROPS) delete retained[name];
  if (value.startsWith("/")) {
    node.name = "img";
    node.props = {
      ...retained,
      "data-aria-type": str("Icon"),
      ...(bem.length ? { class: str(joinClassNames(bem)) } : {}),
      src: str(value),
      alt: ariaLabel ?? str(""),
    };
    node.children = null;
    return;
  }
  node.name = "span";
  node.props = {
    ...retained,
    "data-aria-type": str("Icon"),
    ...(joinClassNames([...bem, value])
      ? { class: str(joinClassNames([...bem, value])) }
      : {}),
    role: str("img"),
    "aria-label": ariaLabel ?? str("Icon"),
  };
  node.children = [];
}

export function syncAlertPresetIcon(alert: ElementNode, preset: string): void {
  if (!isAriaAlertPreset(preset) || !Array.isArray(alert.children)) return;
  const found = alertIconChild(alert);
  if (!found || !isManagedAlertPresetIcon(found.node)) return;
  const next = createAlertPresetIcon(preset);
  next.id = found.node.id;
  alert.children[found.index] = next;
}

export function setAlertIconChoice(alert: ElementNode, value: string): void {
  if (!Array.isArray(alert.children)) alert.children = [];
  const trimmed = value.trim();
  const found = alertIconChild(alert);
  if (!trimmed) {
    if (found) alert.children.splice(found.index, 1);
    return;
  }
  let icon = found?.node;
  if (!icon) {
    icon = {
      id: allocNodeId(),
      kind: "element",
      name: "span",
      props: {
        "data-aria-type": str("Icon"),
        class: str(ARIA_ALERT_ICON_CLASS),
        "aria-hidden": str("true"),
      },
      children: [],
    };
    alert.children.unshift(icon);
  }
  applyComposerIconElement(icon, trimmed);
  const names = classTokens(icon);
  if (!names.includes(ARIA_ALERT_ICON_CLASS)) {
    icon.props.class = str(joinClassNames([ARIA_ALERT_ICON_CLASS, ...names]));
  }
  icon.props["aria-hidden"] = str("true");
  delete icon.props["aria-label"];
}

export function alertIconDisplayValue(node: ElementNode | null | undefined): string {
  if (!node) return "";
  const preset = propString(node, ARIA_ALERT_ICON_ATTR);
  if (preset) return preset;
  const src = propString(node, "src");
  if (src) return src;
  return classTokens(node).find((name) => name.startsWith("i-")) ?? "";
}
