import { describe, expect, it } from "vitest"
import { useWorkspaceTerminal } from "../composables/useWorkspaceTerminal"

describe("useWorkspaceTerminal", () => {
  it("isolates popover and pending-command state by project", () => {
    const first = useWorkspaceTerminal("/projects/first")
    const second = useWorkspaceTerminal("/projects/second")

    first.openAndRun("npm run build")

    expect(first.open.value).toBe(true)
    expect(second.open.value).toBe(false)
    expect(first.takePendingCommand()).toBe("npm run build")
    expect(second.takePendingCommand()).toBeNull()

    second.openTerminal()
    first.closeTerminal()

    expect(first.open.value).toBe(false)
    expect(second.open.value).toBe(true)
  })
})
