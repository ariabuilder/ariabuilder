import { reactive } from "vue"
import { describe, expect, it } from "vitest"
import type { FieldSchema } from "../../shared/cms"
import { cloneSchemaField } from "@/workspace/studio/collections/lib/schemaFieldForm"

describe("cloneSchemaField", () => {
  it("rebuilds nested reactive schema fields as structured-cloneable data", () => {
    const field = reactive<FieldSchema>({
      key: "author",
      label: "Author",
      type: "object",
      fields: [
        {
          key: "name",
          label: "Name",
          type: "string",
        },
      ],
    })

    expect(() => structuredClone(field)).toThrow()

    const cloned = cloneSchemaField(field)
    expect(cloned).toEqual(field)
    expect(() => structuredClone(cloned)).not.toThrow()
    expect(cloned).not.toBe(field)
    expect(cloned.fields?.[0]).not.toBe(field.fields?.[0])
  })
})
