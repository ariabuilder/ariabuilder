import { describe, expect, it } from "vitest"
import { parseAstro } from "../../../../shared/composer"
import {
  composerClassTextForInspector,
  preserveComposerMotionClasses,
  removeComposerSourceClass,
  resolveComposerClassTarget,
  visibleComposerClassNames,
} from "./composerClassTokens"

describe("Composer source class removal", () => {
  it("removes only the class named by the explicit remove control", () => {
    expect(removeComposerSourceClass(
      ["hero-section", "featured"],
      "hero-section",
    )).toEqual({ type: "string", value: "featured" })
  })

  it("targets the descendant whose utility classes are rendered by a fragment", async () => {
    const parsed = await parseAstro(`
      <Fragment slot="content">
        <h3 class="text-2xl font-bold tracking-tight dark:text-white sm:text-3xl mb-2">Heading</h3>
        <p>Body</p>
      </Fragment>
    `)
    expect(parsed.editable).toBe(true)
    if (!parsed.editable) return

    expect(resolveComposerClassTarget(parsed.model, "0", [
      "text-2xl",
      "font-bold",
      "tracking-tight",
      "dark:text-white",
      "sm:text-3xl",
      "mb-2",
    ])?.path).toBe("0.0")
  })

  it("still resolves a fragment class target when Motion tokens are hidden", async () => {
    const parsed = await parseAstro(`
      <Fragment slot="content">
        <h3 class="text-2xl aria-motion aria-motion-fade aria-motion-reveal">Heading</h3>
      </Fragment>
    `)
    expect(parsed.editable).toBe(true)
    if (!parsed.editable) return

    expect(resolveComposerClassTarget(parsed.model, "0", ["text-2xl"])?.path).toBe("0.0")
  })

  it("keeps literal class:list utilities source-owned and editable", async () => {
    const parsed = await parseAstro('<div class:list={["flex", active && "opacity-100"]}>Card</div>')
    expect(parsed.editable).toBe(true)
    if (!parsed.editable) return

    expect(resolveComposerClassTarget(parsed.model, "0", [
      "flex",
      "opacity-100",
    ])).toMatchObject({ path: "0" })
  })

  it("hides Motion-owned classes without removing them from Astro class edits", () => {
    const source = [
      "text-2xl",
      "aria-motion",
      "aria-motion-fade",
      "aria-motion-reveal",
      "aria-parallax",
    ]

    expect(visibleComposerClassNames(source)).toEqual(["text-2xl"])
    expect(preserveComposerMotionClasses(source, {
      type: "string",
      value: "text-3xl font-bold",
    })).toEqual({
      type: "string",
      value: "text-3xl font-bold aria-motion aria-motion-fade aria-motion-reveal aria-parallax",
    })
  })

  it("hides managed Motion literals from class:list presentation only", () => {
    const value = {
      type: "expr" as const,
      value: '[active && "is-active", "aria-motion aria-motion-fade", size]',
    }

    expect(composerClassTextForInspector(value, value.value)).toBe(
      '[active && "is-active", "", size]',
    )
    expect(value.value).toContain("aria-motion-fade")
  })

  it("masks managed Motion literals in opaque expressions", () => {
    const value = {
      type: "expr" as const,
      value: 'classes("card", "aria-parallax-speed-1_5")',
    }

    expect(composerClassTextForInspector(value, value.value)).toBe(
      'classes("card", "[Motion]")',
    )
  })
})
