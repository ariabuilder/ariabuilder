<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { FieldSchema } from "../../../../../shared/cms"
import { cmsEntryLabel, resolveCmsEntryLabels } from "../lib/cmsEntryLabels"
import type { CmsEntryRow } from "../lib/entryRow"
import EntryPickerDialog from "./EntryPickerDialog.vue"

const props = withDefaults(
  defineProps<{
    field: FieldSchema & { type: "relation" }
    modelValue: readonly string[]
    projectRoot: string
    disabled?: boolean
  }>(),
  {
    disabled: false,
  },
)

const emit = defineEmits<{
  "update:modelValue": [value: string[]]
}>()

const isPickerOpen = ref(false)
const selectedLabels = ref<Record<string, string>>({})
let hydrateGeneration = 0

const fieldId = computed(() => `cms-relation-${props.field.key}`)
const selectedIds = computed(() =>
  props.modelValue.filter((value): value is string => typeof value === "string"),
)

watch(
  () =>
    [
      selectedIds.value.join("\0"),
      props.projectRoot,
      props.field.targetCollection ?? "",
    ] as const,
  async () => {
    const ids = selectedIds.value
    const collectionId = props.field.targetCollection?.trim() ?? ""
    const root = props.projectRoot.trim()
    const missing = ids.filter((id) => !selectedLabels.value[id])
    if (!root || !collectionId || missing.length === 0) return
    const generation = ++hydrateGeneration
    const labels = await resolveCmsEntryLabels(root, collectionId, missing)
    if (generation !== hydrateGeneration) return
    if (Object.keys(labels).length === 0) return
    selectedLabels.value = {
      ...selectedLabels.value,
      ...labels,
    }
  },
  { immediate: true },
)

function openPicker(): void {
  if (props.disabled || !props.field.targetCollection) return
  isPickerOpen.value = true
}

function removeTarget(targetEntryId: string): void {
  emit(
    "update:modelValue",
    selectedIds.value.filter((id) => id !== targetEntryId),
  )
}

function moveTarget(targetEntryId: string, direction: -1 | 1): void {
  const next = [...selectedIds.value]
  const index = next.indexOf(targetEntryId)
  const targetIndex = index + direction
  if (index < 0 || targetIndex < 0 || targetIndex >= next.length) {
    return
  }
  const [item] = next.splice(index, 1)
  if (!item) return
  next.splice(targetIndex, 0, item)
  emit("update:modelValue", next)
}

function handleEntrySelect(entry: CmsEntryRow): void {
  selectedLabels.value = {
    ...selectedLabels.value,
    [entry.id]: cmsEntryLabel(entry),
  }
  if (selectedIds.value.includes(entry.id)) {
    return
  }
  emit("update:modelValue", [...selectedIds.value, entry.id])
}

function labelFor(entryId: string): string {
  return selectedLabels.value[entryId] ?? entryId
}
</script>

<template>
  <div class="grid gap-2">
    <div class="flex items-center justify-between gap-3">
      <Label
        :for="fieldId"
        class="m-0 text-xs leading-none text-muted-foreground"
      >
        {{ field.label }}<span v-if="field.required" aria-hidden="true"> *</span>
      </Label>
      <Button
        type="button"
        variant="outline"
        size="sm"
        :disabled="disabled || !field.targetCollection"
        :title="
          field.targetCollection
            ? 'Add related entry'
            : 'Target collection is not configured'
        "
        @click="openPicker"
      >
        Add
      </Button>
    </div>

    <div
      :id="fieldId"
      class="grid gap-2 rounded-md border border-border bg-card/30 p-2"
    >
      <p
        v-if="selectedIds.length === 0"
        class="px-1 py-2 text-xs text-muted-foreground"
      >
        No related entries
      </p>
      <div
        v-for="(targetEntryId, index) in selectedIds"
        :key="targetEntryId"
        class="flex min-w-0 items-center justify-between gap-2 rounded-sm border border-border/50 bg-card/30 px-2 py-1.5"
      >
        <span class="min-w-0">
          <span class="block truncate text-xs text-foreground">
            {{ labelFor(targetEntryId) }}
          </span>
          <span
            v-if="!selectedLabels[targetEntryId]"
            class="block truncate text-[10px] text-muted-foreground"
          >
            {{ targetEntryId }}
          </span>
        </span>
        <span class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            :disabled="disabled || index === 0"
            @click="moveTarget(targetEntryId, -1)"
          >
            <AppIcon name="chevronUp" :size="14" />
          </button>
          <button
            type="button"
            class="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
            :disabled="disabled || index === selectedIds.length - 1"
            @click="moveTarget(targetEntryId, 1)"
          >
            <AppIcon name="chevronDown" :size="14" />
          </button>
          <button
            type="button"
            class="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
            :disabled="disabled"
            @click="removeTarget(targetEntryId)"
          >
            <AppIcon name="trash" :size="14" />
          </button>
        </span>
      </div>
    </div>

    <EntryPickerDialog
      v-if="field.targetCollection"
      v-model:open="isPickerOpen"
      :project-root="projectRoot"
      :target-collection="field.targetCollection"
      :title="`Add ${field.label}`"
      @select="handleEntrySelect"
    />
  </div>
</template>
