import { type Ref, ref, watch } from "vue"
import type { AriaCollectionDef } from "@/types/aria"
import { getCollections } from "@/lib/workspace"

export function useCollectionDetail(
  projectRoot: Ref<string>,
  collectionIdOrName: Ref<string>,
) {
  const collection = ref<AriaCollectionDef | null>(null)
  const isLoading = ref(false)
  const loadError = ref<string | null>(null)

  async function loadCollection(
    options: { force?: boolean; silent?: boolean } = {},
  ): Promise<void> {
    const id = collectionIdOrName.value.trim()
    const root = projectRoot.value.trim()
    if (!id || !root) {
      collection.value = null
      return
    }

    isLoading.value = !options.silent
    loadError.value = null

    try {
      const state = await getCollections(root)
      const found =
        state.collections.find(
          (item) => item.id === id || item.name === id,
        ) ?? null
      collection.value = found
      if (!found) {
        loadError.value = `Collection "${id}" was not found`
      }
    } catch (err) {
      loadError.value =
        err instanceof Error ? err.message : "Failed to load collection"
      if (!options.silent) collection.value = null
    } finally {
      isLoading.value = false
    }
  }

  watch(
    [projectRoot, collectionIdOrName],
    () => {
      void loadCollection()
    },
    { immediate: true },
  )

  return {
    collection,
    isLoading,
    loadError,
    loadCollection,
  }
}
