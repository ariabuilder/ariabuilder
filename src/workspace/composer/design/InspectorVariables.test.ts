// @vitest-environment jsdom

import { defineComponent, h, nextTick, ref } from "vue"
import { describe, expect, it, vi } from "vitest"
import { ColorField } from "@/components/ui/color-picker"
import {
  VariableAssignableInput,
  VariableReferenceAssignButton,
} from "@/components/ui/variable-reference-picker"
import { mount } from "./InspectorParityComponents.testHarness"

describe("Inspector variables", () => {
  it("reveals the shared trailing variable trigger without reserving row width", () => {
    const direct = mount(VariableAssignableInput, {
      modelValue: "16px",
      options: [{ value: "space-md", label: "Space MD" }],
    })
    const root = direct.firstElementChild as HTMLElement
    const input = direct.querySelector("input") as HTMLInputElement
    const trigger = direct.querySelector("[data-variable-reference-trigger]") as HTMLButtonElement

    expect(root.classList.contains("group/variable")).toBe(true)
    expect([...input.classList].some((name) => name.startsWith("pe-"))).toBe(false)
    expect(trigger.dataset.appearance).toBe("overlay")
    expect(trigger.dataset.assigned).toBe("false")
    expect(trigger.classList.contains("opacity-0")).toBe(true)
    expect(trigger.classList.contains("group-hover/variable:opacity-100")).toBe(true)
    expect(trigger.classList.contains("group-focus-within/variable:opacity-100")).toBe(true)
    expect(trigger.classList.contains("bg-transparent")).toBe(true)
    expect(trigger.classList.contains("shadow-none")).toBe(true)
    expect(trigger.classList.contains("bg-background")).toBe(false)
    expect(trigger.querySelector("svg")?.classList.contains("size-3.5")).toBe(true)
    expect(trigger.getAttribute("aria-label")).toBe("Assign variable")
  })

  it("keeps assigned and open variable triggers visible while preserving the inline exception", async () => {
    const assigned = mount(VariableReferenceAssignButton, {
      modelValue: "var(--space-md)",
      options: [{ value: "space-md", label: "Space MD" }],
      buttonClass: "absolute end-2 top-1/2 -translate-y-1/2",
    })
    const assignedTrigger = assigned.querySelector("button") as HTMLButtonElement
    expect(assignedTrigger.dataset.assigned).toBe("true")
    expect(assignedTrigger.classList.contains("opacity-100")).toBe(true)
    expect(assignedTrigger.classList.contains("text-primary")).toBe(true)
    expect(assignedTrigger.classList.contains("end-2")).toBe(true)

    assignedTrigger.click()
    await nextTick()
    expect(assignedTrigger.getAttribute("aria-expanded")).toBe("true")

    const disabledAssigned = mount(VariableReferenceAssignButton, {
      modelValue: "var(--space-md)",
      options: [{ value: "space-md", label: "Space MD" }],
      disabled: true,
    })
    const disabledTrigger = disabledAssigned.querySelector("button") as HTMLButtonElement
    expect(disabledTrigger.disabled).toBe(true)
    expect(disabledTrigger.classList.contains("opacity-50")).toBe(true)
    expect(disabledTrigger.classList.contains("opacity-0")).toBe(false)

    const inline = mount(VariableReferenceAssignButton, {
      appearance: "inline",
      modelValue: "",
      options: [],
    })
    const inlineTrigger = inline.querySelector("button") as HTMLButtonElement
    expect(inlineTrigger.dataset.appearance).toBe("inline")
    expect(inlineTrigger.classList.contains("h-9")).toBe(true)
    expect(inlineTrigger.classList.contains("w-9")).toBe(true)
    expect(inlineTrigger.classList.contains("opacity-0")).toBe(false)
  })

  it("assigns and detaches through one commit while restoring the prior direct value", async () => {
    const modelValue = ref("16px")
    const commit = vi.fn()
    const Harness = defineComponent({
      setup() {
        return () => h(VariableAssignableInput, {
          modelValue: modelValue.value,
          options: [{ value: "space-md", label: "Space MD", group: "Spacing" }],
          "onUpdate:modelValue": (value: string) => { modelValue.value = value },
          onCommit: commit,
        })
      },
    })
    const host = mount(Harness)

    const input = host.querySelector("input") as HTMLInputElement
    const trigger = host.querySelector("[data-variable-reference-trigger]") as HTMLButtonElement
    input.focus()
    trigger.focus()
    expect(commit).not.toHaveBeenCalled()
    trigger.click()
    await vi.waitFor(() => expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull())
    const variableOption = [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')]
      .find((item) => item.textContent?.includes("Space MD"))
    variableOption?.click()
    await vi.waitFor(() => expect(modelValue.value).toBe("var(--space-md)"))
    expect(commit.mock.calls).toEqual([["var(--space-md)"]])

    ;(host.querySelector("[data-variable-reference-trigger]") as HTMLButtonElement).click()
    await vi.waitFor(() => expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull())
    const directOption = [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')]
      .find((item) => item.textContent?.includes("Use direct value"))
    directOption?.click()
    await vi.waitFor(() => expect(modelValue.value).toBe("16px"))
    expect(commit).toHaveBeenCalledTimes(2)
    expect(commit).toHaveBeenLastCalledWith("16px")
  })

  it("detaches an initially assigned variable to its resolved direct value", async () => {
    const modelValue = ref("var(--space-md)")
    const commit = vi.fn()
    const Harness = defineComponent({
      setup() {
        return () => h(VariableAssignableInput, {
          modelValue: modelValue.value,
          options: [{
            value: "space-md",
            label: "Space MD",
            directValue: "16px",
          }],
          "onUpdate:modelValue": (value: string) => { modelValue.value = value },
          onCommit: commit,
        })
      },
    })
    const host = mount(Harness)

    ;(host.querySelector("[data-variable-reference-trigger]") as HTMLButtonElement).click()
    await vi.waitFor(() => expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull())
    const directOption = [...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]')]
      .find((item) => item.textContent?.includes("Use direct value"))
    directOption?.click()

    await vi.waitFor(() => expect(modelValue.value).toBe("16px"))
    expect(commit.mock.calls).toEqual([["16px"]])
  })

  it("overlays color variable assignment without nesting interactive controls", () => {
    const host = mount(ColorField, {
      modelValue: "#112233",
      layout: "unified",
      showVariables: true,
      triggerLabel: "Text color",
    })
    const fieldTrigger = host.querySelector('button[aria-label="Text color"]') as HTMLButtonElement
    const variableTrigger = host.querySelector("[data-variable-reference-trigger]") as HTMLButtonElement
    expect([...fieldTrigger.classList].some((name) => name.startsWith("pe-"))).toBe(false)
    expect(variableTrigger.dataset.appearance).toBe("overlay")
    expect(variableTrigger.classList.contains("absolute")).toBe(true)
    expect(variableTrigger.classList.contains("end-2")).toBe(true)
    expect(host.querySelector("button button")).toBeNull()
  })
})
