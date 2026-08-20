import { describe, expect, it } from "vitest"
import { parseAstro } from "./parseAstro"
import { preserveClassApplyDirectives } from "./cssRuleAst"
import {
  discoverAstroStyleClasses,
  duplicateAstroStyleClass,
  readAstroStyleClassDeclarations,
  writeAstroStyleClassDeclarations,
} from "./astroStyleRules"
import { serializeAstro } from "./serializeAstro"
import { renameClassReferences } from "./renameClassReferences"

async function localStyleModel() {
  const parsed = await parseAstro(`<main>
  <h1 class="project-heading test">Projects</h1>
</main>
<style>
  .project-heading {
    @apply mb-5 text-2xl lg:text-3xl;
  }
  .test {
    /* ready for Inspector */
  }
</style>`)
  if (!parsed.editable) throw new Error(parsed.reason)
  return parsed.model
}

describe("Astro-local style rules", () => {
  it("discovers scoped classes as editable custom rules", async () => {
    const model = await localStyleModel()
    expect(discoverAstroStyleClasses(model).map((rule) => rule.name)).toEqual([
      "project-heading",
      "test",
    ])
  })

  it("updates and duplicates the owning Astro style block", async () => {
    const model = await localStyleModel()
    const current = readAstroStyleClassDeclarations(model, "project-heading") ?? ""
    const next = preserveClassApplyDirectives(current, "color: red;")
    expect(writeAstroStyleClassDeclarations(model, "project-heading", next)).toBe(true)
    expect(duplicateAstroStyleClass(model, "project-heading", "project-heading-2")).toBe(true)

    const source = serializeAstro(model)
    expect(source).toContain("@apply mb-5 text-2xl lg:text-3xl;")
    expect(source).toContain("color: red;")
    expect(source).toContain(".project-heading-2")
  })

  it("renames the Astro class reference and its scoped selector together", async () => {
    const model = await localStyleModel()
    expect(renameClassReferences(model.nodes, "project-heading", "project-title")).toBe(2)
    const source = serializeAstro(model)
    expect(source).toContain('class="project-title test"')
    expect(source).toContain(".project-title {")
    expect(source).not.toContain("project-heading")
  })
})
