<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { m } from "@/paraglide/messages.js"
import type { DesignVariableAlias } from "../../../../shared/design"
import DesignTokenPicker from "../components/DesignTokenPicker.vue"
import type { VariableManagerRow } from "../lib/variableManagerTable"
import type { VariableManagerTokenOption } from "../lib/variableManagerTokens"
import type { VariableReferenceOption } from "../lib/variableReferences"
import CssEditorDialog from "./CssEditorDialog.vue"

export type VariableEditorKind = "custom" | "alias"

export type VariableEditorSavePayload =
  | {
      kind: "custom"
      previousKind: VariableEditorKind
      key: string
      label: string
      value: string
    }
  | {
      kind: "alias"
      previousKind: VariableEditorKind
      key: string
      label: string
      sourceType: DesignVariableAlias["sourceType"]
      sourceKey: string
      fallback: string
    }

const props = defineProps<{
  open: boolean
  row: VariableManagerRow | null
  customVariableOptions: readonly { value: string; label: string }[]
  designTokenOptions: readonly VariableManagerTokenOption[]
  variableReferences?: readonly VariableReferenceOption[]
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  save: [payload: VariableEditorSavePayload]
}>()

const PANEL_TRIGGER_CLASS =
  "h-9! w-full min-w-0 rounded-md border border-border/50 bg-sidebar/40 px-3 text-xs! shadow-none transition-colors hover:bg-sidebar/80 focus:ring-0 focus-visible:border-border"

const draftKind = ref<VariableEditorKind>("custom")
const draftLabel = ref("")
const draftValue = ref("")
const draftAlias = reactive<{
  sourceType: DesignVariableAlias["sourceType"]
  sourceKey: string
}>({
  sourceType: "custom",
  sourceKey: "",
})

function resetDraftFromRow(row: VariableManagerRow): void {
  draftKind.value = row.kind
  draftLabel.value = row.label
  if (row.kind === "custom") {
    draftValue.value = row.variable.value
    draftAlias.sourceType = "custom"
    draftAlias.sourceKey = ""
    return
  }
  draftValue.value = row.alias.fallback ?? ""
  draftAlias.sourceType = row.alias.sourceType
  draftAlias.sourceKey = row.alias.sourceKey
}

watch(
  () => [props.open, props.row] as const,
  ([open, row]) => {
    if (!open || !row) return
    resetDraftFromRow(row)
  },
  { immediate: true },
)

const title = computed(() => {
  const key = props.row?.key ?? ""
  if (draftKind.value === "alias") {
    return m.design_variables_editor_title_alias({ name: key })
  }
  return m.design_variables_editor_title_variable({ name: key })
})

const description = computed(() => {
  if (draftKind.value === "alias") {
    return m.design_variables_editor_description_alias()
  }
  return m.design_variables_editor_description_variable()
})

const editorLabel = computed(() => {
  if (draftKind.value === "alias") {
    return m.design_variables_placeholder_fallback()
  }
  return m.design_variables_column_value()
})

const editorKey = computed(() =>
  props.row ? `${props.row.kind}:${props.row.key}` : "closed",
)

const placeholder = computed(() => {
  if (draftKind.value === "alias") {
    return m.design_variables_placeholder_fallback()
  }
  return m.design_variables_placeholder_value()
})

const selectableCustomOptions = computed(() => {
  const currentKey = props.row?.key
  if (!currentKey) return props.customVariableOptions
  return props.customVariableOptions.filter(
    (option) => option.value !== currentKey,
  )
})

const customSourceLabel = computed(() => {
  if (!draftAlias.sourceKey) {
    return m.design_variables_source_choose_variable()
  }
  return (
    selectableCustomOptions.value.find(
      (option) => option.value === draftAlias.sourceKey,
    )?.label ?? draftAlias.sourceKey
  )
})

function kindButtonClass(active: boolean): string {
  return [
    "inline-flex h-7 flex-1 items-center justify-center rounded-sm px-2 text-xs font-medium transition-colors",
    active
      ? "bg-card text-foreground shadow-sm"
      : "text-muted-foreground hover:text-foreground",
  ].join(" ")
}

function sourceTypeButtonClass(active: boolean): string {
  return kindButtonClass(active)
}

function setKind(kind: VariableEditorKind): void {
  if (draftKind.value === kind) return
  draftKind.value = kind
  if (kind === "alias" && !draftAlias.sourceKey) {
    draftAlias.sourceType = "custom"
  }
}

function setSourceType(value: DesignVariableAlias["sourceType"]): void {
  if (draftAlias.sourceType === value) return
  draftAlias.sourceType = value
  draftAlias.sourceKey = ""
}

function setCustomSource(sourceKey: string): void {
  draftAlias.sourceType = "custom"
  draftAlias.sourceKey = sourceKey
}

function setTokenSource(optionValue: string | null): void {
  if (!optionValue) return
  draftAlias.sourceType = "token"
  draftAlias.sourceKey = optionValue
}

function handleSave(value: string): void {
  if (!props.row) return
  const previousKind = props.row.kind
  const label = draftLabel.value.trim() || props.row.label

  if (draftKind.value === "custom") {
    emit("save", {
      kind: "custom",
      previousKind,
      key: props.row.key,
      label,
      value,
    })
    return
  }

  emit("save", {
    kind: "alias",
    previousKind,
    key: props.row.key,
    label,
    sourceType: draftAlias.sourceType,
    sourceKey: draftAlias.sourceKey,
    fallback: value,
  })
}
</script>

<template>
  <CssEditorDialog
    :key="editorKey"
    :open="open"
    :title="title"
    :description="description"
    :initial-value="draftValue"
    :placeholder="placeholder"
    :variable-references="variableReferences ?? []"
    editor-min-height-class="min-h-[220px]"
    @update:open="emit('update:open', $event)"
    @save="handleSave"
  >
    <template #controls>
      <div class="space-y-3">
        <div class="space-y-2">
          <p
            class="text-2xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            {{ m.design_variables_column_type() }}
          </p>
          <div
            class="inline-flex h-8 w-full max-w-xs items-center gap-0.5 rounded-md border border-border/50 bg-transparent p-0.5"
            role="group"
            :aria-label="m.design_variables_column_type()"
          >
            <button
              type="button"
              :class="kindButtonClass(draftKind === 'custom')"
              @click="setKind('custom')"
            >
              {{ m.design_variables_type_variable() }}
            </button>
            <button
              type="button"
              :class="kindButtonClass(draftKind === 'alias')"
              @click="setKind('alias')"
            >
              {{ m.design_variables_type_alias() }}
            </button>
          </div>
        </div>

        <div v-if="draftKind === 'alias'" class="space-y-2">
          <p
            class="text-2xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            {{ m.design_variables_column_source() }}
          </p>
          <div
            class="inline-flex h-8 w-full max-w-xs items-center gap-0.5 rounded-md border border-border/50 bg-transparent p-0.5"
            role="group"
            :aria-label="m.design_variables_column_source()"
          >
            <button
              type="button"
              :class="sourceTypeButtonClass(draftAlias.sourceType === 'custom')"
              @click="setSourceType('custom')"
            >
              {{ m.design_variables_source_variable() }}
            </button>
            <button
              type="button"
              :class="sourceTypeButtonClass(draftAlias.sourceType === 'token')"
              @click="setSourceType('token')"
            >
              {{ m.design_variables_source_token() }}
            </button>
          </div>

          <Select
            v-if="draftAlias.sourceType === 'custom'"
            :model-value="draftAlias.sourceKey"
            @update:model-value="setCustomSource(String($event))"
          >
            <SelectTrigger
              :class="`${PANEL_TRIGGER_CLASS} text-left text-foreground`"
            >
              <SelectValue>
                {{ customSourceLabel }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="option in selectableCustomOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>

          <DesignTokenPicker
            v-else
            :model-value="draftAlias.sourceKey"
            :options="designTokenOptions"
            :placeholder="m.design_variables_source_choose_token()"
            :trigger-class="`${PANEL_TRIGGER_CLASS} text-foreground`"
            content-class="rounded-xl border-border/50 bg-background/96 shadow-xl backdrop-blur"
            @update:model-value="setTokenSource"
          />
        </div>

        <p
          class="pt-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          {{ editorLabel }}
        </p>
      </div>
    </template>
  </CssEditorDialog>
</template>
