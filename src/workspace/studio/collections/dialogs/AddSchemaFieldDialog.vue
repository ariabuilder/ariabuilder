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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { m } from "@/paraglide/messages.js"
import CmsCollectionCommandSelect from "../components/CmsCollectionCommandSelect.vue"
import CmsFieldWidthSelector from "../components/CmsFieldWidthSelector.vue"
import type { CollectionSummary } from "../composables/useCollectionsList"
import {
  buildSchemaFieldFromDraft,
  CMS_SCHEMA_FIELD_TYPE_GROUPS,
  cloneSchemaField,
  createEmptySchemaFieldDraft,
  moveSchemaField,
  normalizeSchemaFieldKey,
  removeSchemaField,
  type CmsSchemaFieldDraft,
  type CmsSchemaFieldErrors,
} from "../lib/schemaFieldForm"

defineOptions({
  name: "AddSchemaFieldDialog",
})

const props = defineProps<{
  open: boolean
  existingFields: readonly FieldSchema[]
  collections: readonly CollectionSummary[]
  isLoadingCollections?: boolean
  collectionLoadError?: string | null
  isSaving?: boolean
  showEntryWidth?: boolean
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  add: [field: FieldSchema, width: EntryFieldWidth]
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

function fieldTypeLabel(type: string): string {
  return FIELD_TYPE_LABELS[type] ?? type
}

function fieldTypeGroupLabel(label: string): string {
  const keyByLabel: Record<string, string> = {
    Text: m.cms_field_type_group_text(),
    "Numbers & dates": m.cms_field_type_group_numbers(),
    Choices: m.cms_field_type_group_choices(),
    Design: m.cms_field_type_group_design(),
    Media: m.cms_field_type_group_media(),
    References: m.cms_field_type_group_references(),
    Advanced: m.cms_field_type_group_advanced(),
  }
  return keyByLabel[label] ?? label
}

function localizedError(error: string | undefined): string {
  if (!error) return ""
  if (error === "Label is required") return m.cms_field_error_label_required()
  if (error === "Field key is required") return m.cms_field_error_key_required()
  if (error === "Add at least one option")
    return m.cms_field_error_options_required()
  if (error === "Target collection is required")
    return m.cms_field_error_target_required()
  if (error === "Add at least one nested field")
    return m.cms_field_error_nested_required()
  if (error === "Choose a nested field for the row title")
    return m.cms_field_error_title_field_required()
  const match = /^Field "(.+)" already exists$/.exec(error)
  return match
    ? m.cms_field_error_key_exists({ key: match[1]! })
    : error
}

const draft = ref<CmsSchemaFieldDraft>(createEmptySchemaFieldDraft())
const errors = ref<CmsSchemaFieldErrors>({})
const isKeyEdited = ref(false)
const nestedFields = ref<FieldSchema[]>([])
const isAddNestedFieldDialogOpen = ref(false)
const entryWidth = ref<EntryFieldWidth>("full")
const dragNestedIndex = ref<number | null>(null)

const showOptions = computed(
  () => draft.value.type === "select" || draft.value.type === "multiSelect",
)
const showTargetCollection = computed(
  () => draft.value.type === "reference" || draft.value.type === "relation",
)
const showNestedFields = computed(
  () => draft.value.type === "object" || draft.value.type === "repeater",
)
const showRepeaterDisplay = computed(() => draft.value.type === "repeater")

watch(
  () => draft.value.label,
  (label) => {
    if (isKeyEdited.value) return
    draft.value = {
      ...draft.value,
      key: normalizeSchemaFieldKey(label),
    }
  },
)

watch(
  () => props.open,
  (open) => {
    if (!open) {
      resetForm()
    }
  },
)

function resetForm(): void {
  draft.value = createEmptySchemaFieldDraft()
  errors.value = {}
  isKeyEdited.value = false
  nestedFields.value = []
  isAddNestedFieldDialogOpen.value = false
  entryWidth.value = "full"
  dragNestedIndex.value = null
}

function handleOpenChange(open: boolean): void {
  if (!open) {
    resetForm()
  }
  emit("update:open", open)
}

function submitField(): void {
  if (props.isSaving) return
  errors.value = {}
  const result = buildSchemaFieldFromDraft(
    draft.value,
    props.existingFields,
    showNestedFields.value ? nestedFields.value : [],
  )
  if (!result.success) {
    errors.value = result.errors
    const fieldIds: Record<string, string> = {
      label: "schema-field-label",
      key: "schema-field-key",
      optionsText: "schema-field-options",
      targetCollection: "schema-field-target-collection",
      fields: "schema-field-add-nested",
      repeaterTitleFieldKey: "schema-field-repeater-title",
    }
    const targetId = Object.keys(result.errors)
      .map((key) => fieldIds[key])
      .find(Boolean)
    if (targetId) {
      void nextTick(() => document.getElementById(targetId)?.focus())
    }
    return
  }
  emit("add", result.field, entryWidth.value)
}

function addNestedField(field: FieldSchema, _width: EntryFieldWidth = "full"): void {
  nestedFields.value = [...nestedFields.value, field]
  isAddNestedFieldDialogOpen.value = false
  const { fields: _fields, ...rest } = errors.value
  errors.value = rest
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

function handleKeyInput(): void {
  isKeyEdited.value = true
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
        <DialogTitle>{{ m.cms_field_add_title() }}</DialogTitle>
        <DialogDescription>
          {{ m.cms_field_add_description() }}
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-3">
        <div class="grid gap-2">
          <Label for="schema-field-label">{{ m.cms_field_label() }}</Label>
          <Input
            id="schema-field-label"
            v-model="draft.label"
            :disabled="isSaving"
            :aria-invalid="errors.label ? 'true' : undefined"
            :aria-describedby="errors.label ? 'schema-field-label-error' : undefined"
            @keydown.enter="submitField"
          />
          <p v-if="errors.label" id="schema-field-label-error" class="text-xs text-destructive">
            {{ localizedError(errors.label) }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="schema-field-key">{{ m.cms_field_key() }}</Label>
          <Input
            id="schema-field-key"
            v-model="draft.key"
            class="font-mono text-xs"
            :disabled="isSaving"
            :aria-invalid="errors.key ? 'true' : undefined"
            :aria-describedby="errors.key ? 'schema-field-key-error' : undefined"
            @input="handleKeyInput"
            @keydown.enter="submitField"
          />
          <p v-if="errors.key" id="schema-field-key-error" class="text-xs text-destructive">
            {{ localizedError(errors.key) }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="schema-field-type">{{ m.cms_field_type() }}</Label>
          <Select
            :model-value="draft.type"
            :disabled="isSaving"
            @update:model-value="draft.type = $event as typeof draft.type"
          >
            <SelectTrigger id="schema-field-type" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent class="max-h-80 min-w-60 max-w-[calc(100vw-2rem)]">
              <template
                v-for="(group, groupIndex) in CMS_SCHEMA_FIELD_TYPE_GROUPS"
                :key="group.label"
              >
                <SelectSeparator v-if="groupIndex > 0" />
                <SelectGroup>
                  <SelectLabel
                    class="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-primary/80"
                  >
                    {{ fieldTypeGroupLabel(group.label) }}
                  </SelectLabel>
                  <SelectItem
                    v-for="option in group.options"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ fieldTypeLabel(option.value) }}
                  </SelectItem>
                </SelectGroup>
              </template>
            </SelectContent>
          </Select>
        </div>

        <CmsFieldWidthSelector
          v-if="showEntryWidth !== false"
          v-model="entryWidth"
          :disabled="isSaving"
        />

        <div v-if="showOptions" class="grid gap-2">
          <Label for="schema-field-options">{{ m.cms_field_options() }}</Label>
          <Textarea
            id="schema-field-options"
            v-model="draft.optionsText"
            rows="4"
            :disabled="isSaving"
            :aria-invalid="errors.optionsText ? 'true' : undefined"
            :aria-describedby="errors.optionsText ? 'schema-field-options-error' : undefined"
          />
          <p v-if="errors.optionsText" id="schema-field-options-error" class="text-xs text-destructive">
            {{ localizedError(errors.optionsText) }}
          </p>
        </div>

        <div v-if="showTargetCollection" class="grid gap-2">
          <Label for="schema-field-target-collection">
            {{ m.cms_field_target_collection() }}
          </Label>
          <CmsCollectionCommandSelect
            id="schema-field-target-collection"
            v-model="draft.targetCollection"
            :collections="collections"
            :disabled="isSaving"
            :is-loading="isLoadingCollections"
            :load-error="collectionLoadError"
            :aria-invalid="errors.targetCollection ? 'true' : undefined"
            :aria-describedby="errors.targetCollection ? 'schema-field-target-collection-error' : undefined"
          />
          <p v-if="errors.targetCollection" id="schema-field-target-collection-error" class="text-xs text-destructive">
            {{ localizedError(errors.targetCollection) }}
          </p>
        </div>

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
                    type: fieldTypeLabel(draft.type),
                  })
                }}
              </p>
            </div>
            <Button
              id="schema-field-add-nested"
              type="button"
              variant="outline"
              size="sm"
              :disabled="isSaving"
              :aria-describedby="errors.fields ? 'schema-field-fields-error' : undefined"
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

          <p v-if="errors.fields" id="schema-field-fields-error" class="text-xs text-destructive" role="alert">
            {{ localizedError(errors.fields) }}
          </p>

          <div
            v-if="showRepeaterDisplay"
            class="grid gap-3 border-t border-dashed border-border/50 pt-3"
          >
            <div class="grid gap-2">
              <Label for="schema-field-repeater-title">
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
                <SelectTrigger id="schema-field-repeater-title" class="w-full">
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
              <Label for="schema-field-repeater-add-label">
                {{ m.cms_field_add_button_label() }}
              </Label>
              <Input
                id="schema-field-repeater-add-label"
                v-model="draft.repeaterAddButtonLabel"
                :placeholder="m.cms_field_add_placeholder()"
                :disabled="isSaving"
              />
            </div>
          </div>
        </div>

        <label class="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            :checked="draft.required"
            :disabled="isSaving"
            @update:checked="draft.required = $event === true"
          />
          {{ m.cms_field_required() }}
        </label>

        <label class="flex items-start gap-2 text-xs text-muted-foreground">
          <Checkbox
            class="mt-0.5"
            :checked="draft.showInEntryList"
            :disabled="isSaving"
            @update:checked="draft.showInEntryList = $event === true"
          />
          <span class="grid gap-0.5">
            <span class="text-foreground/85">{{ m.cms_field_show_in_list() }}</span>
            <span>{{ m.cms_field_show_in_list_description() }}</span>
          </span>
        </label>
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
          :disabled="isSaving"
          @click="submitField"
        >
          {{
            isSaving
              ? m.cms_field_adding()
              : m.cms_collections_schema_add()
          }}
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
