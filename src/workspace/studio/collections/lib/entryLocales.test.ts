import { describe, expect, it } from "vitest"
import { entryHasLocale, findEntryLocale, matchEntryLocale } from "./entryLocales"

describe("entry locale presence", () => {
  const locales = [
    { locale: "en", isSource: true },
    { locale: "fr-CA", isSource: false },
  ]

  it("finds a locale even when region casing differs from settings", () => {
    expect(matchEntryLocale(locales, "fr-ca")?.locale).toBe("fr-CA")
    expect(findEntryLocale(locales, "fr-ca")?.locale).toBe("fr-CA")
  })

  it("falls back to the source locale when the requested code is absent", () => {
    expect(matchEntryLocale(locales, "de")).toBeUndefined()
    expect(findEntryLocale(locales, "de")?.locale).toBe("en")
  })

  it("treats the locale currently being edited as present", () => {
    expect(entryHasLocale([], "en", "en")).toBe(true)
    expect(entryHasLocale(locales, "en-US")).toBe(false)
    expect(entryHasLocale(locales, "fr-ca")).toBe(true)
    expect(entryHasLocale(locales, "de")).toBe(false)
  })
})
