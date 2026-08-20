import { describe, expect, it } from "vitest";
import {
  addClassName,
  appendClassListToken,
  diffRenderedClasses,
  joinClassNames,
  removeClassName,
  removeClassListTokens,
  splitClassNames,
  staticClassListTokens,
} from "./classAttr";

describe("classAttr", () => {
  it("splits and joins class names", () => {
    expect(splitClassNames("  hero  active  ")).toEqual(["hero", "active"]);
    expect(joinClassNames(["hero", "active"])).toBe("hero active");
    expect(joinClassNames([])).toBe("");
  });

  it("adds and removes idempotently", () => {
    expect(addClassName(["a"], "b")).toEqual(["a", "b"]);
    expect(addClassName(["a", "b"], "a")).toEqual(["a", "b"]);
    expect(removeClassName(["a", "b", "a"], "a")).toEqual(["b"]);
  });

  it("diffs rendered-only classes", () => {
    expect(diffRenderedClasses(["hero"], ["hero", "is-active", "hero"])).toEqual(
      {
        source: ["hero"],
        renderedOnly: ["is-active"],
      },
    );
  });

  it("appends static class:list tokens without replacing dynamic entries", () => {
    expect(
      appendClassListToken(
        { type: "expr", value: `["card", active && "active"]` },
        "md:grid",
      ),
    ).toEqual({
      type: "expr",
      value: `["card", active && "active", "md:grid"]`,
    });
  });

  it("reads literal tokens without treating dynamic class:list code as editable", () => {
    expect(
      staticClassListTokens({
        type: "expr",
        value: `["card wide", active && "active", classes.primary]`,
      }),
    ).toEqual(["card", "wide", "active"]);
  });

  it("removes a literal utility while preserving dynamic class:list entries", () => {
    expect(removeClassListTokens(
      { type: "expr", value: `["flex gap-4", active && "opacity-100"]` },
      (token) => token === "gap-4",
    )).toEqual({
      safe: true,
      value: {
        type: "expr",
        value: `["flex", active && "opacity-100"]`,
      },
    });
  });
});
