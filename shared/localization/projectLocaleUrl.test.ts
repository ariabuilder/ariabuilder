import { describe, expect, it } from "vitest";
import { applyProjectLocaleToRoute } from "./projectLocaleUrl";

describe("applyProjectLocaleToRoute", () => {
  it("uses a query parameter and preserves unrelated URL state", () => {
    expect(applyProjectLocaleToRoute("/giveaway?bike=2#vote", {
      locale: "fr",
      defaultLocale: "en",
      locales: ["en", "fr"],
      resolver: { kind: "query-param", parameter: "lang" },
    })).toBe("/giveaway?bike=2&lang=fr#vote");
  });

  it("replaces path-prefix locales and omits the default prefix", () => {
    const options = { defaultLocale: "en", locales: ["en", "fr"] } as const;
    expect(applyProjectLocaleToRoute("/fr/about?ref=nav", {
      ...options,
      locale: "en",
      resolver: { kind: "path-prefix" },
    })).toBe("/about?ref=nav");
    expect(applyProjectLocaleToRoute("/about", {
      ...options,
      locale: "fr",
      resolver: { kind: "path-prefix" },
    })).toBe("/fr/about");
  });
});
