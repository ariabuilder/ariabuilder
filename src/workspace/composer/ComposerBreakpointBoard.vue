<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { isPreviewMessageOrigin, previewPageUrl } from "@/lib/preview"
import { m } from "@/paraglide/messages.js"
import { ARIA_MSG } from "../../../shared/composer/protocol"
import type { DevicePreview } from "@/workspace/types"
import {
  BREAKPOINT_BOARD_MAX_ZOOM,
  fitBreakpointBoardView,
  fitBreakpointFrameView,
  layoutBreakpointFrames,
  openingBreakpointBoardWorld,
  panBreakpointBoardView,
  zoomBreakpointBoardView,
  type BreakpointBoardView,
} from "./breakpointBoardView"
import { BREAKPOINT_BOARD_PRESETS } from "./devicePreview"

const props = defineProps<{
  previewUrl: string | null
  selectedRoute: string | null
  reloadKey?: number
  isolatedDevice?: DevicePreview | null
}>()

const wrapEl = ref<HTMLElement | null>(null)
const view = ref<BreakpointBoardView | null>(null)
const panning = ref(false)
const heights = ref<Partial<Record<DevicePreview, number>>>({})
const iframeEls: Partial<Record<DevicePreview, HTMLIFrameElement>> = {}
const userMoved = ref(false)
const viewRef = { current: null as BreakpointBoardView | null }

watch(view, (next) => {
  viewRef.current = next
}, { immediate: true })

const pageSrc = computed(() =>
  props.previewUrl
    ? previewPageUrl(props.previewUrl, props.selectedRoute, { designMode: true })
    : null,
)

const frames = computed(() => layoutBreakpointFrames(heights.value))

function presetLabel(id: DevicePreview): string {
  if (id === "tablet") return m.workspace_device_tablet()
  if (id === "mobile") return m.workspace_device_mobile()
  return m.workspace_device_desktop()
}

function setIframeEl(id: DevicePreview, el: unknown) {
  if (el instanceof HTMLIFrameElement) iframeEls[id] = el
  else delete iframeEls[id]
}

const cameraAnimating = ref(false)
let cameraAnimateTimer: ReturnType<typeof setTimeout> | null = null

function fitOpeningWindow() {
  const el = wrapEl.value
  if (!el) return
  const opening = openingBreakpointBoardWorld()
  const next = fitBreakpointBoardView({
    viewportWidth: el.clientWidth,
    viewportHeight: el.clientHeight,
    worldWidth: opening.w,
    worldHeight: opening.h,
  })
  if (next) view.value = next
}

function fitIsolatedWindow(id: DevicePreview) {
  const el = wrapEl.value
  if (!el) return
  const frame = layoutBreakpointFrames().find((entry) => entry.id === id)
  if (!frame) return
  const next = fitBreakpointFrameView({
    viewportWidth: el.clientWidth,
    viewportHeight: el.clientHeight,
    frameX: frame.x,
    frameWidth: frame.width,
    frameHeight: frame.height,
  })
  if (next) view.value = next
}

function fitCurrentWindow() {
  const isolated = props.isolatedDevice
  if (isolated) fitIsolatedWindow(isolated)
  else fitOpeningWindow()
}

function animateCameraToCurrentWindow() {
  cameraAnimating.value = true
  if (cameraAnimateTimer) clearTimeout(cameraAnimateTimer)
  cameraAnimateTimer = setTimeout(() => {
    cameraAnimating.value = false
    cameraAnimateTimer = null
  }, 220)
  userMoved.value = false
  fitCurrentWindow()
}

function scheduleOpeningFit() {
  void nextTick(() => {
    requestAnimationFrame(() => {
      if (!userMoved.value) fitCurrentWindow()
    })
  })
}

function markMoved() {
  userMoved.value = true
}

function zoomBy(factor: number) {
  const el = wrapEl.value
  const current = viewRef.current
  if (!el || !current) return
  markMoved()
  view.value = zoomBreakpointBoardView({
    view: current,
    nextScale: current.s * factor,
    originX: el.clientWidth / 2,
    originY: el.clientHeight / 2,
  })
}

function zoomTo(nextScale: number) {
  const el = wrapEl.value
  const current = viewRef.current
  if (!el || !current) return
  markMoved()
  view.value = zoomBreakpointBoardView({
    view: current,
    nextScale,
    originX: el.clientWidth / 2,
    originY: el.clientHeight / 2,
  })
}

function fitAll() {
  animateCameraToCurrentWindow()
}

function onFrameLoad(id: DevicePreview, event: Event) {
  const iframe = event.currentTarget
  if (!(iframe instanceof HTMLIFrameElement) || !iframe.contentWindow) return
  const preset = BREAKPOINT_BOARD_PRESETS.find((entry) => entry.id === id)
  if (!preset) return
  let origin = "*"
  try {
    origin = new URL(iframe.src).origin
  } catch {
    /* keep wildcard for malformed src */
  }
  iframe.contentWindow.postMessage({ type: ARIA_MSG.setVh, px: preset.viewportHeight }, origin)
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 && event.button !== 1) return
  const current = viewRef.current
  if (!current) return
  event.preventDefault()
  markMoved()
  panning.value = true
  const startX = event.clientX
  const startY = event.clientY
  const origin = { ...current }
  const onMove = (move: PointerEvent) => {
    view.value = panBreakpointBoardView(origin, move.clientX - startX, move.clientY - startY)
  }
  const onUp = () => {
    panning.value = false
    window.removeEventListener("pointermove", onMove)
    window.removeEventListener("pointerup", onUp)
  }
  window.addEventListener("pointermove", onMove)
  window.addEventListener("pointerup", onUp)
}

function onPreviewMessage(event: MessageEvent) {
  if (!isPreviewMessageOrigin(event.origin)) return
  if (event.data?.type !== ARIA_MSG.pageHeight || typeof event.data.height !== "number") return
  const entry = (Object.entries(iframeEls) as Array<[DevicePreview, HTMLIFrameElement | undefined]>)
    .find(([, iframe]) => iframe?.contentWindow === event.source)
  if (!entry) return
  const [id] = entry
  const height = Math.round(event.data.height)
  if (heights.value[id] === height) return
  heights.value = { ...heights.value, [id]: height }
}

watch(
  () => props.isolatedDevice ?? null,
  () => {
    animateCameraToCurrentWindow()
  },
)

let wheelTarget: HTMLElement | null = null
let onWheel: ((event: WheelEvent) => void) | null = null
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  scheduleOpeningFit()
  window.addEventListener("message", onPreviewMessage)
  const el = wrapEl.value
  if (!el) return
  wheelTarget = el
  onWheel = (event: WheelEvent) => {
    event.preventDefault()
    markMoved()
    const current = viewRef.current
    if (!current) return
    const rect = el.getBoundingClientRect()
    const cx = event.clientX - rect.left
    const cy = event.clientY - rect.top
    if (event.ctrlKey || event.metaKey) {
      view.value = zoomBreakpointBoardView({
        view: current,
        nextScale: current.s * Math.exp(-event.deltaY * 0.01),
        originX: cx,
        originY: cy,
      })
      return
    }
    view.value = panBreakpointBoardView(current, -event.deltaX, -event.deltaY)
  }
  el.addEventListener("wheel", onWheel, { passive: false })
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      if (!userMoved.value) fitCurrentWindow()
    })
    resizeObserver.observe(el)
  }
})

onUnmounted(() => {
  window.removeEventListener("message", onPreviewMessage)
  if (wheelTarget && onWheel) wheelTarget.removeEventListener("wheel", onWheel)
  resizeObserver?.disconnect()
  if (cameraAnimateTimer) clearTimeout(cameraAnimateTimer)
})
</script>

<template>
  <div
    ref="wrapEl"
    class="relative min-h-0 flex-1 overflow-hidden bg-background dark:bg-sidebar"
    :class="panning ? 'cursor-grabbing' : 'cursor-grab'"
    data-aria-composer-breakpoint-board
    @pointerdown="onPointerDown"
  >
    <div
      v-if="view"
      class="absolute top-0 left-0 h-0 w-0 origin-top-left will-change-transform"
      :class="cameraAnimating && !panning ? 'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out' : undefined"
      :style="{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }"
    >
      <div
        v-for="frame in frames"
        :key="frame.id"
        class="absolute overflow-hidden rounded-md border border-border/70 bg-white shadow-[0_12px_48px_rgba(0,0,0,0.28)] transition-opacity duration-200"
        :class="isolatedDevice && isolatedDevice !== frame.id ? 'opacity-35' : 'opacity-100'"
        :data-aria-breakpoint-frame="frame.id"
        :style="{ left: `${frame.x}px`, top: '0px', width: `${frame.width}px`, height: `${frame.height}px` }"
      >
        <div
          class="pointer-events-none absolute right-0 bottom-full left-0 whitespace-nowrap font-medium text-muted-foreground"
          :style="{ fontSize: `${13 / view.s}px`, paddingBottom: `${8 / view.s}px` }"
        >
          {{ presetLabel(frame.id) }} · {{ frame.width }}px
        </div>
        <iframe
          v-if="pageSrc"
          :key="`${pageSrc}-${reloadKey ?? 0}-${frame.id}`"
          class="pointer-events-none absolute inset-0 h-full w-full border-0 bg-white"
          :src="pageSrc"
          :title="`${presetLabel(frame.id)} preview`"
          referrerpolicy="no-referrer"
          sandbox="allow-scripts allow-forms allow-same-origin"
          :ref="(el) => setIframeEl(frame.id, el)"
          @load="onFrameLoad(frame.id, $event)"
        />
        <div class="absolute inset-0" aria-hidden="true" />
      </div>
    </div>
    <TooltipProvider v-if="view" :delay-duration="0" :skip-delay-duration="0">
      <div
        class="absolute right-3 bottom-3 z-10 flex items-center gap-0.5 rounded-md border border-border/70 bg-background/95 p-0.5 shadow-sm backdrop-blur-sm"
        @pointerdown.stop
      >
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="size-7 p-0"
              :aria-label="m.composer_breakpoint_board_zoom_out()"
              @click="zoomBy(1 / 1.25)"
            >
              <AppIcon name="zoomOut" :size="14" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ m.composer_breakpoint_board_zoom_out() }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-7 min-w-12 px-1.5 text-[11px] tabular-nums"
              :aria-label="m.composer_breakpoint_board_zoom_reset()"
              @click="zoomTo(1)"
            >
              {{ Math.round(view.s * 100) }}%
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ m.composer_breakpoint_board_zoom_reset() }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="size-7 p-0"
              :disabled="view.s >= BREAKPOINT_BOARD_MAX_ZOOM"
              :aria-label="m.composer_breakpoint_board_zoom_in()"
              @click="zoomBy(1.25)"
            >
              <AppIcon name="zoomIn" :size="14" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ m.composer_breakpoint_board_zoom_in() }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-7 px-2 text-[11px]"
              :aria-label="m.composer_breakpoint_board_zoom_fit()"
              @click="fitAll"
            >
              {{ m.composer_breakpoint_board_zoom_fit() }}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ m.composer_breakpoint_board_zoom_fit() }}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  </div>
</template>
