<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { PropField, PropValue } from "../../../../shared/composer/types"
import { datePropExpression } from "../../../../shared/composer/layoutAuthoring"
import {
  commitBooleanValue,
  commitStringValue,
  isBooleanChecked,
  stringFieldDisplay,
} from "./propValueCodec"

const props = defineProps<{
  field: PropField
  value: PropValue | undefined
  disabled?: boolean
  /** Prefer bare boolean attrs (HTML elements). */
  preferBareBoolean?: boolean
}>()

const emit = defineEmits<{
  change: [value: PropValue | undefined, immediate: boolean]
}>()

const display = computed(() => stringFieldDisplay(props.value))
const draft = ref(display.value.text)
const focused = ref(false)

const fieldId = computed(() => `composer-prop-${props.field.name.replace(/[^a-z0-9_-]/gi, "-")}`)
const fieldLabel = computed(() => humanizeLabel(props.field.name))

function humanizeLabel(value: string): string {
  const acronyms: Record<string, string> = {
    aria: "ARIA",
    cms: "CMS",
    css: "CSS",
    html: "HTML",
    id: "ID",
    url: "URL",
  }
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  return words.map((word, index) => {
    const normalized = word.toLowerCase()
    if (acronyms[normalized]) return acronyms[normalized]
    return index === 0
      ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
      : normalized
  }).join(" ")
}

function optionLabel(value: string): string {
  const known: Record<string, string> = {
    _blank: "New tab",
    _parent: "Parent frame",
    _self: "Current tab",
    _top: "Top frame",
  }
  return known[value] ?? humanizeLabel(value)
}

watch(
  () => [props.field.name, display.value.text, display.value.isExpr] as const,
  () => {
    if (!focused.value) draft.value = display.value.text
  },
)

const placeholder = computed(() =>
  props.field.default !== undefined ? String(props.field.default) : "",
)
const enumUnsetLabel = computed(() => props.field.default !== undefined
  ? optionLabel(String(props.field.default))
  : "Not set")

const longString = computed(() => {
  const name = props.field.name
  return (
    draft.value.length > 48 ||
    /text|description|content|body|paragraph|class/i.test(name)
  )
})

const enumOptions = computed(() => {
  const opts = [...(props.field.options ?? [])]
  const raw =
    props.value && "value" in props.value ? String(props.value.value) : undefined
  if (raw && !opts.includes(raw)) opts.unshift(raw)
  return opts
})

const enumModel = computed({
  get() {
    const defaultStr =
      props.field.default !== undefined ? String(props.field.default) : undefined
    const raw =
      props.value && "value" in props.value
        ? String(props.value.value)
        : undefined
    if (raw === undefined || raw === defaultStr) return "__unset__"
    return raw
  },
  set(v: string) {
    if (v === "__unset__") {
      emit("change", undefined, true)
      return
    }
    emit("change", { type: "string", value: v }, true)
  },
})

const boolChecked = computed({
  get: () =>
    isBooleanChecked(
      props.value,
      typeof props.field.default === "boolean"
        ? props.field.default
        : undefined,
    ),
  set(checked: boolean) {
    emit(
      "change",
      commitBooleanValue(
        props.value,
        checked,
        props.preferBareBoolean ?? false,
      ),
      true,
    )
  },
})

function onStringInput(next: string | number) {
  const text = String(next)
  draft.value = text
  // Opaque kinds (spread / shorthand) are read-only in the inspector.
  if (display.value.opaque) return
  // Always go through commitStringValue so template-literal stays
  // template-literal (do not coerce expr-looking displays to expr).
  emit("change", commitStringValue(props.value, text), false)
}

function onNumberInput(next: string | number) {
  const text = String(next).trim()
  draft.value = text
  if (text === "") {
    emit("change", undefined, false)
    return
  }
  emit("change", { type: "expr", value: text }, false)
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0")
}

function toDateInputValue(value: Date): string {
  return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`
}

function dateInputValue(value: PropValue | undefined): string {
  if (value?.type !== "expr") return ""
  const quoted = value.value.match(/new\s+Date\s*\(\s*['"]([^'"]+)['"]\s*\)/)
  if (!quoted) return ""
  const parsed = new Date(quoted[1]!)
  if (Number.isNaN(parsed.getTime())) return ""
  return toDateInputValue(parsed)
}

function onDateInput(next: string | number) {
  const text = String(next).trim()
  draft.value = text
  if (!text) {
    emit("change", undefined, true)
    return
  }
  emit("change", { type: "expr", value: datePropExpression(text) }, true)
}

function onBlur() {
  focused.value = false
  draft.value = display.value.text
}
</script>

<template>
  <Label v-if="field.type === 'boolean'" class="flex min-h-8 items-center justify-between gap-2 text-xs">
    <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
      {{ fieldLabel }}
    </span>
    <Switch
      :model-value="boolChecked"
      :disabled="disabled || display.opaque"
      :aria-label="fieldLabel"
      @update:model-value="boolChecked = Boolean($event)"
    />
  </Label>

  <div
    v-else
    class="grid grid-cols-[68px_minmax(0,1fr)] gap-2"
    :class="longString ? 'items-start' : 'items-center'"
  >
    <Label
      :for="field.type === 'enum' ? undefined : fieldId"
      class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
      :class="longString ? 'pt-2' : undefined"
    >
      {{ fieldLabel }}
    </Label>

    <Select
      v-if="field.type === 'enum' && enumOptions.length"
      v-model="enumModel"
      :disabled="disabled || display.opaque"
    >
      <SelectTrigger class="h-8 w-full text-xs" :aria-label="fieldLabel">
        <SelectValue :placeholder="enumUnsetLabel" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__unset__">
          <span class="text-muted-foreground">{{ enumUnsetLabel }}</span>
        </SelectItem>
        <SelectItem v-for="opt in enumOptions" :key="opt" :value="opt">
          {{ optionLabel(opt) }}
        </SelectItem>
      </SelectContent>
    </Select>

    <Input
      v-else-if="field.type === 'number'"
      :id="fieldId"
      type="number"
      step="any"
      class="h-8 text-xs"
      :model-value="draft"
      :placeholder="placeholder"
      :disabled="disabled || display.opaque"
      @focus="focused = true"
      @blur="onBlur"
      @update:model-value="onNumberInput"
    />

    <Input
      v-else-if="field.type === 'date'"
      :id="fieldId"
      type="date"
      class="h-8 text-xs"
      :model-value="dateInputValue(value) || draft"
      :disabled="disabled || display.opaque"
      @update:model-value="onDateInput"
    />

    <Textarea
      v-else-if="longString"
      :id="fieldId"
      class="min-h-16 text-xs"
      :model-value="draft"
      :placeholder="placeholder"
      :disabled="disabled || display.opaque"
      @focus="focused = true"
      @blur="onBlur"
      @update:model-value="onStringInput"
    />

    <Input
      v-else
      :id="fieldId"
      class="h-8 text-xs"
      :model-value="draft"
      :placeholder="placeholder"
      :disabled="disabled || display.opaque"
      spellcheck="false"
      @focus="focused = true"
      @blur="onBlur"
      @update:model-value="onStringInput"
    />
  </div>
</template>
