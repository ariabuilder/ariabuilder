import { describe, expect, it } from "vitest";
import { canonicalizeLocaleCode, localeCodesEqual } from "./locale";

describe("locale code comparison", () => {
  it("canonicalizes region casing without changing the language", () => {
    expect(canonicalizeLocaleCode("en-us")).toBe("en-US");
    expect(canonicalizeLocaleCode(" EN-CA ")).toBe("en-CA");
    expect(canonicalizeLocaleCode("en")).toBe("en");
  });

  it("treats equivalent BCP 47 tags as the same locale", () => {
    expect(localeCodesEqual("en-us", "en-US")).toBe(true);
    expect(localeCodesEqual("en", "en")).toBe(true);
    expect(localeCodesEqual("en", "en-US")).toBe(false);
    expect(localeCodesEqual("", "en")).toBe(false);
  });
});
