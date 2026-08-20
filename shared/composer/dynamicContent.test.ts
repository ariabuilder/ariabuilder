import { describe, expect, it } from "vitest";
import { containsDynamicAstroContent } from "./dynamicContent";
import type { EditableNode } from "./types";

describe("containsDynamicAstroContent", () => {
  it("finds expressions nested beneath static formatting elements", () => {
    const nodes: EditableNode[] = [{
      id: "strong",
      kind: "element",
      name: "strong",
      props: {},
      children: [{ id: "name", kind: "expr", value: "{name}" }],
    }];

    expect(containsDynamicAstroContent(nodes)).toBe(true);
  });

  it("finds expression-valued attributes in descendants", () => {
    const nodes: EditableNode[] = [{
      id: "span",
      kind: "element",
      name: "span",
      props: { title: { type: "expr", value: "title" } },
      children: [{ id: "text", kind: "text", value: "Hello" }],
    }];

    expect(containsDynamicAstroContent(nodes)).toBe(true);
  });

  it("allows static authored content to be cleared", () => {
    const nodes: EditableNode[] = [{
      id: "strong",
      kind: "element",
      name: "strong",
      props: {},
      children: [{ id: "text", kind: "text", value: "Hello" }],
    }];

    expect(containsDynamicAstroContent(nodes)).toBe(false);
  });
});
