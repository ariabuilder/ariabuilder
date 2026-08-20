<script setup lang="ts">
import { computed, ref } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ConditionSourceOption } from "../../../../shared/conditions"

const props = defineProps<{
  modelValue: string
  sources: readonly ConditionSourceOption[]
  disabled?: boolean
  label?: string
  describedBy?: string
}>()

const emit = defineEmits<{ "update:modelValue": [value: string] }>()
const open = ref(false)
const search = ref("")

const groups = ["Component", "Content", "Page", "Site", "Visitor", "Browser"] as const
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return props.sources
  return props.sources.filter((source) => `${source.label} ${source.group} ${source.description ?? ""}`.toLowerCase().includes(query))
})
const selected = computed(() => props.sources.find((source) => sourceKey(source) === props.modelValue) ?? null)

function sourceKey(source: ConditionSourceOption): string {
  return encodeURIComponent(JSON.stringify(source.source))
}

function select(source: ConditionSourceOption) {
  emit("update:modelValue", sourceKey(source))
  open.value = false
  search.value = ""
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="outline"
        class="h-8 min-w-0 justify-between rounded-sm bg-input px-2 text-left text-xs font-normal"
        :disabled="disabled"
        :aria-label="label ?? 'Choose what to check'"
        :aria-describedby="describedBy"
      >
        <span class="truncate">{{ selected?.label ?? "Choose source" }}</span>
        <AppIcon name="chevronDown" :size="12" class="shrink-0 opacity-60" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-64 p-0" :side-offset="5">
      <Command>
        <CommandInput v-model="search" placeholder="Search conditions…" />
        <CommandList class="max-h-72">
          <CommandEmpty>No matching sources</CommandEmpty>
          <CommandGroup v-for="group in groups" :key="group" :heading="group">
            <CommandItem
              v-for="source in filtered.filter((item) => item.group === group)"
              :key="sourceKey(source)"
              :value="`${source.label} ${source.group}`"
              class="flex-col items-start gap-0.5"
              @pointerdown.prevent="select(source)"
              @select="select(source)"
            >
              <span>{{ source.label }}</span>
              <span v-if="source.description" class="text-[10px] text-muted-foreground">{{ source.description }}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
