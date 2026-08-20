import { describe, expect, it } from "vitest"
import {
  buildExternalFieldDescriptors,
  formatExternalFieldValue,
  getExternalEntryImageUrl,
  getExternalEntryTitle,
  getSmartExternalVisibleFieldKeys,
} from "../../shared/externalCollectionEntries"

describe("external collection entry projection", () => {
  const entries = [{
    id: "one",
    data: {
      cardTitle: "First",
      title: "Project One",
      thumbnail: "/one.jpg",
      publishedAt: "2026-08-01T12:00:00.000Z",
      featured: true,
      count: 3,
      details: { safe: true },
      tags: ["aria", "astro", "cms", "external"],
    },
  }]

  it("keeps schema fields first and infers deterministic record-only fields", () => {
    const fields = buildExternalFieldDescriptors([
      { key: "title", label: "Project title", type: "string" },
      { key: "publishedAt", label: "Published", type: "datetime" },
    ], entries)
    expect(fields.map((field) => field.key)).toEqual([
      "title", "publishedAt", "cardTitle", "thumbnail", "featured", "count", "details", "tags",
    ])
    expect(fields.find((field) => field.key === "thumbnail")).toMatchObject({ image: true, complex: false })
    expect(fields.find((field) => field.key === "details")).toMatchObject({ type: "object", complex: true, sortable: false })
    expect(fields.find((field) => field.key === "tags")).toMatchObject({ type: "json", complex: true })
  })

  it("uses native identity and image heuristics with smart scalar defaults", () => {
    const fields = buildExternalFieldDescriptors([], entries)
    expect(getExternalEntryTitle(entries[0]!)).toBe("Project One")
    expect(getExternalEntryImageUrl(entries[0]!, fields)).toBe("/one.jpg")
    expect(getSmartExternalVisibleFieldKeys(fields)).toEqual([
      "title", "thumbnail", "publishedAt", "cardTitle", "featured",
    ])
  })

  it("keeps long-form copy out of compact inventory defaults", () => {
    const fields = buildExternalFieldDescriptors([], [{
      id: "post",
      data: {
        title: "Post",
        description: "Long preview copy",
        pubDate: "2026-08-01T12:00:00.000Z",
        image: "/post.jpg",
        author: "Andy",
        tags: "astro, aria",
      },
    }])

    expect(getSmartExternalVisibleFieldKeys(fields)).toEqual([
      "title", "image", "pubDate", "author", "tags",
    ])
  })

  it("resolves Astro image markers through the project media protocol", () => {
    const entry = {
      id: "one",
      data: { thumbnail: "__ASTRO_IMAGE_../../../assets/images/project.png" },
      filePath: "src/data/projects/one/index.mdx",
    }
    const fields = buildExternalFieldDescriptors([], [entry])
    expect(getExternalEntryImageUrl(entry, fields, "/Projects/My Site")).toBe(
      "aria-media://asset/%2FProjects%2FMy%20Site/src%2Fassets%2Fimages%2Fproject.png",
    )
    expect(getExternalEntryImageUrl(
      { ...entry, data: { thumbnail: "__ASTRO_IMAGE_../../../../../../outside.png" } },
      fields,
      "/Projects/My Site",
    )).toBeNull()
  })

  it("formats values without dumping complex JSON into inventory cells", () => {
    expect(formatExternalFieldValue(null)).toBe("—")
    expect(formatExternalFieldValue(true)).toBe("Yes")
    expect(formatExternalFieldValue(false)).toBe("No")
    expect(formatExternalFieldValue([])).toBe("Empty list")
    expect(formatExternalFieldValue(["a", "b", "c", "d"])).toBe("a, b, c +1")
    expect(formatExternalFieldValue({ one: 1, two: 2 })).toBe("2 fields")
    expect(formatExternalFieldValue("2026-08-01", "date")).not.toContain("2026-08-01")
  })
})
