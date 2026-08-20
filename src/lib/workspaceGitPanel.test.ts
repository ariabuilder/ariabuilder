import { describe, expect, it } from "vitest"
import { useWorkspaceGitPanel } from "../composables/useWorkspaceGitPanel"

describe("useWorkspaceGitPanel", () => {
  it("shares open state within one project without leaking to another", () => {
    const key = `project-${Date.now()}`
    const first = useWorkspaceGitPanel(key)
    const second = useWorkspaceGitPanel(key)
    const other = useWorkspaceGitPanel(`${key}-other`)

    first.openGitPanel()
    expect(second.open.value).toBe(true)
    expect(other.open.value).toBe(false)

    second.closeGitPanel()
    expect(first.open.value).toBe(false)
  })
})
