import { describe, expect, it } from "vitest";
import { parseAstro } from "./parseAstro";
import { nodeAtMarkerPath } from "./paths";
import {
  applyNodeMotion,
  documentHasMotion,
  MOTION_PRESETS,
  parseNodeMotion,
  type NodeMotion,
} from "./motion";

async function element(source: string) {
  const parsed = await parseAstro(`---\n---\n${source}`);
  expect(parsed.editable).toBe(true);
  if (!parsed.editable) throw new Error("not editable");
  const node = nodeAtMarkerPath(parsed.model.nodes, "0");
  if (!node || node.kind !== "element") throw new Error("not an element");
  return { model: parsed.model, node };
}

describe("Composer motion attributes", () => {
  it("round trips every standard preset without replacing unrelated source", async () => {
    for (const preset of MOTION_PRESETS) {
      const { node } = await element('<div class="card" data-test="yes">Card</div>');
      expect(applyNodeMotion(node, preset.motion)).toEqual({ ok: true });
      const parsed = parseNodeMotion(node.props);
      expect(parsed.enabled).toBe(true);
      expect(parsed.effects).toEqual(preset.motion.effects);
      expect(parsed.trigger).toBe(preset.motion.trigger);
      expect(parsed.preset).toBe(preset.id);
      expect(node.props["data-test"]).toEqual({ type: "string", value: "yes" });
      expect(node.props.class?.type).toBe("string");
      expect(node.props.class?.type === "string" && node.props.class.value).toContain("card");
    }
  });

  it("preserves dynamic class:list entries and removes only owned tokens", async () => {
    const { node } = await element('<div class:list={[active && "active", "card"]}>Card</div>');
    const motion: NodeMotion = {
      enabled: true,
      effects: ["fade", "slide-up"],
      trigger: "scrub",
      scrub: { travel: 320 },
      speed: 450,
    };
    expect(applyNodeMotion(node, motion).ok).toBe(true);
    expect(node.props["class:list"]?.type).toBe("expr");
    expect(node.props["class:list"]?.type === "expr" && node.props["class:list"].value).toContain("active &&");
    expect(parseNodeMotion(node.props).scrub?.travel).toBe(320);
    expect(applyNodeMotion(node, { ...motion, enabled: false }).ok).toBe(true);
    const value = node.props["class:list"];
    expect(value?.type === "expr" && value.value).toContain("card");
    expect(value?.type === "expr" && value.value).not.toContain("aria-motion");
  });

  it("rejects unsafe class expressions", async () => {
    const { node } = await element('<div class={computeClasses()}>Card</div>');
    const result = applyNodeMotion(node, MOTION_PRESETS[0]!.motion);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/class:list/);
  });

  it("removes owned numeric timing variables without touching other styles", async () => {
    const { node } = await element('<div style="color: red">Card</div>');
    const motion: NodeMotion = {
      enabled: true,
      effects: ["fade"],
      trigger: "reveal",
      speed: 425,
      delay: 75,
    };
    expect(applyNodeMotion(node, motion).ok).toBe(true);
    expect(node.props.style?.type === "string" && node.props.style.value).toContain("--aria-motion-duration: 425ms");
    expect(applyNodeMotion(node, { ...motion, enabled: false }).ok).toBe(true);
    expect(node.props.style).toEqual({ type: "string", value: "color: red" });
  });

  it("detects nested motion and clears the last enabled node", async () => {
    const { model, node } = await element('<section><div>Card</div></section>');
    const child = node.children?.[0];
    if (!child || child.kind !== "element") throw new Error("missing child");
    applyNodeMotion(child, MOTION_PRESETS[1]!.motion);
    expect(documentHasMotion(model)).toBe(true);
    applyNodeMotion(child, { ...MOTION_PRESETS[1]!.motion, enabled: false });
    expect(documentHasMotion(model)).toBe(false);
  });

  it("round trips advanced text, stagger, magnetic, and parallax data", async () => {
    const { node } = await element("<div>Card</div>");
    const motion: NodeMotion = {
      enabled: true,
      effects: ["fade"],
      trigger: "reveal",
      text: { mode: "chars", stagger: 45, effects: ["fade", "slide-up"] },
      stagger: { interval: 120 },
      magnetic: { strength: 0.4 },
      parallax: {
        enabled: true,
        speed: "0.75",
        direction: "left",
        effects: [{ effect: "translate" }, { effect: "opacity" }],
        travel: 180,
        easing: "ease-out",
        anchor: "bottom",
        pin: { enabled: true, duration: "300px" },
        velocity: true,
        disableOnMobile: true,
      },
    };
    applyNodeMotion(node, motion);
    const parsed = parseNodeMotion(node.props);
    expect(parsed.text).toMatchObject({ mode: "chars", stagger: 45 });
    expect(parsed.stagger).toEqual({ interval: 120 });
    expect(parsed.magnetic).toEqual({ strength: 0.4 });
    expect(parsed.parallax).toMatchObject({
      speed: "0.75",
      direction: "left",
      travel: 180,
      anchor: "bottom",
      velocity: true,
      disableOnMobile: true,
    });
  });
});
