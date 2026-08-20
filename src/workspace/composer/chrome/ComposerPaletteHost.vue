<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue"
import type { ScanComponent } from "@/workspace/types"
import { AppIcon } from "@/components/ui/app-icon"
import type { AppIconName } from "@/icons/registry"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { m } from "@/paraglide/messages.js"
import {
  ARIA_PALETTE_PRIMITIVES,
  buildComposerLayoutContract,
  isValidComposerSlotName,
  type AriaPalettePrimitive,
} from "../../../../shared/composer"
import {
  ARIA_DND_COMPONENT,
  ARIA_DND_PRIMITIVE,
  clearComposerDrag,
  setComposerDrag,
} from "../dragState"
import { tryUseComposerDocument } from "../useComposerDocumentSession"
import ComposerPaletteItem from "./ComposerPaletteItem.vue"

const props = withDefaults(
  defineProps<{
    components?: ScanComponent[]
    mode?: "elements" | "components"
    /** When false, drag/insert is disabled (bail / interactive). */
    editable?: boolean
    designActive?: boolean
  }>(),
  {
    components: () => [],
    mode: "elements",
    editable: false,
    designActive: true,
  },
)

const emit = defineEmits<{
  /** Fired when a palette drag starts — parent switches to Structure tab. */
  "drag-begin": []
  /** Fired after the browser has finished or cancelled the native drag. */
  "drag-end": []
  /** Generic Component block opens the real scanned component inventory. */
  "open-components": []
}>()

const doc = tryUseComposerDocument()
const query = ref("")
const view = ref<"grid" | "list">("grid")
const palettePage = ref<"1" | "2">(props.mode === "components" ? "2" : "1")
const namedSlotOpen = ref(false)
const namedSlotName = ref("")
type PalettePinId = AriaPalettePrimitive["id"] | "component"
const PIN_STORAGE_KEY = "aria.composer.palette.pins.v1"

function isPalettePinId(value: unknown): value is PalettePinId {
  return (
    value === "component" ||
    (typeof value === "string" &&
      ARIA_PALETTE_PRIMITIVES.some((item) => item.id === value))
  )
}

function loadPinnedIds(): PalettePinId[] {
  try {
    if (typeof localStorage === "undefined") return []
    const parsed = JSON.parse(localStorage.getItem(PIN_STORAGE_KEY) ?? "[]") as unknown
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter(isPalettePinId))]
  } catch {
    return []
  }
}

const pinnedIds = ref<PalettePinId[]>(loadPinnedIds())
let insertTimer: ReturnType<typeof setTimeout> | null = null

function scheduleInsert(action: () => void) {
  if (insertTimer) clearTimeout(insertTimer)
  insertTimer = setTimeout(() => {
    insertTimer = null
    action()
  }, 180)
}

function insertImmediately(action: () => void) {
  if (insertTimer) clearTimeout(insertTimer)
  insertTimer = null
  action()
}

onUnmounted(() => {
  if (insertTimer) clearTimeout(insertTimer)
})

const canMutate = computed(
  () => props.editable && props.designActive !== false && Boolean(doc),
)
const isLayoutDocument = computed(() => doc?.documentKind.value === "layout")
const layoutContract = computed(() =>
  isLayoutDocument.value && doc?.model.value
    ? buildComposerLayoutContract(doc.model.value)
    : null,
)
const namedSlotError = computed(() => {
  const name = namedSlotName.value.trim()
  if (!name) return ""
  if (!isValidComposerSlotName(name)) return m.composer_layout_slot_name_error()
  if (layoutContract.value?.namedSlots.some((slot) => slot.name === name)) {
    return m.composer_layout_slot_name_duplicate({ name })
  }
  return ""
})

const q = computed(() => query.value.trim().toLowerCase())

const filteredAria = computed(() => {
  const needle = q.value
  if (!needle) return [...ARIA_PALETTE_PRIMITIVES]
  return ARIA_PALETTE_PRIMITIVES.filter(
    (p) =>
      p.id.includes(needle) ||
      p.label.toLowerCase().includes(needle) ||
      p.tag?.includes(needle),
  )
})

const containerAria = computed(() =>
  filteredAria.value.filter(
    (item) => item.category === "container" && !pinnedIds.value.includes(item.id),
  ),
)

const interactiveAria = computed(() =>
  filteredAria.value.filter(
    (item) => item.category === "interactive" && !pinnedIds.value.includes(item.id),
  ),
)

const formAria = computed(() =>
  filteredAria.value.filter(
    (item) => item.category === "form" && !pinnedIds.value.includes(item.id),
  ),
)

const displayAria = computed(() =>
  filteredAria.value.filter(
    (item) => item.category === "display" && !pinnedIds.value.includes(item.id),
  ),
)

const primitiveAria = computed(() =>
  filteredAria.value.filter(
    (item) =>
      item.category !== "container" &&
      item.category !== "interactive" &&
      item.category !== "form" &&
      item.category !== "display" &&
      !pinnedIds.value.includes(item.id),
  ),
)

const showComponentShortcut = computed(() => {
  const needle = q.value
  return (
    props.mode === "elements" &&
    !pinnedIds.value.includes("component") &&
    (!needle || "component".includes(needle))
  )
})

type PinnedEntry =
  | { id: AriaPalettePrimitive["id"]; kind: "primitive"; item: AriaPalettePrimitive }
  | { id: "component"; kind: "component"; item: null }

const pinnedEntries = computed((): PinnedEntry[] => {
  const needle = q.value
  const entries: PinnedEntry[] = []
  for (const id of pinnedIds.value) {
    if (id === "component") {
      if (!needle || "component".includes(needle)) {
        entries.push({ id, kind: "component", item: null })
      }
      continue
    }
    const item = ARIA_PALETTE_PRIMITIVES.find((candidate) => candidate.id === id)
    if (!item) continue
    if (
      needle &&
      !item.id.includes(needle) &&
      !item.label.toLowerCase().includes(needle) &&
      !item.tag?.includes(needle)
    ) {
      continue
    }
    entries.push({ id, kind: "primitive", item })
  }
  return entries
})

type CompGroup = { folder: string; items: ScanComponent[] }

const componentGroups = computed((): CompGroup[] => {
  const needle = q.value
  const list = props.components.filter((c) => {
    if (!needle) return true
    return (
      c.name.toLowerCase().includes(needle) ||
      (c.category || "").toLowerCase().includes(needle) ||
      c.file.toLowerCase().includes(needle)
    )
  })
  const byFolder = new Map<string, ScanComponent[]>()
  for (const c of list) {
    const key = c.category || ""
    let bucket = byFolder.get(key)
    if (!bucket) {
      bucket = []
      byFolder.set(key, bucket)
    }
    bucket.push(c)
  }
  return [...byFolder.entries()]
    .sort(([a], [b]) => {
      if (a === "") return -1
      if (b === "") return 1
      return a.localeCompare(b)
    })
    .map(([folder, items]) => ({ folder, items }))
})

const hasElementResults = computed(
  () =>
    filteredAria.value.length > 0 ||
    showComponentShortcut.value ||
    pinnedEntries.value.length > 0 ||
    isLayoutDocument.value,
)

const hasComponentResults = computed(() =>
  componentGroups.value.some((group) => group.items.length > 0),
)

function prettyName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
}

function iconForPrimitive(item: AriaPalettePrimitive): AppIconName {
  switch (item.id) {
    case "heading":
    case "text":
      return "text"
    case "rich-text":
      return "textFontSize"
    case "image":
      return "image"
    case "video":
      return "video"
    case "link":
      return "link"
    case "code":
      return "code"
    case "comment":
      return "code2Line"
    case "span":
      return "code2Line"
    case "quote":
      return "text"
    case "accordion":
      return "expandHuge"
    case "popover":
      return "moreHorizontal"
    case "dialog":
      return "windowFrame"
    case "datalist":
      return "databaseLine"
    case "progress":
      return "pending"
    case "meter":
      return "tuning"
    case "divider":
      return "zoomOut"
    case "embed":
      return "windowFrame"
    case "icon-list":
      return "checkCircleLinear"
    case "svg":
      return "design"
    case "navigation":
      return "menu01"
    case "list":
    case "pagination":
      return "list"
    case "icon":
      return "star"
    case "button":
      return "cursorLine"
    case "input":
    case "textarea":
    case "field":
      return "alignLeft"
    case "select":
      return "list"
    case "checkbox":
    case "radio":
      return "check"
    case "card":
      return "creditCard"
    case "alert":
      return "warning"
    case "badge":
      return "infoCircle"
    case "avatar":
      return "userCircle"
    case "container":
      return "boxLine"
    case "div":
      return "element"
    default:
      return "section"
  }
}

function isPinned(id: PalettePinId): boolean {
  return pinnedIds.value.includes(id)
}

function togglePin(id: PalettePinId) {
  pinnedIds.value = isPinned(id)
    ? pinnedIds.value.filter((candidate) => candidate !== id)
    : [id, ...pinnedIds.value]
  try {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pinnedIds.value))
  } catch {
    /* Pinning remains available for this session if storage is unavailable. */
  }
}

function onAriaDragStart(item: AriaPalettePrimitive, e: DragEvent) {
  if (!canMutate.value) {
    e.preventDefault()
    return
  }
  e.dataTransfer?.setData(ARIA_DND_PRIMITIVE, item.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy"
  setComposerDrag({ kind: "primitive", id: item.id, tag: item.tag })
  emit("drag-begin")
}

function onComponentDragStart(comp: ScanComponent, e: DragEvent) {
  if (!canMutate.value) {
    e.preventDefault()
    return
  }
  const payload = JSON.stringify({ name: comp.name, file: comp.file })
  e.dataTransfer?.setData(ARIA_DND_COMPONENT, payload)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy"
  setComposerDrag({ kind: "component", name: comp.name, file: comp.file })
  emit("drag-begin")
}

function onDragEnd() {
  clearComposerDrag()
  emit("drag-end")
}

function insertAria(item: AriaPalettePrimitive) {
  if (!canMutate.value || !doc) return
  doc.insertAriaPrimitive(item.id)
}

function insertComponent(comp: ScanComponent) {
  if (!canMutate.value || !doc) return
  doc.insertComponent({ name: comp.name, file: comp.file })
}

function insertPageContentSlot() {
  if (!doc || layoutContract.value?.defaultSlot) return
  doc.insertLayoutSlot(null)
}

function openNamedSlot() {
  namedSlotName.value = ""
  namedSlotOpen.value = true
}

function insertNamedSlot() {
  const name = namedSlotName.value.trim()
  if (!doc || !name || namedSlotError.value) return
  if (doc.insertLayoutSlot(name)) namedSlotOpen.value = false
}

function revealComponents() {
  query.value = ""
  palettePage.value = "2"
}

function closeComponents() {
  palettePage.value = "1"
}
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col overflow-hidden"
    :data-aria-composer-palette="mode"
  >
    <div class="flex h-12 shrink-0 items-center gap-1 border-b border-dashed border-border bg-background/50 px-2 py-2 dark:bg-sidebar/50">
      <Button
        v-if="palettePage === '2'"
        type="button"
        variant="ghost"
        size="icon-xs"
        class="size-8! rounded-md border-[0.5px] border-transparent ring-0 shadow-none focus-visible:border-border focus-visible:ring-[0.5px] focus-visible:ring-ring/70"
        :aria-label="m.composer_left_add_elements()"
        @click="closeComponents"
      >
        <AppIcon name="chevronLeft" :size="16" aria-hidden="true" />
      </Button>
      <div class="relative min-w-0 flex-1">
        <AppIcon
          name="search"
          :size="13"
          class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          v-model="query"
          type="search"
          :placeholder="palettePage === '2' ? m.composer_components_search() : m.composer_palette_search()"
          class="h-8! rounded-md border-[0.5px] border-border/60 bg-card/30 pl-7 pr-2 text-xs ring-0 focus:border-border focus:ring-0 focus-visible:border-border focus-visible:ring-[0.5px] focus-visible:ring-ring/70"
          :disabled="!canMutate"
          spellcheck="false"
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        class="size-8! rounded-md border-[0.5px] border-transparent ring-0 shadow-none focus-visible:border-border focus-visible:ring-[0.5px] focus-visible:ring-ring/70"
        :aria-label="view === 'grid' ? 'Use list view' : 'Use grid view'"
        @click="view = view === 'grid' ? 'list' : 'grid'"
      >
        <AppIcon :name="view" :size="16" aria-hidden="true" />
      </Button>
    </div>

    <div class="composer-palette-slide relative min-h-0 flex-1" :data-page="palettePage">
      <div class="composer-palette-page overflow-y-auto p-2" data-page-id="1">
        <p
          v-if="!canMutate"
          class="px-2 py-3 text-xs text-muted-foreground"
        >
          {{ m.composer_palette_readonly() }}
        </p>

        <p
          v-else-if="!hasElementResults"
          class="px-2 py-3 text-xs text-muted-foreground"
        >
          {{ m.composer_palette_no_match() }}
        </p>

        <div v-else class="space-y-6">
          <section v-if="isLayoutDocument">
            <h3 class="mb-2 px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {{ m.composer_palette_layout_slots() }}
            </h3>
            <ul :class="view === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2'">
              <li>
                <ComposerPaletteItem
                  :label="m.composer_palette_page_content_slot()"
                  icon="layoutGrid"
                  :view="view"
                  :pinned="false"
                  :pinnable="false"
                  :draggable="false"
                  :disabled="Boolean(layoutContract?.defaultSlot)"
                  @activate="insertPageContentSlot"
                  @activate-immediate="insertPageContentSlot"
                />
              </li>
              <li>
                <ComposerPaletteItem
                  :label="m.composer_palette_named_slot()"
                  icon="layers"
                  :view="view"
                  :pinned="false"
                  :pinnable="false"
                  :draggable="false"
                  @activate="openNamedSlot"
                  @activate-immediate="openNamedSlot"
                />
              </li>
            </ul>
          </section>
          <section v-if="pinnedEntries.length">
            <h3 class="mb-2 px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {{ m.composer_palette_pinned() }}
            </h3>
            <ul :class="view === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2'">
              <li v-for="entry in pinnedEntries" :key="`pinned:${entry.id}`">
                <ComposerPaletteItem
                  v-if="entry.kind === 'primitive'"
                  :label="entry.item.label"
                  :icon="iconForPrimitive(entry.item)"
                  :view="view"
                  pinned
                  @drag-start="onAriaDragStart(entry.item, $event)"
                  @drag-end="onDragEnd"
                  @toggle-pin="togglePin(entry.id)"
                  @activate="scheduleInsert(() => insertAria(entry.item))"
                  @activate-immediate="insertImmediately(() => insertAria(entry.item))"
                />
                <ComposerPaletteItem
                  v-else
                  :label="m.composer_palette_component()"
                  icon="component"
                  :view="view"
                  pinned
                  :draggable="false"
                  @toggle-pin="togglePin('component')"
                  @activate="revealComponents"
                  @activate-immediate="revealComponents"
                />
              </li>
            </ul>
          </section>

          <section v-if="containerAria.length || showComponentShortcut">
            <h3 class="mb-2 px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {{ m.composer_palette_containers() }}
            </h3>
            <ul :class="view === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2'">
              <li v-for="item in containerAria" :key="item.id">
                <ComposerPaletteItem
                  :label="item.label"
                  :icon="iconForPrimitive(item)"
                  :view="view"
                  :pinned="isPinned(item.id)"
                  @drag-start="onAriaDragStart(item, $event)"
                  @drag-end="onDragEnd"
                  @toggle-pin="togglePin(item.id)"
                  @activate="scheduleInsert(() => insertAria(item))"
                  @activate-immediate="insertImmediately(() => insertAria(item))"
                />
              </li>
              <li v-if="showComponentShortcut">
                <ComposerPaletteItem
                  :label="m.composer_palette_component()"
                  icon="component"
                  :view="view"
                  :pinned="isPinned('component')"
                  :draggable="false"
                  @toggle-pin="togglePin('component')"
                  @activate="revealComponents"
                  @activate-immediate="revealComponents"
                />
              </li>
            </ul>
          </section>

          <section v-if="interactiveAria.length">
            <h3 class="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {{ m.composer_palette_interactive() }}
            </h3>
            <ul :class="view === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2'">
              <li v-for="item in interactiveAria" :key="item.id">
                <ComposerPaletteItem
                  :label="item.label"
                  :icon="iconForPrimitive(item)"
                  :view="view"
                  :pinned="isPinned(item.id)"
                  @drag-start="onAriaDragStart(item, $event)"
                  @drag-end="onDragEnd"
                  @toggle-pin="togglePin(item.id)"
                  @activate="scheduleInsert(() => insertAria(item))"
                  @activate-immediate="insertImmediately(() => insertAria(item))"
                />
              </li>
            </ul>
          </section>

          <section v-if="formAria.length">
            <h3 class="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {{ m.composer_palette_forms() }}
            </h3>
            <ul :class="view === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2'">
              <li v-for="item in formAria" :key="item.id">
                <ComposerPaletteItem
                  :label="item.label"
                  :icon="iconForPrimitive(item)"
                  :view="view"
                  :pinned="isPinned(item.id)"
                  @drag-start="onAriaDragStart(item, $event)"
                  @drag-end="onDragEnd"
                  @toggle-pin="togglePin(item.id)"
                  @activate="scheduleInsert(() => insertAria(item))"
                  @activate-immediate="insertImmediately(() => insertAria(item))"
                />
              </li>
            </ul>
          </section>

          <section v-if="displayAria.length">
            <h3 class="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {{ m.composer_palette_display() }}
            </h3>
            <ul :class="view === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2'">
              <li v-for="item in displayAria" :key="item.id">
                <ComposerPaletteItem
                  :label="item.label"
                  :icon="iconForPrimitive(item)"
                  :view="view"
                  :pinned="isPinned(item.id)"
                  @drag-start="onAriaDragStart(item, $event)"
                  @drag-end="onDragEnd"
                  @toggle-pin="togglePin(item.id)"
                  @activate="scheduleInsert(() => insertAria(item))"
                  @activate-immediate="insertImmediately(() => insertAria(item))"
                />
              </li>
            </ul>
          </section>

          <section v-if="primitiveAria.length">
            <h3 class="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {{ m.composer_palette_primitives() }}
            </h3>
            <ul :class="view === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2'">
              <li v-for="item in primitiveAria" :key="item.id">
                <ComposerPaletteItem
                  :label="item.label"
                  :icon="iconForPrimitive(item)"
                  :view="view"
                  :pinned="isPinned(item.id)"
                  @drag-start="onAriaDragStart(item, $event)"
                  @drag-end="onDragEnd"
                  @toggle-pin="togglePin(item.id)"
                  @activate="scheduleInsert(() => insertAria(item))"
                  @activate-immediate="insertImmediately(() => insertAria(item))"
                />
              </li>
            </ul>
          </section>
        </div>
      </div>

      <div
        id="composer-palette-project-components"
        class="composer-palette-page overflow-y-auto p-2"
        data-page-id="2"
      >
        <p
          v-if="!canMutate"
          class="px-2 py-3 text-xs text-muted-foreground"
        >
          {{ m.composer_palette_readonly() }}
        </p>
        <p
          v-else-if="!hasComponentResults"
          class="px-2 py-3 text-xs text-muted-foreground"
        >
          {{
            components.length === 0
              ? m.composer_palette_no_components()
              : m.composer_palette_no_match()
          }}
        </p>
        <div v-else class="space-y-6">
          <section v-for="group in componentGroups" :key="group.folder || '__root'">
            <h3 class="mb-2 px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {{ group.folder || m.composer_palette_components() }}
            </h3>
            <ul :class="view === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2'">
              <li v-for="comp in group.items" :key="comp.id">
                <ComposerPaletteItem
                  :label="prettyName(comp.name)"
                  icon="component"
                  :view="view"
                  :pinned="false"
                  :pinnable="false"
                  @drag-start="onComponentDragStart(comp, $event)"
                  @drag-end="onDragEnd"
                  @activate="scheduleInsert(() => insertComponent(comp))"
                  @activate-immediate="insertImmediately(() => insertComponent(comp))"
                />
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>

    <Dialog v-model:open="namedSlotOpen">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{{ m.composer_layout_slot_create_title() }}</DialogTitle>
          <DialogDescription>{{ m.composer_layout_slot_create_description() }}</DialogDescription>
        </DialogHeader>
        <form class="space-y-3" @submit.prevent="insertNamedSlot">
          <div class="space-y-1.5">
            <Label for="composer-layout-slot-name">{{ m.composer_layout_slot_name_label() }}</Label>
            <Input
              id="composer-layout-slot-name"
              v-model="namedSlotName"
              autofocus
              placeholder="sidebar"
              spellcheck="false"
              :aria-invalid="Boolean(namedSlotError)"
              :aria-describedby="namedSlotError ? 'composer-layout-slot-error' : undefined"
            />
            <p v-if="namedSlotError" id="composer-layout-slot-error" class="text-xs text-destructive">
              {{ namedSlotError }}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" @click="namedSlotOpen = false">
              {{ m.confirm_cancel() }}
            </Button>
            <Button type="submit" :disabled="!namedSlotName.trim() || Boolean(namedSlotError)">
              {{ m.composer_layout_slot_create_action() }}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.composer-palette-slide {
  --page-slide-dur: 250ms;
  --page-fade-dur: 250ms;
  --page-slide-distance: 8px;
  --page-blur: 3px;
  --page-stagger: 0ms;
  --page-exit-enabled: 1;
  --page-slide-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --page-fade-ease: cubic-bezier(0.22, 1, 0.36, 1);
}

.composer-palette-page[data-page-id="1"] {
  --t-page-from-x: calc(var(--page-slide-distance) * -1);
}

.composer-palette-page[data-page-id="2"] {
  --t-page-from-x: var(--page-slide-distance);
}

.composer-palette-page {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  transform: translateX(calc(var(--t-page-from-x, 0px) * var(--page-exit-enabled)));
  filter: blur(calc(var(--page-blur) * var(--page-exit-enabled)));
  transition:
    opacity var(--page-fade-dur) var(--page-fade-ease),
    transform var(--page-slide-dur) var(--page-slide-ease),
    filter var(--page-slide-dur) var(--page-slide-ease);
  will-change: opacity, transform, filter;
}

.composer-palette-slide[data-page="1"] .composer-palette-page[data-page-id="1"],
.composer-palette-slide[data-page="2"] .composer-palette-page[data-page-id="2"] {
  opacity: 1;
  pointer-events: auto;
  transform: none;
  filter: none;
  transition-delay: var(--page-stagger);
}

@media (prefers-reduced-motion: reduce) {
  .composer-palette-page {
    transition: none !important;
  }
}
</style>

