// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref, type Component } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WIDTH_SIZING_PROP } from "../../../../shared/composer"
import ComposerSizeControls from "./ComposerSizeControls.vue"

const mounted: Array<() => void> = []

function mount(component: Component, props: Record<string, unknown> = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({ render: () => h(component, props) })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return host
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

describe("ComposerSizeControls", () => {
  it("renders hug/fill/exact controls and constraints without aspect or object-fit", () => {
    const host = mount(ComposerSizeControls, { values: {} })
    const content = host.querySelector('[data-testid="composer-size-controls"]') as HTMLElement
    expect(content).not.toBeNull()
    expect(content.textContent).toContain("Width")
    expect(content.textContent).toContain("Height")
    expect(content.textContent).toContain("Hug")
    expect(content.textContent).toContain("Fill")
    expect(content.textContent).toContain("Exact")
    expect(content.textContent).toContain("Constraints")
    expect(content.textContent).not.toContain("Aspect")
    expect(content.textContent).not.toContain("Object fit")
    expect(content.querySelector('[data-testid="size-width-exact"]')).toBeNull()
    expect(host.querySelectorAll('[data-testid="size-width-mode-group"] [role="radio"]')).toHaveLength(3)
  })

  it("shows the exact input only after Exact is selected and does not save the mode yet", async () => {
    const mode = vi.fn()
    const host = mount(ComposerSizeControls, {
      values: {},
      onMode: mode,
    })

    ;(host.querySelector('[data-testid="size-width-mode-exact"]') as HTMLButtonElement).click()
    await nextTick()
    expect(mode).not.toHaveBeenCalled()
    expect(host.querySelector('[data-testid="size-width-exact"]')).not.toBeNull()
    expect((host.querySelector('[data-testid="size-width-mode-exact"]') as HTMLButtonElement).getAttribute("aria-checked")).toBe("true")
  })

  it("emits hug/fill immediately and commits exact width with sizing metadata", async () => {
    const mode = vi.fn()
    const commit = vi.fn()
    const preview = vi.fn()
    const host = mount(ComposerSizeControls, {
      values: { width: "auto" },
      onMode: mode,
      onCommit: commit,
      onPreview: preview,
    })

    ;(host.querySelector('[data-testid="size-width-mode-fill"]') as HTMLButtonElement).click()
    expect(mode).toHaveBeenCalledWith("width", "fill")

    ;(host.querySelector('[data-testid="size-width-mode-exact"]') as HTMLButtonElement).click()
    await nextTick()
    const input = host.querySelector('[data-testid="size-width-exact"] input') as HTMLInputElement
    expect(input).not.toBeNull()
    input.value = "320"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    expect(preview).toHaveBeenCalledWith({
      width: "320px",
      [WIDTH_SIZING_PROP]: "exact",
    })
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    expect(commit).toHaveBeenCalledWith({
      width: "320px",
      [WIDTH_SIZING_PROP]: "exact",
    })
  })

  it("infers fill from 100% and exact from a pixel width", () => {
    const fill = mount(ComposerSizeControls, { values: { width: "100%" } })
    expect((fill.querySelector('[data-testid="size-width-mode-fill"]') as HTMLButtonElement).getAttribute("aria-checked")).toBe("true")

    const exact = mount(ComposerSizeControls, { values: { width: "480px" } })
    expect((exact.querySelector('[data-testid="size-width-mode-exact"]') as HTMLButtonElement).getAttribute("aria-checked")).toBe("true")
    const input = exact.querySelector('[data-testid="size-width-exact"] input') as HTMLInputElement
    expect(input.value).toBe("480")
  })

  it("leaves modes unselected when sizing is not authored", () => {
    const host = mount(ComposerSizeControls, { values: { width: "auto" } })
    expect((host.querySelector('[data-testid="size-width-mode-hug"]') as HTMLButtonElement).getAttribute("aria-checked")).toBe("false")
    expect((host.querySelector('[data-testid="size-width-mode-fill"]') as HTMLButtonElement).getAttribute("aria-checked")).toBe("false")
    expect((host.querySelector('[data-testid="size-width-mode-exact"]') as HTMLButtonElement).getAttribute("aria-checked")).toBe("false")
    expect(host.querySelector('[data-testid="size-width-exact"]')).toBeNull()
  })

  it("unlocks Exact after cancel so Escape does not keep the input open", async () => {
    const cancelEpoch = ref(0)
    const host = document.createElement("div")
    document.body.append(host)
    const app = createApp(defineComponent({
      setup() {
        return () => h(ComposerSizeControls, {
          values: {},
          cancelEpoch: cancelEpoch.value,
        })
      },
    }))
    app.mount(host)
    mounted.push(() => { app.unmount(); host.remove() })

    ;(host.querySelector('[data-testid="size-width-mode-exact"]') as HTMLButtonElement).click()
    await nextTick()
    expect(host.querySelector('[data-testid="size-width-exact"]')).not.toBeNull()
    cancelEpoch.value += 1
    await nextTick()
    expect(host.querySelector('[data-testid="size-width-exact"]')).toBeNull()
    expect((host.querySelector('[data-testid="size-width-mode-exact"]') as HTMLButtonElement).getAttribute("aria-checked")).toBe("false")
  })

  it("does not treat scrub-start blur as an Exact commit", async () => {
    const commit = vi.fn()
    const host = mount(ComposerSizeControls, {
      values: {},
      onCommit: commit,
    })

    ;(host.querySelector('[data-testid="size-width-mode-exact"]') as HTMLButtonElement).click()
    await nextTick()
    const input = host.querySelector('[data-testid="size-width-exact"] input') as HTMLInputElement
    input.value = "120"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    expect(commit).not.toHaveBeenCalled()
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }))
  })

  it("clears empty constraints instead of writing 0 or none", async () => {
    const preview = vi.fn()
    const commit = vi.fn()
    const values = ref({ "min-width": "12px" })
    const host = document.createElement("div")
    document.body.append(host)
    const app = createApp(defineComponent({
      setup() {
        return () => h(ComposerSizeControls, {
          values: values.value,
          onPreview: (updates: Record<string, string>) => {
            preview(updates)
            values.value = { ...values.value, ...updates }
          },
          onCommit: commit,
        })
      },
    }))
    app.mount(host)
    mounted.push(() => { app.unmount(); host.remove() })

    const minWidth = host.querySelector('[data-testid="size-min-width"] input') as HTMLInputElement
    minWidth.value = ""
    minWidth.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    expect(preview).toHaveBeenCalledWith({ "min-width": "" })
    minWidth.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    expect(commit).toHaveBeenCalledWith({ "min-width": "" })
  })

  it("previews constraint typing and saves only on commit", async () => {
    const preview = vi.fn()
    const commit = vi.fn()
    const values = ref({ "min-width": "0" })
    const host = document.createElement("div")
    document.body.append(host)
    const app = createApp(defineComponent({
      setup() {
        return () => h(ComposerSizeControls, {
          values: values.value,
          onPreview: (updates: Record<string, string>) => {
            preview(updates)
            values.value = { ...values.value, ...updates }
          },
          onCommit: commit,
        })
      },
    }))
    app.mount(host)
    mounted.push(() => { app.unmount(); host.remove() })

    const input = host.querySelector('[data-testid="size-min-width"] input') as HTMLInputElement
    input.value = "12"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    expect(preview).toHaveBeenCalledWith({ "min-width": "12px" })
    expect(commit).not.toHaveBeenCalled()
    input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    await nextTick()
    expect(commit).toHaveBeenCalledWith({ "min-width": "12px" })
  })
})
