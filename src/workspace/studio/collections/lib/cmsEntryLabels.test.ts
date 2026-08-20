import { describe, expect, it, vi } from "vitest"
import type { AriaEntryRecord } from "../../../../../shared/cms"
import {
  cmsEntryLabel,
  cmsEntryLabelFromRecord,
  resolveCmsEntryLabels,
} from "./cmsEntryLabels"

const mocks = vi.hoisted(() => ({
  getCmsEntry: vi.fn(),
}))

vi.mock("@/lib/cms", () => ({
  getCmsEntry: mocks.getCmsEntry,
}))

function entry(id: string, title: string, slug = "entry"): AriaEntryRecord {
  return {
    entry: {
      id,
      collectionId: "tags",
      status: "published",
      version: "v1",
      authorId: "local",
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
      publishedAt: "2026-08-17T00:00:00.000Z",
    },
    locales: [
      {
        entryId: id,
        collectionId: "tags",
        locale: "en",
        slug,
        title,
        frontmatter: {},
        body: null,
        isSource: true,
      },
    ],
  }
}

describe("cms entry labels", () => {
  it("prefers title, then slug, then the stored id", () => {
    expect(cmsEntryLabel({ id: "abc", title: "MCP", slug: "mcp" })).toBe("MCP")
    expect(cmsEntryLabel({ id: "abc", title: "  ", slug: "mcp" })).toBe("mcp")
    expect(cmsEntryLabel({ id: "abc", title: "", slug: "" })).toBe("abc")
  })

  it("resolves stored relation and reference ids to entry titles", async () => {
    mocks.getCmsEntry.mockImplementation(async (_root: string, _collection: string, id: string) => {
      if (id === "tag-1") return entry("tag-1", "AI Engineer")
      if (id === "author-1") return entry("author-1", "Aria Team", "aria-team")
      return null
    })

    const labels = await resolveCmsEntryLabels("/project", "tags", [
      "tag-1",
      "missing",
      "tag-1",
    ])

    expect(labels).toEqual({ "tag-1": "AI Engineer" })
    expect(cmsEntryLabelFromRecord(entry("author-1", "Aria Team"))).toBe(
      "Aria Team",
    )
    expect(mocks.getCmsEntry).toHaveBeenCalledTimes(2)
  })
})
