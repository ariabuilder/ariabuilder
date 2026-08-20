import { describe, expect, it } from "vitest";
import {
  assertContentLocalization,
  cloneContentLocalization,
  fallbackChain,
  inferContentDirection,
  localeUrlPrefix,
  validateContentLocalization,
} from "./contentLocale";

describe("content locale policy", () => {
  it("canonicalizes BCP 47 codes and supports explicit route prefixes", () => {
    const settings = assertContentLocalization({
      defaultLocale: "en-ca",
      locales: [
        {
          code: "en-ca",
          label: "English (Canada)",
          enabled: true,
          direction: "ltr",
          fallbacks: [],
        },
        {
          code: "fr-ca",
          label: "Français (Canada)",
          enabled: true,
          direction: "ltr",
          fallbacks: ["en-ca"],
          pathPrefix: "fr",
        },
      ],
    });

    expect(settings.defaultLocale).toBe("en-CA");
    expect(localeUrlPrefix(settings, "fr-CA")).toBe("fr");
    expect(fallbackChain(settings, "fr-CA")).toEqual(["en-CA"]);
  });

  it("rejects duplicate prefixes, disabled defaults, and fallback cycles", () => {
    const issues = validateContentLocalization({
      defaultLocale: "en",
      locales: [
        {
          code: "en",
          label: "English",
          enabled: false,
          direction: "ltr",
          fallbacks: ["fr"],
          pathPrefix: "content",
        },
        {
          code: "fr",
          label: "French",
          enabled: true,
          direction: "ltr",
          fallbacks: ["en"],
          pathPrefix: "content",
        },
      ],
    });

    expect(issues.map((issue) => issue.message).join(" ")).toMatch(
      /Default locale must remain enabled/,
    );
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(
      /Fallback cycle detected/,
    );
    expect(issues.map((issue) => issue.message).join(" ")).toMatch(
      /already used/,
    );
  });

  it("infers common RTL language directions without mirroring content", () => {
    expect(inferContentDirection("ar-EG")).toBe("rtl");
    expect(inferContentDirection("he")).toBe("rtl");
    expect(inferContentDirection("fr-CA")).toBe("ltr");
  });

  it("rebuilds reactive-proxy-shaped policies as cloneable plain data", () => {
    const locale = new Proxy(
      {
        code: "en",
        label: "English",
        enabled: true,
        direction: "ltr" as const,
        fallbacks: [] as string[],
      },
      {},
    );
    const policy = new Proxy(
      { defaultLocale: "en", locales: [locale] },
      {},
    );
    expect(() => structuredClone(policy)).toThrow();
    const cloned = cloneContentLocalization(policy);
    expect(cloned).toEqual(policy);
    expect(() => structuredClone(cloned)).not.toThrow();
    expect(cloned).not.toBe(policy);
    expect(cloned.locales[0]).not.toBe(locale);
  });
});
