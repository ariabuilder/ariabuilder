import { describe, expect, it } from "vitest"
import type { PropField } from "../../shared/composer/types"
import {
  createLayoutPropDrafts,
  serializeLayoutPropDrafts,
} from "./layoutProps"

describe("layout prop drafts", () => {
  const fields: PropField[] = [
    { name: "theme", type: "enum", optional: false, options: ["light", "dark"] },
    { name: "title", type: "string", optional: false },
    { name: "count", type: "number", optional: false },
    { name: "compact", type: "boolean", optional: false },
  ]

  it("uses the first enum option and emits valid Astro prop values", () => {
    const drafts = {
      ...createLayoutPropDrafts(fields),
      title: "Landing",
      count: "2",
      compact: true,
    }
    expect(serializeLayoutPropDrafts(fields, drafts)).toEqual({
      error: null,
      props: {
        theme: { type: "string", value: "light" },
        title: { type: "string", value: "Landing" },
        count: { type: "expr", value: "2" },
        compact: { type: "bare" },
      },
    })
  })

  it("rejects missing and unsupported required values", () => {
    expect(serializeLayoutPropDrafts(fields, createLayoutPropDrafts(fields)).error)
      .toMatch(/title/)
    expect(
      serializeLayoutPropDrafts(
        [{ name: "config", type: "other", optional: false }],
        { config: "" },
      ).error,
    ).toMatch(/unsupported/i)
  })

  it("serializes date fields and page-name string fallbacks", () => {
    const dateFields: PropField[] = [
      { name: "title", type: "string", optional: false },
      { name: "pubDate", type: "date", optional: false },
    ]
    const drafts = createLayoutPropDrafts(dateFields)
    expect(drafts.pubDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(
      serializeLayoutPropDrafts(dateFields, drafts, {
        emptyStringFallback: "Test",
      }),
    ).toEqual({
      error: null,
      props: {
        title: { type: "string", value: "Test" },
        pubDate: {
          type: "expr",
          value: `new Date("${drafts.pubDate}T00:00:00")`,
        },
      },
    })
  })
})
