import { CompletionContext } from "@codemirror/autocomplete"
import { EditorState } from "@codemirror/state"
import { describe, expect, it } from "vitest"
import {
  buildCssVariableCompletionOptions,
  createCssCompletionSource,
} from "../workspace/design/lib/cssVariableCompletions"

const variableReferences = [
  {
    value: "brand-primary",
    label: "Brand Primary",
    meta: "Color · --brand-primary",
  },
  {
    value: "heading-font",
    label: "Heading Font",
    meta: "Alias · --heading-font",
  },
]

async function complete(
  css: string,
  documentKind: "stylesheet" | "declarations" = "declarations",
) {
  const source = createCssCompletionSource(() => variableReferences, {
    documentKind,
    getProjectSymbols: () => ({
      classNames: ["hero-text", "site-button"],
      utilityCandidates: ["mb-8", "text-neutral-200"],
      keyframeNames: ["fadeUp"],
    }),
  })
  const state = EditorState.create({ doc: css })
  return source(new CompletionContext(state, css.length, false))
}

describe("CSS project completions", () => {
  it("creates descriptive, deduplicated variable options", () => {
    expect(
      buildCssVariableCompletionOptions([
        ...variableReferences,
        { ...variableReferences[0]!, label: "Duplicate" },
      ]),
    ).toEqual([
      {
        label: "--brand-primary",
        apply: "--brand-primary",
        detail: "Color · --brand-primary",
        type: "variable",
      },
      {
        label: "--heading-font",
        apply: "--heading-font",
        detail: "Alias · --heading-font",
        type: "variable",
      },
    ])
  })

  it("suggests standard CSS properties in a declarations-only class draft", async () => {
    const result = await complete("col")
    const labels = result?.options.map((option) => option.label) ?? []

    expect(result?.from).toBe(0)
    expect(labels).not.toContain("col")
    expect(labels).not.toContain("colgroup")
  })

  it("suggests standard CSS values in a declarations-only class draft", async () => {
    const css = "display: fl"
    const result = await complete(css)

    expect(result?.from).toBe(css.indexOf("fl"))
    expect(result?.options.map((option) => option.label)).toContain("flex")
  })

  it("suggests Aria variables inside var()", async () => {
    const css = "color: var(--bra"
    const result = await complete(css)

    expect(result?.from).toBe(css.indexOf("--"))
    expect(result?.options.map((option) => option.label)).toEqual([
      "--brand-primary",
      "--heading-font",
    ])
  })

  it("suggests project utilities and classes inside @apply", async () => {
    const css = "@apply mb-8 text-"
    const result = await complete(css)
    const labels = result?.options.map((option) => option.label) ?? []

    expect(result?.from).toBe(css.lastIndexOf("text-"))
    expect(labels).toContain("text-neutral-200")
    expect(labels).toContain("hero-text")
  })

  it("suggests project keyframes for animation declarations", async () => {
    const result = await complete("animation-name: fa")

    expect(result?.options.map((option) => option.label)).toContain("fadeUp")
  })

  it("suggests project classes in full stylesheet selectors", async () => {
    const result = await complete(".hero", "stylesheet")

    expect(result?.from).toBe(1)
    expect(result?.options.map((option) => option.label)).toContain("hero-text")
  })
})
