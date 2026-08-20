import { computed, ref, watch, type Ref } from "vue"
import { getCollections } from "@/lib/workspace"
import type { AriaCollectionDef } from "../../../../shared/types"

export function useConditionCollections(
  open: Readonly<Ref<boolean>>,
  projectPath: Readonly<Ref<string>>,
) {
  const collections = ref<AriaCollectionDef[]>([])
  const loading = ref(false)
  const error = ref("")
  const loadedProjectPath = ref("")
  let generation = 0

  async function load(path: string) {
    const currentGeneration = ++generation
    loading.value = true
    error.value = ""
    try {
      const state = await getCollections(path)
      if (currentGeneration !== generation || projectPath.value !== path) return
      collections.value = state.collections
      loadedProjectPath.value = path
    } catch (cause) {
      if (currentGeneration !== generation || projectPath.value !== path) return
      collections.value = []
      error.value = cause instanceof Error ? cause.message : "CMS fields could not be loaded."
    } finally {
      if (currentGeneration === generation) loading.value = false
    }
  }

  watch([open, projectPath], ([isOpen, path], previous) => {
    const previousPath = previous?.[1] ?? ""
    if (path !== previousPath) {
      generation += 1
      collections.value = []
      loadedProjectPath.value = ""
      loading.value = false
      error.value = ""
    }
    if (!isOpen || !path || loadedProjectPath.value === path || loading.value) return
    void load(path)
  }, { immediate: true })

  return {
    collections,
    loading,
    error,
    hasRegisteredCollections: computed(() => collections.value.length > 0),
  }
}
