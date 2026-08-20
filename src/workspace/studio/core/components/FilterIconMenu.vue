<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { m } from "@/paraglide/messages.js"
import HeaderActionDropdownTooltip from "./HeaderActionDropdownTooltip.vue"

export interface FilterIconMenuOption {
  key: string
  label: string
  count: number
}

export interface FilterIconMenuSection {
  label: string
  options: FilterIconMenuOption[]
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    filters: FilterIconMenuOption[]
    sections?: FilterIconMenuSection[]
    defaultValue?: string
    activeLabel?: string
  }>(),
  {
    defaultValue: "all",
  },
)

const emit = defineEmits<{
  "update:modelValue": [value: string]
}>()

const isFiltered = computed(() => props.modelValue !== props.defaultValue)

const allOptions = computed(() => [
  ...props.filters,
  ...(props.sections ?? []).flatMap((section) => section.options),
])

const activeLabel = computed(
  () =>
    props.activeLabel ??
    allOptions.value.find((filter) => filter.key === props.modelValue)?.label ??
    m.common_filter(),
)

function selectFilter(key: string) {
  emit("update:modelValue", key)
}
</script>

<template>
  <HeaderActionDropdownTooltip
    :label="
      isFiltered
        ? `${m.common_filter()}: ${activeLabel}`
        : m.common_filter()
    "
  >
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button
          variant="headerAction"
          size="icon-header"
          :class="isFiltered ? 'text-foreground' : 'text-muted-foreground'"
          :aria-label="m.common_filter()"
        >
          <AppIcon
            :name="isFiltered ? 'filterRemove' : 'filter'"
            class="size-3.5 shrink-0"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-44">
        <DropdownMenuItem
          v-for="filter in props.filters"
          :key="filter.key"
          @select.prevent="selectFilter(filter.key)"
        >
          <span class="flex-1 truncate">{{ filter.label }}</span>
          <span class="tabular-nums text-muted-foreground/50">
            {{ filter.count }}
          </span>
        </DropdownMenuItem>

        <template v-for="section in props.sections ?? []" :key="section.label">
          <DropdownMenuLabel>{{ section.label }}</DropdownMenuLabel>
          <DropdownMenuItem
            v-for="filter in section.options"
            :key="filter.key"
            @select.prevent="selectFilter(filter.key)"
          >
            <span class="flex-1 truncate">{{ filter.label }}</span>
            <span class="tabular-nums text-muted-foreground/50">
              {{ filter.count }}
            </span>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>
  </HeaderActionDropdownTooltip>
</template>
