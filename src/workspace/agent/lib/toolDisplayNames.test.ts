import { describe, expect, it } from "vitest"
import { resolvedToolName, toolDisplayName } from "./toolDisplayNames"

describe("agent tool presentation", () => {
  it("shows the typed target of aria_execute_command", () => {
    const target = resolvedToolName("aria_execute_command", {
      command: "aria_save_document",
      input: { file: "src/pages/index.astro" },
    })
    expect(target).toBe("aria_save_document")
    expect(toolDisplayName(target)).toBe("Save document")
  })

  it("keeps the wrapper name when no command is present", () => {
    expect(resolvedToolName("aria_execute_command", {})).toBe(
      "aria_execute_command",
    )
  })
})
