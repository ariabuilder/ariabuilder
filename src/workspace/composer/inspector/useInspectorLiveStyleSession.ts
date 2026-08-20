import { onUnmounted, ref, watch, type Ref } from "vue"

/** Temporary canvas styling with one explicit commit/cancel boundary. */
export function useInspectorLiveStyleSession(options: {
  path: Ref<string | null>
  preview: (path: string, cssText: string) => void
  clear: (path?: string) => void
  onCancel?: (originCssText: string) => void
}) {
  const active = ref(false)
  let origin = ""
  let latest = ""
  let frame = 0
  let listening = false
  let paintedPath: string | null = null

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !active.value) return
    if (
      event.target instanceof Element &&
      event.target.closest("[data-inspector-escape-owner]")
    ) return
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }

  function startListening() {
    if (listening) return
    listening = true
    window.addEventListener("keydown", onKeydown, true)
  }

  function stopListening() {
    if (!listening) return
    listening = false
    window.removeEventListener("keydown", onKeydown, true)
  }

  function flush() {
    frame = 0
    const path = options.path.value
    if (path) {
      paintedPath = path
      options.preview(path, latest)
    }
  }

  function begin(cssText: string) {
    if (!active.value) origin = cssText
    active.value = true
    latest = cssText
    startListening()
  }

  function preview(cssText: string, originCssText = cssText) {
    if (!active.value) begin(originCssText)
    latest = cssText
    if (!frame) frame = requestAnimationFrame(flush)
  }

  function clear() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    options.clear(paintedPath ?? options.path.value ?? undefined)
    paintedPath = null
    active.value = false
    latest = ""
    origin = ""
    stopListening()
  }

  /** Keep the committed preview rule painted until Astro refreshes it. */
  function commit(cssText: string) {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    const path = options.path.value
    if (path) {
      paintedPath = path
      options.preview(path, cssText)
    }
    active.value = false
    latest = ""
    origin = ""
    stopListening()
  }

  function cancel(): string {
    const restore = origin
    if (!active.value) return restore
    clear()
    options.onCancel?.(restore)
    return restore
  }

  function finish(): string {
    const value = latest
    clear()
    return value
  }

  watch(options.path, () => {
    // A committed rule is editor-authoritative until the matching persisted
    // revision is active. Selection is navigation, not a cancellation signal.
    if (active.value) clear()
  })
  onUnmounted(clear)
  return { active, begin, preview, cancel, finish, commit, clear }
}

/** Horizontal numeric scrub; typing and arrow keys remain handled by the input. */
export function beginPointerScrub(options: {
  event: PointerEvent | MouseEvent
  value: number
  pixelsPerStep?: number
  step?: number
  onPreview: (value: number) => void
  onCommit: (value: number) => void
  onCancel?: () => void
}) {
  if (options.event.button !== 0) return
  const originX = options.event.clientX
  const originValue = options.value
  const pixels = options.pixelsPerStep ?? 2
  const step = options.step ?? 1
  let moved = false
  let current = originValue
  const pointerId = "pointerId" in options.event ? options.event.pointerId : undefined
  const target = options.event.currentTarget
  if (target instanceof Element && typeof pointerId === "number") {
    target.setPointerCapture?.(pointerId)
  }

  const move = (event: PointerEvent | MouseEvent) => {
    const delta = event.clientX - originX
    if (!moved && Math.abs(delta) < 2) return
    if (!moved) {
      // Defer until drag starts so click-to-focus still works on inputs.
      event.preventDefault()
      if (document.activeElement instanceof HTMLInputElement) {
        document.activeElement.blur()
      }
      document.body.style.cursor = "ew-resize"
      document.body.style.userSelect = "none"
    }
    moved = true
    current = originValue + Math.round(delta / pixels) * step
    options.onPreview(current)
  }
  const cleanup = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("mousemove", move)
    window.removeEventListener("pointerup", up)
    window.removeEventListener("mouseup", up)
    window.removeEventListener("keydown", keydown, true)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
  }
  const up = () => {
    cleanup()
    if (moved) options.onCommit(current)
  }
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    event.preventDefault()
    cleanup()
    options.onCancel?.()
  }
  window.addEventListener("pointermove", move)
  window.addEventListener("mousemove", move)
  window.addEventListener("pointerup", up, { once: true })
  window.addEventListener("mouseup", up, { once: true })
  window.addEventListener("keydown", keydown, true)
}
