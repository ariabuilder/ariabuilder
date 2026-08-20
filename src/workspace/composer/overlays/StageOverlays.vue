<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue"
import type {
  AriaDropHitMessage,
  AriaRect,
} from "../../../../shared/composer/protocol"
import type { OverlayInfo } from "../../../../shared/composer/paths"
import { nodeAtMarkerPath } from "../../../../shared/composer/paths"
import { parentPathOf } from "../../../../shared/composer/mutate"
import {
  applyExactDimensions,
  describeComposerCmsSelection,
  layoutParentContextForPath,
  parseStyleAttr,
  resizeAxesForHandle,
  serializeStyleAttr,
  setStyleProp,
} from "../../../../shared/composer"
import type { ResizeHandle } from "../../../../shared/composer/overlays"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/ui/app-icon"
import { ColorField } from "@/components/ui/color-picker"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import ComposerToolbarHeadingLevelPicker from "./ComposerToolbarHeadingLevelPicker.vue"
import ComposerToolbarCmsControls from "./ComposerToolbarCmsControls.vue"
import { overlayToolbarPlacement } from "./overlayToolbarPlacement"
import { tryUseComposerBeacon } from "../selection/useComposerBeacon"
import { tryUseComposerDocument } from "../useComposerDocumentSession"

export type OverlayBox = {
  key: string
  type: "sel" | "secondary" | "ghost" | "hover"
  rect: AriaRect
  info: OverlayInfo
  path?: string
  occurrence?: number
}

const props = withDefaults(
  defineProps<{
    boxes: OverlayBox[]
    /** Cutout rects that stay lit while the rest of the canvas dims (drill-in). */
    focusRects?: AriaRect[]
    dropHit?: AriaDropHitMessage | null
    showSelectionToolbar?: boolean
    showSelectionSizing?: boolean
  }>(),
  {
    focusRects: () => [],
    dropHit: null,
    showSelectionToolbar: true,
    showSelectionSizing: true,
  },
)

const emit = defineEmits<{
  "resize-preview": [payload: { path: string; cssText: string }]
  "resize-clear": [path?: string]
  open: [payload: { path: string; occurrence: number }]
}>()

const doc = tryUseComposerDocument()
const beacon = tryUseComposerBeacon()
const overlayRoot = ref<HTMLElement | null>(null)
const announcement = ref("")
const isResizingSelection = ref(false)

const handles: Array<{
  id: ResizeHandle
  className: string
  cursor: string
}> = [
  { id: "nw", className: "left-0 top-0 -translate-x-1/2 -translate-y-1/2", cursor: "nwse-resize" },
  { id: "n", className: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2", cursor: "ns-resize" },
  { id: "ne", className: "right-0 top-0 translate-x-1/2 -translate-y-1/2", cursor: "nesw-resize" },
  { id: "e", className: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2", cursor: "ew-resize" },
  { id: "se", className: "bottom-0 right-0 translate-x-1/2 translate-y-1/2", cursor: "nwse-resize" },
  { id: "s", className: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2", cursor: "ns-resize" },
  { id: "sw", className: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2", cursor: "nesw-resize" },
  { id: "w", className: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2", cursor: "ew-resize" },
]

type ResizeSession = {
  box: OverlayBox
  handle: ResizeHandle
  pointer: {
    target: HTMLElement
    id: number
    captured: boolean
  } | null
  startX: number
  startY: number
  width: number
  height: number
  nextWidth: number
  nextHeight: number
}

let resizeSession: ResizeSession | null = null

function clampSize(value: number): number {
  return Math.max(1, Math.round(value))
}

function dimensionsFor(
  session: ResizeSession,
  clientX: number,
  clientY: number,
) {
  const dx = clientX - session.startX
  const dy = clientY - session.startY
  const east = session.handle.includes("e")
  const west = session.handle.includes("w")
  const north = session.handle.includes("n")
  const south = session.handle.includes("s")
  const width = clampSize(
    session.width + (east ? dx : west ? -dx : 0),
  )
  const height = clampSize(
    session.height + (south ? dy : north ? -dy : 0),
  )
  return { width, height }
}

function exactDimensionsForSession(session: ResizeSession) {
  const axes = resizeAxesForHandle(session.handle)
  return {
    ...(axes.width ? { width: session.nextWidth } : {}),
    ...(axes.height ? { height: session.nextHeight } : {}),
  }
}

function previewResize(session: ResizeSession, width: number, height: number) {
  session.nextWidth = width
  session.nextHeight = height
  const axes = resizeAxesForHandle(session.handle)
  const parts: string[] = []
  if (axes.width) parts.push(`width:${width}px`)
  if (axes.height) parts.push(`height:${height}px`)
  announcement.value = parts.length === 2
    ? `${width} by ${height} pixels`
    : axes.width
      ? `${width} pixels wide`
      : `${height} pixels tall`
  if (!session.box.path) return
  emit("resize-preview", {
    path: session.box.path,
    cssText: parts.length ? `${parts.join(";")};` : "",
  })
}

function onPointerMove(event: PointerEvent) {
  if (!resizeSession?.pointer || event.pointerId !== resizeSession.pointer.id) return
  const next = dimensionsFor(resizeSession, event.clientX, event.clientY)
  previewResize(resizeSession, next.width, next.height)
}

function cleanupResizeListeners(session: ResizeSession) {
  const pointer = session.pointer
  if (!pointer) return
  const eventTarget: HTMLElement | Window = pointer.captured
    ? pointer.target
    : window
  eventTarget.removeEventListener("pointermove", onPointerMove as EventListener)
  eventTarget.removeEventListener("pointerup", commitResize as EventListener)
  eventTarget.removeEventListener("pointercancel", cancelResizeFromPointer as EventListener)
  if (pointer.captured) {
    pointer.target.removeEventListener("lostpointercapture", cancelResizeFromPointer)
    try {
      if (pointer.target.hasPointerCapture(pointer.id)) {
        pointer.target.releasePointerCapture(pointer.id)
      }
    } catch {
      // The browser may already have released capture during pointer cancellation.
    }
  }
}

function commitResize(event?: PointerEvent) {
  if (
    event &&
    resizeSession?.pointer &&
    event.pointerId !== resizeSession.pointer.id
  ) return
  const session = resizeSession
  resizeSession = null
  isResizingSelection.value = false
  if (session) cleanupResizeListeners(session)
  if (!session?.box.path) return
  emit("resize-clear", session.box.path)
  const model = doc?.model.value
  if (!model) return
  const node = nodeAtMarkerPath(model.nodes, session.box.path)
  if (
    !node ||
    (node.kind !== "element" && node.kind !== "component")
  ) {
    return
  }
  const currentStyle =
    node.props.style?.type === "string" ? node.props.style.value : ""
  const declarations = applyExactDimensions(
    parseStyleAttr(currentStyle),
    exactDimensionsForSession(session),
    layoutParentContextForPath(model.nodes, session.box.path),
  )
  doc?.setSelectedProp("style", {
    type: "string",
    value: serializeStyleAttr(declarations),
  }, { immediate: true })
}

function cancelResize() {
  const session = resizeSession
  const path = session?.box.path
  resizeSession = null
  isResizingSelection.value = false
  if (session) cleanupResizeListeners(session)
  emit("resize-clear", path)
}

function cancelResizeFromPointer(event: PointerEvent) {
  if (!resizeSession?.pointer || event.pointerId !== resizeSession.pointer.id) return
  cancelResize()
}

function startResize(box: OverlayBox, handle: ResizeHandle, event: PointerEvent) {
  if (!box.path) return
  event.preventDefault()
  event.stopPropagation()
  if (resizeSession) cancelResize()
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  let captured = false
  try {
    target.setPointerCapture(event.pointerId)
    captured = typeof target.hasPointerCapture === "function"
      ? target.hasPointerCapture(event.pointerId)
      : true
  } catch {
    // Window listeners preserve same-document dragging in older test/webviews.
  }
  resizeSession = {
    box,
    handle,
    pointer: { target, id: event.pointerId, captured },
    startX: event.clientX,
    startY: event.clientY,
    width: clampSize(box.rect.w),
    height: clampSize(box.rect.h),
    nextWidth: clampSize(box.rect.w),
    nextHeight: clampSize(box.rect.h),
  }
  isResizingSelection.value = true
  const eventTarget: HTMLElement | Window = captured ? target : window
  eventTarget.addEventListener("pointermove", onPointerMove as EventListener)
  eventTarget.addEventListener("pointerup", commitResize as EventListener)
  eventTarget.addEventListener("pointercancel", cancelResizeFromPointer as EventListener)
  if (captured) target.addEventListener("lostpointercapture", cancelResizeFromPointer)
}

function onHandleKeydown(
  box: OverlayBox,
  handle: ResizeHandle,
  event: KeyboardEvent,
) {
  if (event.key === "Escape") {
    event.preventDefault()
    cancelResize()
    return
  }
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    return
  }
  const axes = resizeAxesForHandle(handle)
  const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight"
  const vertical = event.key === "ArrowUp" || event.key === "ArrowDown"
  if ((horizontal && !axes.width) || (vertical && !axes.height)) return
  event.preventDefault()
  const step = event.shiftKey ? 10 : 1
  let width = clampSize(box.rect.w)
  let height = clampSize(box.rect.h)
  if (event.key === "ArrowLeft") width -= step
  if (event.key === "ArrowRight") width += step
  if (event.key === "ArrowUp") height -= step
  if (event.key === "ArrowDown") height += step
  resizeSession = {
    box,
    handle,
    pointer: null,
    startX: 0,
    startY: 0,
    width: clampSize(box.rect.w),
    height: clampSize(box.rect.h),
    nextWidth: clampSize(width),
    nextHeight: clampSize(height),
  }
  previewResize(resizeSession, clampSize(width), clampSize(height))
  commitResize()
}

onUnmounted(cancelResize)
watch(() => props.showSelectionSizing, (visible) => {
  if (!visible && resizeSession) cancelResize()
})

const ordered = computed(() => {
  // Draw hover under selection when both present.
  return [...props.boxes].sort((a, b) => {
    if (a.type === b.type) return 0
    return a.type === "hover" ? -1 : 1
  })
})

const SIZE_BADGE_HEIGHT = 20
const SIZE_BADGE_GAP = 7

function resizeHandleIndicatorClass(handle: ResizeHandle): string {
  if (handle.length === 2) {
    return "size-2.5 border border-solid border-primary bg-background dark:bg-sidebar"
  }

  return handle === "n" || handle === "s"
    ? "h-0.75 w-3 bg-primary"
    : "h-3 w-0.75 bg-primary"
}

function sizeBadgeStyle(box: OverlayBox) {
  const rootHeight = overlayRoot.value?.clientHeight ?? window.innerHeight
  const placeInside =
    box.rect.y + box.rect.h + SIZE_BADGE_GAP + SIZE_BADGE_HEIGHT > rootHeight

  return placeInside
    ? {
        left: "50%",
        top: `${box.rect.h - SIZE_BADGE_GAP}px`,
        transform: "translate(-50%, -100%)",
      }
    : {
        left: "50%",
        top: `${box.rect.h + SIZE_BADGE_GAP}px`,
        transform: "translateX(-50%)",
      }
}

function nodeForBox(box: OverlayBox) {
  const model = doc?.model.value
  return model && box.path ? nodeAtMarkerPath(model.nodes, box.path) : null
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function toolbarNodeType(box: OverlayBox): string {
  const node = nodeForBox(box)
  if (!node) return "Element"
  if (node.kind === "component") return titleCase(node.name || "Component")
  if (node.kind === "text") return "Text"
  if (node.kind === "map") return "Collection"
  if (node.kind === "conditional") return "Conditional"
  if (node.kind === "slot") return "Slot"
  if (node.kind === "fragment") return "Fragment"
  if (node.kind === "doctype") return "Doctype"
  if (node.kind === "expr" || node.kind === "comment") return "Code"
  if (node.kind !== "element" && node.kind !== "raw") return "Element"

  const ariaType = node.props?.["data-aria-type"]
  if (ariaType?.type === "string" && ariaType.value.trim()) {
    if (ariaType.value.replace(/[-_\s]+/g, "").toLowerCase() === "richtext") {
      return "Rich Text"
    }
    return titleCase(ariaType.value.trim())
  }
  const tag = node.name.toLowerCase()
  if (/^h[1-6]$/.test(tag)) return "Heading"
  if (["p", "span", "strong", "em"].includes(tag)) return "Text"
  if (tag === "img" || tag === "picture") return "Image"
  if (tag === "svg") return "SVG"
  return titleCase(tag || "Element")
}

function isTextBox(box: OverlayBox): boolean {
  const node = nodeForBox(box)
  if (!node || (node.kind !== "element" && node.kind !== "raw")) return false
  const tag = node.name.toLowerCase()
  const ariaType = node.props?.["data-aria-type"]
  const type = ariaType?.type === "string" ? ariaType.value.toLowerCase() : ""
  return ["heading", "text", "paragraph", "span", "richtext", "rich-text"].includes(type) ||
    /^h[1-6]$/.test(tag) ||
    ["p", "span", "strong", "em"].includes(tag)
}

function headingLevel(box: OverlayBox): number | null {
  const node = nodeForBox(box)
  if (!node || (node.kind !== "element" && node.kind !== "raw")) return null
  const match = /^h([1-6])$/i.exec(node.name)
  return match ? Number(match[1]) : null
}

function toolbarTextColor(box: OverlayBox): string {
  const node = nodeForBox(box)
  if (!node || (node.kind !== "element" && node.kind !== "raw")) return ""
  const style = node.props.style
  if (style?.type !== "string") return ""
  return parseStyleAttr(style.value).color ?? ""
}

function setToolbarTextColor(box: OverlayBox, value: string) {
  const node = nodeForBox(box)
  if (!node || (node.kind !== "element" && node.kind !== "raw")) return
  const current = node.props.style?.type === "string" ? node.props.style.value : ""
  const next = setStyleProp(parseStyleAttr(current), "color", value)
  doc?.setSelectedProp("style", {
    type: "string",
    value: serializeStyleAttr(next),
  }, { immediate: true })
}

function setHeadingLevel(level: number) {
  if (!Number.isInteger(level) || level < 1 || level > 6) return
  doc?.setSelectedTag(`h${level}`)
}

function showCmsControls(box: OverlayBox): boolean {
  const model = doc?.model.value
  if (!model || !box.path) return false
  const state = describeComposerCmsSelection(model, box.path)
  return state.canBindText || state.canBindProps || state.canRepeat
}

function selectableParentPath(box: OverlayBox): string | null {
  if (!box.path) return null
  const model = doc?.model.value
  let parentPath = parentPathOf(box.path)
  if (!parentPath) return null
  if (!model || nodeAtMarkerPath(model.nodes, parentPath)) return parentPath

  const branchParent = /^(.*)\.[tf]$/.exec(parentPath)?.[1] ?? null
  return branchParent && nodeAtMarkerPath(model.nodes, branchParent)
    ? branchParent
    : null
}

function canSelectParent(box: OverlayBox): boolean {
  return Boolean(selectableParentPath(box))
}

function selectParent(box: OverlayBox) {
  const parentPath = selectableParentPath(box)
  if (!parentPath) return
  beacon?.select(
    { path: parentPath, occurrence: box.occurrence ?? 0 },
    { source: "api" },
  )
}

function editComponent(box: OverlayBox) {
  if (!box.path || box.info.kind !== "component") return
  emit("open", { path: box.path, occurrence: box.occurrence ?? 0 })
}

function toolbarStyle(box: OverlayBox) {
  const rootWidth = overlayRoot.value?.clientWidth ?? window.innerWidth
  const rootHeight = overlayRoot.value?.clientHeight ?? window.innerHeight
  return overlayToolbarPlacement(box.rect, {
    width: rootWidth,
    height: rootHeight,
  })
}
</script>

<template>
  <div
    ref="overlayRoot"
    class="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    data-aria-composer-overlays
  >
    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
    <div
      v-if="dropHit?.rect && dropHit.mode === 'inside'"
      class="absolute z-[5] rounded-sm bg-primary/8 outline outline-2 outline-offset-[-2px] outline-primary"
      :style="{
        left: `${dropHit.rect.x}px`,
        top: `${dropHit.rect.y}px`,
        width: `${Math.max(dropHit.rect.w, 2)}px`,
        height: `${Math.max(dropHit.rect.h, 24)}px`,
      }"
    />
    <div
      v-else-if="dropHit?.rect"
      class="absolute z-[6] rounded-full bg-primary shadow-[0_0_0_2px_hsl(var(--background))]"
      :style="
        dropHit.axis === 'vertical'
          ? {
              left: `${dropHit.rect.x}px`,
              top: `${dropHit.mode === 'before' ? dropHit.rect.y : dropHit.rect.y + dropHit.rect.h}px`,
              width: `${Math.max(dropHit.rect.w, 24)}px`,
              height: '2px',
            }
          : {
              left: `${dropHit.mode === 'before' ? dropHit.rect.x : dropHit.rect.x + dropHit.rect.w}px`,
              top: `${dropHit.rect.y}px`,
              width: '2px',
              height: `${Math.max(dropHit.rect.h, 24)}px`,
            }
      "
    />
    <!-- Stacki-shaped focus dimming: huge box-shadow cutout around the instance. -->
    <div
      v-for="(rect, i) in focusRects"
      :key="`focus-${i}`"
      class="absolute z-[3] outline outline-1 outline-offset-[-1px] outline-emerald-500"
      :style="{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.w}px`,
        height: `${rect.h}px`,
        boxShadow: '0 0 0 100vmax rgba(0, 0, 0, 0.55)',
      }"
    />
    <div
      v-for="box in ordered"
      :key="box.key"
      :class="
        cn(
          'absolute z-[4] box-border',
          box.type === 'sel' && 'border border-solid border-primary/85',
          box.type === 'secondary' && 'outline-1 outline-primary/80',
          box.type === 'ghost' && 'outline-1 outline-dashed outline-primary/50',
          box.type === 'hover' && 'outline-1 outline-dashed outline-primary/70',
          box.info.kind === 'component' &&
            box.type !== 'sel' &&
            'outline-emerald-500/70 bg-emerald-500/10',
          box.info.kind === 'map' &&
            box.type !== 'sel' &&
            'outline-violet-500/70',
        )
      "
      :style="{
        left: `${box.rect.x}px`,
        top: `${box.rect.y}px`,
        width: `${box.rect.w}px`,
        height: `${box.rect.h}px`,
      }"
    >
      <TooltipProvider :delay-duration="0" :skip-delay-duration="0">
        <div
          v-if="box.type === 'sel' && props.showSelectionToolbar && !isResizingSelection"
          class="pointer-events-auto absolute flex h-8.5 select-none items-center whitespace-nowrap rounded-sm border-solid border-border bg-sidebar px-0 pb-0.3 text-xs text-foreground"
          :style="toolbarStyle(box)"
          role="toolbar"
          :aria-label="`${toolbarNodeType(box)} actions`"
          data-overlay="toolbar"
        >
          <div class="flex min-w-0 items-center gap-1 px-1">
            <Tooltip v-if="canSelectParent(box)">
              <TooltipTrigger as-child>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="h-6! shrink-0"
                  aria-label="Select parent"
                  @click.stop.prevent="selectParent(box)"
                >
                  <AppIcon name="selectParent" :size="14" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Select parent</TooltipContent>
            </Tooltip>
            <span class="max-w-28 truncate px-1 text-xs font-medium capitalize text-muted-foreground">
              {{ toolbarNodeType(box) }}
            </span>
          </div>

          <template v-if="isTextBox(box)">
            <div class="mx-1.5 h-2.5 shrink-0 border-l border-solid border-muted-foreground/30" aria-hidden="true" />
            <div class="flex items-center gap-0" @click.stop>
              <ColorField
                :model-value="toolbarTextColor(box)"
                variant="toolbar"
                layout="unified"
                show-design-colors
                show-alpha
                content-side="bottom"
                content-align="start"
                @update:model-value="setToolbarTextColor(box, $event)"
              />
              <ComposerToolbarHeadingLevelPicker
                v-if="headingLevel(box)"
                :model-value="headingLevel(box)!"
                @select="setHeadingLevel"
              />
            </div>
          </template>

          <template v-if="box.path && showCmsControls(box)">
            <div class="mx-1.5 h-2.5 shrink-0 border-l border-solid border-muted-foreground/30" aria-hidden="true" />
            <div class="flex items-center gap-0" @click.stop>
              <ComposerToolbarCmsControls :path="box.path" />
            </div>
          </template>

          <div class="mx-1.5 h-2.5 shrink-0 border-l border-solid border-muted-foreground/30" aria-hidden="true" />

          <div class="flex items-center gap-0 pr-1">
            <Tooltip v-if="box.info.kind === 'component'">
              <TooltipTrigger as-child>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="h-6! w-6! shrink-0"
                  aria-label="Edit component"
                  @click.stop.prevent="editComponent(box)"
                >
                  <AppIcon name="editComponent" :size="14" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Edit component</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="h-6! w-6! shrink-0"
                  aria-label="Duplicate selection"
                  @click.stop.prevent="doc?.duplicateSelected()"
                >
                  <AppIcon name="duplicate" :size="14" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Duplicate</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  class="h-6! w-6! shrink-0 hover:border-destructive/50 hover:text-destructive"
                  aria-label="Delete selection"
                  @click.stop.prevent="doc?.deleteSelected()"
                >
                  <AppIcon name="trash" :size="14" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Delete</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      <button
        v-for="handle in box.type === 'sel' && props.showSelectionSizing ? handles : []"
        :key="handle.id"
        type="button"
        :class="cn(
          'pointer-events-auto absolute z-[6] flex size-6 touch-none select-none items-center justify-center border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
          handle.className,
        )"
        :style="{ cursor: handle.cursor }"
        :aria-label="`Resize ${box.info.label} from ${handle.id}`"
        @pointerdown="startResize(box, handle.id, $event)"
        @dragstart.prevent
        @keydown="onHandleKeydown(box, handle.id, $event)"
      >
        <span
          class="block"
          :class="resizeHandleIndicatorClass(handle.id)"
          aria-hidden="true"
        />
      </button>

      <span
        v-if="box.type === 'sel' && props.showSelectionSizing"
        class="pointer-events-none absolute z-1 whitespace-nowrap rounded-sm bg-primary px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-4 tabular-nums text-primary-foreground shadow-sm"
        :style="sizeBadgeStyle(box)"
        aria-hidden="true"
        data-overlay="selection-size"
      >
        {{ Math.round(box.rect.w) }} × {{ Math.round(box.rect.h) }}
      </span>

      <span
        v-if="box.type === 'hover' && box.info.label !== box.info.path"
        :class="
          cn(
            'absolute left-0 inline-flex max-w-full items-center truncate px-1.5 py-0.5 text-[10px] font-semibold leading-none',
            box.rect.y < 18
              ? 'top-0 rounded-br-sm'
              : 'top-0 -translate-y-full rounded-t-sm rounded-br-sm',
            box.info.kind === 'component'
              ? 'bg-transparent text-emerald-600 dark:text-emerald-400'
              : box.info.kind === 'map'
                ? 'bg-transparent text-violet-600 dark:text-violet-400'
                : 'bg-transparent text-primary',
          )
        "
      >
        {{ box.info.label }}
      </span>
    </div>
  </div>
</template>
