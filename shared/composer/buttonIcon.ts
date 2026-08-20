import { cloneNodeWithNewIds, type MutateResult } from "./mutate";
import { nodeAtMarkerPath } from "./paths";
import { parseStyleAttr, serializeStyleAttr, setStyleProp } from "./styleAttr";
import type { AstroDocumentModel, EditableNode, ElementNode, PropValue } from "./types";

export type NativeButtonIconSetting = "size" | "color" | "gap";
export type NativeButtonIconSide = "left" | "right";

export const NATIVE_BUTTON_ICON_CSS_PROPERTIES = {
  size: "--aria-button-icon-size",
  color: "--aria-button-icon-color",
  gap: "--aria-button-icon-gap",
} as const;

const SETTING_ATTRS: Record<NativeButtonIconSetting, string> = {
  size: "data-button-icon-size",
  color: "data-button-icon-color",
  gap: "data-button-icon-gap",
};

const MANAGED_LAYOUT_VALUES = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--aria-button-icon-gap, 0.5rem)",
  justifyContent: "space-between",
} as const;

function staticString(value: PropValue | undefined): string {
  return value?.type === "string" ? value.value : "";
}

export function isManagedNativeButtonIcon(node: EditableNode | null | undefined): node is ElementNode {
  return Boolean(
    node?.kind === "element"
    && staticString(node.props["data-aria-button-icon"]).toLowerCase() === "true",
  );
}

export function nativeButtonIconValue(node: EditableNode | null | undefined): string {
  if (!isManagedNativeButtonIcon(node)) return "";
  return staticString(node.props["data-aria-button-icon-value"])
    || staticString(node.props.class);
}

function iconSide(button: ElementNode): NativeButtonIconSide {
  return staticString(button.props["data-button-icon-position"]) === "right" ? "right" : "left";
}

function writeStaticStyle(node: ElementNode, styles: Record<string, string>): boolean {
  const current = node.props.style;
  if (current && current.type !== "string") return false;
  const value = serializeStyleAttr(styles);
  if (value) node.props.style = { type: "string", value };
  else delete node.props.style;
  return true;
}

function styleManagedIcon(icon: ElementNode, side: NativeButtonIconSide): boolean {
  const current = icon.props.style;
  if (current && current.type !== "string") return false;
  let styles = parseStyleAttr(staticString(current));
  styles = setStyleProp(styles, "display", "block");
  styles = setStyleProp(styles, "inline-size", "var(--aria-button-icon-size, 1em)");
  styles = setStyleProp(styles, "block-size", "var(--aria-button-icon-size, 1em)");
  styles = setStyleProp(styles, "flex", "none");
  styles = setStyleProp(styles, "color", "var(--aria-button-icon-color, currentColor)");
  styles = setStyleProp(styles, "order", side === "right" ? "1" : "-1");
  return writeStaticStyle(icon, styles);
}

function updateButtonLayout(button: ElementNode): boolean {
  const current = button.props.style;
  if (current && current.type !== "string") return false;
  let styles = parseStyleAttr(staticString(current));
  for (const setting of ["size", "color", "gap"] as const) {
    styles = setStyleProp(
      styles,
      NATIVE_BUTTON_ICON_CSS_PROPERTIES[setting],
      staticString(button.props[SETTING_ATTRS[setting]]) || null,
    );
  }
  styles = setStyleProp(styles, "display", MANAGED_LAYOUT_VALUES.display);
  styles = setStyleProp(styles, "align-items", MANAGED_LAYOUT_VALUES.alignItems);
  styles = setStyleProp(styles, "gap", MANAGED_LAYOUT_VALUES.gap);
  styles = setStyleProp(
    styles,
    "justify-content",
    button.props["data-button-icon-space-between"] != null
      ? MANAGED_LAYOUT_VALUES.justifyContent
      : null,
  );
  return writeStaticStyle(button, styles);
}

function nativeButtonAtPath(model: AstroDocumentModel, path: string): ElementNode | null {
  const node = nodeAtMarkerPath(model.nodes, path);
  return node?.kind === "element" && node.name.toLowerCase() === "button" ? node : null;
}

export function prepareManagedNativeButtonIcon(
  source: ElementNode,
  storedValue: string,
): ElementNode {
  const icon = cloneNodeWithNewIds(source) as ElementNode;
  icon.props["data-aria-button-icon"] = { type: "string", value: "true" };
  icon.props["data-aria-button-icon-value"] = { type: "string", value: storedValue };
  icon.props["aria-hidden"] = { type: "string", value: "true" };
  icon.props.focusable = { type: "string", value: "false" };
  delete icon.props.width;
  delete icon.props.height;
  styleManagedIcon(icon, "left");
  return icon;
}

export function setNativeButtonIconAtPath(
  model: AstroDocumentModel,
  path: string,
  source: ElementNode,
  storedValue: string,
): MutateResult {
  const button = nativeButtonAtPath(model, path);
  if (!button || !Array.isArray(button.children)) {
    return { ok: false, selectPath: path, reason: "A native button is required" };
  }
  if (source.props.style && source.props.style.type !== "string") {
    return { ok: false, selectPath: path, reason: "Button icon styles are expression-bound" };
  }
  if (!updateButtonLayout(button)) {
    return { ok: false, selectPath: path, reason: "Button styles are expression-bound" };
  }
  const side = iconSide(button);
  const icon = prepareManagedNativeButtonIcon(source, storedValue);
  styleManagedIcon(icon, side);
  const existingIndex = button.children.findIndex(isManagedNativeButtonIcon);
  if (existingIndex >= 0) button.children.splice(existingIndex, 1, icon);
  else if (side === "right") button.children.push(icon);
  else button.children.unshift(icon);
  return { ok: true, selectPath: path };
}

export function setNativeButtonIconSettingAtPath(
  model: AstroDocumentModel,
  path: string,
  setting: NativeButtonIconSetting,
  value: string,
): MutateResult {
  const button = nativeButtonAtPath(model, path);
  if (!button) return { ok: false, selectPath: path, reason: "A native button is required" };
  const current = button.props[SETTING_ATTRS[setting]];
  if (current && current.type !== "string") {
    return { ok: false, selectPath: path, reason: `Button icon ${setting} is expression-bound` };
  }
  if (button.props.style && button.props.style.type !== "string") {
    return { ok: false, selectPath: path, reason: "Button styles are expression-bound" };
  }
  const trimmed = value.trim();
  if (trimmed) button.props[SETTING_ATTRS[setting]] = { type: "string", value: trimmed };
  else delete button.props[SETTING_ATTRS[setting]];
  if (!updateButtonLayout(button)) {
    return { ok: false, selectPath: path, reason: "Button styles are expression-bound" };
  }
  return { ok: true, selectPath: path };
}

export function setNativeButtonIconSideAtPath(
  model: AstroDocumentModel,
  path: string,
  side: NativeButtonIconSide,
): MutateResult {
  const button = nativeButtonAtPath(model, path);
  if (!button || !Array.isArray(button.children)) {
    return { ok: false, selectPath: path, reason: "A native button is required" };
  }
  const current = button.props["data-button-icon-position"];
  if (current && current.type !== "string") {
    return { ok: false, selectPath: path, reason: "Button icon position is expression-bound" };
  }
  if (button.props.style && button.props.style.type !== "string") {
    return { ok: false, selectPath: path, reason: "Button styles are expression-bound" };
  }
  const icon = button.children.find(isManagedNativeButtonIcon);
  if (icon?.props.style && icon.props.style.type !== "string") {
    return { ok: false, selectPath: path, reason: "Button icon styles are expression-bound" };
  }
  button.props["data-button-icon-position"] = { type: "string", value: side };
  if (icon && !styleManagedIcon(icon, side)) {
    return { ok: false, selectPath: path, reason: "Button icon styles are expression-bound" };
  }
  if (!updateButtonLayout(button)) {
    return { ok: false, selectPath: path, reason: "Button styles are expression-bound" };
  }
  return { ok: true, selectPath: path };
}

export function setNativeButtonIconSpaceBetweenAtPath(
  model: AstroDocumentModel,
  path: string,
  enabled: boolean,
): MutateResult {
  const button = nativeButtonAtPath(model, path);
  if (!button) return { ok: false, selectPath: path, reason: "A native button is required" };
  const current = button.props["data-button-icon-space-between"];
  if (current && current.type !== "bare") {
    return { ok: false, selectPath: path, reason: "Button icon spacing is expression-bound" };
  }
  if (button.props.style && button.props.style.type !== "string") {
    return { ok: false, selectPath: path, reason: "Button styles are expression-bound" };
  }
  if (enabled) button.props["data-button-icon-space-between"] = { type: "bare" };
  else delete button.props["data-button-icon-space-between"];
  if (!updateButtonLayout(button)) {
    return { ok: false, selectPath: path, reason: "Button styles are expression-bound" };
  }
  return { ok: true, selectPath: path };
}

export function clearManagedNativeButtonIconAuthoring(button: ElementNode): void {
  for (const name of [
    "data-button-icon-position",
    "data-button-icon-gap",
    "data-button-icon-size",
    "data-button-icon-color",
    "data-button-icon-space-between",
  ]) delete button.props[name];
  if (Array.isArray(button.children)) {
    button.children = button.children.filter((child) => !isManagedNativeButtonIcon(child));
  }
  if (button.props.style?.type !== "string") return;
  let styles = parseStyleAttr(button.props.style.value);
  for (const property of Object.values(NATIVE_BUTTON_ICON_CSS_PROPERTIES)) {
    styles = setStyleProp(styles, property, null);
  }
  if (styles.display === MANAGED_LAYOUT_VALUES.display) styles = setStyleProp(styles, "display", null);
  if (styles["align-items"] === MANAGED_LAYOUT_VALUES.alignItems) styles = setStyleProp(styles, "align-items", null);
  if (styles.gap === MANAGED_LAYOUT_VALUES.gap) styles = setStyleProp(styles, "gap", null);
  if (styles["justify-content"] === MANAGED_LAYOUT_VALUES.justifyContent) {
    styles = setStyleProp(styles, "justify-content", null);
  }
  writeStaticStyle(button, styles);
}
