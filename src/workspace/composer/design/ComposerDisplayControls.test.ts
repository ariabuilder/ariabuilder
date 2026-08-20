// @vitest-environment jsdom

import { createApp, h, nextTick, type Component } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import ComposerDisplayControls from "./ComposerDisplayControls.vue"

const mounted: Array<() => void> = []

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
})

function mount(component: Component, props: Record<string, unknown> = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({ render: () => h(component, props) })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return host
}

function row(host: HTMLElement, property: string) {
  return host.querySelector(`[data-display-property="${property}"]`) as HTMLElement | null
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

describe("ComposerDisplayControls", () => {
  it("shows mode, overflow, and visibility for block/unset without flex or grid extras", () => {
    const host = mount(ComposerDisplayControls, {
      values: {},
      elementTag: "div",
    })
    const content = host.querySelector('[data-testid="composer-display-controls"]') as HTMLElement
    expect(content).not.toBeNull()
    expect(content.textContent).toContain("Mode")
    expect(content.textContent).toContain("Overflow")
    expect(content.textContent).toContain("Visible")
    expect(row(host, "display")).not.toBeNull()
    expect(row(host, "display")?.dataset.resolvedDisplay).toBe("block")
    expect(row(host, "overflow")).not.toBeNull()
    expect(row(host, "visibility")).not.toBeNull()
    expect(row(host, "flex-direction")).toBeNull()
    expect(row(host, "grid-template-columns")).toBeNull()
    expect(row(host, "gap")).toBeNull()
    expect(row(host, "flow-tolerance")).toBeNull()
    expect(row(host, "grid-column")).toBeNull()
  })

  it("uses a tag-aware default display without writing CSS", () => {
    const commit = vi.fn()
    const host = mount(ComposerDisplayControls, {
      values: {},
      elementTag: "span",
      onCommit: commit,
    })
    expect(row(host, "display")?.dataset.resolvedDisplay).toBe("inline")
    expect(row(host, "flex-direction")).toBeNull()
    expect(commit).not.toHaveBeenCalled()
  })

  it("renders flex direction, wrap, justify, items, content, and gap", () => {
    const host = mount(ComposerDisplayControls, {
      values: { display: "flex", gap: "16px" },
    })
    expect(row(host, "flex-direction")).not.toBeNull()
    expect(row(host, "flex-wrap")).not.toBeNull()
    expect(row(host, "justify-content")).not.toBeNull()
    expect(row(host, "align-items")).not.toBeNull()
    expect(row(host, "align-content")).not.toBeNull()
    expect(row(host, "gap")).not.toBeNull()
    expect(row(host, "grid-template-columns")).toBeNull()
    expect(row(host, "justify-items")).toBeNull()
    expect(
      (row(host, "gap")?.querySelector("input") as HTMLInputElement).value,
    ).toBe("16px")
    expect(row(host, "flex-direction")?.querySelectorAll('[role="radio"]')).toHaveLength(2)
    expect(row(host, "flex-wrap")?.querySelectorAll('[role="radio"]')).toHaveLength(3)
    expect(row(host, "justify-content")?.querySelectorAll('[role="radio"]')).toHaveLength(4)
    expect(row(host, "align-items")?.querySelectorAll('[role="radio"]')).toHaveLength(4)
    expect(row(host, "align-content")?.querySelectorAll('[role="radio"]')).toHaveLength(5)
  })

  it("renders grid templates, alignment groups, presets, and gap", () => {
    const host = mount(ComposerDisplayControls, {
      values: {
        display: "grid",
        "grid-template-columns": "repeat(3, 1fr)",
        "grid-template-rows": "auto",
      },
    })
    expect(row(host, "grid-template-columns")).not.toBeNull()
    expect(row(host, "grid-template-rows")).not.toBeNull()
    expect(row(host, "justify-content")).not.toBeNull()
    expect(row(host, "align-content")).not.toBeNull()
    expect(row(host, "justify-items")).not.toBeNull()
    expect(row(host, "align-items")).not.toBeNull()
    expect(row(host, "gap")).not.toBeNull()
    expect(row(host, "flex-direction")).toBeNull()
    expect(row(host, "flow-tolerance")).toBeNull()
    expect(host.querySelector('[data-testid="grid-cols-helper-trigger"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="grid-rows-helper-trigger"]')).not.toBeNull()
    expect(row(host, "justify-content")?.querySelectorAll('[role="radio"]')).toHaveLength(5)
    expect(row(host, "justify-items")?.querySelectorAll('[role="radio"]')).toHaveLength(4)
    expect(row(host, "align-items")?.querySelectorAll('[role="radio"]')).toHaveLength(4)
  })

  it("shows flow tolerance for grid-lanes", () => {
    const host = mount(ComposerDisplayControls, {
      values: { display: "grid-lanes", "flow-tolerance": "1em" },
    })
    expect(row(host, "grid-template-columns")).not.toBeNull()
    expect(row(host, "flow-tolerance")).not.toBeNull()
    expect(
      (row(host, "flow-tolerance")?.querySelector("input") as HTMLInputElement).value,
    ).toBe("1em")
  })

  it("shows span when the parent is a grid, independent of the child's display", () => {
    const host = mount(ComposerDisplayControls, {
      values: { display: "block", "grid-column": "span 2" },
      parentIsGrid: true,
    })
    expect(row(host, "grid-column")).not.toBeNull()
    expect(
      (row(host, "grid-column")?.querySelector("input") as HTMLInputElement).value,
    ).toBe("span 2")
    expect(row(host, "flex-direction")).toBeNull()
  })

  it("hides span when the parent is not a grid", () => {
    const host = mount(ComposerDisplayControls, {
      values: { display: "block" },
      parentIsGrid: false,
    })
    expect(row(host, "grid-column")).toBeNull()
  })

  it("toggles visibility between visible and hidden", async () => {
    const commit = vi.fn()
    const host = mount(ComposerDisplayControls, {
      values: {},
      onCommit: commit,
    })
    const visibilitySwitch = host.querySelector('[data-testid="display-visible-switch"]') as HTMLButtonElement
    expect(visibilitySwitch).not.toBeNull()
    expect(visibilitySwitch.getAttribute("aria-checked") ?? visibilitySwitch.getAttribute("data-state")).toMatch(/true|checked/)
    visibilitySwitch.click()
    await nextTick()
    expect(commit).toHaveBeenCalledWith("visibility", "hidden")
  })

  it("restores visibility when the switch is turned back on", async () => {
    const commit = vi.fn()
    const host = mount(ComposerDisplayControls, {
      values: { visibility: "hidden" },
      onCommit: commit,
    })
    const visibilitySwitch = host.querySelector('[data-testid="display-visible-switch"]') as HTMLButtonElement
    visibilitySwitch.click()
    await nextTick()
    expect(commit).toHaveBeenCalledWith("visibility", "visible")
  })

  it("commits a grid column preset from the helper popover", async () => {
    const commit = vi.fn()
    const host = mount(ComposerDisplayControls, {
      values: { display: "grid" },
      onCommit: commit,
    })
    const trigger = host.querySelector('[data-testid="grid-cols-helper-trigger"]') as HTMLButtonElement
    trigger.click()
    await nextTick()
    const preset = document.querySelector('[data-testid="grid-cols-preset-three-columns"]') as HTMLButtonElement
    expect(preset).not.toBeNull()
    preset.click()
    await nextTick()
    expect(commit).toHaveBeenCalledWith("grid-template-columns", "repeat(3, minmax(0, 1fr))")
  })

  it("treats start/end as selected for flex alignment aliases", () => {
    const host = mount(ComposerDisplayControls, {
      values: { display: "flex", "justify-content": "start", "align-items": "end" },
    })
    expect(
      row(host, "justify-content")?.querySelector('[aria-checked="true"]')?.getAttribute("aria-label"),
    ).toBe("Justify: start")
    expect(
      row(host, "align-items")?.querySelector('[aria-checked="true"]')?.getAttribute("aria-label"),
    ).toBe("Align items: end")
  })

  it("uses keyboard-complete flex alignment radio groups", async () => {
    const commit = vi.fn()
    const host = mount(ComposerDisplayControls, {
      values: { display: "flex", "justify-content": "flex-start" },
      onCommit: commit,
    })
    const current = row(host, "justify-content")?.querySelector('[aria-checked="true"]') as HTMLButtonElement
    expect(current).not.toBeNull()
    current.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }))
    await nextTick()
    expect(commit).toHaveBeenCalledWith("justify-content", "space-between")
  })

  it("disables every native display action", () => {
    const host = mount(ComposerDisplayControls, {
      values: { display: "grid", gap: "8px" },
      parentIsGrid: true,
      disabled: true,
    })
    const content = host.querySelector('[data-testid="composer-display-controls"]') as HTMLElement
    const buttons = [...content.querySelectorAll("button")] as HTMLButtonElement[]
    const inputs = [...content.querySelectorAll("input")] as HTMLInputElement[]
    expect(buttons.length).toBeGreaterThan(0)
    expect(inputs.length).toBeGreaterThan(0)
    expect(buttons.every((button) => button.disabled)).toBe(true)
    expect(inputs.every((input) => input.disabled)).toBe(true)
  })
})
