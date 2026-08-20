// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  buildOpacityVariableReferenceOptions,
  type VariableReferenceOption,
} from "@/workspace/design/lib/variableReferences"
import ComposerOpacityControls from "./ComposerOpacityControls.vue"
import { parseComposerOpacityValue } from "./composerOpacity"

vi.mock("@/components/ui/slider", () => ({
  Slider: defineComponent({
    inheritAttrs: false,
    props: {
      modelValue: { type: Array, default: () => [0] },
      disabled: Boolean,
    },
    emits: ["update:model-value", "value-commit"],
    setup(props, { attrs, emit }) {
      return () => h("input", {
        ...attrs,
        "data-testid": "opacity-slider",
        type: "range",
        min: 0,
        max: 100,
        disabled: props.disabled,
        value: props.modelValue[0] ?? 0,
        onInput: (event: Event) => emit(
          "update:model-value",
          [Number((event.target as HTMLInputElement).value)],
        ),
        onChange: (event: Event) => emit(
          "value-commit",
          [Number((event.target as HTMLInputElement).value)],
        ),
      })
    },
  }),
}))

vi.mock("@/components/ui/variable-reference-picker", () => ({
  VariableAssignableInput: defineComponent({
    name: "VariableAssignableInput",
    inheritAttrs: false,
    props: {
      modelValue: { type: String, default: "" },
      disabled: Boolean,
      options: { type: Array, default: () => [] },
      ariaLabel: String,
      ariaDescribedby: String,
      ariaInvalid: Boolean,
    },
    emits: ["update:model-value", "commit"],
    setup(props, { attrs, slots, emit }) {
      return () => h("div", { "data-testid": "opacity-variable-wrapper" }, [
        slots.control?.(),
        !slots.control && h("input", {
          ...attrs,
          "data-testid": "opacity-input",
          value: props.modelValue,
          disabled: props.disabled,
          "aria-label": props.ariaLabel,
          "aria-describedby": props.ariaDescribedby,
          "aria-invalid": props.ariaInvalid || undefined,
          onInput: (event: Event) => emit(
            "update:model-value",
            (event.target as HTMLInputElement).value,
          ),
          onBlur: () => emit("commit", props.modelValue),
        }),
        h("button", {
          type: "button",
          "data-testid": "assign-opacity-variable",
          disabled: props.disabled,
          onClick: () => {
            emit("update:model-value", "var(--opacity-muted)")
            emit("commit", "var(--opacity-muted)")
          },
        }, "assign opacity"),
        h("button", {
          type: "button",
          "data-testid": "assign-color-variable",
          disabled: props.disabled,
          onClick: () => {
            emit("update:model-value", "var(--brand-primary)")
            emit("commit", "var(--brand-primary)")
          },
        }, "assign color"),
      ])
    },
  }),
}))

const mounted: Array<() => void> = []

type OpacityControlProps = InstanceType<typeof ComposerOpacityControls>["$props"]

function mountOpacity(props: OpacityControlProps): HTMLElement {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({ render: () => h(ComposerOpacityControls, props) })
  app.mount(host)
  mounted.push(() => {
    app.unmount()
    host.remove()
  })
  return host
}

function mountReactiveOpacity(props: OpacityControlProps) {
  const modelValue = ref(props.modelValue)
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    render: () => h(ComposerOpacityControls, {
      ...props,
      modelValue: modelValue.value,
    }),
  })
  app.mount(host)
  mounted.push(() => {
    app.unmount()
    host.remove()
  })
  return { host, modelValue }
}

async function flushUi(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

function required<T extends Element>(host: HTMLElement, selector: string): T {
  const element = host.querySelector<T>(selector)
  if (!element) throw new Error(`Missing ${selector}`)
  return element
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})

const opacityOptions: VariableReferenceOption[] = [{
  value: "opacity-muted",
  label: "Opacity muted",
  group: "Custom Variables",
  directValue: "0.5",
}]

describe("Composer opacity parsing", () => {
  it("normalizes CSS numbers and percentages to integer percentage decimals", () => {
    expect(parseComposerOpacityValue("0.444", opacityOptions)).toEqual({
      ok: true,
      value: { cssValue: "0.44", percentage: 44, variableKey: null },
    })
    expect(parseComposerOpacityValue("72%", opacityOptions)).toEqual({
      ok: true,
      value: { cssValue: "0.72", percentage: 72, variableKey: null },
    })
  })

  it("rejects out-of-range values and variables outside the effects options", () => {
    expect(parseComposerOpacityValue("1.2", opacityOptions)).toEqual({
      ok: false,
      error: "invalid",
    })
    expect(parseComposerOpacityValue("var(--brand-primary)", opacityOptions)).toEqual({
      ok: false,
      error: "incompatible-variable",
    })
  })

  it("offers effects variables and aliases that resolve to effects only", () => {
    const options = buildOpacityVariableReferenceOptions({
      custom: {
        "opacity-muted": {
          label: "Opacity muted",
          value: "0.5",
          category: "effects",
          source: "aria",
        },
        "brand-primary": {
          label: "Brand primary",
          value: "#0f0",
          category: "color",
          source: "aria",
        },
      },
      aliases: {
        "opacity-alias": {
          label: "Opacity alias",
          sourceType: "custom",
          sourceKey: "opacity-muted",
        },
        "color-alias": {
          label: "Color alias",
          sourceType: "custom",
          sourceKey: "brand-primary",
        },
      },
    })

    expect(options.map((option) => option.value).sort()).toEqual([
      "opacity-alias",
      "opacity-muted",
    ])
  })
})

describe("ComposerOpacityControls", () => {
  it("keeps a stable empty status region and clears rejected drafts on authoritative updates", async () => {
    const { host, modelValue } = mountReactiveOpacity({
      modelValue: "1",
      variableOptions: opacityOptions,
      previewValue: vi.fn(),
      commitValue: vi.fn().mockResolvedValue({ ok: true }),
      cancelPreview: vi.fn(),
    })
    const status = required(host, '[data-testid="opacity-error"]')
    expect(status.getAttribute("role")).toBe("status")
    expect(status.getAttribute("aria-atomic")).toBe("true")
    expect(status.textContent?.trim()).toBe("")

    required<HTMLButtonElement>(host, '[data-testid="assign-color-variable"]').click()
    await flushUi()
    expect(status.textContent).toBe("This variable cannot be used for opacity.")

    modelValue.value = "0.44"
    await nextTick()
    expect(status.textContent?.trim()).toBe("")
    expect(status.classList.contains("sr-only")).toBe(true)
  })

  it("previews slider values and commits one normalized CSS decimal", async () => {
    const previewValue = vi.fn()
    const commitValue = vi.fn().mockResolvedValue({ ok: true })
    const host = mountOpacity({
      modelValue: "0.44",
      variableOptions: opacityOptions,
      previewValue,
      commitValue,
      cancelPreview: vi.fn(),
    })

    expect(required(host, '[data-testid="opacity-value"]').textContent?.trim()).toBe("44%")
    const slider = required<HTMLInputElement>(host, '[data-testid="opacity-slider"]')
    expect(slider.getAttribute("aria-label")).toBe("Opacity")
    expect(slider.getAttribute("aria-valuetext")).toBe("44% opacity")

    slider.value = "25"
    slider.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    expect(previewValue).toHaveBeenLastCalledWith("0.25")
    slider.dispatchEvent(new Event("change", { bubbles: true }))
    await flushUi()
    expect(commitValue).toHaveBeenCalledOnce()
    expect(commitValue).toHaveBeenCalledWith("0.25")
  })

  it("assigns compatible variables and replaces the slider with the variable input", async () => {
    const commitValue = vi.fn().mockResolvedValue({ ok: true })
    const host = mountOpacity({
      modelValue: "1",
      variableOptions: opacityOptions,
      previewValue: vi.fn(),
      commitValue,
      cancelPreview: vi.fn(),
    })

    required<HTMLButtonElement>(host, '[data-testid="assign-opacity-variable"]').click()
    await flushUi()
    expect(commitValue).toHaveBeenCalledWith("var(--opacity-muted)")
    expect(host.querySelector('[data-testid="opacity-slider"]')).toBeNull()
    expect(host.querySelector('[data-testid="opacity-value"]')).toBeNull()
    expect(required(host, '[data-testid="opacity-input"]').getAttribute("aria-label"))
      .toBe("Opacity value or variable")
  })

  it("rejects incompatible variables, restores the preview, and announces the error", async () => {
    const cancelPreview = vi.fn()
    const commitValue = vi.fn().mockResolvedValue({ ok: true })
    const host = mountOpacity({
      modelValue: "1",
      variableOptions: opacityOptions,
      previewValue: vi.fn(),
      commitValue,
      cancelPreview,
    })

    required<HTMLButtonElement>(host, '[data-testid="assign-color-variable"]').click()
    await flushUi()
    expect(commitValue).not.toHaveBeenCalled()
    expect(cancelPreview).toHaveBeenCalledOnce()
    const error = required(host, '[data-testid="opacity-error"]')
    expect(error.textContent).toBe("This variable cannot be used for opacity.")
    expect(error.getAttribute("role")).toBe("status")
  })

  it("reverts and reports an acknowledged save failure", async () => {
    const cancelPreview = vi.fn()
    const host = mountOpacity({
      modelValue: "1",
      variableOptions: opacityOptions,
      previewValue: vi.fn(),
      commitValue: vi.fn().mockResolvedValue({
        ok: false,
        error: "Failed to save page: test",
      }),
      cancelPreview,
    })

    const slider = required<HTMLInputElement>(host, '[data-testid="opacity-slider"]')
    slider.value = "44"
    slider.dispatchEvent(new Event("input", { bubbles: true }))
    slider.dispatchEvent(new Event("change", { bubbles: true }))
    await flushUi()
    expect(cancelPreview).toHaveBeenCalledOnce()
    expect(required(host, '[data-testid="opacity-error"]').textContent)
      .toBe("Failed to save page: test")
  })

  it("disables the slider while the target is read-only and exposes inheritance", () => {
    const host = mountOpacity({
      modelValue: "1",
      variableOptions: opacityOptions,
      disabled: true,
      inherited: true,
      previewValue: vi.fn(),
      commitValue: vi.fn().mockResolvedValue({ ok: true }),
      cancelPreview: vi.fn(),
    })

    expect(required<HTMLInputElement>(host, '[data-testid="opacity-slider"]').disabled)
      .toBe(true)
    expect(host.textContent).toContain("Inherited from a lower breakpoint.")
  })
})
