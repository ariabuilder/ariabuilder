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
const pageSwitcher = fs.readFileSync(
  path.join(import.meta.dirname, "../PageSwitcher.vue"),
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
    expect(composerSurface).toContain("openDesignTools,")
    expect(composerSurface).toContain("openComposerCanvasTarget,")
    expect(inspectorHost).toContain("defineExpose({ activateTab, openDesignTools })")
    expect(inspectorHost).toContain('<ComposerDesignToolsDialog v-model:open="designToolsOpen" />')
  })

  it("merges the Composer edit trail into the page switcher", () => {
    expect(workspaceHeader).toContain(":composer-edit-trail=\"composerEditTrail\"")
    expect(workspaceHeader).not.toContain("data-aria-composer-edit-stack")
    expect(pageSwitcher).toContain("data-aria-composer-edit-stack")
    expect(pageSwitcher).toContain('aria-label="Composer location"')
    expect(pageSwitcher).toContain('aria-current="page"')
    expect(pageSwitcher).toContain("hiddenComposerAncestors")
    expect(workspaceShell).toContain(':composer-edit-trail="session.rail === \'composer\' ? composerEditTrail : []"')
    expect(workspaceShell).toContain('@edit-trail-change="composerEditTrail = $event"')
    expect(composerSurface).toContain('emit("edit-trail-change"')
    expect(composerSurface).toContain("goToStackIndex,")

    const canvasBar = fs.readFileSync(
      path.join(import.meta.dirname, "chrome/ComposerCanvasBar.vue"),
      "utf8",
    )
    expect(canvasBar).not.toContain("data-aria-composer-edit-stack")
    expect(canvasBar).not.toContain("composer_drill_trail")
  })

  it("opens exact canvas instances before the existing document groups", () => {
    const canvasGroup = pageSwitcher.indexOf('{ kind: "canvas", label: () => "On this canvas" }')
    const pagesGroup = pageSwitcher.indexOf('{ kind: "page", label: () =>')
    expect(canvasGroup).toBeGreaterThan(-1)
    expect(canvasGroup).toBeLessThan(pagesGroup)
    expect(pageSwitcher).toContain("composerCanvasResults.value")
    expect(pageSwitcher).toContain("result.detail.toLocaleLowerCase().includes(normalizedQuery)")
    expect(pageSwitcher).toContain("onOpenComposerCanvasTarget?.(result.targetId)")
    expect(workspaceShell).toContain('@canvas-targets-change="composerCanvasTargets = $event"')
    expect(composerSurface).toContain('emit("canvas-targets-change", targets)')
    expect(composerSurface).toContain("openCanvasTargetThroughInstanceChain")
    expect(composerSurface).toContain("occurrence: row.instance?.occurrence ?? 0")
    expect(composerSurface).toContain("return onStructureNavigate(row, true)")
  })

  it("preserves the compact create footer and its three existing actions", () => {
    expect(pageSwitcher).toContain("border-t border-dashed border-border px-4 py-2")
    expect(pageSwitcher).toContain("m.global_search_group_create()")
    expect(pageSwitcher).toContain('v-for="result in createResults"')
    expect(pageSwitcher).toContain('size="icon-sm"')
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
