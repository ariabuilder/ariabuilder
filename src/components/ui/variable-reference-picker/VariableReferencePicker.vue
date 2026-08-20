<script setup lang="ts">
import { computed } from "vue"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  extractVariableReferenceKey,
  type VariableReferenceOption,
} from "@/workspace/design/lib/variableReferences"
import { m } from "@/paraglide/messages.js"

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: readonly VariableReferenceOption[]
    isLoading?: boolean
    pickerPlaceholder?: string
    showDirectValue?: boolean
    previewByKey?: Record<string, string>
    /** Flat chrome for embedding inside ColorPicker (no -m-px / row dashed borders). */
    embedded?: boolean
  }>(),
  {
    isLoading: false,
    pickerPlaceholder: "",
    showDirectValue: true,
    previewByKey: undefined,
    embedded: false,
  },
)

const commandRootClass = computed(() =>
  props.embedded ? "rounded-none bg-transparent shadow-none" : "rounded-md",
)

const commandInputWrapperClass =
  "m-0 h-9! gap-2 border-0 border-b border-dashed border-border bg-sidebar px-3"

const commandItemEmbeddedClass =
  "border-0 border-b border-solid border-border/50 px-3 py-2 last:border-b-0"

function previewForKey(key: string): string | null {
  const preview = props.previewByKey?.[key]?.trim()
  return preview || null
}

const emit = defineEmits<{
  select: [value: string | null]
}>()

const variableKey = computed(() =>
  extractVariableReferenceKey(props.modelValue.trim()),
)

const groupedOptions = computed(() => {
  const groups = new Map<string, VariableReferenceOption[]>()

  for (const option of props.options) {
    const groupName = option.group?.trim() || m.design_variables_group_default()
    const group = groups.get(groupName)
    if (group) {
      group.push(option)
      continue
    }

    groups.set(groupName, [option])
  }

  return Array.from(groups.entries()).map(([heading, options]) => ({
    heading,
    options,
  }))
})

function optionLabel(option: VariableReferenceOption): string {
  return option.label?.trim() || `--${option.value}`
}

function handleSelect(variableKeyValue: string | null): void {
  emit("select", variableKeyValue)
}
</script>

<template>
  <Command :class="commandRootClass">
    <CommandInput
      :placeholder="pickerPlaceholder || m.design_variables_search_placeholder()"
      :wrapper-class="embedded ? commandInputWrapperClass : undefined"
    />
    <CommandList>
      <CommandEmpty>
        {{
          isLoading && options.length === 0
            ? m.design_variables_loading()
            : m.design_variables_no_matches()
        }}
      </CommandEmpty>

      <CommandGroup
        v-if="showDirectValue"
        :heading="m.design_variables_mode()"
        :class="
          groupedOptions.length === 0
            ? '[&>[data-slot=command-item]:last-child]:border-b-0'
            : undefined
        "
      >
        <CommandItem
          :class="[
            'group/direct-value rounded-none',
            embedded ? commandItemEmbeddedClass : undefined,
          ]"
          value="direct-value"
          @select="handleSelect(null)"
        >
          <div class="flex min-w-0 flex-col items-start">
            <span
              class="text-xs text-foreground transition-colors group-hover/direct-value:text-primary group-data-highlighted/direct-value:text-primary-foreground"
              >{{ m.design_variables_use_direct() }}</span
            >
            <span class="text-2xs text-muted-foreground">
              {{ m.design_variables_use_direct_hint() }}
            </span>
          </div>
        </CommandItem>
      </CommandGroup>

      <CommandGroup
        v-for="(group, groupIndex) in groupedOptions"
        :key="group.heading"
        :heading="group.heading"
        :class="
          groupIndex === groupedOptions.length - 1
            ? '[&>[data-slot=command-item]:last-child]:border-b-0'
            : undefined
        "
      >
        <CommandItem
          v-for="option in group.options"
          :key="option.value"
          :class="['rounded-none', embedded ? commandItemEmbeddedClass : undefined]"
          :value="`${optionLabel(option)} ${option.meta ?? ''} ${option.value}`"
          @select="handleSelect(option.value)"
        >
          <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
            <span
              v-if="previewForKey(option.value)"
              class="size-4 shrink-0 rounded-sm border border-border/50"
              :style="{
                backgroundColor: previewForKey(option.value) ?? 'transparent',
              }"
              aria-hidden="true"
            />
            <div class="flex min-w-0 flex-col items-start">
              <span class="truncate text-xs">{{ optionLabel(option) }}</span>
              <span
                v-if="option.meta"
                class="truncate text-2xs text-muted-foreground"
                >{{ option.meta }}</span
              >
            </div>

            <span
              v-if="variableKey === option.value"
              class="size-1.5 shrink-0 rounded-full bg-primary"
            />
          </div>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
</template>
