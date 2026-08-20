import { describe, expect, it } from "vitest";
import {
  clipboardPlainText,
  decodeComposerClipboard,
  encodeComposerClipboard,
  looksLikeSourceCodePaste,
  serializeClipboardHtml,
  type ComposerClipboardPayloadV1,
} from "./clipboard";
import { createAriaPrimitiveNode } from "./ariaPrimitives";
import { visualAffordanceRect } from "./overlays";
import { FALLBACK_BREAKPOINTS, isLikelyUtilityClass } from "./frameworks";
import {
  toggleSelection,
  uniqueSelectionPaths,
  type SelectionRef,
} from "./selection";

describe("Composer authoring contracts", () => {
  it("deduplicates structural selection paths but keeps rendered occurrences", () => {
    const first: SelectionRef = { path: "0.1", occurrence: 0 };
    const second: SelectionRef = { path: "0.1", occurrence: 1 };
    expect(toggleSelection([first], second)).toEqual([first, second]);
    expect(uniqueSelectionPaths([first, second])).toEqual(["0.1"]);
    expect(toggleSelection([first, second], first)).toEqual([second]);
  });

  it("provides an editor-only hit rail for zero-height nodes", () => {
    expect(visualAffordanceRect({ x: 10, y: 20, w: 0, h: 0 })).toEqual({
      x: 10,
      y: 8,
      w: 24,
      h: 24,
    });
    expect(visualAffordanceRect({ x: 1, y: 2, w: 30, h: 12 })).toEqual({
      x: 1,
      y: 2,
      w: 30,
      h: 12,
    });
  });

  it("round-trips structured clipboard data and exports clean HTML/text", () => {
    const nodes = [createAriaPrimitiveNode("heading")];
    const payload: ComposerClipboardPayloadV1 = {
      version: 1,
      sourceProject: "/project",
      sourceFile: "src/pages/index.astro",
      nodes,
      imports: [],
      classes: [],
      copiedAt: 1,
    };
    expect(decodeComposerClipboard(encodeComposerClipboard(payload))).toEqual(
      payload,
    );
    expect(serializeClipboardHtml(nodes)).toContain("<h2>Heading</h2>");
    expect(serializeClipboardHtml(nodes)).not.toContain("---");
    expect(clipboardPlainText(nodes)).toBe("Heading");
  });

  it("rejects obvious source-code clipboard wrappers", () => {
    expect(looksLikeSourceCodePaste("```html\n<div />\n```")).toBe(true);
    expect(looksLikeSourceCodePaste("import X from './X.astro'"))
      .toBe(true);
    expect(looksLikeSourceCodePaste("A normal paragraph")).toBe(false);
  });

  it("recognizes utility variants and exposes deterministic fallback breakpoints", () => {
    expect(isLikelyUtilityClass("md:hover:bg-blue-500")).toBe(true);
    expect(isLikelyUtilityClass("w-[calc(100%-2rem)]")).toBe(true);
    expect(isLikelyUtilityClass("marketing-card")).toBe(false);
    expect(isLikelyUtilityClass("plain")).toBe(false);
    expect(FALLBACK_BREAKPOINTS).toMatchObject({ md: 768, "2xl": 1536 });
  });
});
