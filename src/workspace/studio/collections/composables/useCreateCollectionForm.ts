import { ref, type Ref } from "vue"
import { toast } from "vue-sonner"
import {
  generateId,
  type CollectionKind,
  type CollectionSupport,
} from "../../../../../shared/cms"
import type { AriaCollectionDef } from "@/types/aria"
import { getCollections, updateCollections } from "@/lib/workspace"
import { slugify } from "../lib/slugify"

export type CreatedCollectionResult = {
  id: string
  name: string
  label: string
  kind: CollectionKind
}

export function useCreateCollectionForm(
  projectRoot: Ref<string>,
  existingNames: Ref<readonly string[]>,
) {
  const label = ref("")
  const name = ref("")
  const kind = ref<CollectionKind>("content")
  const isNameEdited = ref(false)
  const isCreating = ref(false)
  const errors = ref<Record<string, string>>({})

  function defaultSupportsForKind(
    collectionKind: CollectionKind,
  ): CollectionSupport[] {
    return collectionKind === "content" ? ["body", "cover"] : []
  }

  function updateNameFromLabel(): void {
    if (!isNameEdited.value) {
      name.value = slugify(label.value)
    }
  }

  function resetForm(): void {
    label.value = ""
    name.value = ""
    kind.value = "content"
    isNameEdited.value = false
    errors.value = {}
  }

  function validate(): boolean {
    errors.value = {}
    if (!label.value.trim()) {
      errors.value.label = "Label is required"
    }
    const slug = name.value.trim() || slugify(label.value)
    if (!slug) {
      errors.value.name = "API name is required"
    } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      errors.value.name = "Use lowercase letters, numbers, and hyphens"
    } else if (existingNames.value.includes(slug)) {
      errors.value.name = `Collection "${slug}" already exists`
    }
    return Object.keys(errors.value).length === 0
  }

  async function submitCreate(): Promise<CreatedCollectionResult | null> {
    if (isCreating.value) return null
    if (!validate()) return null

    const root = projectRoot.value.trim()
    if (!root) {
      toast.error("No project open")
      return null
    }

    const slug = name.value.trim() || slugify(label.value)
    const collection: AriaCollectionDef = {
      id: generateId(),
      name: slug,
      label: label.value.trim(),
      kind: kind.value,
      urlPattern: kind.value === "content" ? `/${slug}/{slug}` : null,
      listPageFile: null,
      templatePageFile: null,
      schema: { fields: [], version: 1 },
      supports: defaultSupportsForKind(kind.value),
      scope: "global",
    }

    isCreating.value = true
    try {
      const state = await getCollections(root)
      await updateCollections(root, {
        collections: [...state.collections, collection],
      })
      toast.success(`Created collection "${collection.label}"`)
      const result: CreatedCollectionResult = {
        id: collection.id,
        name: collection.name,
        label: collection.label,
        kind: collection.kind,
      }
      resetForm()
      return result
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create collection",
      )
      return null
    } finally {
      isCreating.value = false
    }
  }

  return {
    label,
    name,
    kind,
    isNameEdited,
    isCreating,
    errors,
    updateNameFromLabel,
    resetForm,
    submitCreate,
  }
}
