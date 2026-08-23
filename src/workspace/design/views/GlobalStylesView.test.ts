// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createEmptyGlobalStyles,
  type DesignSnapshot,
} from "../../../../shared/design"
import GlobalStylesView from "./GlobalStylesView.vue"

vi.mock("../components/DesignHeaderTeleport.vue", () => ({
  default: defineComponent({
    setup(_, { slots }) {
      return () => h("div", slots.default?.())
    },
  }),
}))

vi.mock("@/components/ui/color-picker", () => ({
  ColorField: defineComponent({ render: () => h("div") }),
}))

vi.mock("@/components/ui/variable-reference-picker", () => ({
  VariableAssignableInput: defineComponent({ render: () => h("div") }),
  VariableReferenceAssignButton: defineComponent({ render: () => h("div") }),
}))

vi.mock("../components/GlobalStylesLinkedSides.vue", () => ({
  default: defineComponent({ render: () => h("div") }),
}))

const mounted: Array<() => void> = []

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

function snapshot(): DesignSnapshot {
  return {
    fonts: {
      google: [],
      custom: [],
      fontsource: [
        { id: "inter", family: "Inter", variable: true },
        { id: "outfit", family: "Outfit", variable: true },
      ],
    },
    globalStyles: createEmptyGlobalStyles(),
  } as unknown as DesignSnapshot
}

function mountView() {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    render: () => h(GlobalStylesView, { snapshot: snapshot() }),
  })
  app.mount(host)
  mounted.push(() => {
    app.unmount()
    host.remove()
  })
  return host
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  )
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${text}`)
  }
  return button
}

function fontTrigger(host: HTMLElement, placeholder: string): HTMLElement {
  const trigger = [...host.querySelectorAll('[data-slot="select-trigger"]')].find(
    (candidate) => candidate.textContent?.includes(placeholder),
  )
  if (!(trigger instanceof HTMLElement)) {
    throw new Error(`Missing font selector: ${placeholder}`)
  }
  return trigger
}

describe("GlobalStylesView font selectors", () => {
  it("renders Fontsource-backed selectors with visible indicators in every font tab", async () => {
    const host = mountView()
    const sections = [
      ["Body", "Select body font"],
      ["Headings", "Select heading font"],
      ["Inputs", "Select input font"],
      ["Buttons", "Select button font"],
    ] as const

    for (const [tab, placeholder] of sections) {
      if (tab !== "Body") {
        buttonByText(host, tab).click()
        await nextTick()
      }
      const trigger = fontTrigger(host, placeholder)
      expect(trigger.getAttribute("role")).toBe("combobox")
      expect(trigger.querySelector("svg")).not.toBeNull()
      expect(trigger.className).toContain("[&>svg]:me-8")
      expect(
        host.querySelector(`input[placeholder="${placeholder}"]`),
      ).toBeNull()
    }
  })
})
