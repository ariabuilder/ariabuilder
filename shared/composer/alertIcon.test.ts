import { describe, expect, it } from "vitest";
import {
  ARIA_ALERT_ICON_ATTR,
  applyComposerIconElement,
  createAlertPresetIcon,
  isManagedAlertPresetIcon,
  setAlertIconChoice,
  syncAlertPresetIcon,
} from "./alertIcon";
import type { ElementNode } from "./types";

function alertShell(icon: ElementNode): ElementNode {
  return {
    id: "alert",
    kind: "element",
    name: "div",
    props: {
      "data-aria-type": { type: "string", value: "Alert" },
      class: { type: "string", value: "aria-alert aria-alert--info" },
    },
    children: [icon],
  };
}

describe("alertIcon", () => {
  it("creates a decorative SVG preset icon", () => {
    const icon = createAlertPresetIcon("info");
    expect(icon.name).toBe("svg");
    expect(icon.props.class).toEqual({ type: "string", value: "aria-alert__icon" });
    expect(icon.props[ARIA_ALERT_ICON_ATTR]).toEqual({ type: "string", value: "info" });
    expect(icon.props["aria-hidden"]).toEqual({ type: "string", value: "true" });
    expect(icon.props.width).toEqual({ type: "string", value: "18" });
    expect(icon.props.height).toEqual({ type: "string", value: "18" });
    expect(isManagedAlertPresetIcon(icon)).toBe(true);
  });

  it("replaces a managed preset icon when the alert variant changes", () => {
    const alert = alertShell(createAlertPresetIcon("info"));
    syncAlertPresetIcon(alert, "warning");
    const icon = alert.children?.[0];
    expect(icon?.kind === "element" ? icon.props[ARIA_ALERT_ICON_ATTR] : null).toEqual({
      type: "string",
      value: "warning",
    });
  });

  it("leaves a custom icon alone when the variant changes", () => {
    const custom: ElementNode = {
      id: "custom",
      kind: "element",
      name: "span",
      props: {
        "data-aria-type": { type: "string", value: "Icon" },
        class: { type: "string", value: "aria-alert__icon i-lucide:star" },
      },
      children: [],
    };
    const alert = alertShell(custom);
    syncAlertPresetIcon(alert, "danger");
    expect(alert.children?.[0]).toBe(custom);
  });

  it("keeps the BEM element class when the icon picker rewrites the node", () => {
    const icon = createAlertPresetIcon("info");
    applyComposerIconElement(icon, "i-lucide:bell");
    expect(icon.name).toBe("span");
    expect(icon.props.class).toEqual({
      type: "string",
      value: "aria-alert__icon i-lucide:bell",
    });
    expect(icon.props[ARIA_ALERT_ICON_ATTR]).toBeUndefined();
  });

  it("adds or removes the alert icon from the wrapper", () => {
    const alert = alertShell(createAlertPresetIcon("info"));
    setAlertIconChoice(alert, "i-lucide:sparkles");
    const icon = alert.children?.[0];
    expect(icon?.kind === "element" ? icon.props.class : null).toEqual({
      type: "string",
      value: "aria-alert__icon i-lucide:sparkles",
    });
    setAlertIconChoice(alert, "");
    expect(alert.children).toEqual([]);
  });
});
