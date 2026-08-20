import { describe, expect, it } from "vitest";
import { normalizeAgentNodeTreeForInsert } from "./agentNodeNormalizer";
import {
  composerUtilityClassesEnabled,
  unsupportedUtilityClassesInNodes,
  unsupportedUtilityClassTokens,
} from "./agentUtilityClasses";
import type { ComposerFrameworkCapabilities } from "./frameworks";

const plainCss: ComposerFrameworkCapabilities = {
  primary: "none",
  detected: [],
  confidence: "none",
  sources: [],
  breakpoints: { md: 768 },
  candidates: [],
  diagnostics: ["No Tailwind or UnoCSS project evidence found."],
};

const tailwind: ComposerFrameworkCapabilities = {
  ...plainCss,
  primary: "tailwind",
  detected: ["tailwind"],
  confidence: "configured",
  sources: ["src/global.css"],
  diagnostics: [],
};

describe("agent utility class safety", () => {
  it("requires a configured framework rather than package evidence alone", () => {
    expect(composerUtilityClassesEnabled(tailwind)).toBe(true);
    expect(composerUtilityClassesEnabled({ ...tailwind, confidence: "package" })).toBe(false);
    expect(composerUtilityClassesEnabled(plainCss)).toBe(false);
  });

  it("rejects utility tokens in a plain CSS project while allowing custom classes", () => {
    expect(unsupportedUtilityClassTokens(
      ["hero-shell", "relative", "md:px-12", "bg-[#070b14]"],
      plainCss,
    )).toEqual(["bg-[#070b14]", "md:px-12", "relative"]);
  });

  it("allows Design Manager classes even when their names resemble utilities", () => {
    expect(unsupportedUtilityClassTokens(
      ["relative", "hero-shell"],
      plainCss,
      new Set(["relative"]),
    )).toEqual([]);
  });

  it("checks nested inserted trees and allows configured Tailwind", () => {
    const normalized = normalizeAgentNodeTreeForInsert([{
      tag: "section",
      className: "hero-shell flex",
      children: [{ tag: "h1", className: "text-5xl", children: ["Hello"] }],
    }]);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(unsupportedUtilityClassesInNodes({ nodes: normalized.nodes, framework: plainCss }))
      .toEqual(["flex", "text-5xl"]);
    expect(unsupportedUtilityClassesInNodes({ nodes: normalized.nodes, framework: tailwind }))
      .toEqual([]);
  });
});
