<script setup lang="ts">
import type { EntryFieldWidth } from "../../../../../shared/cms"
import { m } from "@/paraglide/messages.js"
import { CMS_ENTRY_FIELD_WIDTH_OPTIONS } from "../lib/entryFieldWidth"

const props = withDefaults(
  defineProps<{
    modelValue: EntryFieldWidth
    disabled?: boolean
  }>(),
  {
    disabled: false,
  },
)

const emit = defineEmits<{
  "update:modelValue": [value: EntryFieldWidth]
}>()

const widthLabels: Record<(typeof CMS_ENTRY_FIELD_WIDTH_OPTIONS)[number]["labelKey"], string> = {
  full: m.cms_field_width_full(),
  half: m.cms_field_width_half(),
  third: m.cms_field_width_third(),
  quarter: m.cms_field_width_quarter(),
}

function selectWidth(width: EntryFieldWidth): void {
  if (!props.disabled) {
    emit("update:modelValue", width)
  }
}
</script>

<template>
  <fieldset class="grid gap-2">
    <legend class="text-sm text-muted-foreground">
      {{ m.cms_field_width() }}
    </legend>
    <div
      class="grid grid-cols-4 overflow-hidden rounded-md border border-border"
      role="radiogroup"
      :aria-label="m.cms_field_width()"
    >
      <button
        v-for="option in CMS_ENTRY_FIELD_WIDTH_OPTIONS"
        :key="option.value"
        type="button"
        role="radio"
        :aria-checked="modelValue === option.value"
        :disabled="disabled"
        :class="[
          'grid min-w-0 gap-0.5 border-r border-border px-2 py-2 text-center transition-colors last:border-r-0 disabled:cursor-not-allowed disabled:opacity-50',
          modelValue === option.value
            ? 'bg-primary/15 text-primary'
            : 'bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        ]"
        @click="selectWidth(option.value)"
      >
        <span class="text-xs font-medium leading-none">
          {{ widthLabels[option.labelKey] }}
        </span>
        <span class="text-[10px] leading-none opacity-70">
          {{ option.fraction }}
        </span>
      </button>
    </div>
    <p class="m-0 text-[11px] leading-4 text-muted-foreground">
      {{ m.cms_field_width_description() }}
    </p>
  </fieldset>
</template>
