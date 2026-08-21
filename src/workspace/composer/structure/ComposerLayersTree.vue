<script setup lang="ts">
/** Astro-native Layers tree with aria-demo interaction and visual parity. */
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue"
import draggable from "vuedraggable"
import type {
  ComposerLayerDropCandidate,
  ComposerLayerRegion,
  ComposerLayerRow,
  ComposerLayerTreeProjection,
} from "../../../../shared/composer/layers"
import { resolveComposerLayerDropPosition } from "../../../../shared/composer/layers"
import {
  locateAtPath,
  parentAcceptsChildAtPath,
  parentPathOf,
  setComposerLayerLabelAtPath,
  type InsertTarget,
} from "../../../../shared/composer/mutate"
import { cn } from "@/lib/utils"
import { formatShortcut, isMacPlatform } from "@/lib/keyboardShortcuts"
import type { MenuItemDef } from "@/menu/types"
import { AppIcon } from "@/components/ui/app-icon"
import { TooltipProvider } from "@/components/ui/tooltip"
import { m } from "@/paraglide/messages.js"
import {
  ARIA_DND_NODE,
  COMPOSER_DRAG_CHANGE_EVENT,
  clearComposerDrag,
  dragChildTag,
  getComposerDrag,
  setComposerDrag,
} from "../dragState"
import { useComposerBeacon } from "../selection/useComposerBeacon"
import { tryUseComposerDocument } from "../useComposerDocumentSession"
import StructureTreeNode from "./StructureTreeNode.vue"
import { composerLayerPresentationRows } from "./layerPresentation"

const props = withDefaults(
  defineProps<{
    tree: ComposerLayerTreeProjection
    loading?: boolean
    error?: string | null
    bailReason?: string | null
    embedded?: boolean
    editable?: boolean
    canMoveUp?: boolean
    canMoveDown?: boolean
    persistKey?: string | null
    searchQuery?: string
  }>(),
  {
    embedded: false,
    editable: false,
    canMoveUp: false,
    canMoveDown: false,
    persistKey: null,
    searchQuery: "",
  },
)

const emit = defineEmits<{
  action: [id: string]
  open: [row: ComposerLayerRow]
  navigate: [row: ComposerLayerRow, open: boolean]
}>()

type SortChange = {
  added?: { element: ComposerLayerRow; newIndex: number }
  moved?: { element: ComposerLayerRow; oldIndex: number; newIndex: number }
  removed?: { element: ComposerLayerRow; oldIndex: number }
}

const beacon = useComposerBeacon()
const doc = tryUseComposerDocument()
const treeRef = ref<HTMLElement | null>(null)
const collapsed = ref<Set<string>>(new Set())
const documentOpen = ref(false)
const focusedPath = ref<string | null>(null)
const renamingPath = ref<string | null>(null)
const pendingMenuRename = ref<ComposerLayerRow | null>(null)
const selectionAnchorPath = ref<string | null>(null)
const dropCandidate = ref<ComposerLayerDropCandidate | null>(null)
const isDragging = ref(false)
const statusMessage = ref("")
const sortableContent = ref<ComposerLayerRow[]>([])
const sortableDocument = ref<ComposerLayerRow[]>([])
let expandTimer: ReturnType<typeof setTimeout> | null = null
let contextNavigateTimer: ReturnType<typeof setTimeout> | null = null
let revealFrame: number | null = null

const canMutate = computed(
  () => props.editable && doc?.designActive.value !== false,
)
const sortingDisabled = computed(() => Boolean(props.searchQuery.trim()))

function storageKey(file: string, suffix: string): string {
  return `aria.composer.layers.${suffix}:${file}`
}

function loadState(file: string | null | undefined) {
  collapsed.value = new Set()
  documentOpen.value = false
  if (!file) return
  try {
    const raw = localStorage.getItem(storageKey(file, "collapsed"))
    const parsed = raw ? JSON.parse(raw) as unknown : null
    if (Array.isArray(parsed)) {
      collapsed.value = new Set(
        parsed.filter((path): path is string => typeof path === "string"),
      )
    }
    documentOpen.value =
      localStorage.getItem(storageKey(file, "document-open")) === "true"
  } catch {
    collapsed.value = new Set()
    documentOpen.value = false
  }
}

function persistState() {
  if (!props.persistKey) return
  try {
    localStorage.setItem(
      storageKey(props.persistKey, "collapsed"),
      JSON.stringify([...collapsed.value]),
    )
    localStorage.setItem(
      storageKey(props.persistKey, "document-open"),
      String(documentOpen.value),
    )
  } catch {
    // Expansion persistence is best-effort only.
  }
}

watch(() => props.persistKey, loadState, { immediate: true })

watch(
  () => props.tree,
  (tree) => {
    const next = new Set(collapsed.value)
    if (documentOpen.value) {
      for (const path of collectPaths(tree.document)) next.delete(path)
    }
    collapsed.value = next
  },
  { immediate: true, deep: true },
)

function collectRows(rows: ComposerLayerRow[], out: ComposerLayerRow[] = []) {
  for (const row of rows) {
    out.push(row)
    collectRows(row.children, out)
  }
  return out
}

const allSourceRows = computed(() => [
  ...collectRows(props.tree.document),
  ...collectRows(props.tree.content),
])

function findRow(path: string | null, occurrence?: number): ComposerLayerRow | null {
  if (!path) return null
  return allSourceRows.value.find(
    (row) => row.path === path &&
      (occurrence === undefined ||
        !row.instance ||
        row.instance.occurrence === occurrence),
  ) ?? allSourceRows.value.find((row) => row.path === path) ?? null
}

function findRowTrail(
  path: string,
  occurrence: number,
): ComposerLayerRow[] | null {
  const visit = (
    rows: ComposerLayerRow[],
    parents: ComposerLayerRow[],
  ): ComposerLayerRow[] | null => {
    for (const row of rows) {
      const trail = [...parents, row]
      if (
        row.path === path &&
        (!row.instance || row.instance.occurrence === occurrence)
      ) {
        return trail
      }
      const childTrail = visit(row.children, trail)
      if (childTrail) return childTrail
    }
    return null
  }

  return visit(props.tree.document, []) ?? visit(props.tree.content, [])
}

function filterRows(rows: ComposerLayerRow[], query: string): ComposerLayerRow[] {
  if (!query) return rows
  const result: ComposerLayerRow[] = []
  for (const row of rows) {
    const children = filterRows(row.children, query)
    if (row.searchText.includes(query) || children.length) {
      result.push({ ...row, children })
    }
  }
  return result
}

const normalizedQuery = computed(() => props.searchQuery.trim().toLowerCase())
const contentRows = computed(() => filterRows(props.tree.content, normalizedQuery.value))
const projectedDocumentRows = computed(() => filterRows(props.tree.document, normalizedQuery.value))
const layoutRows = computed(() =>
  projectedDocumentRows.value.filter((row) => row.pageLayout),
)
const documentRows = computed(() =>
  projectedDocumentRows.value.filter((row) => !row.pageLayout),
)
const hasActiveDocumentRoot = computed(
  () => props.tree.content.length === 1 && props.tree.content[0]?.activeDocumentRoot === true,
)
const showDocument = computed(
  () =>
    documentRows.value.length > 0 &&
    (documentOpen.value || Boolean(normalizedQuery.value)),
)

watch(
  contentRows,
  (rows) => { sortableContent.value = [...rows] },
  { immediate: true, deep: true },
)
watch(
  documentRows,
  (rows) => { sortableDocument.value = [...rows] },
  { immediate: true, deep: true },
)

function collectPaths(rows: ComposerLayerRow[], out = new Set<string>()) {
  for (const row of rows) {
    out.add(row.treeKey)
    collectPaths(row.children, out)
  }
  return out
}

const expanded = computed(() => {
  const all = collectPaths([...props.tree.content, ...props.tree.document])
  if (normalizedQuery.value) return all
  return new Set([...all].filter((path) => !collapsed.value.has(path)))
})

const allExpanded = computed(() => {
  const contentPaths = collectPaths(props.tree.content)
  return [...contentPaths].every((path) => !collapsed.value.has(path))
})

function toggleAll() {
  const contentPaths = collectPaths(props.tree.content)
  const next = new Set(collapsed.value)
  if (allExpanded.value) {
    for (const path of contentPaths) next.add(path)
  } else {
    for (const path of contentPaths) next.delete(path)
  }
  collapsed.value = next
  persistState()
}

defineExpose({ allExpanded, toggleAll })

function toggleRow(row: ComposerLayerRow) {
  const next = new Set(collapsed.value)
  if (next.has(row.treeKey)) {
    next.delete(row.treeKey)
    announce(`Expanded ${row.label}`)
  } else {
    next.add(row.treeKey)
    announce(`Collapsed ${row.label}`)
  }
  collapsed.value = next
  persistState()
}

function toggleDocument() {
  const opening = !documentOpen.value
  documentOpen.value = opening
  if (opening) {
    const next = new Set(collapsed.value)
    for (const path of collectPaths(props.tree.document)) next.delete(path)
    collapsed.value = next
  }
  persistState()
  announce(`${documentOpen.value ? "Expanded" : "Collapsed"} Document`)
}

function visibleRows(): ComposerLayerRow[] {
  return composerLayerPresentationRows({
    layout: layoutRows.value,
    content: contentRows.value,
    document: documentRows.value,
    showDocument: showDocument.value,
    expanded: expanded.value,
  })
}

function revealRow(key: string | null, moveFocus = false) {
  if (!key) return
  if (revealFrame !== null) cancelAnimationFrame(revealFrame)
  revealFrame = null
  focusedPath.value = key
  const reveal = (remainingAttempts: number) => {
    const item = [...(treeRef.value?.querySelectorAll<HTMLElement>("[role='treeitem']") ?? [])]
      .find((element) => element.dataset.layerKey === key)
    if (item) {
      if (moveFocus) item.focus({ preventScroll: true })
      item.scrollIntoView({ block: "nearest", inline: "nearest" })
      revealFrame = null
      return
    }
    if (remainingAttempts <= 0) return
    revealFrame = requestAnimationFrame(() => reveal(remainingAttempts - 1))
  }
  void nextTick(() => reveal(12))
}

function focusRow(key: string | null) {
  revealRow(key, true)
}

function selectRow(row: ComposerLayerRow, event?: MouseEvent | KeyboardEvent) {
  if (row.presentationOnly) {
    if (row.children.length) toggleRow(row)
    focusedPath.value = row.treeKey
    return
  }
  if (row.activeDocumentRoot) {
    if (event instanceof KeyboardEvent && event.key === " " && row.children.length) {
      toggleRow(row)
    }
    focusedPath.value = row.treeKey
    return
  }
  if (row.contextOnly) {
    focusedPath.value = row.treeKey
    if (event instanceof MouseEvent && row.kind === "component") {
      if (contextNavigateTimer) clearTimeout(contextNavigateTimer)
      contextNavigateTimer = setTimeout(() => {
        contextNavigateTimer = null
        emit("navigate", row, false)
      }, 180)
    } else {
      emit("navigate", row, false)
    }
    return
  }
  const additive = Boolean(event?.metaKey || event?.ctrlKey)
  if (event?.shiftKey && selectionAnchorPath.value) {
    const visible = visibleRows()
    const anchorIndex = visible.findIndex((item) => item.treeKey === selectionAnchorPath.value)
    const rowIndex = visible.findIndex((item) => item.treeKey === row.treeKey)
    if (anchorIndex >= 0 && rowIndex >= 0) {
      const [start, end] = anchorIndex <= rowIndex
        ? [anchorIndex, rowIndex]
        : [rowIndex, anchorIndex]
      const range = visible.slice(start, end + 1)
      beacon.setSelections(
        range.filter((item) => !item.contextOnly).map((item) => ({ path: item.path, occurrence: item.instance?.occurrence ?? 0 })),
        { source: "structure" },
      )
      announce(`${range.length} layers selected`)
      focusRow(row.treeKey)
      return
    }
  }

  beacon.select(
    { path: row.path, occurrence: row.instance?.occurrence ?? 0 },
    { source: "structure", toggle: additive },
  )
  if (!additive) selectionAnchorPath.value = row.treeKey
  focusedPath.value = row.treeKey
}

function announce(message: string) {
  statusMessage.value = ""
  queueMicrotask(() => { statusMessage.value = message })
}

function canRenameRow(row: ComposerLayerRow): boolean {
  return Boolean(
    canMutate.value &&
    !row.activeDocumentRoot &&
    !row.contextOnly &&
    !row.presentationOnly &&
    !row.sourceLocked &&
    row.deletable &&
    row.kind === "element",
  )
}

function beginRename(row: ComposerLayerRow) {
  if (!canRenameRow(row)) return
  if (!beacon.selections.value.some((selection) => selection.path === row.path)) {
    selectRow(row)
  }
  focusedPath.value = row.treeKey
  renamingPath.value = row.treeKey
}

function cancelRename(row: ComposerLayerRow) {
  if (renamingPath.value !== row.treeKey) return
  renamingPath.value = null
  void nextTick(() => focusRow(row.treeKey))
}

function commitRename(row: ComposerLayerRow, label: string) {
  if (!doc || !canRenameRow(row)) return
  const renamed = doc.mutateModel(
    (model) => setComposerLayerLabelAtPath(model, row.path, label),
    { immediate: true, coalesceKey: null },
  )
  if (!renamed) {
    announce("Layer could not be renamed")
    return
  }
  renamingPath.value = null
  announce(label.trim() ? `Renamed layer to ${label.trim()}` : "Reset layer name")
  void nextTick(() => focusRow(row.treeKey))
}

watch(
  () => beacon.selections.value,
  (selections) => {
    const primary = selections[0]
    if (!primary) return
    const { path, occurrence } = primary
    const trail = findRowTrail(path, occurrence)
    const selected = trail?.at(-1) ?? findRow(path, occurrence)
    if (selected?.region === "document" && !selected.pageLayout && !documentOpen.value) {
      documentOpen.value = true
      const expandedDocument = new Set(collapsed.value)
      for (const documentPath of collectPaths(props.tree.document)) {
        expandedDocument.delete(documentPath)
      }
      collapsed.value = expandedDocument
      persistState()
    }
    const next = new Set(collapsed.value)
    let changed = false
    for (const ancestor of trail?.slice(0, -1) ?? []) {
      if (next.delete(ancestor.treeKey)) changed = true
    }
    if (changed) {
      collapsed.value = next
      persistState()
    }
    revealRow(selected?.treeKey ?? null)
  },
  { immediate: true },
)

const duplicateShortcut = formatShortcut({ id: "composerDuplicate", key: "d", mod: true })
const copyShortcut = formatShortcut({ id: "composerCopy", key: "c", mod: true })
const pasteShortcut = formatShortcut({ id: "composerPaste", key: "v", mod: true })
const deleteShortcut = isMacPlatform() ? "⌫" : "Del"

function menuItemsFor(row: ComposerLayerRow): MenuItemDef[] {
  const structuralLock = Boolean(row.sourceLocked || !row.deletable)
  const muted = !canMutate.value || Boolean(row.contextOnly || row.presentationOnly)
  const canEditComponent =
    row.kind === "component" &&
    !row.activeDocumentRoot &&
    !row.presentationOnly
  return [
    {
      type: "item",
      id: "edit",
      label: m.composer_structure_edit_component(),
      icon: "editComponent",
      hidden: !canEditComponent,
    },
    { type: "separator", hidden: !canEditComponent },
    {
      type: "item",
      id: "copy",
      label: m.composer_structure_copy(),
      icon: "copy",
      shortcut: copyShortcut,
      disabled: muted || structuralLock,
    },
    {
      type: "item",
      id: "paste",
      label: m.composer_structure_paste(),
      icon: "clipboard",
      shortcut: pasteShortcut,
      disabled: muted || structuralLock,
    },
    { type: "separator" },
    {
      type: "item",
      id: "rename",
      label: m.composer_structure_rename(),
      icon: "rename",
      disabled: !canRenameRow(row),
    },
    {
      type: "item",
      id: "duplicate",
      label: m.composer_structure_duplicate(),
      icon: "copy",
      shortcut: duplicateShortcut,
      disabled: muted || structuralLock,
    },
    {
      type: "item",
      id: "move-up",
      label: m.composer_structure_move_up(),
      icon: "chevronUp",
      disabled: muted || structuralLock || !props.canMoveUp,
    },
    {
      type: "item",
      id: "move-down",
      label: m.composer_structure_move_down(),
      icon: "chevronDown",
      disabled: muted || structuralLock || !props.canMoveDown,
    },
    { type: "separator" },
    {
      type: "icon-group",
      label: m.composer_structure_wrap_in(),
      actions: [
        {
          id: "wrap-section",
          label: m.composer_structure_wrap_section(),
          icon: "section",
          disabled: muted || structuralLock || row.region === "document",
        },
        {
          id: "wrap-container",
          label: m.composer_structure_wrap_container(),
          icon: "element",
          disabled: muted || structuralLock || row.region === "document",
        },
        {
          id: "wrap-div",
          label: m.composer_structure_wrap_div(),
          icon: "boxLine",
          disabled: muted || structuralLock || row.region === "document",
        },
      ],
    },
    { type: "separator" },
    {
      type: "item",
      id: "delete",
      label: m.composer_structure_delete(),
      icon: "trash",
      shortcut: deleteShortcut,
      destructive: true,
      disabled: muted || structuralLock,
    },
  ]
}

function onMenuAction(id: string, row: ComposerLayerRow) {
  pendingMenuRename.value = null
  if (!beacon.selections.value.some((selection) => selection.path === row.path)) {
    selectRow(row)
  }
  if (id === "edit") {
    onOpen(row)
    return
  }
  if (id === "rename") {
    pendingMenuRename.value = row
    return
  }
  if ((row.sourceLocked || !row.deletable) && ["copy", "paste", "delete", "duplicate", "move-up", "move-down"].includes(id)) {
    announce(m.composer_layers_shell_locked())
    return
  }
  emit("action", id)
}

function onMenuCloseAutoFocus(event: Event, row: ComposerLayerRow) {
  const pending = pendingMenuRename.value
  if (!pending || pending.treeKey !== row.treeKey) return
  event.preventDefault()
  pendingMenuRename.value = null
  beginRename(pending)
}

function onOpen(row: ComposerLayerRow) {
  if (row.contextOnly) {
    if (contextNavigateTimer) clearTimeout(contextNavigateTimer)
    contextNavigateTimer = null
    emit("navigate", row, true)
  }
  else if (row.kind === "component") emit("open", row)
}

function onTreeKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target?.matches("input, textarea, [contenteditable='true']")) return
  const visible = visibleRows()
  if (!visible.length) return
  const currentPath = focusedPath.value ?? visible[0]!.treeKey
  const index = Math.max(0, visible.findIndex((row) => row.treeKey === currentPath))
  const current = visible[index]!
  const selectAndFocus = (row: ComposerLayerRow | undefined) => {
    if (!row) return
    selectRow(row)
    focusRow(row.treeKey)
  }

  if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
    if (current.presentationOnly || current.sourceLocked) return
    const key = event.key.toLowerCase()
    if (key === "d" && current.deletable) {
      event.preventDefault()
      emit("action", "duplicate")
      return
    }
    if (key === "c") {
      event.preventDefault()
      void doc?.copySelected()
      return
    }
    if (key === "x" && current.deletable) {
      event.preventDefault()
      void doc?.cutSelected()
      return
    }
    if (key === "v") {
      event.preventDefault()
      void doc?.pasteClipboard()
      return
    }
  }

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault()
      selectAndFocus(visible[Math.min(visible.length - 1, index + 1)])
      break
    case "ArrowUp":
      event.preventDefault()
      selectAndFocus(visible[Math.max(0, index - 1)])
      break
    case "Home":
      event.preventDefault()
      selectAndFocus(visible[0])
      break
    case "End":
      event.preventDefault()
      selectAndFocus(visible[visible.length - 1])
      break
    case "ArrowRight":
      event.preventDefault()
      if (current.children.length && !expanded.value.has(current.treeKey)) {
        toggleRow(current)
      } else if (current.children[0]) {
        selectAndFocus(current.children[0])
      }
      break
    case "ArrowLeft": {
      event.preventDefault()
      if (current.children.length && expanded.value.has(current.treeKey)) {
        toggleRow(current)
      } else {
        const trail = findRowTrail(
          current.path,
          current.instance?.occurrence ?? 0,
        )
        const parent = parentPathOf(current.path)
        selectAndFocus(trail?.at(-2) ?? findRow(parent) ?? undefined)
      }
      break
    }
    case " ":
      event.preventDefault()
      selectRow(current, event)
      break
    case "Enter":
      if (current.kind === "component") {
        event.preventDefault()
        onOpen(current)
      }
      break
    case "Delete":
    case "Backspace":
      if (current.deletable && canMutate.value) {
        event.preventDefault()
        emit("action", "delete")
      }
      break
    case "Escape":
      clearDrop()
      break
  }
}

function childCount(parentPath: string | null): number {
  const model = doc?.model.value
  if (!model) return 0
  if (!parentPath) return model.nodes.length
  const loc = locateAtPath(model.nodes, parentPath)
  if (!loc) return 0
  const node = loc.node
  if (node.kind === "conditional") return node.consequent.length
  if (
    node.kind === "element" ||
    node.kind === "component" ||
    node.kind === "fragment" ||
    node.kind === "slot" ||
    node.kind === "map"
  ) return node.children?.length ?? 0
  return 0
}

function rawIndex(path: string): number {
  const loc = doc?.model.value ? locateAtPath(doc.model.value.nodes, path) : null
  return loc?.index ?? 0
}

function selectedDragRows(dragged: ComposerLayerRow): ComposerLayerRow[] {
  const selectedPaths = beacon.selections.value.map((selection) => selection.path)
  if (!selectedPaths.includes(dragged.path)) return [dragged]
  return selectedPaths
    .map((path) => findRow(path))
    .filter((row): row is ComposerLayerRow => Boolean(row))
}

function canSort(event: {
  draggedContext?: { element?: ComposerLayerRow }
  to?: HTMLElement
}): boolean {
  const dragged = event.draggedContext?.element
  const model = doc?.model.value
  const destination = event.to
  if (!dragged || !model || !destination || !dragged.draggable) return false
  const region = destination.dataset.layerRegion as ComposerLayerRegion | undefined
  const parentPath = destination.dataset.layerParent || null
  if (!region || region !== dragged.region) return false
  if (region === "document" && findRow(parentPath)?.semanticType !== "head") return false

  for (const row of selectedDragRows(dragged)) {
    if (!row.draggable || row.region !== region) return false
    if (parentPath && (parentPath === row.path || parentPath.startsWith(`${row.path}.`))) {
      return false
    }
    if (!parentAcceptsChildAtPath(model, parentPath, row.kind === "element" ? row.tag ?? null : null)) {
      return false
    }
  }
  return true
}

function onSortableStart(event: { item?: HTMLElement; originalEvent?: DragEvent }) {
  const path = event.item?.dataset.layerPath
  const row = findRow(path ?? null)
  if (!row || !row.draggable) return
  isDragging.value = true
  setComposerDrag({
    kind: "node",
    path: row.path,
    nodeKind: row.kind,
    tag: row.kind === "element" ? row.tag : undefined,
  })
  if (event.originalEvent?.dataTransfer) {
    event.originalEvent.dataTransfer.effectAllowed = "move"
    event.originalEvent.dataTransfer.setData(ARIA_DND_NODE, row.path)
  }
  announce(`Moving ${selectedDragRows(row).length > 1 ? `${selectedDragRows(row).length} layers` : row.label}`)
}

function clearDrop() {
  if (expandTimer) clearTimeout(expandTimer)
  expandTimer = null
  dropCandidate.value = null
}

function onSortableEnd() {
  isDragging.value = false
  clearComposerDrag()
  clearDrop()
}

function handleSortableChange(
  change: SortChange,
  parentPath: string | null,
  orderedRows: ComposerLayerRow[],
  slotGroup?: { slotGroup?: boolean; slotName?: string | null },
) {
  const operation = change.added ?? change.moved
  if (!operation || !doc) return
  const rows = selectedDragRows(operation.element)
  const moved = change.added && slotGroup?.slotGroup
    ? doc.assignNodesToPageSlot(
        rows.map((row) => row.path),
        slotGroup.slotName ?? null,
        operation.newIndex,
      )
    : (() => {
        const nextRow = orderedRows[operation.newIndex + 1]
        const targetIndex = nextRow ? rawIndex(nextRow.path) : childCount(parentPath)
        return doc.moveNodesTo(rows.map((row) => row.path), {
          parentPath,
          index: targetIndex,
        })
      })()
  if (moved) {
    announce(`${rows.length > 1 ? `${rows.length} layers` : operation.element.label} moved`)
    void nextTick(() => focusRow(beacon.selectedPath.value))
  } else {
    announce("That layer cannot be moved there")
  }
}

function validateTarget(
  region: ComposerLayerRegion,
  target: InsertTarget,
  targetPath: string | null,
  position: ComposerLayerDropCandidate["position"],
): ComposerLayerDropCandidate {
  const drag = getComposerDrag()
  const model = doc?.model.value
  const invalid = (reason: string): ComposerLayerDropCandidate => ({
    position,
    targetPath,
    ...target,
    valid: false,
    reason,
  })
  if (!drag || !model) return invalid("Nothing is being dragged")
  if (drag.kind !== "node" && region === "document") {
    return invalid("Elements and components belong in Content")
  }

  const sourceRow = drag.kind === "node" ? findRow(drag.path) : null
  const dragRows = sourceRow ? selectedDragRows(sourceRow) : []
  if (drag.kind === "node") {
    if (!sourceRow?.draggable) return invalid(m.composer_layers_shell_locked())
    if (sourceRow.region !== region) return invalid("Content and Document layers cannot be mixed")
    for (const row of dragRows) {
      if (target.parentPath && (target.parentPath === row.path || target.parentPath.startsWith(`${row.path}.`))) {
        return invalid("A layer cannot be moved into itself")
      }
      const tag = row.kind === "element" ? row.tag ?? null : null
      if (!parentAcceptsChildAtPath(model, target.parentPath, tag)) {
        return invalid(`Invalid containment for ${row.sourceLabel}`)
      }
    }
  } else if (!parentAcceptsChildAtPath(model, target.parentPath, dragChildTag(drag))) {
    return invalid("That element is not valid in this container")
  }
  if (region === "document" && findRow(target.parentPath)?.semanticType !== "head") {
    return invalid("Document metadata can only be reordered inside Head")
  }
  return { position, targetPath, ...target, valid: true }
}

function candidateForRow(event: DragEvent, row: ComposerLayerRow) {
  const current = event.currentTarget
  if (!(current instanceof HTMLElement)) return null
  const rect = current.getBoundingClientRect()
  const position = resolveComposerLayerDropPosition({
    clientY: event.clientY,
    top: rect.top,
    height: rect.height,
    allowInside: row.canAcceptChildren,
  })
  if (row.synthetic && row.insertTarget && row.activeDocumentRoot) {
    return validateTarget(
      row.region,
      row.insertTarget,
      row.path,
      "inside",
    )
  }
  if (row.synthetic && row.insertTarget && row.treeKey.startsWith("slot-group:")) {
    const candidate = validateTarget(
      row.region,
      row.insertTarget,
      row.path,
      "inside",
    )
    return { ...candidate, slotName: row.slotName ?? null }
  }
  const model = doc?.model.value
  const loc = model ? locateAtPath(model.nodes, row.path) : null
  if (!loc) return null
  const target: InsertTarget = position === "inside"
    ? { parentPath: row.path, index: childCount(row.path) }
    : {
        parentPath: parentPathOf(row.path),
        index: loc.index + (position === "after" ? 1 : 0),
      }
  return validateTarget(row.region, target, row.path, position)
}

function onRowDragOver(event: DragEvent, row: ComposerLayerRow) {
  const candidate = candidateForRow(event, row)
  if (!candidate) return
  dropCandidate.value = candidate
  if (!candidate.valid) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none"
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = getComposerDrag()?.kind === "node" ? "move" : "copy"
  }
  if (
    candidate.position === "inside" &&
    (row.children.length > 0 || row.canAcceptChildren) &&
    collapsed.value.has(row.treeKey) &&
    !expandTimer
  ) {
    expandTimer = setTimeout(() => {
      const next = new Set(collapsed.value)
      next.delete(row.treeKey)
      collapsed.value = next
      persistState()
      expandTimer = null
    }, 600)
  } else if (candidate.position !== "inside" && expandTimer) {
    clearTimeout(expandTimer)
    expandTimer = null
  }
}

function onRowDragLeave(event: DragEvent) {
  const current = event.currentTarget
  const related = event.relatedTarget
  if (current instanceof HTMLElement && related instanceof Node && current.contains(related)) {
    return
  }
  queueMicrotask(() => {
    if (!isDragging.value && !getComposerDrag()) clearDrop()
  })
}

function performExternalDrop(event: DragEvent) {
  const candidate = dropCandidate.value
  const drag = getComposerDrag()
  if (!candidate?.valid || !drag || !doc) {
    if (candidate?.reason) announce(candidate.reason)
    clearDrop()
    return
  }
  if (drag.kind === "node") {
    if (!("slotName" in candidate)) return
    event.preventDefault()
    event.stopPropagation()
    const source = findRow(drag.path)
    const paths = source ? selectedDragRows(source).map((row) => row.path) : [drag.path]
    const moved = doc.assignNodesToPageSlot(paths, candidate.slotName ?? null)
    announce(moved ? "Layers moved to slot" : candidate.reason ?? "That layer cannot be moved there")
    clearComposerDrag()
    clearDrop()
    return
  }
  event.preventDefault()
  event.stopPropagation()
  const target = { parentPath: candidate.parentPath, index: candidate.index }
  let inserted = false
  if ("slotName" in candidate) {
    doc.activatePageSlot(candidate.slotName ?? null, target)
  }
  const explicitTarget = "slotName" in candidate ? undefined : target
  if (drag.kind === "primitive") inserted = doc.insertAriaPrimitive(drag.id, explicitTarget)
  else if (drag.kind === "element") inserted = doc.insertElement(drag.tag, explicitTarget)
  else if (drag.kind === "component") {
    inserted = doc.insertComponent({ name: drag.name, file: drag.file }, explicitTarget)
  }
  announce(inserted ? "Layer inserted" : candidate.reason ?? "That layer cannot be inserted there")
  clearComposerDrag()
  clearDrop()
}

function rootCandidate(
  region: ComposerLayerRegion,
  parentPath: string | null,
  index: number,
): ComposerLayerDropCandidate {
  return validateTarget(region, { parentPath, index }, null, "after")
}

function onRootDragOver(
  event: DragEvent,
  region: ComposerLayerRegion,
  parentPath: string | null,
  index: number,
) {
  const candidate = rootCandidate(region, parentPath, index)
  dropCandidate.value = candidate
  if (!candidate.valid) return
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = getComposerDrag()?.kind === "node" ? "move" : "copy"
  }
}

function autoScroll(event: DragEvent) {
  const scroller = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : null
  if (!scroller) return
  const rect = scroller.getBoundingClientRect()
  const edge = 32
  let left = 0
  let top = 0
  if (event.clientX < rect.left + edge) left = -10
  else if (event.clientX > rect.right - edge) left = 10
  if (event.clientY < rect.top + edge) top = -10
  else if (event.clientY > rect.bottom - edge) top = 10
  if (left || top) scroller.scrollBy({ left, top })
}

onBeforeUnmount(() => {
  if (expandTimer) clearTimeout(expandTimer)
  if (contextNavigateTimer) clearTimeout(contextNavigateTimer)
  if (revealFrame !== null) cancelAnimationFrame(revealFrame)
  window.removeEventListener(COMPOSER_DRAG_CHANGE_EVENT, onComposerDragChange)
  window.removeEventListener("keydown", onWindowKeydown)
  clearComposerDrag()
})

function onComposerDragChange() {
  if (!getComposerDrag()) {
    isDragging.value = false
    clearDrop()
  }
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && (isDragging.value || getComposerDrag())) {
    clearComposerDrag()
    isDragging.value = false
    clearDrop()
    announce("Move cancelled")
  }
}

onMounted(() => {
  window.addEventListener(COMPOSER_DRAG_CHANGE_EVENT, onComposerDragChange)
  window.addEventListener("keydown", onWindowKeydown)
})
</script>

<template>
  <component
    :is="embedded ? 'div' : 'aside'"
    :class="embedded
      ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
      : 'flex h-full min-h-0 w-64 shrink-0 flex-col overflow-hidden border-r border-dashed border-border/70 bg-background'"
    data-aria-composer-layers
  >
    <div
      v-if="!embedded"
      class="flex h-11 shrink-0 items-center border-b border-dashed border-border px-3"
    >
      <h2 class="truncate text-sm font-medium tracking-tight text-foreground">Layers</h2>
    </div>

    <TooltipProvider :delay-duration="250" :skip-delay-duration="0">
      <div
        ref="treeRef"
        class="flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
        @keydown="onTreeKeydown"
      >
        <div
          data-layer-scroll-region="structure"
          class="flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-auto overscroll-contain px-1 pb-1 [container-type:inline-size]"
          @dragover="autoScroll"
          @dragleave.self="clearDrop"
        >
          <p v-if="loading" class="px-2 py-3 text-xs text-muted-foreground">Parsing page…</p>
          <p v-else-if="error" class="px-2 py-3 text-xs text-destructive">{{ error }}</p>
          <p v-else-if="bailReason" class="px-2 py-3 text-xs text-muted-foreground">{{ bailReason }}</p>

          <template v-else>
            <div
              v-if="!contentRows.length && !layoutRows.length && !documentRows.length && normalizedQuery"
              class="flex min-h-40 flex-col items-center justify-center px-5 text-center"
            >
              <AppIcon name="search" :size="16" class="mb-2 text-muted-foreground" aria-hidden="true" />
              <p class="text-xs font-medium text-foreground">{{ m.composer_layers_no_match() }}</p>
              <p class="mt-1 text-xs text-muted-foreground">{{ m.composer_layers_no_match_hint() }}</p>
            </div>

            <template v-else>
              <section v-if="layoutRows.length" class="py-1">
                <div
                  role="tree"
                  aria-label="Page layout"
                  class="w-max min-w-full outline-none"
                  data-layer-scroll-content
                >
                  <StructureTreeNode
                    v-for="row in layoutRows"
                    :key="row.treeKey"
                    :row="row"
                    :depth="0"
                    :expanded="expanded"
                    :can-mutate="!!canMutate"
                    :focused-path="focusedPath"
                    :renaming-path="renamingPath"
                    :menu-items-for="menuItemsFor"
                    :drop-candidate="dropCandidate"
                    :sorting-disabled="true"
                    :is-dragging="isDragging"
                    :can-sort="canSort"
                    @toggle="toggleRow"
                    @select="selectRow"
                    @focus="focusedPath = $event.treeKey"
                    @open="onOpen"
                    @rename-start="beginRename"
                    @rename-commit="commitRename"
                    @rename-cancel="cancelRename"
                    @menu-action="onMenuAction"
                    @menu-close-auto-focus="onMenuCloseAutoFocus"
                    @row-drag-over="onRowDragOver"
                    @row-drag-leave="onRowDragLeave"
                    @row-drop="performExternalDrop"
                    @sort-change="handleSortableChange($event.change, $event.parentPath, $event.rows, $event)"
                    @sort-start="onSortableStart"
                    @sort-end="onSortableEnd"
                  />
                </div>
              </section>

          <draggable
            v-model="sortableContent"
            item-key="treeKey"
            tag="div"
            role="tree"
            aria-label="Content layers"
            class="flex min-h-7 w-max min-w-full flex-col text-foreground outline-none"
            data-layer-scroll-content
            :data-layer-parent="tree.contentParentPath ?? ''"
            data-layer-region="content"
            :group="{ name: 'aria-composer-layers', pull: true, put: true }"
            :disabled="!canMutate || sortingDisabled || hasActiveDocumentRoot"
            :move="canSort"
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
            @start="onSortableStart"
            @end="onSortableEnd"
            @change="handleSortableChange($event, tree.contentParentPath, sortableContent)"
            @dragover="onRootDragOver($event, 'content', tree.contentParentPath, childCount(tree.contentParentPath))"
            @drop="performExternalDrop"
          >
            <template #item="{ element: row }">
              <StructureTreeNode
                :row="row"
                :depth="0"
                :expanded="expanded"
                :can-mutate="!!canMutate"
                :focused-path="focusedPath"
                :renaming-path="renamingPath"
                :menu-items-for="menuItemsFor"
                :drop-candidate="dropCandidate"
                :sorting-disabled="sortingDisabled"
                :is-dragging="isDragging"
                :can-sort="canSort"
                @toggle="toggleRow"
                @select="selectRow"
                @focus="focusedPath = $event.treeKey"
                @open="onOpen"
                @rename-start="beginRename"
                @rename-commit="commitRename"
                @rename-cancel="cancelRename"
                @menu-action="onMenuAction"
                @menu-close-auto-focus="onMenuCloseAutoFocus"
                @row-drag-over="onRowDragOver"
                @row-drag-leave="onRowDragLeave"
                @row-drop="performExternalDrop"
                @sort-change="handleSortableChange($event.change, $event.parentPath, $event.rows, $event)"
                @sort-start="onSortableStart"
                @sort-end="onSortableEnd"
              />
            </template>
            <template #footer>
              <div
                v-if="canMutate"
                :class="cn(
                  'relative mx-1 shrink-0 transition-colors duration-100',
                  !sortableContent.length
                    ? 'my-2 rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground'
                    : 'h-3',
                  !sortableContent.length && dropCandidate?.valid && dropCandidate.targetPath === null && 'border-primary bg-primary/10 text-foreground',
                )"
                @dragover.stop="onRootDragOver($event, 'content', tree.contentParentPath, childCount(tree.contentParentPath))"
                @drop.stop="performExternalDrop"
              >
                <template v-if="!sortableContent.length">
                  {{ m.composer_structure_drop_empty() }}
                </template>
                <span
                  v-else-if="dropCandidate?.valid && dropCandidate.targetPath === null"
                  class="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-primary shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_30%,transparent)]"
                  aria-hidden="true"
                />
              </div>
            </template>
              </draggable>
            </template>
          </template>
        </div>

        <section
          v-if="!loading && !error && !bailReason && documentRows.length"
          class="flex max-h-[45%] min-h-0 shrink-0 flex-col overflow-hidden"
          data-layer-section="document"
        >
          <button
            type="button"
            :class="cn(
              'group flex h-10 w-[calc(100%+2px)] shrink-0 items-center gap-2 border-y! border-dashed! border-border! bg-background px-2 text-left text-xs! font-medium transition-colors duration-150 focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary dark:bg-sidebar',
              showDocument
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )"
            :aria-expanded="showDocument"
            @click="toggleDocument"
          >
            <AppIcon
              :name="showDocument ? 'chevronDown' : 'chevronRight'"
              :size="13"
              aria-hidden="true"
            />
            <AppIcon name="page" :size="13" aria-hidden="true" />
            <span>{{ m.composer_layers_document() }}</span>
          </button>

          <div
            v-if="showDocument"
            data-layer-scroll-region="document"
            class="min-h-0 flex-1 overflow-x-auto overflow-y-auto overscroll-contain pb-6 [container-type:inline-size]"
            @dragover="autoScroll"
            @dragleave.self="clearDrop"
          >
            <draggable
              v-model="sortableDocument"
              item-key="treeKey"
              tag="div"
              role="tree"
              :aria-label="m.composer_layers_document_hint()"
              class="layer-children w-max min-w-full outline-none"
              data-layer-scroll-content
              data-layer-parent=""
              data-layer-region="document"
              :group="{ name: 'aria-composer-layers', pull: true, put: true }"
              :disabled="!canMutate || sortingDisabled"
              :move="canSort"
              filter="[data-layer-no-drag],button,input,textarea,a"
              :prevent-on-filter="false"
              ghost-class="composer-layer-ghost"
              chosen-class="composer-layer-chosen"
              drag-class="composer-layer-dragging"
              :animation="150"
              :empty-insert-threshold="18"
              :fallback-on-body="true"
              :fallback-tolerance="4"
              :swap-threshold="0.65"
              :inverted-swap-threshold="0.35"
              :invert-swap="true"
              @start="onSortableStart"
              @end="onSortableEnd"
              @change="handleSortableChange($event, null, sortableDocument)"
            >
              <template #item="{ element: row }">
                <StructureTreeNode
                  :row="row"
                  :depth="0"
                  :expanded="expanded"
                  :can-mutate="!!canMutate"
                  :focused-path="focusedPath"
                  :renaming-path="renamingPath"
                  :menu-items-for="menuItemsFor"
                  :drop-candidate="dropCandidate"
                  :sorting-disabled="sortingDisabled"
                  :is-dragging="isDragging"
                  :can-sort="canSort"
                  @toggle="toggleRow"
                  @select="selectRow"
                  @focus="focusedPath = $event.treeKey"
                  @open="onOpen"
                  @rename-start="beginRename"
                  @rename-commit="commitRename"
                  @rename-cancel="cancelRename"
                  @menu-action="onMenuAction"
                  @menu-close-auto-focus="onMenuCloseAutoFocus"
                  @row-drag-over="onRowDragOver"
                  @row-drag-leave="onRowDragLeave"
                  @row-drop="performExternalDrop"
                  @sort-change="handleSortableChange($event.change, $event.parentPath, $event.rows, $event)"
                  @sort-start="onSortableStart"
                  @sort-end="onSortableEnd"
                />
              </template>
            </draggable>
          </div>
        </section>
      </div>
    </TooltipProvider>

    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {{ statusMessage }}
    </div>
  </component>
</template>

<style scoped>
:deep(.composer-layer-ghost) {
  position: relative;
  height: 0;
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow: visible;
  border: 0;
  background: transparent;
  opacity: 0;
  pointer-events: none;
}

:deep(.composer-layer-ghost)::after {
  position: absolute;
  inset-inline: 0;
  inset-block-start: 0;
  height: 2px;
  content: "";
  background: var(--primary);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary) 30%, transparent);
}

:deep(.composer-layer-chosen) {
  background: color-mix(in srgb, var(--primary) 5%, transparent);
}

:deep(.composer-layer-dragging) {
  opacity: 0.85;
}

@media (prefers-reduced-motion: no-preference) {
  :deep(.composer-layer-dragging) {
    transform: rotate(1deg);
  }
}

:deep(.layer-children) {
  display: block;
  margin-inline-start: 0.375rem;
  padding-inline-start: 0.5rem;
}

:deep([data-layer-scroll-content] [data-layer-node]) {
  min-inline-size: 100cqi;
}

:deep(.layer-children > [data-layer-node])::before,
:deep(.layer-children > [data-layer-node])::after {
  position: absolute;
  inset-inline-start: -0.5rem;
  border-color: color-mix(in srgb, var(--border) 52%, transparent);
  content: "";
  pointer-events: none;
}

:deep(.layer-children > [data-layer-node])::before {
  inset-block-start: 0.875rem;
  inline-size: 0.75rem;
  border-block-start-style: dashed;
  border-block-start-width: 1px;
}

:deep(.layer-children > [data-layer-node])::after {
  inset-block: 0;
  border-inline-start-style: dashed;
  border-inline-start-width: 1px;
}

:deep(.layer-children > [data-layer-node]:last-child)::after {
  inset-block-end: auto;
  block-size: 0.875rem;
}

:deep(.layer-children > [data-layer-selected-path="true"])::before,
:deep(.layer-children > [data-layer-selected-path="true"])::after {
  border-color: color-mix(in srgb, var(--primary) 38%, transparent);
}

@media (forced-colors: active) {
  :deep([role="treeitem"]:focus-visible) {
    outline: 2px solid CanvasText;
  }
}
</style>
