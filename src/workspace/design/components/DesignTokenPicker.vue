<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { computed, ref } from "vue"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import AppIcon from "@/components/ui/app-icon/AppIcon.vue"
import type { VariableManagerTokenOption } from "../lib/variableManagerTokens"

interface DesignTokenPickerProps {
  modelValue: string | null
  options: readonly VariableManagerTokenOption[]
  placeholder?: string
  triggerClass?: HTMLAttributes["class"]
  contentClass?: HTMLAttributes["class"]
}

const props = withDefaults(defineProps<DesignTokenPickerProps>(), {
  placeholder: "Select token",
  triggerClass: undefined,
  contentClass: undefined,
})

const emit = defineEmits<{
  "update:modelValue": [value: string | null]
}>()

const isOpen = ref(false)
const activeGroup = ref<string>("all")

const selectedOption = computed(
  () =>
    props.options.find((option) => option.value === props.modelValue) ?? null,
)

const groupedOptions = computed(() => {
  const groups = new Map<string, VariableManagerTokenOption[]>()

  for (const option of props.options) {
    const entries = groups.get(option.group)
    if (entries) {
      entries.push(option)
      continue
    }

    groups.set(option.group, [option])
  }

  return Array.from(groups.entries()).map(([heading, options]) => ({
    heading,
    options,
  }))
})

const filterGroups = computed(() => [
  { value: "all", label: m.design_variables_filter_all() },
  ...groupedOptions.value.map((group) => ({
    value: group.heading,
    label: formatGroupLabel(group.heading),
  })),
])

function formatGroupLabel(heading: string): string {
  if (heading === "Palette Tokens") {
    return m.design_variables_token_picker_palette()
  }

  if (heading === "Semantic Tokens") {
    return m.design_variables_token_picker_semantic()
  }

  return heading.replace(/ Tokens$/, "")
}

const visibleGroups = computed(() => {
  if (activeGroup.value === "all") {
    return groupedOptions.value
  }

  return groupedOptions.value.filter(
    (group) => group.heading === activeGroup.value,
  )
})

function updateValue(value: string | null): void {
  emit("update:modelValue", value)
  isOpen.value = false
}
</script>

<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <button
        type="button"
        :class="
          cn(
            'flex h-7! w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-card/50 px-2 text-left text-xs! text-foreground transition-colors hover:border-foreground/20',
            props.triggerClass,
          )
        "
      >
        <span class="flex min-w-0 items-center gap-1.5">
          <span
            v-if="selectedOption"
            class="size-2.5 shrink-0 rounded-full border border-border/50"
            :style="{ backgroundColor: selectedOption.preview }"
          />
          <span class="truncate text-xs text-foreground">
            {{ selectedOption?.label || props.placeholder }}
          </span>
        </span>

        <AppIcon name="search" class="size-3 shrink-0 text-muted-foreground" />
      </button>
    </PopoverTrigger>

    <PopoverContent
      :class="cn('w-72 p-0 text-xs', props.contentClass)"
      align="start"
      :side-offset="4"
    >
      <Command
        class="text-xs [&_[data-slot=command-input-wrapper]]:h-8 [&_[data-slot=command-input-wrapper]]:gap-1.5 [&_[data-slot=command-input-wrapper]]:px-2 [&_[data-slot=command-input-wrapper]_svg]:size-3.5"
      >
        <CommandInput
          :placeholder="m.design_variables_token_picker_search()"
          class="h-8! py-1.5! text-xs!"
        />
        <div
          class="flex flex-wrap gap-1 border-b border-dashed border-border px-2 py-1.5"
        >
          <button
            v-for="group in filterGroups"
            :key="group.value"
            type="button"
            :class="[
              'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors',
              activeGroup === group.value
                ? 'border-foreground/20 bg-foreground text-background'
                : 'border-border bg-background text-muted-foreground hover:text-foreground',
            ]"
            @click="activeGroup = group.value"
          >
            {{ group.label }}
          </button>
        </div>
        <CommandList class="max-h-56">
          <CommandEmpty class="py-4 text-xs">{{
            m.design_variables_token_picker_no_matches()
          }}</CommandEmpty>

          <CommandGroup
            v-for="group in visibleGroups"
            :key="group.heading"
            :heading="formatGroupLabel(group.heading)"
            class="p-0.5 [&_[data-slot=command-group-heading]]:px-2 [&_[data-slot=command-group-heading]]:py-1 [&_[data-slot=command-group-heading]]:text-[10px] [&_[data-slot=command-group-heading]]:font-medium [&_[data-slot=command-group-heading]]:tracking-wider [&_[data-slot=command-group-heading]]:uppercase"
          >
            <CommandItem
              v-for="option in group.options"
              :key="option.value"
              :value="`${option.label} ${option.meta} ${option.value}`"
              class="gap-1.5 px-2 py-1 text-xs"
              @select="updateValue(option.value)"
            >
              <div class="flex min-w-0 items-center gap-2">
                <span
                  class="size-2.5 shrink-0 rounded-full border border-border/50"
                  :style="{ backgroundColor: option.preview }"
                />
                <div class="flex min-w-0 flex-col items-start gap-0 leading-tight">
                  <span class="truncate text-xs font-medium">{{
                    option.label
                  }}</span>
                  <span class="truncate text-[10px] text-muted-foreground">
                    {{ option.meta }}
                  </span>
                </div>
              </div>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
