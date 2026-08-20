// @vitest-environment jsdom

import { defineComponent, h, nextTick, ref } from "vue"
import { describe, expect, it, vi } from "vitest"
import type { PropValue } from "../../../../shared/composer/types"
import ComposerClassEditor from "./ComposerClassEditor.vue"
import ComposerClassTagChip from "./ComposerClassTagChip.vue"
import {
  mount,
  mountInspectorHeaderSelection,
} from "./InspectorParityComponents.testHarness"

describe("Inspector classes", () => {
  it("keeps class activation and removal as distinct native controls", async () => {
    const activate = vi.fn()
    const remove = vi.fn()
    const host = mount(ComposerClassTagChip, {
      label: ".hero",
      variant: "custom",
      activatable: true,
      onActivate: activate,
      onRemove: remove,
    })

    const buttons = [...host.querySelectorAll("button")]
    expect(buttons).toHaveLength(2)
    expect(buttons[0]?.getAttribute("aria-label")).toContain(".hero")
    expect(buttons[1]?.getAttribute("aria-label")).toContain(".hero")
    buttons[0]?.click()
    buttons[1]?.click()
    await nextTick()
    expect(activate).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
  })

  it("overlays utility removal without reserving a permanent end gap", () => {
    const host = mount(ComposerClassTagChip, {
      label: "lg:py-4",
      variant: "utility",
    })

    const chip = host.querySelector(".class-tag-chip") as HTMLElement
    const remove = host.querySelector(".class-tag-remove") as HTMLButtonElement
    expect(chip.dataset.removeLayout).toBe("overlay")
    expect(remove.classList.contains("class-tag-remove")).toBe(true)
    expect(remove.getAttribute("aria-label")).toContain("lg:py-4")
  })

  it("overlays custom removal without changing chip width", () => {
    const host = mount(ComposerClassTagChip, {
      label: ".hero",
      variant: "custom",
      activatable: true,
    })

    const chip = host.querySelector(".class-tag-chip") as HTMLElement
    const remove = host.querySelector(".class-tag-remove") as HTMLButtonElement
    expect(chip.dataset.removeLayout).toBe("overlay")
    expect(remove.classList.contains("class-tag-remove")).toBe(true)
  })

  it("keeps the class picker open while its input is clicked again", async () => {
    const host = mount(ComposerClassEditor, {
      classText: "",
      isExpr: false,
      opaque: false,
      renderedClasses: [],
    })
    const input = host.querySelector("input") as HTMLInputElement
    input.focus()
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(document.querySelector('[data-slot="popover-content"][data-state="open"]')).not.toBeNull()

    input.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }))
    input.click()
    await nextTick()
    expect(document.querySelector('[data-slot="popover-content"][data-state="open"]')).not.toBeNull()
  })

  it("places the unchanged class editor surface directly below the merged header", () => {
    const host = mount(ComposerClassEditor, {
      classText: "bg-card text-card-foreground",
      isExpr: false,
      opaque: false,
      renderedClasses: [],
    })
    const surface = host.firstElementChild as HTMLElement

    expect(host.querySelector('[data-inspector-section="Classes"]')).toBeNull()
    expect(surface.classList.contains("bg-muted/50")).toBe(true)
    expect(host.querySelector('input[aria-label="Add or create a class…"]')).not.toBeNull()
    expect(host.textContent).toContain("bg-card")
    expect(host.textContent).toContain("text-card-foreground")
  })

  it("renders stylesheet classes as selectable custom chips", async () => {
    const activate = vi.fn()
    const host = mount(ComposerClassEditor, {
      classText: "project-heading test",
      isExpr: false,
      opaque: false,
      renderedClasses: [],
      customClassNames: ["project-heading", "test"],
      onActivateClass: activate,
    })

    const editTest = [...host.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-label")?.includes(".test")
      && button.getAttribute("aria-label")?.toLowerCase().includes("edit"),
    ) as HTMLButtonElement
    expect(editTest).toBeDefined()
    editTest.click()
    await nextTick()
    expect(activate).toHaveBeenCalledWith("test")
  })

  it("hides a detached class while the canvas still echoes its old classList", async () => {
    const setClass = vi.fn()
    const source = ref(["hero-title", "aria-4jbd2"])
    const Harness = defineComponent({
      setup() {
        return () => h(ComposerClassEditor, {
          classText: source.value.join(" "),
          sourceClassNames: source.value,
          isExpr: false,
          opaque: false,
          // Deliberately remain stale after the source update.
          renderedClasses: ["hero-title", "aria-4jbd2"],
          customClassNames: ["hero-title", "aria-4jbd2"],
          onSetClass: (value: PropValue | undefined, immediate: boolean) => {
            setClass(value, immediate)
            source.value = value?.type === "string"
              ? value.value.split(/\s+/).filter(Boolean)
              : []
          },
        })
      },
    })
    const host = mount(Harness)

    const remove = [...host.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-label")?.includes(".aria-4jbd2")
      && button.getAttribute("aria-label")?.toLowerCase().includes("remove"),
    ) as HTMLButtonElement
    expect(remove).toBeDefined()
    remove.click()
    await nextTick()

    expect(setClass).toHaveBeenCalledWith(
      { type: "string", value: "hero-title" },
      true,
    )
    expect(host.textContent).not.toContain("aria-4jbd2")
  })

  it("replaces the element name with selected-class actions and keeps pseudo before edit", async () => {
    const { host, actions } = mountInspectorHeaderSelection("hero-card")
    const directActionLabels = [...host.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label"),
    )
    expect(host.textContent).toContain(".hero-card")
    expect(host.textContent).not.toContain("Hero")
    expect(host.querySelector(".text-muted-foreground")?.textContent).toContain(".hero-card")
    expect(directActionLabels).toContain("Custom class pseudo states")
    expect(directActionLabels).toContain("Paste class styles")
    expect(directActionLabels).toContain("Edit class CSS")
    expect(directActionLabels).toContain("Done editing class")
    expect(directActionLabels).not.toContain("Copy class styles")
    expect(directActionLabels).not.toContain("Rename class")
    expect(directActionLabels.indexOf("Custom class pseudo states")).toBeLessThan(
      directActionLabels.indexOf("Edit class CSS"),
    )
    const actionGroup = host.querySelector("[data-aria-class-header-actions]") as HTMLElement
    expect(actionGroup.classList.contains("gap-0")).toBe(true)
    for (const label of ["Paste class styles", "Edit class CSS", "Done editing class", "More class actions"]) {
      const action = host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement
      expect(action.classList.contains("size-6")).toBe(true)
      expect(action.classList.contains("cursor-pointer")).toBe(true)
    }
    const pseudo = host.querySelector('button[aria-label="Custom class pseudo states"]') as HTMLButtonElement
    expect(pseudo.classList.contains("size-6")).toBe(true)
    expect((pseudo.querySelector("svg") as SVGElement).style.getPropertyValue("--app-icon-size")).toBe("12px")

    ;(host.querySelector('button[aria-label="Edit class CSS"]') as HTMLButtonElement).click()
    expect(actions.editCss).toHaveBeenCalledOnce()

    const more = [...host.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-label")?.toLowerCase().includes("more"),
    ) as HTMLButtonElement
    more.click()
    await nextTick()

    const menu = document.querySelector('[role="menu"]') as HTMLElement
    expect(menu.textContent).toContain("Copy class styles")
    expect(menu.textContent).toContain("Paste class styles")
    expect(menu.textContent).toContain("Edit class CSS")
    expect(menu.textContent).toContain("Rename class")
    expect(menu.textContent).toContain("Duplicate for element")
    expect(menu.textContent).toContain("Remove from element")
  })

  it("renders discovered-only classes without a destructive control", () => {
    const host = mount(ComposerClassTagChip, {
      label: "runtime-only",
      variant: "rendered",
      removable: false,
    })
    expect(host.querySelectorAll("button")).toHaveLength(1)
    expect((host.querySelector("button") as HTMLButtonElement).disabled).toBe(true)
  })
})
