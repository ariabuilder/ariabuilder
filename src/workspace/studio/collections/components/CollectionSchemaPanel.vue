<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue"
import { toast } from "vue-sonner"
import type {
  AriaCollection,
  EntryFieldOrderItem,
  EntryFieldWidth,
  FieldSchema,
  SystemEntryFieldKey,
} from "../../../../../shared/cms"
import {
  entryFieldsForCollection,
  isCoverImageField,
  normalizeEntryFieldOrder,
} from "../../../../../shared/cms"
import type { AriaCollectionDef } from "@/types/aria"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/ui/app-icon"
import { confirm } from "@/composables/useConfirm"
import { getCollections, updateCollections } from "@/lib/workspace"
import { m } from "@/paraglide/messages.js"
import {
  getEntryFieldPlacement,
  type CmsEntryFieldPlacement,
} from "../lib/entryFieldPlacement"
import {
  getEntryFieldWidthFraction,
  normalizeEntryFieldWidth,
} from "../lib/entryFieldWidth"
import { replaceSchemaField } from "../lib/schemaFieldForm"
import { useCollectionsList } from "../composables/useCollectionsList"
import AddSchemaFieldDialog from "../dialogs/AddSchemaFieldDialog.vue"
import EditSchemaFieldDialog from "../dialogs/EditSchemaFieldDialog.vue"

const props = defineProps<{
  collection: AriaCollectionDef
  projectRoot: string
  embedded?: boolean
}>()

const emit = defineEmits<{
  updated: [collection: AriaCollectionDef]
}>()

type SchemaOrderRow =
  | {
      id: string
      kind: "system"
      key: SystemEntryFieldKey
      label: string
      typeLabel: string
    }
  | {
      id: string
      kind: "field"
      key: string
      field: FieldSchema
      placement: CmsEntryFieldPlacement
      managed: boolean
      width: EntryFieldWidth
    }

const projectRootRef = toRef(props, "projectRoot")
const {
  collections,
  isLoading: isLoadingCollections,
  loadError: collectionLoadError,
  loadCollections,
} = useCollectionsList(projectRootRef)

const isSaving = ref(false)
const isAddFieldDialogOpen = ref(false)
const editingField = ref<FieldSchema | null>(null)
const mainRows = ref<SchemaOrderRow[]>([])
const sidebarRows = ref<SchemaOrderRow[]>([])

type DragPayload = {
  area: "main" | "sidebar"
  index: number
}
const dragPayload = ref<DragPayload | null>(null)
const dropTarget = ref<DragPayload | null>(null)

const fields = computed(
  () => (props.collection.schema?.fields ?? []) as FieldSchema[],
)
const schemaVersion = computed(() => props.collection.schema?.version ?? 1)

const layoutAreas = computed(() => [
  {
    key: "main" as const,
    title: m.cms_collections_schema_main_area(),
    description: m.cms_collections_schema_main_area_description(),
    empty: m.cms_collections_schema_main_area_empty(),
    rows: mainRows.value,
  },
  {
    key: "sidebar" as const,
    title: m.cms_collections_schema_sidebar_area(),
    description: m.cms_collections_schema_sidebar_area_description(),
    empty: m.cms_collections_schema_sidebar_area_empty(),
    rows: sidebarRows.value,
  },
])

const isEditFieldDialogOpen = computed({
  get: () => editingField.value !== null,
  set: (value) => {
    if (!value) editingField.value = null
  },
})

const editingFieldWidth = computed<EntryFieldWidth>(() => {
  const fieldKey = editingField.value?.key
  if (!fieldKey) return "full"
  const row = [...mainRows.value, ...sidebarRows.value].find(
    (candidate) => candidate.kind === "field" && candidate.key === fieldKey,
  )
  return row?.kind === "field" ? row.width : "full"
})

const FIELD_TYPE_LABELS: Record<string, string> = {
  string: "Short text",
  text: "Long text",
  slug: "Slug",
  number: "Number",
  integer: "Integer",
  boolean: "Boolean",
  date: "Date",
  datetime: "Date and time",
  select: "Select",
  multiSelect: "Multi-select",
  color: "Color",
  icon: "Icon",
  image: "Image",
  file: "File",
  reference: "Reference",
  relation: "Relation",
  link: "Link",
  structuredText: "Structured text",
  richtext: "Rich text",
  json: "JSON object",
  object: "Object",
  repeater: "Repeater",
}

function getFieldTypeLabel(field: FieldSchema): string {
  return FIELD_TYPE_LABELS[field.type] ?? field.type
}

function systemFieldLabel(key: SystemEntryFieldKey): string {
  switch (key) {
    case "title":
      return m.cms_collections_schema_system_title()
    case "slug":
      return m.cms_collections_schema_system_slug()
    case "body":
      return m.cms_collections_schema_system_body()
  }
}

function systemFieldTypeLabel(key: SystemEntryFieldKey): string {
  switch (key) {
    case "title":
      return m.cms_collections_schema_system()
    case "slug":
      return m.cms_collections_schema_system_slug()
    case "body":
      return m.cms_collections_schema_system_body()
  }
}

function rowOrderKey(rowsToKey: readonly SchemaOrderRow[]): string {
  return rowsToKey.map((row) => row.id).join("\u001f")
}

function collectionForOrder(collection: AriaCollectionDef): AriaCollection {
  const supports = collection.supports ?? []
  return {
    id: collection.id,
    name: collection.name,
    label: collection.label,
    kind: collection.kind,
    scope: collection.scope ?? "global",
    icon: collection.icon ?? null,
    urlPattern: collection.urlPattern,
    listPageFile: collection.listPageFile,
    templatePageFile: collection.templatePageFile,
    supports,
    schema: {
      id: collection.id,
      label: collection.label,
      kind: collection.kind,
      fields: (collection.schema?.fields ?? []) as FieldSchema[],
      version: collection.schema?.version ?? 1,
      entryFieldOrder: collection.schema?.entryFieldOrder,
      icon: collection.schema?.icon,
    },
    createdAt: "",
    updatedAt: "",
  }
}

function schemaRowFromOrderItem(
  item: EntryFieldOrderItem,
  fieldsByKey: ReadonlyMap<string, FieldSchema>,
  managedFieldKeys: ReadonlySet<string>,
): SchemaOrderRow | null {
  if (item.kind === "system") {
    return {
      id: `system:${item.key}`,
      kind: "system",
      key: item.key,
      label: systemFieldLabel(item.key),
      typeLabel: systemFieldTypeLabel(item.key),
    }
  }

  const field = fieldsByKey.get(item.key)
  if (!field) return null

  return {
    id: `field:${field.key}`,
    kind: "field",
    key: field.key,
    field,
    placement: item.placement ?? getEntryFieldPlacement(field),
    managed: managedFieldKeys.has(field.key),
    width: normalizeEntryFieldWidth(item.width),
  }
}

function schemaRowsForCollection(collection: AriaCollectionDef): {
  main: SchemaOrderRow[]
  sidebar: SchemaOrderRow[]
} {
  const adapted = collectionForOrder(collection)
  const entryFields = entryFieldsForCollection(adapted)
  const fieldsByKey = new Map(entryFields.map((field) => [field.key, field]))
  const hasPersistedCover = (collection.schema?.fields ?? []).some(
    isCoverImageField,
  )
  const managedFieldKeys = new Set(
    (collection.supports ?? []).includes("cover") && !hasPersistedCover
      ? ["cover"]
      : [],
  )
  const order = normalizeEntryFieldOrder({
    fields: entryFields,
    entryFieldOrder: collection.schema?.entryFieldOrder,
    supportsBody: (collection.supports ?? []).includes("body"),
  })
  const rows = order
    .map((item) => schemaRowFromOrderItem(item, fieldsByKey, managedFieldKeys))
    .filter((row): row is SchemaOrderRow => Boolean(row))

  return {
    main: rows.filter(
      (row) => row.kind === "system" || row.placement === "main",
    ),
    sidebar: rows.filter(
      (row) => row.kind === "field" && row.placement === "sidebar",
    ),
  }
}

function syncLocalFields(): void {
  const layout = schemaRowsForCollection(props.collection)
  mainRows.value = layout.main
  sidebarRows.value = layout.sidebar
}

function openAddFieldDialog(): void {
  isAddFieldDialogOpen.value = true
  void loadCollections()
}

function fieldsFromRows(rows: readonly SchemaOrderRow[]): FieldSchema[] {
  return rows
    .filter(
      (row): row is Extract<SchemaOrderRow, { kind: "field" }> =>
        row.kind === "field" && !row.managed,
    )
    .map((row) => row.field)
}

function entryFieldOrderFromRows(
  rows: readonly SchemaOrderRow[],
): EntryFieldOrderItem[] {
  return rows.map((row) =>
    row.kind === "system"
      ? { kind: "system", key: row.key }
      : {
          kind: "field" as const,
          key: row.key,
          placement: row.placement,
          ...(row.width === "full" ? {} : { width: row.width }),
        },
  )
}

async function saveRows(
  nextMainRows: readonly SchemaOrderRow[],
  nextSidebarRows: readonly SchemaOrderRow[],
): Promise<boolean> {
  if (isSaving.value) return false

  const nextRows = [...nextMainRows, ...nextSidebarRows]
  const nextFields = fieldsFromRows(nextRows)
  const entryFieldOrder = entryFieldOrderFromRows(nextRows)

  isSaving.value = true
  try {
    const state = await getCollections(props.projectRoot)
    const next: AriaCollectionDef = {
      ...props.collection,
      schema: {
        fields: nextFields,
        version: schemaVersion.value + 1,
        entryFieldOrder,
        icon: props.collection.schema?.icon,
      },
    }
    const collectionsNext = state.collections.map((item) =>
      item.id === next.id ? next : item,
    )
    await updateCollections(props.projectRoot, { collections: collectionsNext })
    mainRows.value = [...nextMainRows]
    sidebarRows.value = [...nextSidebarRows]
    emit("updated", next)
    toast.success(m.cms_collections_schema_updated())
    return true
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to update schema")
    return false
  } finally {
    isSaving.value = false
  }
}

async function addField(
  field: FieldSchema,
  width: EntryFieldWidth = "full",
): Promise<void> {
  const nextRows = [...mainRows.value]
  const newRow: SchemaOrderRow = {
    id: `field:${field.key}`,
    kind: "field",
    key: field.key,
    field,
    placement: "main",
    managed: false,
    width,
  }
  const lastRow = nextRows[nextRows.length - 1]
  const trailingBodyIndex =
    lastRow?.kind === "system" && lastRow.key === "body"
      ? nextRows.length - 1
      : -1
  let lastCustomIndex = -1
  for (let index = nextRows.length - 1; index >= 0; index -= 1) {
    if (nextRows[index]?.kind === "field") {
      lastCustomIndex = index
      break
    }
  }
  const insertIndex =
    trailingBodyIndex >= 0
      ? trailingBodyIndex
      : lastCustomIndex >= 0
        ? lastCustomIndex + 1
        : nextRows.length

  nextRows.splice(insertIndex, 0, newRow)
  const ok = await saveRows(nextRows, sidebarRows.value)
  if (ok) {
    isAddFieldDialogOpen.value = false
  }
}

async function deleteField(fieldKey: string): Promise<void> {
  const cleanRows = (rows: readonly SchemaOrderRow[]) => {
    const remaining = fieldsFromRows(
      [...mainRows.value, ...sidebarRows.value].filter(
        (row) => row.kind === "system" || row.key !== fieldKey,
      ),
    )
    const fieldsByKey = new Map(remaining.map((field) => [field.key, field]))
    return rows
      .filter((row) => row.kind === "system" || row.key !== fieldKey)
      .map((row): SchemaOrderRow | null => {
        if (row.kind === "system") return row
        const field = fieldsByKey.get(row.key)
        return field ? { ...row, field } : null
      })
      .filter((row): row is SchemaOrderRow => Boolean(row))
  }

  const ok = await saveRows(
    cleanRows(mainRows.value),
    cleanRows(sidebarRows.value),
  )
  if (!ok) {
    syncLocalFields()
  }
}

async function requestDeleteField(field: FieldSchema): Promise<void> {
  const ok = await confirm({
    title: m.cms_collections_schema_remove_title(),
    description: m.cms_collections_schema_remove_description(),
    confirmLabel: m.cms_collections_schema_delete(),
    destructive: true,
  })
  if (!ok) return
  await deleteField(field.key)
}

function openEditField(field: FieldSchema): void {
  editingField.value = field
  void loadCollections()
}

function openEditFieldFromCard(event: MouseEvent, field: FieldSchema): void {
  const target = event.target
  if (
    target instanceof HTMLElement &&
    target.closest("button,a,input,select,textarea")
  ) {
    return
  }
  openEditField(field)
}

async function updateField(
  field: FieldSchema,
  width: EntryFieldWidth,
): Promise<void> {
  const currentRows = [...mainRows.value, ...sidebarRows.value]
  const nextFields = replaceSchemaField(fieldsFromRows(currentRows), field)
  const fieldsByKey = new Map(nextFields.map((item) => [item.key, item]))
  const updateRows = (rows: readonly SchemaOrderRow[]) =>
    rows.map((row): SchemaOrderRow => {
      if (row.kind === "system") return row
      return {
        ...row,
        field: fieldsByKey.get(row.key) ?? row.field,
        ...(row.key === field.key ? { width } : {}),
      }
    })
  const ok = await saveRows(
    updateRows(mainRows.value),
    updateRows(sidebarRows.value),
  )
  if (ok) {
    editingField.value = null
  } else {
    syncLocalFields()
  }
}

async function persistReorder(
  nextMain: SchemaOrderRow[],
  nextSidebar: SchemaOrderRow[],
): Promise<void> {
  const withPlacement = {
    main: nextMain.map((row) =>
      row.kind === "field" ? { ...row, placement: "main" as const } : row,
    ),
    sidebar: nextSidebar.map((row) =>
      row.kind === "field" ? { ...row, placement: "sidebar" as const } : row,
    ),
  }

  const persisted = schemaRowsForCollection(props.collection)
  if (
    rowOrderKey(withPlacement.main) === rowOrderKey(persisted.main) &&
    rowOrderKey(withPlacement.sidebar) === rowOrderKey(persisted.sidebar)
  ) {
    mainRows.value = withPlacement.main
    sidebarRows.value = withPlacement.sidebar
    return
  }

  mainRows.value = withPlacement.main
  sidebarRows.value = withPlacement.sidebar
  const ok = await saveRows(withPlacement.main, withPlacement.sidebar)
  if (!ok) {
    syncLocalFields()
  }
}

function areaRows(area: "main" | "sidebar"): SchemaOrderRow[] {
  return area === "main" ? [...mainRows.value] : [...sidebarRows.value]
}

function onRowDragStart(
  area: "main" | "sidebar",
  index: number,
  event: DragEvent,
): void {
  const row = areaRows(area)[index]
  if (!row || isSaving.value) {
    event.preventDefault()
    return
  }
  dragPayload.value = { area, index }
  event.dataTransfer?.setData("text/plain", row.id)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move"
  }
}

function onRowDragOver(
  area: "main" | "sidebar",
  index: number,
  event: DragEvent,
): void {
  const payload = dragPayload.value
  if (!payload) return
  const dragged = areaRows(payload.area)[payload.index]
  if (dragged?.kind === "system" && area !== "main") {
    return
  }
  event.preventDefault()
  dropTarget.value = { area, index }
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move"
  }
}

function onAreaDragOver(area: "main" | "sidebar", event: DragEvent): void {
  const payload = dragPayload.value
  if (!payload) return
  const dragged = areaRows(payload.area)[payload.index]
  if (dragged?.kind === "system" && area !== "main") {
    return
  }
  event.preventDefault()
  const rows = areaRows(area)
  dropTarget.value = { area, index: rows.length }
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move"
  }
}

async function onRowDrop(
  area: "main" | "sidebar",
  index: number,
  event: DragEvent,
): Promise<void> {
  event.preventDefault()
  const payload = dragPayload.value
  dragPayload.value = null
  dropTarget.value = null
  if (!payload || isSaving.value) return

  const dragged = areaRows(payload.area)[payload.index]
  if (!dragged) return
  if (dragged.kind === "system" && area !== "main") return

  let nextMain = [...mainRows.value]
  let nextSidebar = [...sidebarRows.value]
  const source = payload.area === "main" ? nextMain : nextSidebar
  const [removed] = source.splice(payload.index, 1)
  if (!removed) return

  const dest = area === "main" ? nextMain : nextSidebar
  let insertIndex = index
  if (payload.area === area && payload.index < index) {
    insertIndex = Math.max(0, index - 1)
  }
  insertIndex = Math.min(Math.max(0, insertIndex), dest.length)
  dest.splice(insertIndex, 0, removed)

  if (area === "main") nextMain = dest
  else nextSidebar = dest
  if (payload.area === "main" && area !== "main") nextMain = source
  if (payload.area === "sidebar" && area !== "sidebar") nextSidebar = source

  await persistReorder(nextMain, nextSidebar)
}

async function onAreaDrop(
  area: "main" | "sidebar",
  event: DragEvent,
): Promise<void> {
  event.preventDefault()
  await onRowDrop(area, areaRows(area).length, event)
}

function onDragEnd(): void {
  dragPayload.value = null
  dropTarget.value = null
}

watch(
  () => props.collection,
  () => {
    syncLocalFields()
  },
  { immediate: true },
)
</script>

<template>
  <aside
    :class="
      embedded
        ? 'grid gap-5'
        : 'space-y-4 rounded-lg border border-border/60 bg-card/40 p-4'
    "
  >
    <div class="flex min-w-0 items-center justify-between gap-4">
      <div class="min-w-0">
        <h2
          :class="
            embedded
              ? 'm-0 text-lg font-medium text-foreground'
              : 'm-0 text-sm font-medium'
          "
        >
          {{ m.cms_collections_schema_title() }}
        </h2>
        <p class="m-0 mt-1 text-sm text-muted-foreground">
          {{
            m.cms_collections_schema_description({
              count: fields.length,
              collection: collection.name,
            })
          }}
        </p>
      </div>
      <Button
        size="sm"
        class="h-8! shrink-0"
        :disabled="isSaving"
        @click="openAddFieldDialog"
      >
        <AppIcon name="add" :size="14" class="mr-1.5" />
        {{ m.cms_collections_schema_add() }}
      </Button>
    </div>

    <section class="grid content-start gap-5">
      <p class="m-0 text-xs leading-5 text-muted-foreground">
        {{ m.cms_collections_schema_layout_hint() }}
      </p>

      <div v-for="area in layoutAreas" :key="area.key" class="grid gap-2">
        <div class="flex items-end justify-between gap-3 px-0.5">
          <div class="min-w-0">
            <h3 class="m-0 text-sm font-medium text-foreground">
              {{ area.title }}
            </h3>
            <p class="m-0 mt-0.5 text-[11px] leading-4 text-muted-foreground">
              {{ area.description }}
            </p>
          </div>
          <Badge variant="outline" class="h-5 shrink-0 px-1.5 text-[10px]">
            {{ area.rows.length }}
          </Badge>
        </div>

        <div
          class="grid min-h-14 content-start gap-2 rounded-lg border border-dashed border-border/60 bg-card/15 p-2"
          :data-layout-area="area.key"
          @dragover="onAreaDragOver(area.key, $event)"
          @drop="onAreaDrop(area.key, $event)"
        >
          <div
            v-if="area.rows.length === 0"
            class="grid min-h-10 place-items-center px-3 text-center text-[11px] leading-4 text-muted-foreground/65"
          >
            {{ area.empty }}
          </div>

          <div
            v-for="(row, index) in area.rows"
            :key="row.id"
            class="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border border-border/50 bg-background px-1.5 py-1.5 shadow-xs transition-colors hover:border-border"
            :class="[
              row.kind === 'system' ? 'bg-muted/20' : '',
              dropTarget?.area === area.key && dropTarget.index === index
                ? 'ring-1 ring-primary/40'
                : '',
            ]"
            draggable="true"
            @dragstart="onRowDragStart(area.key, index, $event)"
            @dragover="onRowDragOver(area.key, index, $event)"
            @drop="onRowDrop(area.key, index, $event)"
            @dragend="onDragEnd"
            @dblclick="
              row.kind === 'field' &&
              !row.managed &&
              openEditFieldFromCard($event, row.field)
            "
          >
            <button
              type="button"
              class="schema-field-drag-handle grid size-7 shrink-0 cursor-grab place-items-center rounded-sm text-muted-foreground/40 transition-colors hover:bg-card hover:text-muted-foreground active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
              :disabled="isSaving"
              :aria-label="m.cms_collections_schema_reorder()"
            >
              <AppIcon name="dragHandle" :size="14" />
            </button>

            <p
              class="m-0 min-w-0 truncate text-xs font-medium text-foreground"
            >
              {{ row.kind === "system" ? row.label : row.field.label }}
            </p>

            <div class="flex items-center gap-0.5">
              <div
                v-if="row.kind === 'field' && !row.managed"
                class="schema-row-switcher"
              >
                <span
                  class="schema-row-overlay schema-row-type-toggle truncate text-[10px] text-muted-foreground/70"
                >
                  {{ getFieldTypeLabel(row.field) }}
                </span>
                <div
                  class="schema-row-overlay schema-row-actions flex items-center gap-0.5"
                >
                  <Badge
                    v-if="area.key === 'main'"
                    variant="outline"
                    class="mr-1 h-5 shrink-0 px-1.5 text-[9px] text-muted-foreground"
                  >
                    {{ getEntryFieldWidthFraction(row.width) }}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    :disabled="isSaving"
                    :title="m.cms_collections_schema_edit()"
                    :aria-label="m.cms_collections_schema_edit()"
                    @click="openEditField(row.field)"
                  >
                    <AppIcon name="edit" :size="14" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    :disabled="isSaving"
                    :title="m.cms_collections_schema_delete()"
                    :aria-label="m.cms_collections_schema_delete()"
                    @click="requestDeleteField(row.field)"
                  >
                    <AppIcon name="trash" :size="14" />
                  </Button>
                </div>
              </div>

              <template
                v-else-if="row.kind === 'field' && area.key === 'main'"
              >
                <div class="schema-row-switcher">
                  <span
                    class="schema-row-overlay schema-row-type-toggle truncate text-[10px] text-muted-foreground/70"
                  >
                    {{ getFieldTypeLabel(row.field) }}
                  </span>
                  <Badge
                    variant="outline"
                    class="schema-row-overlay schema-row-actions h-5 shrink-0 px-1.5 text-[9px] text-muted-foreground"
                  >
                    {{ getEntryFieldWidthFraction(row.width) }}
                  </Badge>
                </div>
                <span
                  class="mx-2 inline-flex"
                  :title="m.cms_collections_schema_managed_field()"
                >
                  <AppIcon
                    name="lock"
                    :size="14"
                    class="text-muted-foreground/40"
                  />
                </span>
              </template>

              <template v-else>
                <span class="truncate text-[10px] text-muted-foreground/70">
                  {{
                    row.kind === "system"
                      ? row.typeLabel
                      : getFieldTypeLabel(row.field)
                  }}
                </span>
                <span
                  class="mx-2 inline-flex"
                  :title="
                    row.kind === 'field'
                      ? m.cms_collections_schema_managed_field()
                      : m.cms_collections_schema_system_main_only()
                  "
                >
                  <AppIcon
                    name="lock"
                    :size="14"
                    class="text-muted-foreground/40"
                  />
                </span>
              </template>
            </div>
          </div>
        </div>
      </div>

      <Button
        v-if="fields.length === 0"
        variant="outline"
        size="sm"
        :disabled="isSaving"
        @click="openAddFieldDialog"
      >
        <AppIcon name="add" :size="14" class="mr-1.5 shrink-0" />
        {{ m.cms_collections_schema_empty() }}
      </Button>
    </section>

    <AddSchemaFieldDialog
      :open="isAddFieldDialogOpen"
      :existing-fields="fields"
      :is-saving="isSaving"
      :collections="collections"
      :is-loading-collections="isLoadingCollections"
      :collection-load-error="collectionLoadError"
      @update:open="isAddFieldDialogOpen = $event"
      @add="addField"
    />
    <EditSchemaFieldDialog
      :open="isEditFieldDialogOpen"
      :field="editingField"
      :is-saving="isSaving"
      :collections="collections"
      :is-loading-collections="isLoadingCollections"
      :collection-load-error="collectionLoadError"
      :entry-width="editingFieldWidth"
      @update:open="isEditFieldDialogOpen = $event"
      @save="updateField"
    />
  </aside>
</template>

<style scoped>
.schema-row-switcher {
  display: grid;
  align-items: center;
  justify-items: end;
}

.schema-row-overlay {
  grid-area: 1 / 1;
}

.schema-row-type-toggle {
  opacity: 1;
  transition:
    opacity 90ms ease-out,
    transform 140ms ease-out;
}

.schema-row-actions {
  pointer-events: none;
  opacity: 0;
  transform: translateX(0.5rem);
  transition:
    opacity 120ms ease-out,
    transform 180ms cubic-bezier(0.22, 1.45, 0.36, 1);
}

.group:hover .schema-row-actions,
.group:focus-within .schema-row-actions {
  pointer-events: auto;
  opacity: 1;
  transform: translateX(0);
}

.group:hover .schema-row-type-toggle,
.group:focus-within .schema-row-type-toggle {
  opacity: 0;
  transform: translateX(-0.25rem);
}

@media (hover: none) {
  .schema-row-actions {
    pointer-events: auto;
    opacity: 1;
    transform: translateX(0);
  }

  .schema-row-type-toggle {
    opacity: 0;
    transform: translateX(-0.25rem);
  }
}
</style>
