import { describe, expect, it } from "vitest"
import { composerLibraryPanelState } from "./libraryDragPanel"

describe("composerLibraryPanelState", () => {
  it("leaves the active palette panel unchanged when its drag starts", () => {
    expect(
      composerLibraryPanelState(
        "add-elements",
        "add-elements",
        "add-elements",
      ),
    ).toBe("active")
  })

  it("keeps the inactive palette rendered for the native drag session", () => {
    expect(
      composerLibraryPanelState("add-elements", "layers", "add-elements"),
    ).toBe("drag-source")
    expect(
      composerLibraryPanelState("layers", "layers", "add-elements"),
    ).toBe("active")
  })

  it("hides inactive panels outside a library drag", () => {
    expect(
      composerLibraryPanelState("add-elements", "layers", null),
    ).toBe("hidden")
    expect(
      composerLibraryPanelState("layers", "add-elements", null),
    ).toBe("hidden")
  })

  it("hides library palettes when the agent tab is active", () => {
    expect(
      composerLibraryPanelState("add-elements", "agent", null),
    ).toBe("hidden")
    expect(composerLibraryPanelState("layers", "agent", null)).toBe("hidden")
  })
})
