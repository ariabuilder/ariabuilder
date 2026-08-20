import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("app content security policy", () => {
  it("allows project media protocol URLs in image elements", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8")
    const policy = html.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1]
    const imageDirective = policy
      ?.split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("img-src "))

    expect(imageDirective).toContain("aria-media:")
  })

  it("allows Fontsource catalog fetch and jsDelivr preview assets", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8")
    const policy = html.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1]
    const directives = policy
      ?.split(";")
      .map((directive) => directive.trim())
      ?? []
    const connect = directives.find((directive) => directive.startsWith("connect-src "))
    const style = directives.find((directive) => directive.startsWith("style-src "))
    const font = directives.find((directive) => directive.startsWith("font-src "))

    expect(connect).toContain("https://api.fontsource.org")
    expect(connect).toContain("https://cdn.jsdelivr.net")
    expect(style).toContain("https://cdn.jsdelivr.net")
    expect(font).toContain("https://cdn.jsdelivr.net")
  })
})
