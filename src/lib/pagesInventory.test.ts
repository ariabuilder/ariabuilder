import { describe, expect, it } from "vitest"
import type { ScanPage } from "@/workspace/types"
import { pageMenuItems } from "@/workspace/studio/pages/pageMenuItems"
import { toPagesInventoryRows } from "@/workspace/studio/pages/usePagesTable"

const entryTemplate: ScanPage = {
  route: "/blog/[...slug]",
  file: "src/pages/blog/[...slug].astro",
  mtimeMs: 1,
  role: "cms-entry",
}

describe("Pages inventory", () => {
  it("keeps CMS entry templates visible after collection assignment", () => {
    expect(toPagesInventoryRows([entryTemplate])).toEqual([
      expect.objectContaining({
        file: entryTemplate.file,
        role: "cms-entry",
      }),
    ])
  })

  it("offers the CMS-aware Composer launch for entry templates", () => {
    const row = toPagesInventoryRows([entryTemplate])[0]!
    const ids = pageMenuItems(row).flatMap((item) =>
      item.type === "item" ? [item.id] : [],
    )

    expect(ids).toContain("details")
    expect(ids).toContain("composer")
  })
})
