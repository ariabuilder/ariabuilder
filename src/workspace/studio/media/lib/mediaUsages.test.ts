import { describe, expect, it } from "vitest"
import {
  formatUsageLineLabel,
  groupMediaUsages,
  isVisibleMediaUsageFile,
  mediaUsageRowTitle,
} from "./mediaUsages"

describe("isVisibleMediaUsageFile", () => {
  it("keeps pages, components, layouts, and CMS entries", () => {
    expect(isVisibleMediaUsageFile("src/pages/work.astro")).toBe(true)
    expect(isVisibleMediaUsageFile("src/components/Hero.astro")).toBe(true)
    expect(isVisibleMediaUsageFile("src/layouts/Layout.astro")).toBe(true)
    expect(
      isVisibleMediaUsageFile(".aria/cms/entries/logos/airtable.json"),
    ).toBe(true)
  })

  it("hides Aria config files", () => {
    expect(isVisibleMediaUsageFile(".aria/site-settings.json")).toBe(false)
    expect(isVisibleMediaUsageFile(".aria/pages-meta.json")).toBe(false)
    expect(isVisibleMediaUsageFile(".aria/collections.json")).toBe(false)
    expect(isVisibleMediaUsageFile(".aria/design-meta.json")).toBe(false)
  })
})

describe("groupMediaUsages", () => {
  it("groups hits in the same file and sorts line numbers", () => {
    expect(
      groupMediaUsages([
        {
          file: "src/pages/work.astro",
          line: 40,
          reference: "/images/hero.webp",
        },
        {
          file: "src/pages/work.astro",
          line: 12,
          reference: "/images/hero.webp",
        },
        {
          file: ".aria/cms/entries/work/hero.json",
          line: 8,
          reference: "public/images/hero.webp",
        },
      ]),
    ).toEqual([
      {
        file: "src/pages/work.astro",
        name: "work.astro",
        directory: "src/pages",
        lines: [12, 40],
        references: ["/images/hero.webp"],
      },
      {
        file: ".aria/cms/entries/work/hero.json",
        name: "hero.json",
        directory: ".aria/cms/entries/work",
        lines: [8],
        references: ["public/images/hero.webp"],
      },
    ])
  })

  it("omits Aria config hits such as site-settings.json", () => {
    expect(
      groupMediaUsages([
        {
          file: "src/layouts/Layout.astro",
          line: 12,
          reference: "/src/assets/logos/airtable-logo.svg",
        },
        {
          file: ".aria/site-settings.json",
          line: 203,
          reference: "src/assets/logos/airtable-logo.svg",
        },
        {
          file: ".aria/pages-meta.json",
          line: 40,
          reference: "/src/assets/logos/airtable-logo.svg",
        },
      ]),
    ).toEqual([
      {
        file: "src/layouts/Layout.astro",
        name: "Layout.astro",
        directory: "src/layouts",
        lines: [12],
        references: ["/src/assets/logos/airtable-logo.svg"],
      },
    ])
  })

  it("keeps a root file without a directory", () => {
    expect(
      groupMediaUsages([
        { file: "README.md", line: 8, reference: "./hero.webp" },
      ]),
    ).toEqual([
      {
        file: "README.md",
        name: "README.md",
        directory: "",
        lines: [8],
        references: ["./hero.webp"],
      },
    ])
  })
})

describe("formatUsageLineLabel", () => {
  it("joins a short line list and falls back to a count", () => {
    expect(formatUsageLineLabel([12, 40])).toBe("12, 40")
    expect(formatUsageLineLabel([1, 2, 3, 4, 5])).toBe("5")
  })
})

describe("mediaUsageRowTitle", () => {
  it("lists file:line locations for the tooltip", () => {
    expect(
      mediaUsageRowTitle({
        file: "src/pages/work.astro",
        name: "work.astro",
        directory: "src/pages",
        lines: [12, 40],
        references: ["/images/hero.webp"],
      }),
    ).toBe("src/pages/work.astro:12\nsrc/pages/work.astro:40")
  })
})
