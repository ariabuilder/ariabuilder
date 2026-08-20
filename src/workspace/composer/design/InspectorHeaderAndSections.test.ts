// @vitest-environment jsdom

import { createApp, h, nextTick } from "vue"
import { describe, expect, it, vi } from "vitest"
import ComposerInspectorHeader from "../chrome/ComposerInspectorHeader.vue"
import ComposerInspectorHost from "../chrome/ComposerInspectorHost.vue"
import ComposerDesignToolsDialog from "./ComposerDesignToolsDialog.vue"
import InspectorBreakpointIndicators from "./InspectorBreakpointIndicators.vue"
import InspectorPropertySection from "./InspectorPropertySection.vue"
import {
  mount,
  mounted,
  mountInspectorHeaderSelection,
  mountWithTooltipProvider,
} from "./InspectorParityComponents.testHarness"

describe("Inspector header and sections", () => {
  it("keeps workspace-level design tools out of the element selection header", () => {
    const host = mountWithTooltipProvider(ComposerInspectorHeader)
    expect(
      host.querySelector('button[aria-label="Classes and variables"]'),
    ).toBeNull()
  })

  it("uses the requested Inspector header surfaces with the Conditions action", () => {
    const { host } = mountInspectorHeaderSelection()
    const header = host.firstElementChild as HTMLElement
    expect(header.textContent).toContain("Hero")
    expect(header.querySelector('button[aria-label="Conditions"]')).not.toBeNull()
    expect(header.classList.contains("bg-background/50")).toBe(true)
    expect(header.classList.contains("dark:bg-sidebar/50")).toBe(true)
  })

  it("keeps the selection controls exposed directly below the switching Inspector tabs", async () => {
    const host = mount(ComposerInspectorHost)
    const tabs = host.querySelector("[data-aria-composer-inspector-tabs]")
    const context = host.querySelector("[data-aria-composer-inspector-context]")
    const tabButtons = [...(tabs?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]

    expect(tabs).not.toBeNull()
    expect(context).not.toBeNull()
    expect(tabs?.nextElementSibling).toBe(context)
    expect(context?.nextElementSibling?.textContent).toContain("Select an element")
    expect(tabButtons).toHaveLength(3)
    expect(tabButtons[0]?.getAttribute("aria-selected")).toBe("true")

    tabButtons[1]?.click()
    await nextTick()
    expect(tabButtons[1]?.getAttribute("aria-selected")).toBe("true")

    tabButtons[2]?.click()
    await nextTick()
    expect(tabButtons[2]?.getAttribute("aria-selected")).toBe("true")
    expect(tabs?.nextElementSibling).toBe(context)
  })

  it("opens the class and variable editors as an accessible modal workbench", async () => {
    const updateOpen = vi.fn()
    mount(ComposerDesignToolsDialog, {
      open: true,
      "onUpdate:open": updateOpen,
    })
    await nextTick()

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog).not.toBeNull()
    expect(dialog.textContent).toContain("Class Manager")
    expect(dialog.textContent).toContain("Variable Manager")
    expect(dialog.textContent).toContain("Manage your classes")
    expect(dialog.textContent).toContain("Manage your variables")

    const tabs = [...dialog.querySelectorAll('[role="tab"]')] as HTMLButtonElement[]
    expect(tabs).toHaveLength(2)
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true")
    tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
    }))
    await nextTick()
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(tabs[1])
  })

  it("exposes section changes and a separately operable reset action", async () => {
    const reset = vi.fn()
    const host = mount(InspectorPropertySection, {
      title: "Typography",
      hasChanges: true,
      showReset: true,
      resetLabel: "Reset Typography",
      onReset: reset,
    })

    const indicator = host.querySelector('[data-testid="property-change-indicator"]') as HTMLElement
    expect(indicator).not.toBeNull()
    indicator.click()
    await nextTick()
    expect((host.querySelector('button[data-slot="collapsible-trigger"]') as HTMLButtonElement).getAttribute("aria-expanded")).toBe("true")
    const button = host.querySelector('[data-testid="property-reset-button"]') as HTMLButtonElement
    expect(button.getAttribute("aria-label")).toBe("Reset Typography")
    button.click()
    await nextTick()
    expect(reset).toHaveBeenCalledOnce()
    expect((host.querySelector('button[data-slot="collapsible-trigger"]') as HTMLButtonElement).getAttribute("aria-expanded")).toBe("true")
  })

  it("keeps chevron-free section headers keyboard operable", async () => {
    const host = mount(InspectorPropertySection, { title: "Display" })
    const trigger = host.querySelector('button[data-slot="collapsible-trigger"]') as HTMLButtonElement
    expect(trigger).not.toBeNull()
    expect(trigger.tagName).toBe("BUTTON")
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(trigger.querySelector("svg")).toBeNull()

    // Native button activation is the Enter/Space keyboard contract; jsdom does
    // not synthesize the follow-up click for keyboard events.
    trigger.click()
    await nextTick()
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
  })

  it("shows exact breakpoint metadata and switches targets without toggling the section", async () => {
    const select = vi.fn()
    const host = mount(InspectorPropertySection, {
      title: "Size",
      open: true,
    })
    const trigger = host.querySelector('button[data-slot="collapsible-trigger"]') as HTMLButtonElement
    const app = createApp({
      render: () => h(InspectorBreakpointIndicators, {
        breakpoints: [
          { id: "base", label: "Base", width: null, isCurrent: false },
          { id: "content-wide", label: "Content wide", width: 920, isCurrent: true },
          { id: "cinema", label: "Cinema", width: 1440, isCurrent: false },
        ],
        onSelect: select,
      }),
    })
    const actions = document.createElement("div")
    host.append(actions)
    app.mount(actions)
    mounted.push(() => app.unmount())

    const current = actions.querySelector('[data-testid="breakpoint-indicator-content-wide"]') as HTMLButtonElement
    expect(current.getAttribute("aria-label")).toContain("Content wide")
    expect(current.getAttribute("aria-label")).toContain("920px")
    expect(current.getAttribute("aria-pressed")).toBe("true")
    const before = trigger.getAttribute("aria-expanded")
    current.click()
    await nextTick()
    expect(select).toHaveBeenCalledWith("content-wide")
    expect(trigger.getAttribute("aria-expanded")).toBe(before)
  })
})
