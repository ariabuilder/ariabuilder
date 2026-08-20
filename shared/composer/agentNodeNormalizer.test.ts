import { describe, expect, it } from "vitest";
import {
  formatAgentNodeNormalizationIssues,
  normalizeAgentNodeForInsert,
  normalizeAgentNodeTreeForInsert,
} from "./agentNodeNormalizer";
import { createAriaPrimitiveNode } from "./ariaPrimitives";
import { serializeNode } from "./serializeAstro";

describe("Astro agent node normalizer", () => {
  it("accepts primitive shortcuts without ids", () => {
    const result = normalizeAgentNodeForInsert({ primitive: "section" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.node.kind).toBe("element");
    if (result.node.kind !== "element") return;
    expect(result.node.name).toBe("section");
    expect(result.node.id).toMatch(/^c\d+/);
    expect(result.node.props["data-aria-type"]).toEqual({
      type: "string",
      value: "Section",
    });
  });

  it("accepts demo-style tag/type trees and string children", () => {
    const result = normalizeAgentNodeForInsert({
      tag: "section",
      className: "hero",
      children: [
        { type: "h1", text: "Welcome" },
        { tag: "p", children: ["Body copy"] },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.node.kind).toBe("element");
    if (result.node.kind !== "element") return;
    expect(result.node.props.class).toEqual({ type: "string", value: "hero" });
    expect(result.node.children?.length).toBe(2);
    const heading = result.node.children?.[0];
    expect(heading?.kind).toBe("element");
    if (heading?.kind !== "element") return;
    expect(heading.name).toBe("h1");
    expect(heading.children?.[0]).toMatchObject({
      kind: "text",
      value: "Welcome",
    });
  });

  it("accepts kind/name EditableNode-shaped payloads without ids", () => {
    const result = normalizeAgentNodeForInsert({
      kind: "element",
      name: "div",
      props: { class: "card" },
      children: [{ kind: "text", value: "Hi" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.node).toMatchObject({
      kind: "element",
      name: "div",
      props: { class: { type: "string", value: "card" } },
    });
  });

  it("matches createAriaPrimitiveNode section Astro output after normalize", () => {
    const baseline = createAriaPrimitiveNode("section");
    const normalized = normalizeAgentNodeForInsert({ primitive: "section" });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const render = (node: typeof baseline) => {
      const lines: string[] = [];
      serializeNode(node, "", lines);
      return lines.join("\n").replace(/\s+/g, " ").trim();
    };
    expect(render(normalized.node as typeof baseline)).toBe(render(baseline));
  });

  it("normalizes the Rich Text primitive to its canonical Astro structure", () => {
    const result = normalizeAgentNodeForInsert({ primitive: "rich-text" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.node).toMatchObject({
      kind: "element",
      name: "div",
      props: {
        "data-aria-type": { type: "string", value: "RichText" },
      },
      children: [
        {
          kind: "element",
          name: "p",
          children: [{ kind: "text", value: "Rich text" }],
        },
      ],
    });
  });

  it("reports nested issues for invalid children", () => {
    const result = normalizeAgentNodeTreeForInsert([
      { kind: "element", name: "div", children: [42] },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(formatAgentNodeNormalizationIssues(result.issues)).toContain(
      "0.children.0",
    );
  });
});
