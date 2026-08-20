import { onBeforeUnmount, ref, type Ref } from "vue"

export type MediaPlaybackController = {
  activeId: Ref<string | null>
  playing: Ref<boolean>
  isActive: (id: string) => boolean
  isPlaying: (id: string) => boolean
  registerElement: (id: string, el: HTMLMediaElement | null) => void
  requestPlay: (id: string) => Promise<void>
  requestPause: (id?: string) => void
  stop: () => void
}

/**
 * Single-active media playback across the media grid and detail view.
 * Starting one asset pauses any other registered element.
 */
export function createMediaPlayback(): MediaPlaybackController {
  const activeId = ref<string | null>(null)
  const playing = ref(false)
  const elements = new Map<string, HTMLMediaElement>()

  function pauseElement(id: string, reset = false): void {
    const el = elements.get(id)
    if (!el) return
    el.pause()
    if (reset) {
      try {
        el.currentTime = 0
      } catch {
        // Some sources reject seeks before metadata.
      }
    }
  }

  function isActive(id: string): boolean {
    return activeId.value === id
  }

  function isPlaying(id: string): boolean {
    return activeId.value === id && playing.value
  }

  function registerElement(id: string, el: HTMLMediaElement | null): void {
    if (!el) {
      const existing = elements.get(id)
      if (existing) {
        existing.pause()
        elements.delete(id)
      }
      if (activeId.value === id) {
        activeId.value = null
        playing.value = false
      }
      return
    }
    elements.set(id, el)
  }

  async function requestPlay(id: string): Promise<void> {
    const el = elements.get(id)
    if (!el) return

    if (activeId.value && activeId.value !== id) {
      // Keep the prior frame for video; reset audio so re-entry starts clean.
      const prior = elements.get(activeId.value)
      const resetPrior = prior instanceof HTMLAudioElement
      pauseElement(activeId.value, resetPrior)
    }

    activeId.value = id
    playing.value = true
    try {
      await el.play()
    } catch {
      playing.value = false
      if (activeId.value === id) activeId.value = null
    }
  }

  function requestPause(id?: string): void {
    const target = id ?? activeId.value
    if (!target) return
    pauseElement(target, false)
    if (activeId.value === target) {
      playing.value = false
    }
  }

  function stop(): void {
    if (activeId.value) {
      pauseElement(activeId.value, true)
    }
    for (const [id] of elements) {
      if (id !== activeId.value) pauseElement(id, false)
    }
    activeId.value = null
    playing.value = false
  }

  onBeforeUnmount(() => {
    stop()
    elements.clear()
  })

  return {
    activeId,
    playing,
    isActive,
    isPlaying,
    registerElement,
    requestPlay,
    requestPause,
    stop,
  }
}
