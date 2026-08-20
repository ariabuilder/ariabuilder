import { onMounted, onUnmounted, ref, shallowRef, watch, type Ref } from "vue"
import { toast } from "vue-sonner"
import type { DesignPatch, DesignSnapshot } from "../../../../shared/design"
import { getDesignSnapshot, patchDesignSystem } from "@/lib/design"
import { m } from "@/paraglide/messages.js"

export function useDesignSnapshot(projectRoot: Ref<string>) {
  const snapshot = shallowRef<DesignSnapshot | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let stopWatch: (() => void) | null = null

  async function refresh() {
    const root = projectRoot.value
    if (!root) {
      snapshot.value = null
      return
    }
    loading.value = true
    error.value = null
    try {
      snapshot.value = await getDesignSnapshot(root)
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Failed to load design system"
    } finally {
      loading.value = false
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void refresh()
    }, 400)
  }

  async function patch(next: DesignPatch, options?: { silent?: boolean }) {
    const root = projectRoot.value
    if (!root) throw new Error("No project open")
    saving.value = true
    error.value = null
    try {
      snapshot.value = await patchDesignSystem(
        root,
        next,
        snapshot.value?.revision,
      )
      if (!options?.silent) {
        toast.success(m.design_save_success())
      }
      return snapshot.value
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save design system"
      error.value = message
      toast.error(m.design_save_failed(), { description: message })
      throw err
    } finally {
      saving.value = false
    }
  }

  watch(
    projectRoot,
    () => {
      void refresh()
    },
    { immediate: true },
  )

  onMounted(() => {
    stopWatch =
      window.aria?.project.onChange((changedRoot, change) => {
        if (changedRoot !== projectRoot.value) return
        const path = change.path.replace(/\\/g, "/").toLowerCase()
        const watchedSources = new Set(
          (snapshot.value?.sourceFiles ?? []).map((file) => file.toLowerCase()),
        )
        const isDesignSource = watchedSources.has(path)
        const isCustomFont =
          (path.startsWith("public/fonts/") ||
            path.startsWith("public/uploads/")) &&
          /\.(woff2?|ttf|otf|eot)$/.test(path)
        if (!isDesignSource && !isCustomFont) return
        if (saving.value) return
        scheduleRefresh()
      }) ?? null
  })

  onUnmounted(() => {
    stopWatch?.()
    if (refreshTimer) clearTimeout(refreshTimer)
  })

  return {
    snapshot,
    loading,
    saving,
    error,
    refresh,
    patch,
    adoptSnapshot(next: DesignSnapshot) {
      snapshot.value = next
    },
  }
}
