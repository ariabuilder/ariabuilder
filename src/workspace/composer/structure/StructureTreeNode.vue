<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue"
import draggable from "vuedraggable"
import type {
  ComposerLayerDropCandidate,
  ComposerLayerRow,
  ComposerLayerSemanticType,
} from "../../../../shared/composer/layers"
import {
  locateAtPath,
  parentAcceptsChildAtPath,
} from "../../../../shared/composer/mutate"
import type { MenuItemDef } from "@/menu/types"
import { AppIcon } from "@/components/ui/app-icon"
import type { AppIconName } from "@/icons/registry"
import AppContextMenu from "@/components/menu/AppContextMenu.vue"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useComposerBeacon } from "../selection/useComposerBeacon"
import { tryUseComposerDocument } from "../useComposerDocumentSession"
import { nextRenderedChildLimit } from "./layerPresentation"

type SortChange = {
  added?: { element: ComposerLayerRow; newIndex: number }
  moved?: { element: ComposerLayerRow; oldIndex: number; newIndex: number }
  removed?: { element: ComposerLayerRow; oldIndex: number }
}

const props = defineProps<{
  row: ComposerLayerRow
  depth: number
  expanded: Set<string>
  canMutate: boolean
  focusedPath: string | null
  renamingPath: string | null
  menuItemsFor: (row: ComposerLayerRow) => MenuItemDef[]
  dropCandidate: ComposerLayerDropCandidate | null
  sortingDisabled?: boolean
  isDragging?: boolean
  canSort: (event: {
    draggedContext?: { element?: ComposerLayerRow }
    to?: HTMLElement
  }) => boolean
}>()

const emit = defineEmits<{
  toggle: [row: ComposerLayerRow]
  select: [row: ComposerLayerRow, event?: MouseEvent | KeyboardEvent]
  focus: [row: ComposerLayerRow]
  open: [row: ComposerLayerRow]
  "rename-start": [row: ComposerLayerRow]
  "rename-commit": [row: ComposerLayerRow, label: string]
  "rename-cancel": [row: ComposerLayerRow]
  "menu-action": [id: string, row: ComposerLayerRow]
  "menu-close-auto-focus": [event: Event, row: ComposerLayerRow]
  "row-drag-over": [event: DragEvent, row: ComposerLayerRow]
  "row-drag-leave": [event: DragEvent, row: ComposerLayerRow]
  "row-drop": [event: DragEvent, row: ComposerLayerRow]
  "sort-change": [payload: {
    change: SortChange
    parentPath: string | null
    rows: ComposerLayerRow[]
    slotGroup?: boolean
    slotName?: string | null
  }]
  "sort-start": [event: { item?: HTMLElement; originalEvent?: DragEvent }]
  "sort-end": []
}>()

const beacon = useComposerBeacon()
const doc = tryUseComposerDocument()
const sortableChildren = ref<ComposerLayerRow[]>([])
const renderedChildLimit = ref(24)
const renameInput = ref<HTMLInputElement | null>(null)
const renameDraft = ref("")
const renameFinishing = ref(false)
const cmsLabel = computed(() => {
  const names = props.row.cmsCollections ?? []
  const source = names.length === 1
    ? `${names[0]!.replace(/[-_]+/g, " ").replace(/^./, (letter) => letter.toUpperCase())} collection`
    : names.length > 1
      ? `${names.length} collections`
      : "CMS content"
  const count = props.row.cmsBindingCount
    ? ` · ${props.row.cmsBindingCount} binding${props.row.cmsBindingCount === 1 ? "" : "s"}`
    : ""
  const ownership = props.row.cmsOwnership ? ` · ${props.row.cmsOwnership}` : ""
  return `${source}${count}${ownership}`
})
const conditionStatusLabel = computed(() => {
  switch (props.row.conditionStatus) {
    case true: return "Passes"
    case false: return "Fails"
    case "unknown": return "Unknown"
    case "custom": return "Custom"
    default: return ""
  }
})
let renderFrame: number | null = null

function cancelRenderFrame() {
  if (renderFrame !== null) cancelAnimationFrame(renderFrame)
  renderFrame = null
}

function syncRenderedChildren() {
  const children = props.row.children
  const limit = props.isDragging ? children.length : renderedChildLimit.value
  sortableChildren.value = children.slice(0, limit)
}

function scheduleChildBatches() {
  cancelRenderFrame()
  if (!props.expanded.has(props.row.treeKey) || props.isDragging) {
    if (props.isDragging) renderedChildLimit.value = props.row.children.length
    syncRenderedChildren()
    return
  }
  const step = () => {
    renderFrame = null
    if (!props.expanded.has(props.row.treeKey)) return
    renderedChildLimit.value = nextRenderedChildLimit({
      current: renderedChildLimit.value,
      total: props.row.children.length,
      expanded: true,
      dragging: props.isDragging,
    })
    syncRenderedChildren()
    if (renderedChildLimit.value < props.row.children.length) {
      renderFrame = requestAnimationFrame(step)
    }
  }
  if (renderedChildLimit.value < props.row.children.length) {
    renderFrame = requestAnimationFrame(step)
  }
}

watch(
  () => props.row.treeKey,
  () => {
    renderedChildLimit.value = Math.min(props.row.children.length, 24)
    syncRenderedChildren()
    scheduleChildBatches()
  },
  { immediate: true },
)

watch(
  () => props.row.children,
  (children) => {
    renderedChildLimit.value = Math.min(children.length, renderedChildLimit.value)
    syncRenderedChildren()
    scheduleChildBatches()
  },
)

watch(
  () => [props.expanded.has(props.row.treeKey), props.isDragging] as const,
  scheduleChildBatches,
  { immediate: true },
)

onBeforeUnmount(cancelRenderFrame)

const isExpanded = computed(() => props.expanded.has(props.row.treeKey))
const isRenaming = computed(() => props.renamingPath === props.row.treeKey)
const isSelected = computed(() =>
  !props.row.presentationOnly && (
    (
      Boolean(props.row.address) &&
      beacon.contextSelection.value?.file === props.row.address?.file &&
      beacon.contextSelection.value?.path === props.row.address?.path
    ) ||
    beacon.selections.value.some(
      (selection) => selection.path === props.row.path &&
        (!props.row.instance ||
          selection.occurrence === props.row.instance.occurrence),
    )
  ),
)
const treeItemLabel = computed(() => {
  if (props.row.activeDocumentRoot) {
    return `${props.row.label}, active component`
  }
  if (props.row.kind === "comment" && props.row.commentPreview) {
    return `Comment: ${props.row.commentPreview}`
  }
  return undefined
})
const isCanvasHovered = computed(() => {
  if (
    props.row.contextOnly ||
    props.row.presentationOnly ||
    beacon.hoverPath.value !== props.row.path
  ) {
    return false
  }
  return !props.row.instance ||
    beacon.hoverOccurrence.value === props.row.instance.occurrence
})
const isSelectedBranch = computed(() =>
  beacon.selections.value.some(
    (selection) =>
      selection.path !== props.row.path &&
      selection.path.startsWith(`${props.row.path}.`),
  ),
)
const isDropRow = computed(
  () => props.dropCandidate?.targetPath === props.row.path && props.dropCandidate.valid,
)
const isMountingChildren = computed(
  () => isExpanded.value && renderedChildLimit.value < props.row.children.length,
)
const isActiveDocumentRoot = computed(() => props.row.activeDocumentRoot === true)
const isSlotGroup = computed(
  () => props.row.synthetic && props.row.treeKey.startsWith("slot-group:"),
)
const isVirtualRoot = computed(
  () => isSlotGroup.value || isActiveDocumentRoot.value || props.row.presentationOnly,
)
const childParentPath = computed(() =>
  isVirtualRoot.value
    ? props.row.insertTarget?.parentPath ?? null
    : props.row.path,
)
const dropPosition = computed(() =>
  isDropRow.value ? props.dropCandidate?.position ?? null : null,
)
const canRename = computed(() =>
  props.canMutate &&
  !isActiveDocumentRoot.value &&
  !props.row.contextOnly &&
  !props.row.presentationOnly &&
  !props.row.sourceLocked &&
  props.row.deletable &&
  props.row.kind === "element",
)

watch(isRenaming, async (active) => {
  if (!active) {
    return
  }
  renameDraft.value = props.row.label
  renameFinishing.value = false
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
})

function startRename() {
  if (canRename.value) emit("rename-start", props.row)
}

function commitRename() {
  const label = renameDraft.value.trim()
  if (label === props.row.label) {
    renameFinishing.value = true
    emit("rename-cancel", props.row)
    return
  }
  renameFinishing.value = true
  emit("rename-commit", props.row, label)
}

function cancelRename() {
  if (renameFinishing.value) return
  renameFinishing.value = true
  emit("rename-cancel", props.row)
}

function finishRenameOnBlur() {
  if (renameFinishing.value) return
  commitRename()
}

function iconFor(type: ComposerLayerSemanticType): AppIconName {
  switch (type) {
    case "section": return "section"
    case "container": return "element"
    case "component": return "component"
    case "heading": return "headingNode"
    case "text": return "textFontSize"
    case "richtext": return "textFontSize"
    case "button": return "buttonLayer"
    case "image": return "galleryLinear"
    case "video": return "element"
    case "icon": return "star"
    case "list": return "list"
    case "listitem": return "checkSmall"
    case "link": return "link"
    case "code": return "element"
    case "navigation": return "element"
    case "field": return "alignLeft"
    case "card": return "creditCard"
    case "alert": return "warning"
    case "badge": return "infoCircle"
    case "avatar": return "userCircle"
    case "document": return "page"
    case "html": return "globe"
    case "head": return "codeSquare"
    case "body": return "layoutGrid"
    case "meta": return "settings"
    case "slot": return "layers"
    case "map": return "refresh"
    case "conditional": return "branchingPaths"
    case "fragment": return "groupLayers"
    default: return "element"
  }
}

function childTag(row: ComposerLayerRow): string | null {
  return row.kind === "element" ? row.tag ?? null : null
}

function canAcceptDraggedChild(event: {
  draggedContext?: { element?: ComposerLayerRow }
}): boolean {
  const dragged = event.draggedContext?.element
  const model = doc?.model.value
  if (!dragged || !model || !props.row.canAcceptChildren) return false
  if (dragged.region !== props.row.region || !dragged.draggable) return false
  const parentPath = childParentPath.value
  if (parentPath && (parentPath === dragged.path || parentPath.startsWith(`${dragged.path}.`))) {
    return false
  }
  return parentAcceptsChildAtPath(model, parentPath, childTag(dragged))
}

function canMoveChild(event: {
  draggedContext?: { element?: ComposerLayerRow }
  to?: HTMLElement
}): boolean {
  return canAcceptDraggedChild(event) && props.canSort(event)
}

function canHostChildren(): boolean {
  const model = doc?.model.value
  if (!model || !props.row.canAcceptChildren) return false
  if (isVirtualRoot.value) return true
  return Boolean(locateAtPath(model.nodes, props.row.path))
}
</script>

<template>
  <div
    class="relative"
    :data-layer-node="row.treeKey"
    :data-layer-path="row.path"
    :data-layer-selected-path="isSelectedBranch ? 'true' : undefined"
  >
    <AppContextMenu
      :items="menuItemsFor(row)"
      @action="emit('menu-action', $event, row)"
      @close-auto-focus="emit('menu-close-auto-focus', $event, row)"
    >
      <div
        role="treeitem"
        :aria-level="depth + 1"
        :aria-selected="isActiveDocumentRoot || row.presentationOnly ? undefined : isSelected"
        :aria-expanded="row.children.length ? isExpanded : undefined"
        :aria-label="treeItemLabel"
        :tabindex="focusedPath === row.treeKey ? 0 : -1"
        :data-layer-key="row.treeKey"
        :data-layer-path="row.path"
        :data-layer-region="row.region"
        :data-layer-no-drag="!row.draggable ? 'true' : undefined"
        :class="
          cn(
            'group/layer relative mx-1 flex h-7.5 min-w-0 items-center border border-transparent text-foreground outline-none transition-colors rounded-sm',
            isActiveDocumentRoot && 'rounded-sm border-violet-500/25 bg-violet-500/10 text-violet-950 dark:text-violet-100',
            isSelected && 'rounded-sm border-primary/40 bg-primary/30 text-foreground shadow-none',
            !isSelected && !isActiveDocumentRoot && 'hover:bg-primary/20',
            isActiveDocumentRoot && 'hover:bg-violet-500/15',
            isCanvasHovered && !isSelected && 'bg-primary/20',
            dropPosition === 'inside' && 'rounded-sm bg-primary/12 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_42%,transparent)]',
            'focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
          )
        "
        @click.stop="!isRenaming && (isActiveDocumentRoot ? emit('toggle', row) : emit('select', row, $event))"
        @focus="emit('focus', row)"
        @dblclick.stop="!isRenaming && !isActiveDocumentRoot && row.kind === 'component' && emit('open', row)"
        @contextmenu="!isActiveDocumentRoot && !row.presentationOnly && !isSelected && emit('select', row, $event)"
        @mouseenter="!row.contextOnly && !row.presentationOnly && beacon.setStructureHover(row.path, row.instance?.occurrence ?? null)"
        @mouseleave="!row.contextOnly && !row.presentationOnly && beacon.setStructureHover(null)"
        @dragover.stop="emit('row-drag-over', $event, row)"
        @dragleave.stop="emit('row-drag-leave', $event, row)"
        @drop.stop="emit('row-drop', $event, row)"
      >
        <span
          v-if="dropPosition === 'before'"
          class="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_30%,transparent)]"
          aria-hidden="true"
        />
        <span
          v-if="dropPosition === 'after'"
          class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-primary shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_30%,transparent)]"
          aria-hidden="true"
        />

        <button
          v-if="row.children.length"
          type="button"
          data-layer-no-drag
          class="flex size-5 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-primary/8 focus-visible:outline-2 focus-visible:outline-primary"
          :aria-label="isExpanded ? `Collapse ${row.label}` : `Expand ${row.label}`"
          :aria-expanded="isExpanded"
          :aria-busy="isMountingChildren || undefined"
          @click.stop="emit('toggle', row)"
        >
          <AppIcon
            :name="isMountingChildren ? 'loading' : 'chevronRight'"
            :size="12"
            :class="cn(
              'text-muted-foreground transition-transform motion-reduce:transition-none',
              isMountingChildren && 'motion-safe:animate-spin',
              isExpanded && !isMountingChildren && 'rotate-90',
            )"
            aria-hidden="true"
          />
        </button>
        <span v-else class="size-5 shrink-0" aria-hidden="true" />

        <AppIcon
          :name="row.pageLayout ? 'pageLayout' : iconFor(row.semanticType)"
          :size="14"
          :class="cn(
            'mx-1.5 shrink-0 text-muted-foreground',
            isActiveDocumentRoot && 'text-violet-600 dark:text-violet-400',
            isSelected && (row.pageLayout || row.kind !== 'component') && 'text-primary',
            isCanvasHovered && !isSelected && 'text-primary',
          )"
          aria-hidden="true"
        />

        <div class="flex min-w-0 flex-1 items-center gap-1">
          <input
            v-if="isRenaming"
            ref="renameInput"
            v-model="renameDraft"
            data-layer-no-drag
            type="text"
            maxlength="100"
            spellcheck="false"
            :aria-label="`Rename ${row.label}`"
            class="h-6 min-w-0 flex-1 rounded-sm border border-border bg-background px-1.5 text-xs text-foreground outline-none focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            @click.stop
            @dblclick.stop
            @blur="finishRenameOnBlur"
            @keydown.enter.stop.prevent="commitRename"
            @keydown.escape.stop.prevent="cancelRename"
          />
          <Tooltip v-else>
            <TooltipTrigger as-child>
              <span
                :class="cn(
                  'min-w-0 flex-1 cursor-pointer truncate overflow-hidden text-ellipsis whitespace-nowrap text-xs transition-colors hover:text-foreground',
                  isActiveDocumentRoot && 'font-semibold text-violet-900 hover:text-violet-950 dark:text-violet-200 dark:hover:text-violet-100',
                  isSelected && 'font-medium',
                )"
                @dblclick.stop="startRename"
              >
                {{ row.label }}
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              :side-offset="8"
              :class="cn('max-w-72', row.commentPreview && 'max-w-80')"
            >
              <template v-if="row.commentPreview">
                <div class="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Comment
                </div>
                <div class="whitespace-pre-wrap wrap-break-word text-xs leading-relaxed">
                  {{ row.commentPreview }}
                </div>
              </template>
              <template v-else>
                <div class="font-medium">{{ row.label }}</div>
                <div class="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {{ row.sourceLabel }}
                </div>
              </template>
            </TooltipContent>
          </Tooltip>
        </div>

        <Tooltip v-if="row.conditionStatus !== undefined">
          <TooltipTrigger as-child>
            <span
              class="mr-0.5 inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 text-[9px] font-semibold"
              :class="
                row.conditionStatus === true
                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : row.conditionStatus === false
                    ? 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'border-border bg-muted/50 text-muted-foreground'
              "
              :aria-label="`${conditionStatusLabel}: ${row.conditionSummary ?? row.label}`"
            >
              {{ conditionStatusLabel }}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">
            <div class="font-medium">{{ conditionStatusLabel }}</div>
            <div class="mt-0.5 max-w-64 text-[10px] text-muted-foreground">{{ row.conditionSummary }}</div>
          </TooltipContent>
        </Tooltip>

        <Tooltip v-if="row.hasMotion">
          <TooltipTrigger as-child>
            <button
              type="button"
              data-layer-no-drag
              :disabled="row.contextOnly"
              class="mr-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-primary transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none"
              :aria-label="`Motion applied to ${row.label}`"
              @click.stop="emit('select', row); emit('menu-action', 'inspect-motion', row)"
            >
              <AppIcon name="lightning" :size="12" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Motion enabled</TooltipContent>
        </Tooltip>

        <Tooltip v-if="row.translationBinding">
          <TooltipTrigger as-child>
            <button
              type="button"
              data-layer-no-drag
              :disabled="row.contextOnly"
              class="mr-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-primary transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none"
              :aria-label="`Translation ${row.translationBinding.namespace}.${row.translationBinding.keyPath.join('.')} applied to ${row.label}`"
              @click.stop="emit('select', row); emit('menu-action', 'inspect-cms', row)"
            >
              <AppIcon name="globe" :size="12" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Project translation · {{ row.translationBinding.namespace }}.{{ row.translationBinding.keyPath.join('.') }}</TooltipContent>
        </Tooltip>

        <Tooltip v-if="row.hasCmsBinding">
          <TooltipTrigger as-child>
            <button
              type="button"
              data-layer-no-drag
              :disabled="row.contextOnly"
              class="mr-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-[#f97316] transition-colors hover:bg-[#f97316]/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-[#f97316] disabled:pointer-events-none"
              :aria-label="`${cmsLabel} applied to ${row.label}`"
              @click.stop="emit('select', row); emit('menu-action', 'inspect-cms', row)"
            >
              <AppIcon name="inspectorTabProps" :size="12" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{{ cmsLabel }}</TooltipContent>
        </Tooltip>

        <Tooltip v-else-if="row.hasDataBinding">
          <TooltipTrigger as-child>
            <button
              type="button"
              data-layer-no-drag
              :disabled="row.contextOnly"
              class="mr-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none"
              :aria-label="`Project data applied to ${row.label}`"
              @click.stop="emit('select', row); emit('menu-action', 'inspect-cms', row)"
            >
              <AppIcon name="databaseLine" :size="12" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Project data</TooltipContent>
        </Tooltip>

        <Tooltip v-if="row.isDocumentShell">
          <TooltipTrigger as-child>
            <span class="mr-1.5 flex size-5 items-center justify-center text-muted-foreground opacity-0 transition-opacity duration-100 group-hover/layer:opacity-100">
              <AppIcon name="lock" :size="11" aria-hidden="true" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">Document shell node</TooltipContent>
        </Tooltip>
      </div>
    </AppContextMenu>

    <draggable
      v-if="(!row.synthetic || isVirtualRoot) && isExpanded && (row.children.length || (isDragging && canMutate && canHostChildren()))"
      v-model="sortableChildren"
      item-key="treeKey"
      tag="div"
      role="group"
      :class="cn('layer-children', !sortableChildren.length && isDragging && 'min-h-7', isDragging && 'pb-3')"
      :data-layer-parent="childParentPath ?? ''"
      :data-layer-region="row.region"
      :group="{ name: 'aria-composer-layers', pull: true, put: true }"
      :disabled="!canMutate || sortingDisabled"
      :move="canMoveChild"
      filter="[data-layer-no-drag],button,input,textarea,a"
      :prevent-on-filter="false"
      ghost-class="composer-layer-ghost"
      chosen-class="composer-layer-chosen"
      drag-class="composer-layer-dragging"
      :animation="150"
      direction="vertical"
      :empty-insert-threshold="18"
      :fallback-on-body="true"
      :fallback-tolerance="4"
      :swap-threshold="0.65"
      :inverted-swap-threshold="0.35"
      :invert-swap="true"
      @start="emit('sort-start', $event)"
      @end="emit('sort-end')"
      @change="emit('sort-change', {
        change: $event,
        parentPath: childParentPath,
        rows: sortableChildren,
        slotGroup: isSlotGroup,
        slotName: row.slotName,
      })"
    >
      <template #item="{ element: child }">
        <StructureTreeNode
          :row="child"
          :depth="depth + 1"
          :expanded="expanded"
          :can-mutate="canMutate"
          :focused-path="focusedPath"
          :renaming-path="renamingPath"
          :menu-items-for="menuItemsFor"
          :drop-candidate="dropCandidate"
          :sorting-disabled="sortingDisabled"
          :is-dragging="isDragging"
          :can-sort="canSort"
          @toggle="emit('toggle', $event)"
          @select="(selectedRow, event) => emit('select', selectedRow, event)"
          @focus="emit('focus', $event)"
          @open="emit('open', $event)"
          @rename-start="emit('rename-start', $event)"
          @rename-commit="(selectedRow, label) => emit('rename-commit', selectedRow, label)"
          @rename-cancel="emit('rename-cancel', $event)"
          @menu-action="(id, selectedRow) => emit('menu-action', id, selectedRow)"
          @menu-close-auto-focus="(event, selectedRow) => emit('menu-close-auto-focus', event, selectedRow)"
          @row-drag-over="(event, selectedRow) => emit('row-drag-over', event, selectedRow)"
          @row-drag-leave="(event, selectedRow) => emit('row-drag-leave', event, selectedRow)"
          @row-drop="(event, selectedRow) => emit('row-drop', event, selectedRow)"
          @sort-change="emit('sort-change', $event)"
          @sort-start="emit('sort-start', $event)"
          @sort-end="emit('sort-end')"
        />
      </template>
    </draggable>
  </div>
</template>
