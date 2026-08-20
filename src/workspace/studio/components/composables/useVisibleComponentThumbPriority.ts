import { onBeforeUnmount, watch, type Ref } from "vue"
import { prioritizeComponentThumbs } from "@/lib/thumbs"

const PRIORITIZE_DEBOUNCE_MS = 100

function toEnabled(value: Ref<boolean> | (() => boolean)): boolean {
  return typeof value === "function" ? value() : value.value
}

function toProjectPath(value: Ref<string> | (() => string)): string {
  return typeof value === "function" ? value() : value.value
}

/** Tell the warm job to capture on-screen grid cards before the rest. */
export function useVisibleComponentThumbPriority(opts: {
  enabled: Ref<boolean> | (() => boolean)
  projectPath: Ref<string> | (() => string)
  scrollRoot: Ref<HTMLElement | null>
}): void {
  let observer: IntersectionObserver | null = null
  let mutations: MutationObserver | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const visible = new Set<string>()

  function flush() {
    debounceTimer = null
    if (!toEnabled(opts.enabled)) return
    const root = opts.scrollRoot.value
    if (!root) return
    const ids = [...visible].filter((id) =>
      root.querySelector(`[data-component-id=${JSON.stringify(id)}]`),
    )
    if (!ids.length) return
    const projectPath = toProjectPath(opts.projectPath)
    if (!projectPath) return
    void prioritizeComponentThumbs({ projectPath, ids }).catch(() => undefined)
  }

  function scheduleFlush() {
    if (debounceTimer != null) return
    debounceTimer = setTimeout(flush, PRIORITIZE_DEBOUNCE_MS)
  }

  function disconnect() {
    observer?.disconnect()
    observer = null
    mutations?.disconnect()
    mutations = null
    visible.clear()
    if (debounceTimer != null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  function observeCards(root: HTMLElement) {
    if (!observer) return
    for (const node of root.querySelectorAll<HTMLElement>("[data-component-id]")) {
      observer.observe(node)
    }
    scheduleFlush()
  }

  function connect(root: HTMLElement) {
    disconnect()
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.componentId
          if (!id) continue
          if (entry.isIntersecting) visible.add(id)
          else visible.delete(id)
        }
        scheduleFlush()
      },
      { root, rootMargin: "80px 0px", threshold: 0.01 },
    )
    observeCards(root)
    mutations = new MutationObserver(() => observeCards(root))
    mutations.observe(root, { childList: true, subtree: true })
  }

  watch(
    [opts.scrollRoot, () => toEnabled(opts.enabled), () => toProjectPath(opts.projectPath)],
    ([root, enabled]) => {
      if (!enabled || !root) {
        disconnect()
        return
      }
      connect(root)
    },
    { flush: "post" },
  )

  onBeforeUnmount(disconnect)
}
