<script setup lang="ts">
import { computed, nextTick } from "vue"
import { Button } from "@/components/ui/button"
import {
  addElementListItemAtPath,
  applyElementListStyleAtPath,
  applyListPresentationToStyles,
  clearListPresentationFromStyles,
  convertElementListAtPath,
  elementListHasPresentationChanges,
  elementListMode,
  elementListStyleIsExpression,
  LIST_PRESENTATION_PROPERTIES,
  listPresentationCss,
  listPresentationHasChangesFromStyles,
  nativeListMarker,
  nodeAtMarkerPath,
  ORDERED_LIST_MARKERS,
  parseStyleAttr,
  resetElementListAtPath,
  resolveElementInspectorTarget,
  resolveListMarker,
  resolveListPosition,
  resolveListPresentationFromStyles,
  serializeStyleAttr,
  UNORDERED_LIST_MARKERS,
  type ElementListMode,
} from "../../../../shared/composer"
import type { PropValue } from "../../../../shared/composer/types"
import { tryUseInspectorContext } from "../inspector/useInspectorContext"
import InspectorPropertySection from "./InspectorPropertySection.vue"

type StyleCommitOptions = {
  historyBoundary?: boolean
  preserveApply?: boolean
  deletedKeys?: string[]
}

const props = defineProps<{
  openSection?: string | null
  disabled?: boolean
  styleText?: string
  inheritedStyleText?: string
}>()
const emit = defineEmits<{
  "update:openSection": [value: string | null]
  setStyle: [value: PropValue | undefined, immediate: boolean, options?: StyleCommitOptions]
}>()
const inspector = tryUseInspectorContext()
const listModes = ["unordered", "ordered", "description"] as const
const listPositions = ["outside", "inside"] as const
const MARKER_GLYPHS: Record<string, string> = {
  decimal: "1",
  "lower-alpha": "a",
  "upper-alpha": "A",
  "lower-roman": "i",
  "upper-roman": "I",
}
const MARKER_LABELS: Record<string, string> = {
  disc: "Disc",
  circle: "Circle",
  square: "Square",
  none: "None",
  decimal: "Decimal",
  "lower-alpha": "Lower alpha",
  "upper-alpha": "Upper alpha",
  "lower-roman": "Lower roman",
  "upper-roman": "Upper roman",
}
const POSITION_LABELS = { outside: "Outside", inside: "Inside" } as const
const context = computed(() => {
  const model = inspector?.document.model.value
  const path = inspector?.selectedPath.value
  return model && path ? resolveElementInspectorTarget(model, path) : null
})
const sectionId = computed(() => context.value?.sections.includes("icon-list") ? "icon-list" : "list")
const listNode = computed(() => context.value?.listNode ?? null)
const classStyleTarget = computed(() => inspector?.styleTarget.value === "class")
const authoredClassStyles = computed(() => parseStyleAttr(props.styleText ?? ""))
const classPresentation = computed(() => resolveListPresentationFromStyles({
  ...parseStyleAttr(props.inheritedStyleText ?? ""),
  ...authoredClassStyles.value,
}))
const mode = computed<ElementListMode>(() => listNode.value ? elementListMode(listNode.value) : "unordered")
const markerOptions = computed(() => mode.value === "ordered" ? ORDERED_LIST_MARKERS : UNORDERED_LIST_MARKERS)
const marker = computed(() => {
  if (!listNode.value) return "disc"
  if (classStyleTarget.value) return classPresentation.value.type || nativeListMarker(mode.value)
  return resolveListMarker(listNode.value, mode.value)
})
const position = computed(() => {
  if (!listNode.value) return "outside"
  if (classStyleTarget.value) return classPresentation.value.position || "outside"
  return resolveListPosition(listNode.value)
})
const hasChanges = computed(() => {
  if (!listNode.value) return false
  if (classStyleTarget.value) {
    return mode.value !== "unordered" || listPresentationHasChangesFromStyles(authoredClassStyles.value)
  }
  return elementListHasPresentationChanges(listNode.value, mode.value)
})
const resetDisabled = computed(() => props.disabled || (
  !classStyleTarget.value && Boolean(listNode.value && elementListStyleIsExpression(listNode.value))
))

function paintListPreview(path: string) {
  const model = inspector?.document.model.value
  const list = model ? nodeAtMarkerPath(model.nodes, path) : null
  const css = list?.kind === "element" ? listPresentationCss(list) : ""
  if (css) inspector?.document.previewStyle?.(path, css)
  else inspector?.document.clearPreviewStyle?.(path)
}

function commitClassListStyle(next: Record<string, string>, options: StyleCommitOptions = {}) {
  const css = serializeStyleAttr(next)
  emit("setStyle", css ? { type: "string", value: css } : undefined, true, options)
}

function changeMode(value: unknown) {
  const path = context.value?.listPath
  if (!path || props.disabled) return
  const next = String(value) as ElementListMode
  const ok = inspector?.document.commitInspectorMutation(
    "Change list type",
    (model) => convertElementListAtPath(model, path, next, {
      syncPresentation: !classStyleTarget.value,
    }),
    { immediate: true, coalesceKey: null },
  )
  if (ok && !classStyleTarget.value) paintListPreview(path)
}
function addItem() {
  const path = inspector?.selectedPath.value
  if (!path || props.disabled) return
  inspector.document.commitInspectorMutation("Add list item", (model) => addElementListItemAtPath(model, path), { immediate: true, coalesceKey: null })
}
function setListStyle(name: "list-style-type" | "list-style-position", value: string) {
  if (props.disabled || resetDisabled.value) return
  if (classStyleTarget.value) {
    commitClassListStyle(
      applyListPresentationToStyles(
        authoredClassStyles.value,
        name === "list-style-type" ? { type: String(value) } : { position: String(value) },
        { type: nativeListMarker(mode.value), position: "outside" },
      ),
      { deletedKeys: ["list-style-type", "list-style-position"] },
    )
    return
  }
  const path = context.value?.listPath
  if (!path || props.disabled) return
  const next = name === "list-style-type" ? { type: String(value) } : { position: String(value) }
  const ok = inspector?.document.commitInspectorMutation(
    "Edit list style",
    (model) => applyElementListStyleAtPath(model, path, next),
    { immediate: true, coalesceKey: null },
  )
  if (ok) paintListPreview(path)
}
async function onRadioGroupKeydown(
  event: KeyboardEvent,
  values: readonly string[],
  current: string,
  attr: string,
  select: (value: string) => void,
  blocked = false,
) {
  if (blocked || props.disabled) return
  const currentIndex = values.indexOf(current)
  let index = currentIndex < 0 ? 0 : currentIndex
  if (["ArrowRight", "ArrowDown"].includes(event.key)) index = (index + 1) % values.length
  else if (["ArrowLeft", "ArrowUp"].includes(event.key)) index = (index - 1 + values.length) % values.length
  else if (event.key === "Home") index = 0
  else if (event.key === "End") index = values.length - 1
  else return
  event.preventDefault()
  const value = values[index]
  if (!value) return
  const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]')
  select(value)
  await nextTick()
  ;(group?.querySelector(`[${attr}="${value}"]`) as HTMLElement | null)?.focus()
}
function onListModeKeydown(event: KeyboardEvent) {
  return onRadioGroupKeydown(event, listModes, mode.value, "data-list-mode", (value) => changeMode(value), sectionId.value === "icon-list")
}
function onMarkerKeydown(event: KeyboardEvent) {
  return onRadioGroupKeydown(
    event,
    markerOptions.value,
    marker.value,
    "data-list-marker",
    (value) => setListStyle("list-style-type", value),
    resetDisabled.value,
  )
}
function onPositionKeydown(event: KeyboardEvent) {
  return onRadioGroupKeydown(
    event,
    listPositions,
    position.value,
    "data-list-position",
    (value) => setListStyle("list-style-position", value),
    resetDisabled.value,
  )
}
function resetList() {
  if (resetDisabled.value) return
  if (classStyleTarget.value) {
    const listPath = context.value?.listPath
    if (listPath && mode.value !== "unordered") {
      inspector?.document.commitInspectorMutation(
        "Reset list",
        (model) => convertElementListAtPath(model, listPath, "unordered", { syncPresentation: false }),
        { immediate: true, coalesceKey: null },
      )
    }
    commitClassListStyle(clearListPresentationFromStyles(authoredClassStyles.value), {
      historyBoundary: true,
      deletedKeys: [...LIST_PRESENTATION_PROPERTIES],
    })
    return
  }
  const listPath = context.value?.listPath
  if (!listPath || resetDisabled.value) return
  const ok = inspector?.document.commitInspectorMutation(
    "Reset list",
    (model) => resetElementListAtPath(model, listPath),
    { immediate: true, coalesceKey: null },
  )
  if (ok) paintListPreview(listPath)
}
</script>

<template>
  <InspectorPropertySection
    v-if="context?.listNode"
    :title="sectionId === 'icon-list' ? 'Icon list' : 'List'"
    :open="openSection === sectionId"
    :has-changes="hasChanges"
    :show-reset="openSection === sectionId && hasChanges"
    :reset-disabled="resetDisabled"
    :reset-label="`Reset ${sectionId === 'icon-list' ? 'Icon list' : 'List'}`"
    @update:open="emit('update:openSection', $event ? sectionId : openSection === sectionId ? null : openSection ?? null)"
    @reset="resetList"
  >
    <div class="space-y-3">
      <div class="grid grid-cols-3 gap-1" role="radiogroup" aria-label="List type">
        <Button v-for="item in listModes" :key="item" type="button" size="sm" :variant="mode === item ? 'default' : 'outline'" role="radio" :aria-checked="mode === item" :tabindex="sectionId === 'icon-list' ? -1 : mode === item ? 0 : -1" :data-list-mode="item" :disabled="disabled || sectionId === 'icon-list'" class="h-8 px-1 text-[10px] capitalize" @click="changeMode(item)" @keydown="onListModeKeydown">{{ item }}</Button>
      </div>
      <Button type="button" size="sm" variant="outline" class="h-8 w-full" :disabled="disabled" @click="addItem">Add item</Button>
      <div v-if="mode !== 'description' && sectionId !== 'icon-list'" class="space-y-2">
        <div class="grid grid-cols-[68px_1fr] items-center gap-2">
          <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Marker</span>
          <div
            class="grid gap-1"
            :class="mode === 'ordered' ? 'grid-cols-5' : 'grid-cols-4'"
            role="radiogroup"
            aria-label="List marker"
            data-testid="list-style-type-select"
          >
            <Button
              v-for="item in markerOptions"
              :key="item"
              type="button"
              size="sm"
              :variant="marker === item ? 'default' : 'outline'"
              role="radio"
              :aria-checked="marker === item"
              :aria-label="MARKER_LABELS[item] ?? item"
              :title="MARKER_LABELS[item] ?? item"
              :tabindex="marker === item ? 0 : -1"
              :data-list-marker="item"
              :disabled="disabled || resetDisabled"
              class="h-8 px-0"
              @click="setListStyle('list-style-type', item)"
              @keydown="onMarkerKeydown"
            >
              <span v-if="MARKER_GLYPHS[item]" class="text-[11px] font-semibold leading-none">{{ MARKER_GLYPHS[item] }}</span>
              <span v-else-if="item === 'disc'" class="size-2 rounded-full bg-current" />
              <span v-else-if="item === 'circle'" class="size-2 rounded-full border-[1.5px] border-current bg-transparent" />
              <span v-else-if="item === 'square'" class="size-2 bg-current" />
              <span v-else class="relative flex size-2.5 items-center justify-center" aria-hidden="true">
                <span class="size-2 rounded-full border border-current" />
                <span class="absolute h-px w-full -rotate-45 bg-current" />
              </span>
            </Button>
          </div>
        </div>
        <div class="grid grid-cols-[68px_1fr] items-center gap-2">
          <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Position</span>
          <div class="grid grid-cols-2 gap-1" role="radiogroup" aria-label="List marker position" data-testid="list-style-position-select">
            <Button
              v-for="item in listPositions"
              :key="item"
              type="button"
              size="sm"
              :variant="position === item ? 'default' : 'outline'"
              role="radio"
              :aria-checked="position === item"
              :aria-label="POSITION_LABELS[item]"
              :title="POSITION_LABELS[item]"
              :tabindex="position === item ? 0 : -1"
              :data-list-position="item"
              :disabled="disabled || resetDisabled"
              class="h-8 px-0"
              @click="setListStyle('list-style-position', item)"
              @keydown="onPositionKeydown"
            >
              <svg viewBox="0 0 16 16" class="size-3.5" fill="none" aria-hidden="true">
                <circle cx="3.25" cy="5" r="1.35" fill="currentColor" />
                <path
                  :d="item === 'outside' ? 'M7.25 5h6.5M7.25 11h6.5' : 'M6.25 5h7.5M3.25 11h10.5'"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
              </svg>
            </Button>
          </div>
        </div>
      </div>
      <p v-if="sectionId === 'icon-list'" class="text-[10px] leading-relaxed text-muted-foreground">Select an icon inside a row to change it with the Icon section. Icon lists retain unordered native semantics.</p>
    </div>
  </InspectorPropertySection>
</template>
