import { describe, expect, it } from "vitest"
import { createComposerBeacon } from "./useComposerBeacon"

describe("Composer Beacon structure hover", () => {
  it("emits reveal intent only for selection sources that should move the canvas", () => {
    const beacon = createComposerBeacon()

    beacon.select({ path: "0.1", occurrence: 0 }, { source: "structure" })
    expect(beacon.revealRequest.value).toMatchObject({
      selection: { path: "0.1", occurrence: 0 },
      policy: "if-needed",
    })
    const firstNonce = beacon.revealRequest.value?.nonce ?? 0

    beacon.select({ path: "0.1", occurrence: 0 }, { source: "structure" })
    expect(beacon.revealRequest.value?.nonce).toBeGreaterThan(firstNonce)

    beacon.select({ path: "0.2", occurrence: 0 }, { source: "canvas" })
    expect(beacon.revealRequest.value?.selection.path).toBe("0.1")

    beacon.illuminate("0.3", { source: "api", reveal: "none" })
    expect(beacon.selectedPath.value).toBe("0.3")
    expect(beacon.revealRequest.value?.selection.path).toBe("0.1")
  })

  it("targets and snapshots the entered component occurrence", () => {
    const beacon = createComposerBeacon()

    beacon.setStructureHover("0.1", 3)

    expect(beacon.structureHoverPath.value).toBe("0.1")
    expect(beacon.structureHoverOccurrence.value).toBe(3)
    expect(beacon.getSnapshot()).toMatchObject({
      structureHoverPath: "0.1",
      structureHoverOccurrence: 3,
    })

    beacon.setStructureHover(null)
    expect(beacon.structureHoverPath.value).toBeNull()
    expect(beacon.structureHoverOccurrence.value).toBeNull()
  })

  it("holds a related-source inspection until a normal selection replaces it", () => {
    const beacon = createComposerBeacon()
    const node = {
      id: "n1",
      kind: "element" as const,
      name: "meta",
      props: {
        name: { type: "string" as const, value: "description" },
        content: { type: "string" as const, value: "Summary" },
      },
      children: [],
    }

    beacon.inspectContext({
      file: "src/layouts/Layout.astro",
      path: "1.0.0",
      label: "Search description",
      node,
      importSpec: "@components/Header.astro",
    })

    expect(beacon.hasSelection.value).toBe(true)
    expect(beacon.selectedPath.value).toBeNull()
    expect(beacon.contextSelection.value).toMatchObject({
      file: "src/layouts/Layout.astro",
      path: "1.0.0",
      node,
      importSpec: "@components/Header.astro",
    })

    beacon.select({ path: "0.1", occurrence: 0 }, { source: "structure" })
    expect(beacon.contextSelection.value).toBeNull()
    expect(beacon.selectedPath.value).toBe("0.1")
  })
})
