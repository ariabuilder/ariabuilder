import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const workspaceHeader = fs.readFileSync(
  path.join(import.meta.dirname, "../WorkspaceHeader.vue"),
  "utf8",
)
const workspaceShell = fs.readFileSync(
  path.join(import.meta.dirname, "../WorkspaceShell.vue"),
  "utf8",
)
const composerSurface = fs.readFileSync(
  path.join(import.meta.dirname, "ComposerSurface.vue"),
  "utf8",
)
const inspectorHost = fs.readFileSync(
  path.join(import.meta.dirname, "chrome/ComposerInspectorHost.vue"),
  "utf8",
)
const composerLeftPanel = fs.readFileSync(
  path.join(import.meta.dirname, "chrome/ComposerLeftPanel.vue"),
  "utf8",
)

describe("Composer workspace header actions", () => {
  it("places classes and variables immediately before the live-site action", () => {
    const designTools = workspaceHeader.indexOf("data-aria-composer-design-tools")
    const liveSite = workspaceHeader.indexOf('<AppIcon name="externalLink"')

    expect(workspaceHeader).toContain('v-if="session.rail === \'composer\'"')
    expect(workspaceHeader).toContain('@click="onOpenComposerDesignTools"')
    expect(workspaceHeader).toContain('class="text-muted-foreground/80 hover:text-foreground"')
    expect(designTools).toBeGreaterThan(-1)
    expect(liveSite).toBeGreaterThan(designTools)
  })

  it("hides Agent activation in Composer and keeps it on Studio rails", () => {
    const liveSite = workspaceHeader.indexOf('<AppIcon name="externalLink"')
    const agentActivation = workspaceHeader.indexOf("data-aria-agent-activation")

    expect(workspaceHeader).toContain('v-if="session.rail !== \'composer\'"')
    expect(workspaceHeader).toContain('@click="onToggleAgent"')
    expect(workspaceHeader).toContain(':aria-pressed="agentOpen"')
    expect(workspaceHeader).toContain("agentOpen ? 'Close' : 'Open'")
    expect(agentActivation).toBeGreaterThan(liveSite)
    expect(workspaceShell).toContain(':on-toggle-agent="toggleAgentPanel"')
    expect(workspaceShell).not.toContain("<AgentFab")
  })

  it("keeps the header action connected to the existing Composer dialog", () => {
    expect(workspaceShell).toContain(':on-open-composer-design-tools="openComposerDesignTools"')
    expect(workspaceShell).toContain('ref="composerSurfaceRef"')
    expect(composerSurface).toContain("defineExpose({ openDesignTools })")
    expect(inspectorHost).toContain("defineExpose({ activateTab, openDesignTools })")
    expect(inspectorHost).toContain('<ComposerDesignToolsDialog v-model:open="designToolsOpen" />')
  })

  it("hosts Aria Engineer as the Composer left-panel agent tab", () => {
    expect(workspaceShell).toContain(
      'v-if="agentOpen && agentDocked && session.rail !== \'composer\'"',
    )
    expect(workspaceShell).toContain(
      'v-if="!agentDocked && session.rail !== \'composer\'"',
    )
    expect(workspaceShell).toContain(':agent-shell-context="agentShellContext"')
    expect(composerSurface).toContain(':agent-shell-context="agentShellContext"')
    expect(composerLeftPanel).toContain('id: "agent"')
    expect(composerLeftPanel).toContain("<AgentComposerDock")
    expect(composerLeftPanel).toContain('v-show="activeTab === \'agent\'"')
    expect(composerLeftPanel).toContain(':project-path="projectPath"')
    expect(composerLeftPanel).not.toContain('id: "components"')
  })

  it("uses the all-breakpoints board for Preview and header buttons to isolate a device", () => {
    expect(composerSurface).toContain("<ComposerBreakpointBoard")
    expect(composerSurface).toContain('v-if="showStage && isPreviewImmersive"')
    expect(composerSurface).toContain(':isolated-device="previewIsolatedDevice ?? null"')
    expect(workspaceShell).toContain(
      ':show-composer-viewport-controls="session.rail === \'composer\' && composerPreviewImmersive"',
    )
    expect(workspaceShell).toContain(":preview-isolated-device=")
    expect(workspaceHeader).toContain("allow-deselect")
    expect(workspaceHeader).toContain(":device=\"previewIsolatedDevice ?? null\"")
    expect(workspaceHeader).not.toContain(':device="session.device"')
    expect(workspaceShell).toContain("previewIsolatedDevice.value = device")
    expect(workspaceShell).not.toContain("onDeviceChange(device)")
  })
})
