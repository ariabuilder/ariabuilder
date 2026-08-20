import { onMounted, onUnmounted, ref } from "vue"

const fullscreen = ref(false)
let subscriberCount = 0
let unlisten: (() => void) | undefined

function connectFullscreenListener(): void {
  if (unlisten) return
  const api = window.aria?.window
  if (!api) return

  void api.isFullscreen().then((value) => {
    fullscreen.value = value
  })
  unlisten = api.onFullscreenChange((value) => {
    fullscreen.value = value
  })
}

function disconnectFullscreenListener(): void {
  unlisten?.()
  unlisten = undefined
}

/**
 * Tracks Electron native fullscreen so titlebar chrome can drop the
 * traffic-light inset when the macOS controls are hidden.
 */
export function useWindowFullscreen() {
  onMounted(() => {
    subscriberCount += 1
    connectFullscreenListener()
  })

  onUnmounted(() => {
    subscriberCount = Math.max(0, subscriberCount - 1)
    if (subscriberCount === 0) disconnectFullscreenListener()
  })

  return { fullscreen }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    subscriberCount = 0
    disconnectFullscreenListener()
  })
}
