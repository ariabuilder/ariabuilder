// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import type { ConditionSet } from "../../../../shared/conditions"
import { createConditionSourceOption } from "../../../../shared/conditions"
import ComposerConditionBuilder from "./ComposerConditionBuilder.vue"

const mounted: Array<() => void> = []
afterEach(() => mounted.splice(0).forEach((unmount) => unmount()))

function mountBuilder() {
  const value = ref<ConditionSet | undefined>()
  const host = document.createElement("div")
  document.body.appendChild(host)
  const app = createApp(defineComponent({
    setup() {
      return () => h(ComposerConditionBuilder, {
        modelValue: value.value,
        sources: [
          createConditionSourceOption({ provider: "component", path: ["plan"], label: "Plan", valueType: "string", options: [{ label: "Pro", value: "pro" }] }),
          createConditionSourceOption({ provider: "component", path: ["featured"], label: "Featured", valueType: "boolean" }),
        ],
        "onUpdate:modelValue": (next: ConditionSet | undefined) => { value.value = next },
      })
    },
  }))
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { host, value }
}

describe("ComposerConditionBuilder", () => {
  it("starts simple and exposes the full flat rule-group model", async () => {
    const { host, value } = mountBuilder()
    expect(host.textContent).toContain("Always shown")
    const add = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Add condition"))
    expect(add).toBeDefined()
    add?.click()
    await nextTick()
    expect(value.value?.groups).toHaveLength(1)
    expect(value.value?.groups[0]?.rules).toHaveLength(1)
    expect(host.textContent).toContain("Match all")
    expect(host.querySelector('[aria-label="Rule 1: choose what to check"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="Rule 1: comparison"]')).not.toBeNull()

    const alternative = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Add alternative"))
    alternative?.click()
    await nextTick()
    expect(value.value?.groups).toHaveLength(2)
    expect(host.textContent?.toLowerCase()).toContain("or")
  })

  it("removes the final rule back to Always shown", async () => {
    const { host, value } = mountBuilder()
    ;[...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Add condition"))?.click()
    await nextTick()
    ;(host.querySelector('[aria-label="Remove rule 1"]') as HTMLButtonElement | null)?.click()
    await nextTick()
    expect(value.value).toBeUndefined()
    expect(host.textContent).toContain("Always shown")
  })
})

