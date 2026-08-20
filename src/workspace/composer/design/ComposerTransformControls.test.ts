// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref, type Component } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import ComposerTransformControls from "./ComposerTransformControls.vue"

const mounted: Array<() => void> = []

function mount(component: Component, props: Record<string, unknown> = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({ render: () => h(component, props) })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return host
}

function inputValue(host: HTMLElement, testId: string) {
  return (host.querySelector(`[data-testid="${testId}"] input`) as HTMLInputElement | null)?.value ?? ""
}

async function commitInput(host: HTMLElement, testId: string, value: string) {
  const input = host.querySelector(`[data-testid="${testId}"] input`) as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
  await nextTick()
  input.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
  await nextTick()
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

const FULL_TRANSFORM =
  "translate(12px, 18px) rotate(15deg) scale(1.1, 1.2) skew(2deg, 4deg)"

describe("ComposerTransformControls", () => {
  it("hydrates from composite transform and origin", () => {
    const host = mount(ComposerTransformControls, {
      transform: FULL_TRANSFORM,
      transformOrigin: "left top",
    })

    expect(inputValue(host, "transform-translate-x-input")).toBe("12px")
    expect(inputValue(host, "transform-translate-y-input")).toBe("18px")
    expect(inputValue(host, "transform-rotate-input")).toBe("15deg")
    expect(inputValue(host, "transform-scale-x-input")).toBe("1.1")
    expect(inputValue(host, "transform-scale-y-input")).toBe("1.2")
    expect(inputValue(host, "transform-skew-x-input")).toBe("2deg")
    expect(inputValue(host, "transform-skew-y-input")).toBe("4deg")
    expect(inputValue(host, "transform-origin-x-input")).toBe("left")
    expect(inputValue(host, "transform-origin-y-input")).toBe("top")
  })

  it("hydrates leftover individual translate/rotate/scale properties", () => {
    const host = mount(ComposerTransformControls, {
      transform: "",
      transformOrigin: "center",
      translate: "8px 4px",
      rotate: "45deg",
      scale: "1.5",
    })

    expect(inputValue(host, "transform-translate-x-input")).toBe("8px")
    expect(inputValue(host, "transform-translate-y-input")).toBe("4px")
    expect(inputValue(host, "transform-rotate-input")).toBe("45deg")
    expect(inputValue(host, "transform-scale-x-input")).toBe("1.5")
    expect(inputValue(host, "transform-scale-y-input")).toBe("1.5")
    expect(inputValue(host, "transform-origin-x-input")).toBe("center")
    expect(inputValue(host, "transform-origin-y-input")).toBe("center")
  })

  it("commits rotate as a full transform string and clears leftover individual props", async () => {
    const commit = vi.fn()
    const host = mount(ComposerTransformControls, {
      transform: FULL_TRANSFORM,
      transformOrigin: "left top",
      translate: "99px",
      rotate: "1deg",
      scale: "3",
      onCommit: commit,
    })

    await commitInput(host, "transform-rotate-input", "45deg")

    expect(commit).toHaveBeenCalledWith({
      transform:
        "translate(12px, 18px) rotate(45deg) scale(1.1, 1.2) skew(2deg, 4deg)",
      translate: "",
      rotate: "",
      scale: "",
    })
  })

  it("writes only transform-origin when an origin preset is clicked", async () => {
    const commit = vi.fn()
    const host = mount(ComposerTransformControls, {
      transform: FULL_TRANSFORM,
      transformOrigin: "left top",
      onCommit: commit,
    })

    ;(host.querySelector('[data-testid="transform-origin-center-center"]') as HTMLButtonElement).click()
    await nextTick()

    expect(commit).toHaveBeenCalledWith({
      "transform-origin": "",
    })
  })

  it("renders the preview subject and origin anchor from current state", () => {
    const host = mount(ComposerTransformControls, {
      transform: FULL_TRANSFORM,
      transformOrigin: "left top",
    })

    const subject = host.querySelector('[data-testid="transform-preview-subject"]') as HTMLElement
    const anchor = host.querySelector('[data-testid="transform-preview-origin-anchor"]') as HTMLElement
    expect(subject.getAttribute("style")).toContain("translate(12px, 18px)")
    expect(subject.getAttribute("style")).toContain("transform-origin: left top")
    expect(anchor.getAttribute("style")).toContain("left: 0%")
    expect(anchor.getAttribute("style")).toContain("top: 0%")
  })

  it("does not mirror unlinked translate axes", async () => {
    const commit = vi.fn()
    const host = mount(ComposerTransformControls, {
      transform: "translate(12px, 18px)",
      transformOrigin: "center center",
      onCommit: commit,
    })

    expect(
      (host.querySelector('[data-testid="transform-translate-link-toggle"]') as HTMLButtonElement)
        .getAttribute("aria-pressed"),
    ).toBe("false")

    await commitInput(host, "transform-translate-x-input", "24px")

    expect(commit).toHaveBeenCalledWith({
      transform: "translate(24px, 18px)",
      translate: "",
      rotate: "",
      scale: "",
    })
    expect(inputValue(host, "transform-translate-y-input")).toBe("18px")
  })

  it("does not commit when a transform field blurs unchanged", async () => {
    const commit = vi.fn()
    const host = mount(ComposerTransformControls, {
      transform: "",
      transformOrigin: "",
      onCommit: commit,
    })

    await commitInput(host, "transform-translate-x-input", "0px")
    expect(commit).not.toHaveBeenCalled()
  })

  it("keeps unlinked equal axes unlinked after another field commits", async () => {
    const transform = ref("scale(1, 1)")
    const commit = vi.fn((updates: Record<string, string>) => {
      if (updates.transform !== undefined) transform.value = updates.transform
    })
    const Harness = defineComponent({
      setup() {
        return () => h(ComposerTransformControls, {
          transform: transform.value,
          transformOrigin: "",
          onCommit: commit,
        })
      },
    })
    const host = mount(Harness)

    const link = host.querySelector('[data-testid="transform-scale-link-toggle"]') as HTMLButtonElement
    expect(link.getAttribute("aria-pressed")).toBe("true")
    link.click()
    await nextTick()
    expect(link.getAttribute("aria-pressed")).toBe("false")

    await commitInput(host, "transform-rotate-input", "45deg")
    expect(commit).toHaveBeenCalled()
    expect(
      (host.querySelector('[data-testid="transform-scale-link-toggle"]') as HTMLButtonElement)
        .getAttribute("aria-pressed"),
    ).toBe("false")

    await commitInput(host, "transform-scale-x-input", "1.4")
    expect(commit).toHaveBeenLastCalledWith({
      transform: "rotate(45deg) scale(1.4, 1)",
      translate: "",
      rotate: "",
      scale: "",
    })
  })

  it("hydrates translateX without dropping it on rotate edits", async () => {
    const commit = vi.fn()
    const host = mount(ComposerTransformControls, {
      transform: "translateX(10px) rotate(15deg)",
      transformOrigin: "",
      onCommit: commit,
    })

    expect(inputValue(host, "transform-translate-x-input")).toBe("10px")
    await commitInput(host, "transform-rotate-input", "45deg")
    expect(commit).toHaveBeenCalledWith({
      transform: "translate(10px, 0px) rotate(45deg)",
      translate: "",
      rotate: "",
      scale: "",
    })
  })

  it("does not warn for nested calc or var in supported functions", () => {
    const host = mount(ComposerTransformControls, {
      transform: "translate(calc(10px + 4px)) rotate(var(--angle))",
      transformOrigin: "",
    })
    expect(host.textContent).not.toContain(
      "Unsupported transform functions will be replaced if you edit this section.",
    )
  })

  it("warns when the authored transform uses unsupported functions", () => {
    const host = mount(ComposerTransformControls, {
      transform: "matrix(1, 0, 0, 1, 10, 20)",
      transformOrigin: "center center",
    })

    expect(host.textContent).toContain(
      "Unsupported transform functions will be replaced if you edit this section.",
    )
  })
})
