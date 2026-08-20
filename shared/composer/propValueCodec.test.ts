import { describe, expect, it } from "vitest";
import { serializeAttrs } from "./serializeAstro";
import {
  commitBooleanValue,
  commitStringValue,
  decodeAttr,
  encodeAttr,
  isOpaquePropValue,
  stringFieldDisplay,
} from "./propValueCodec";
import type { PropValue } from "./types";

describe("propValueCodec kind preservation", () => {
  it("round-trips string / expr / bare via encodeAttr(decodeAttr)", () => {
    const cases: PropValue[] = [
      { type: "string", value: "/about" },
      { type: "expr", value: "activeClass" },
      { type: "bare" },
      { type: "template-literal", value: "hello ${name}" },
    ];
    for (const v of cases) {
      const decoded = decodeAttr(v);
      const encoded = encodeAttr(decoded, v);
      expect(encoded).toEqual(v);
      // Serialize stays stable after codec round-trip
      expect(serializeAttrs({ x: encoded })).toBe(
        serializeAttrs({ x: v }),
      );
    }
  });

  it("does not corrupt template-literal when editing via commitStringValue", () => {
    const existing: PropValue = {
      type: "template-literal",
      value: "hello ${name}",
    };
    const next = commitStringValue(existing, "hi ${name}");
    expect(next).toEqual({
      type: "template-literal",
      value: "hi ${name}",
    });
    expect(serializeAttrs({ title: next! })).toBe(
      ' title={`hi ${name}`}',
    );
  });

  it("keeps expr kind when editing expression string fields", () => {
    const existing: PropValue = { type: "expr", value: "activeClass" };
    expect(commitStringValue(existing, "otherClass")).toEqual({
      type: "expr",
      value: "otherClass",
    });
    expect(serializeAttrs({ class: commitStringValue(existing, "otherClass")! })).toBe(
      " class={otherClass}",
    );
  });

  it("treats spread and shorthand as opaque", () => {
    const spread: PropValue = { type: "spread", value: "rest" };
    const shorthand: PropValue = { type: "shorthand", value: "title" };
    expect(isOpaquePropValue(spread)).toBe(true);
    expect(isOpaquePropValue(shorthand)).toBe(true);
    expect(encodeAttr(decodeAttr(spread), spread)).toEqual(spread);
    expect(commitStringValue(shorthand, "nope")).toEqual(shorthand);
    expect(stringFieldDisplay(spread).opaque).toBe(true);
  });

  it("preserves bare boolean on HTML-style preferBare", () => {
    expect(commitBooleanValue(undefined, true, true)).toEqual({
      type: "bare",
    });
    expect(commitBooleanValue({ type: "bare" }, false, true)).toBeUndefined();
    expect(
      commitBooleanValue({ type: "expr", value: "true" }, false, false),
    ).toEqual({ type: "expr", value: "false" });
  });
});
