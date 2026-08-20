<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import type { EntryFieldWidth, FieldSchema } from "../../../../../shared/cms"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { m } from "@/paraglide/messages.js"
import AddSchemaFieldDialog from "./AddSchemaFieldDialog.vue"
import CmsCollectionCommandSelect from "../components/CmsCollectionCommandSelect.vue"
import CmsFieldWidthSelector from "../components/CmsFieldWidthSelector.vue"
import type { CollectionSummary } from "../composables/useCollectionsList"
import { normalizeEntryFieldWidth } from "../lib/entryFieldWidth"
import {
  buildUpdatedSchemaFieldFromDraft,
  cloneSchemaField,
  createEmptySchemaFieldDraft,
  createSchemaFieldDraftFromField,
  fieldSupportsNestedSchema,
  moveSchemaField,
  removeSchemaField,
  reorderNestedSchemaFields,
  type CmsSchemaFieldDraft,
  type CmsSchemaFieldErrors,
} from "../lib/schemaFieldForm"

const props = defineProps<{
  open: boolean
  field: FieldSchema | null
  collections: readonly CollectionSummary[]
  isLoadingCollections?: boolean
  collectionLoadError?: string | null
  isSaving?: boolean
  entryWidth?: EntryFieldWidth
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  save: [field: FieldSchema, width: EntryFieldWidth]
}>()

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

function localizedFieldTypeLabel(type: string): string {
  return FIELD_TYPE_LABELS[type] ?? type
}

function localizedError(error: string | undefined): string {
  if (!error) return ""
  if (error === "Label is required") return m.cms_field_error_label_required()
  if (error === "Field key cannot be changed yet")
    return m.cms_field_error_key_locked()
  if (error === "Field type cannot be changed yet")
    return m.cms_field_error_type_locked()
  if (error === "Add at least one option")
    return m.cms_field_error_options_required()
  if (error === "Target collection is required")
    return m.cms_field_error_target_required()
  if (error === "Choose a nested field for the row title")
    return m.cms_field_error_title_field_required()
  return error
}

const draft = ref<CmsSchemaFieldDraft>(createEmptySchemaFieldDraft())
const errors = ref<CmsSchemaFieldErrors>({})
const nestedFields = ref<FieldSchema[]>([])
const isAddNestedFieldDialogOpen = ref(false)
const entryWidthDraft = ref<EntryFieldWidth>("full")
const dragNestedIndex = ref<number | null>(null)

const fieldTypeLabel = computed(() => {
  const type = props.field?.type
  return type ? localizedFieldTypeLabel(type) : ""
})
const showOptions = computed(
  () => draft.value.type === "select" || draft.value.type === "multiSelect",
)
const showTargetCollection = computed(
  () => draft.value.type === "reference" || draft.value.type === "relation",
)
const showNestedFields = computed(
  () => props.field !== null && fieldSupportsNestedSchema(props.field),
)
const showRepeaterDisplay = computed(() => props.field?.type === "repeater")

watch(
  () => [props.open, props.field, props.entryWidth] as const,
  ([open, field]) => {
    errors.value = {}
    draft.value =
      open && field
        ? createSchemaFieldDraftFromField(field)
        : createEmptySchemaFieldDraft()
    nestedFields.value =
      open && field && fieldSupportsNestedSchema(field)
        ? [...(field.fields ?? [])]
        : []
    isAddNestedFieldDialogOpen.value = false
    entryWidthDraft.value = normalizeEntryFieldWidth(props.entryWidth)
    dragNestedIndex.value = null
  },
  { immediate: true },
)

function handleOpenChange(open: boolean): void {
  emit("update:open", open)
}

function submitField(): void {
  if (props.isSaving || !props.field) return
  errors.value = {}
  const result = buildUpdatedSchemaFieldFromDraft(
    props.field,
    draft.value,
    showNestedFields.value ? nestedFields.value : undefined,
  )
  if (!result.success) {
    errors.value = result.errors
    const fieldIds: Record<string, string> = {
      label: "edit-schema-field-label",
      key: "edit-schema-field-key",
      type: "edit-schema-field-type",
      optionsText: "edit-schema-field-options",
      targetCollection: "edit-schema-field-target-collection",
      fields: "edit-schema-field-add-nested",
      repeaterTitleFieldKey: "edit-schema-field-repeater-title",
    }
    const targetId = Object.keys(result.errors)
      .map((key) => fieldIds[key])
      .find(Boolean)
    if (targetId) {
      void nextTick(() => document.getElementById(targetId)?.focus())
    }
    return
  }
  emit(
    "save",
    showNestedFields.value
      ? reorderNestedSchemaFields(result.field, nestedFields.value)
      : result.field,
    entryWidthDraft.value,
  )
}

function addNestedField(field: FieldSchema, _width: EntryFieldWidth = "full"): void {
  nestedFields.value = [...nestedFields.value, field]
  isAddNestedFieldDialogOpen.value = false
}

function removeNestedField(fieldKey: string): void {
  nestedFields.value = removeSchemaField(nestedFields.value, fieldKey)
  if (draft.value.repeaterTitleFieldKey === fieldKey) {
    draft.value = {
      ...draft.value,
      repeaterTitleFieldKey: "",
    }
  }
}

function onNestedDragStart(index: number): void {
  dragNestedIndex.value = index
}

function onNestedDrop(toIndex: number): void {
  const fromIndex = dragNestedIndex.value
  dragNestedIndex.value = null
  if (fromIndex === null || fromIndex === toIndex) return
  nestedFields.value = moveSchemaField(nestedFields.value, fromIndex, toIndex)
}

function moveNestedFieldBy(index: number, delta: -1 | 1): void {
  const nextIndex = index + delta
  if (nextIndex < 0 || nextIndex >= nestedFields.value.length) return
  nestedFields.value = moveSchemaField(nestedFields.value, index, nextIndex)
}

function duplicateNestedField(index: number): void {
  const source = nestedFields.value[index]
  if (!source) return
  const keys = new Set(nestedFields.value.map((field) => field.key))
  let key = `${source.key}-copy`
  let suffix = 2
  while (keys.has(key)) key = `${source.key}-copy-${suffix++}`
  const copy = cloneSchemaField(source)
  copy.key = key
  copy.label = `${source.label} copy`
  const next = [...nestedFields.value]
  next.splice(index + 1, 0, copy)
  nestedFields.value = next
}

function handleDialogPointerDownOutside(
  event: CustomEvent<{ originalEvent: PointerEvent }>,
): void {
  const target = event.detail.originalEvent.target
  if (
    target instanceof HTMLElement &&
    target.closest("[data-cms-collection-picker-content]")
  ) {
    event.preventDefault()
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent
      class="sm:max-w-[525px]"
      @pointer-down-outside="handleDialogPointerDownOutside"
    >
      <DialogHeader class="gap-0">
        <DialogTitle>{{ m.cms_field_edit_title() }}</DialogTitle>
        <DialogDescription>
          {{ m.cms_field_edit_description() }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="field" class="grid gap-3">
        <div class="grid gap-2">
          <Label
            for="edit-schema-field-label"
            class="text-sm! text-muted-foreground"
          >
            {{ m.cms_field_label() }}
          </Label>
          <Input
            id="edit-schema-field-label"
            v-model="draft.label"
            :disabled="isSaving"
            :aria-invalid="errors.label ? 'true' : undefined"
            :aria-describedby="errors.label ? 'edit-schema-field-label-error' : undefined"
            @keydown.enter="submitField"
          />
          <p v-if="errors.label" id="edit-schema-field-label-error" class="text-xs text-destructive">
            {{ localizedError(errors.label) }}
          </p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-2">
            <Label
              for="edit-schema-field-key"
              class="text-sm! text-muted-foreground"
            >
              {{ m.cms_field_key() }}
            </Label>
            <Input
              id="edit-schema-field-key"
              v-model="draft.key"
              class="font-mono text-xs"
              disabled
              :aria-invalid="errors.key ? 'true' : undefined"
              :aria-describedby="errors.key ? 'edit-schema-field-key-error' : undefined"
            />
            <p v-if="errors.key" id="edit-schema-field-key-error" class="text-xs text-destructive">
              {{ localizedError(errors.key) }}
            </p>
          </div>
          <div class="grid gap-2">
            <Label
              for="edit-schema-field-type"
              class="text-sm! text-muted-foreground"
            >
              {{ m.cms_field_type() }}
            </Label>
            <Input
              id="edit-schema-field-type"
              :model-value="fieldTypeLabel"
              disabled
              :aria-invalid="errors.type ? 'true' : undefined"
              :aria-describedby="errors.type ? 'edit-schema-field-type-error' : undefined"
            />
            <p v-if="errors.type" id="edit-schema-field-type-error" class="text-xs text-destructive">
              {{ localizedError(errors.type) }}
            </p>
          </div>
        </div>

        <CmsFieldWidthSelector
          v-model="entryWidthDraft"
          :disabled="isSaving"
        />

        <div v-if="showOptions" class="grid gap-2">
          <Label for="edit-schema-field-options">
            {{ m.cms_field_options() }}
          </Label>
          <Textarea
            id="edit-schema-field-options"
            v-model="draft.optionsText"
            rows="4"
            :disabled="isSaving"
            :aria-invalid="errors.optionsText ? 'true' : undefined"
            :aria-describedby="errors.optionsText ? 'edit-schema-field-options-error' : undefined"
          />
          <p v-if="errors.optionsText" id="edit-schema-field-options-error" class="text-xs text-destructive">
            {{ localizedError(errors.optionsText) }}
          </p>
        </div>

        <div v-if="showTargetCollection" class="grid gap-2">
          <Label for="edit-schema-field-target-collection">
            {{ m.cms_field_target_collection() }}
          </Label>
          <CmsCollectionCommandSelect
            id="edit-schema-field-target-collection"
            v-model="draft.targetCollection"
            :collections="collections"
            :disabled="isSaving"
            :is-loading="isLoadingCollections"
            :load-error="collectionLoadError"
            :aria-invalid="errors.targetCollection ? 'true' : undefined"
            :aria-describedby="errors.targetCollection ? 'edit-schema-field-target-collection-error' : undefined"
          />
          <p v-if="errors.targetCollection" id="edit-schema-field-target-collection-error" class="text-xs text-destructive">
            {{ localizedError(errors.targetCollection) }}
          </p>
        </div>

        <label class="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            :checked="draft.required"
            :disabled="isSaving"
            @update:checked="draft.required = $event === true"
          />
          {{ m.cms_field_required() }}
        </label>

        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            :checked="draft.showInEntryList"
            :disabled="isSaving"
            @update:checked="draft.showInEntryList = $event === true"
          />
          {{ m.cms_field_show_in_table() }}
        </label>

        <div
          v-if="showNestedFields"
          class="grid gap-3 rounded-md border border-border/50 bg-card/30 p-3"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="grid gap-0.5">
              <p class="m-0 text-sm font-medium leading-none text-foreground">
                {{ m.cms_field_nested() }}
              </p>
              <p class="m-0 text-xs text-muted-foreground">
                {{
                  m.cms_field_nested_count({
                    count: nestedFields.length,
                    type: localizedFieldTypeLabel(draft.type),
                  })
                }}
              </p>
            </div>
            <Button
              id="edit-schema-field-add-nested"
              type="button"
              variant="outline"
              size="sm"
              :disabled="isSaving"
              @click="isAddNestedFieldDialogOpen = true"
            >
              {{ m.cms_collections_schema_add() }}
            </Button>
          </div>

          <div
            v-if="nestedFields.length === 0"
            class="rounded-md border border-dashed border-border/50 px-3 py-4 text-xs text-muted-foreground"
          >
            {{ m.cms_field_add_child() }}
          </div>

          <div v-else class="grid gap-2">
            <div
              v-for="(nestedField, index) in nestedFields"
              :key="nestedField.key"
              class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border/50 bg-background/60 px-2.5 py-2"
              draggable="true"
              @dragstart="onNestedDragStart(index)"
              @dragover.prevent
              @drop.prevent="onNestedDrop(index)"
            >
              <button
                type="button"
                class="grid size-7 cursor-grab place-items-center rounded-sm text-muted-foreground/40 transition-colors hover:bg-card hover:text-muted-foreground active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
                :disabled="isSaving"
                :aria-label="m.cms_field_reorder_nested()"
              >
                <AppIcon name="dragHandle" :size="14" />
              </button>
              <div class="min-w-0">
                <p
                  class="m-0 truncate text-sm font-medium leading-tight text-foreground"
                >
                  {{ nestedField.label }}
                </p>
                <p class="m-0 truncate text-xs text-muted-foreground">
                  {{ nestedField.key }} · {{ nestedField.type }}
                </p>
              </div>
              <div class="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon" class="size-7" :disabled="isSaving || index === 0" :aria-label="`Move ${nestedField.label} up`" @click="moveNestedFieldBy(index, -1)">
                  <AppIcon name="chevronUp" :size="14" />
                </Button>
                <Button type="button" variant="ghost" size="icon" class="size-7" :disabled="isSaving || index === nestedFields.length - 1" :aria-label="`Move ${nestedField.label} down`" @click="moveNestedFieldBy(index, 1)">
                  <AppIcon name="chevronDown" :size="14" />
                </Button>
                <Button type="button" variant="ghost" size="icon" class="size-7" :disabled="isSaving" :aria-label="`Duplicate ${nestedField.label}`" @click="duplicateNestedField(index)">
                  <AppIcon name="copy" :size="14" />
                </Button>
                <Button type="button" variant="ghost" size="icon" class="size-7 hover:text-destructive" :disabled="isSaving" :aria-label="`Delete ${nestedField.label}`" @click="removeNestedField(nestedField.key)">
                  <AppIcon name="trash" :size="14" />
                </Button>
              </div>
            </div>
          </div>

          <div
            v-if="showRepeaterDisplay"
            class="grid gap-3 border-t border-dashed border-border/50 pt-3"
          >
            <div class="grid gap-2">
              <Label for="edit-schema-field-repeater-title">
                {{ m.cms_field_collapsed_title() }}
              </Label>
              <Select
                :model-value="draft.repeaterTitleFieldKey || '__auto'"
                :disabled="isSaving"
                @update:model-value="
                  (value) => {
                    draft.repeaterTitleFieldKey =
                      value === '__auto' ? '' : String(value)
                  }
                "
              >
                <SelectTrigger
                  id="edit-schema-field-repeater-title"
                  class="w-full"
                >
                  <SelectValue :placeholder="m.cms_field_auto_title()" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto">
                    {{ m.cms_field_auto_title() }}
                  </SelectItem>
                  <SelectItem
                    v-for="nestedField in nestedFields"
                    :key="nestedField.key"
                    :value="nestedField.key"
                  >
                    {{ nestedField.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p
                v-if="errors.repeaterTitleFieldKey"
                class="text-xs text-destructive"
              >
                {{ localizedError(errors.repeaterTitleFieldKey) }}
              </p>
            </div>

            <div class="grid gap-2">
              <Label for="edit-schema-field-repeater-add-label">
                {{ m.cms_field_add_button_label() }}
              </Label>
              <Input
                id="edit-schema-field-repeater-add-label"
                v-model="draft.repeaterAddButtonLabel"
                :placeholder="m.cms_field_add_placeholder()"
                :disabled="isSaving"
              />
            </div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          size="sm"
          class="h-9!"
          :disabled="isSaving"
          @click="handleOpenChange(false)"
        >
          {{ m.cms_common_cancel() }}
        </Button>
        <Button
          size="sm"
          class="h-9!"
          :disabled="isSaving || !field"
          @click="submitField"
        >
          {{ isSaving ? m.cms_entry_saving() : m.cms_field_save() }}
        </Button>
      </DialogFooter>

      <AddSchemaFieldDialog
        :open="isAddNestedFieldDialogOpen"
        :existing-fields="nestedFields"
        :collections="collections"
        :is-loading-collections="isLoadingCollections"
        :collection-load-error="collectionLoadError"
        :is-saving="isSaving"
        :show-entry-width="false"
        @update:open="isAddNestedFieldDialogOpen = $event"
        @add="addNestedField"
      />
    </DialogContent>
  </Dialog>
</template>
