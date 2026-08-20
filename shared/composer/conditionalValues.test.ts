import { describe, expect, it } from "vitest";
import { parseAstro } from "./parseAstro";
import { serializeAstro } from "./serializeAstro";
import {
  conditionalPropValue,
  evaluateComposerConditionalValue,
  parseManagedConditionalPropValue,
  setConditionalTextValueAtPath,
  type ComposerConditionalValue,
} from "./conditionalValues";

async function editableModel(source: string) {
  const result = await parseAstro(source);
  expect(result.editable).toBe(true);
  if (!result.editable) throw new Error("Expected editable Astro source");
  return result.model;
}

const value: ComposerConditionalValue = {
  version: 1,
  cases: [{
    id: "case-pro",
    when: { version: 1, groups: [{ id: "g", rules: [{ id: "r", source: { provider: "component", path: ["plan"] }, operator: "equals", value: "pro" }] }] },
    value: { type: "string", value: "Upgrade" },
  }],
  fallback: { type: "string", value: "Learn more" },
};

describe("Composer conditional prop values", () => {
  it("compiles, evaluates first-match, and reopens its managed contract", () => {
    const prop = conditionalPropValue(value);
    expect(prop?.type).toBe("expr");
    expect(prop && parseManagedConditionalPropValue(prop)).toEqual(value);
    expect(evaluateComposerConditionalValue(value, { providers: { component: { plan: "pro" } } })).toMatchObject({ caseId: "case-pro", value: { value: "Upgrade" } });
    expect(evaluateComposerConditionalValue(value, { providers: { component: { plan: "free" } } })).toMatchObject({ caseId: null, value: { value: "Learn more" } });
  });

  it("round-trips through a normal Astro prop expression", async () => {
    const prop = conditionalPropValue(value)!;
    expect(prop.type).toBe("expr");
    if (prop.type !== "expr") throw new Error("Expected managed expression prop");
    const model = await editableModel(`---\nconst { plan } = Astro.props;\n---\n<Button label={${prop.value}} />\n`);
    expect(model.nodes[0]?.kind).toBe("component");
    const reparsed = await editableModel(serializeAstro(model));
    const node = reparsed.nodes[0];
    expect(node?.kind === "component" ? parseManagedConditionalPropValue(node.props.label) : null).toEqual(value);
  });

  it("converts text to a managed expression and restores literal text without losing identity", async () => {
    const model = await editableModel("<p>Hello</p>");
    const text = model.nodes[0]?.kind === "element" ? model.nodes[0].children?.[0] : null;
    expect(text?.kind).toBe("text");
    const id = text!.id;
    expect(setConditionalTextValueAtPath(model, "0.0", conditionalPropValue(value)!)).toMatchObject({ ok: true });
    const managed = model.nodes[0]?.kind === "element" ? model.nodes[0].children?.[0] : null;
    expect(managed).toMatchObject({ kind: "expr", id });
    expect(setConditionalTextValueAtPath(model, "0.0", { type: "string", value: "Fallback" })).toMatchObject({ ok: true });
    const restored = model.nodes[0]?.kind === "element" ? model.nodes[0].children?.[0] : null;
    expect(restored).toMatchObject({ kind: "text", id, value: "Fallback" });
  });
});
