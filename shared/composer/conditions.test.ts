import { describe, expect, it } from "vitest";
import {
  addOtherwiseBranchAtPath,
  conditionalPathAtOrAbove,
  removeConditionAtPath,
  wrapNodesInConditionAtPaths,
} from "./conditions";
import {
  evaluateConditionalValue,
  evaluateConditionSet,
  formatConditionSet,
  managedConditionExpression,
  parseComponentControlMetadata,
  validateComponentControlMetadata,
  writeComponentControlMetadata,
  type ComponentControlMetadata,
  type ConditionSet,
} from "../conditions";
import { parseAstro } from "./parseAstro";
import { serializeAstro, serializeAstroMarked } from "./serializeAstro";
import { buildComposerLayerTree } from "./layers";

const planIsPro: ConditionSet = {
  version: 1,
  groups: [{
    id: "group-plan",
    rules: [{
      id: "rule-plan",
      source: { provider: "component", path: ["plan"] },
      operator: "equals",
      value: "pro",
    }],
  }],
};

async function editableModel(source: string) {
  const result = await parseAstro(source);
  expect(result.editable).toBe(true);
  if (!result.editable) throw new Error("Expected editable Astro source");
  return result.model;
}

describe("condition evaluation", () => {
  it("uses AND within groups and OR between groups", () => {
    const condition: ConditionSet = {
      version: 1,
      groups: [
        {
          id: "paid-en",
          rules: [
            { id: "paid", source: { provider: "component", path: ["paid"] }, operator: "equals", value: true },
            { id: "english", source: { provider: "locale", path: [] }, operator: "equals", value: "en" },
          ],
        },
        {
          id: "preview",
          rules: [{ id: "preview-rule", source: { provider: "route", path: ["pathname"] }, operator: "equals", value: "/preview" }],
        },
      ],
    };
    expect(evaluateConditionSet(condition, { providers: { component: { paid: true }, locale: "en", route: { pathname: "/" } } })).toBe(true);
    expect(evaluateConditionSet(condition, { providers: { component: { paid: false }, locale: "en", route: { pathname: "/preview" } } })).toBe(true);
    expect(evaluateConditionSet(condition, { providers: { component: { paid: false }, locale: "en", route: { pathname: "/" } } })).toBe(false);
  });

  it("distinguishes missing, empty, false, and zero", () => {
    const empty: ConditionSet = { version: 1, groups: [{ id: "g", rules: [{ id: "r", source: { provider: "component", path: ["value"] }, operator: "is-empty" }] }] };
    expect(evaluateConditionSet(empty, { providers: { component: { value: "" } } })).toBe(true);
    expect(evaluateConditionSet(empty, { providers: { component: { value: null } } })).toBe(false);
    expect(evaluateConditionSet(empty, { providers: { component: { value: undefined } } })).toBe(false);
    expect(evaluateConditionSet(empty, { providers: { component: { value: false } } })).toBe(false);
    expect(evaluateConditionSet(empty, { providers: { component: { value: 0 } } })).toBe(false);
    expect(evaluateConditionSet(empty, { providers: { component: {} } })).toBe("unknown");
    const set: ConditionSet = { version: 1, groups: [{ id: "g", rules: [{ id: "r", source: { provider: "component", path: ["value"] }, operator: "is-set" }] }] };
    expect(evaluateConditionSet(set, { providers: { component: {} } })).toBe("unknown");
    expect(evaluateConditionSet(set, { providers: { component: { value: undefined } } })).toBe(false);
  });

  it("supports typed CMS-friendly text, count, date, and presence comparisons", () => {
    const evaluate = (operator: string, actual: unknown, value?: unknown) => evaluateConditionSet({
      version: 1,
      groups: [{
        id: "g",
        rules: [{ id: "r", source: { provider: "cms", path: ["value"] }, operator, value }],
      }],
    }, { providers: { cms: { value: actual } } });

    expect(evaluate("starts-with", "News: Launch", "News:")).toBe(true);
    expect(evaluate("ends-with", "launch.astro", ".astro")).toBe(true);
    expect(evaluate("is-not-empty", ["release"])).toBe(true);
    expect(evaluate("is-empty", {})).toBe(true);
    expect(evaluate("at-least", 3, 3)).toBe(true);
    expect(evaluate("at-most", 3, 2)).toBe(false);
    expect(evaluate("on-or-before", "2026-08-15", "2026-08-15")).toBe(true);
    expect(evaluate("on-or-after", "2026-08-15", "2026-08-14")).toBe(true);

    const notSet: ConditionSet = {
      version: 1,
      groups: [{ id: "g", rules: [{ id: "r", source: { provider: "cms", path: ["value"] }, operator: "is-not-set" }] }],
    };
    expect(evaluateConditionSet(notSet, { providers: { cms: { value: undefined } } })).toBe(true);
    expect(evaluateConditionSet(notSet, { providers: { cms: {} } })).toBe("unknown");
  });

  it("returns the first matching conditional value and a fallback", () => {
    const conditional = {
      version: 1 as const,
      cases: [{ id: "pro", when: planIsPro, value: "Priority support" }],
      fallback: "Community support",
    };
    expect(evaluateConditionalValue(conditional, { providers: { component: { plan: "pro" } } })).toMatchObject({ caseId: "pro", value: "Priority support" });
    expect(evaluateConditionalValue(conditional, { providers: { component: { plan: "free" } } })).toMatchObject({ caseId: null, value: "Community support" });
  });

  it("formats a plain-language summary", () => {
    expect(formatConditionSet(planIsPro)).toBe("plan is pro");
    expect(formatConditionSet(undefined)).toBe("Always shown");
  });
});

describe("component control metadata", () => {
  it("writes and reopens static frontmatter metadata", () => {
    const source = `---\ninterface Props { plan?: string; icon?: string }\n---\n<button />`;
    const metadata: ComponentControlMetadata = {
      version: 1,
      fields: { icon: { visibleWhen: planIsPro } },
    };
    const written = writeComponentControlMetadata(source, metadata);
    expect(written).toContain("@aria-component-controls v1");
    expect(parseComponentControlMetadata(written)).toMatchObject({ found: true, valid: true, metadata });
    expect(writeComponentControlMetadata(written, metadata).match(/@aria-component-controls/g)).toHaveLength(1);
  });

  it("rejects direct and indirect dependency cycles", () => {
    const metadata: ComponentControlMetadata = {
      version: 1,
      fields: {
        a: { visibleWhen: { ...planIsPro, groups: [{ id: "ga", rules: [{ ...planIsPro.groups[0]!.rules[0]!, id: "ra", source: { provider: "component", path: ["b"] } }] }] } },
        b: { enabledWhen: { ...planIsPro, groups: [{ id: "gb", rules: [{ ...planIsPro.groups[0]!.rules[0]!, id: "rb", source: { provider: "component", path: ["a"] } }] }] } },
      },
    };
    expect(validateComponentControlMetadata(metadata).some((issue) => issue.message.includes("cycle"))).toBe(true);
  });
});

describe("Astro element conditions", () => {
  it("wraps contiguous nodes, round-trips managed metadata, and unwraps", async () => {
    const model = await editableModel(`<main><p>One</p><p>Two</p><p>Three</p></main>`);
    const firstId = model.nodes[0]!.kind === "element" ? model.nodes[0]!.children?.[0]?.id : null;
    const wrapped = wrapNodesInConditionAtPaths(model, ["0.0", "0.1"], "0.0", planIsPro);
    expect(wrapped.ok).toBe(true);
    expect(wrapped.selectPaths).toEqual(["0.0.0", "0.0.1"]);
    expect(conditionalPathAtOrAbove(model, "0.0.1")).toBe("0.0");
    const serialized = serializeAstro(model);
    expect(serialized).toContain("@aria-condition:v1:");
    expect(serialized).toContain("Astro.props?.[\"plan\"] === \"pro\"");
    const authoring = serializeAstroMarked(model);
    expect(authoring).toContain('Astro.url.searchParams.get("aria-design") === "1"');
    expect(authoring).toContain('data-aria-condition-start="0.0:t"');
    expect(authoring).toContain('data-aria-condition-start="0.0:f"');

    const reparsed = await editableModel(serialized);
    const condition = reparsed.nodes[0]!.kind === "element" ? reparsed.nodes[0]!.children?.[0] : null;
    expect(condition).toMatchObject({ kind: "conditional", condition: planIsPro });
    expect(condition?.kind === "conditional" ? condition.consequent.map((node) => node.id).length : 0).toBe(2);

    expect(removeConditionAtPath(model, "0.0", "shown").ok).toBe(true);
    expect(model.nodes[0]!.kind === "element" ? model.nodes[0]!.children?.[0]?.id : null).toBe(firstId);
  });

  it("rejects non-contiguous selections without changing source", async () => {
    const model = await editableModel(`<main><p>One</p><p>Two</p><p>Three</p></main>`);
    const before = serializeAstro(model);
    expect(wrapNodesInConditionAtPaths(model, ["0.0", "0.2"], "0.0", planIsPro)).toMatchObject({ ok: false });
    expect(serializeAstro(model)).toBe(before);
  });

  it("round-trips an empty Otherwise branch", async () => {
    const model = await editableModel(`<main><p>One</p></main>`);
    expect(wrapNodesInConditionAtPaths(model, ["0.0"], "0.0", planIsPro).ok).toBe(true);
    expect(addOtherwiseBranchAtPath(model, "0.0").ok).toBe(true);
    const serialized = serializeAstro(model);
    expect(serialized).toContain(": null}");
    const reparsed = await editableModel(serialized);
    const condition = reparsed.nodes[0]!.kind === "element" ? reparsed.nodes[0]!.children?.[0] : null;
    expect(condition).toMatchObject({ kind: "conditional", mode: "ternary", alternate: [] });
    const row = buildComposerLayerTree(reparsed, {
      conditionContext: { providers: { component: { plan: "free" } } },
    }).content[0]?.children[0];
    expect(row).toMatchObject({
      kind: "conditional",
      conditionStatus: false,
      children: [
        { label: "Shown content", presentationOnly: true },
        { label: "Otherwise content", presentationOnly: true },
      ],
    });
  });

  it("keeps hand-written conditions custom and unchanged", async () => {
    const model = await editableModel(`{published && <article>Story</article>}`);
    const condition = model.nodes[0];
    expect(condition).toMatchObject({ kind: "conditional", test: "published" });
    expect(condition?.kind === "conditional" ? condition.condition : null).toBeUndefined();
    expect(serializeAstro(model)).toContain("{published && <article>Story</article>}");
  });

  it("generates a managed Astro expression", () => {
    expect(managedConditionExpression(planIsPro)).toContain("Astro.props?.[\"plan\"] === \"pro\"");
  });
});
