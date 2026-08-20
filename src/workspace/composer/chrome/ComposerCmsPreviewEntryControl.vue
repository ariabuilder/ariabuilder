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
import type { ComposerCmsEntryTemplatePreviewContext } from "../../../../shared/composer"

const props = defineProps<{
  context: ComposerCmsEntryTemplatePreviewContext
}>()
const emit = defineEmits<{
  select: [entryId: string]
}>()

const open = ref(false)
const selected = computed(() => props.context.entries.find(
  (entry) => entry.id === props.context.selectedEntryId,
) ?? null)

function choose(entryId: string) {
  emit("select", entryId)
  open.value = false
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="h-7 max-w-72 cursor-pointer gap-1.5 border border-dashed border-border/70 px-2 text-[11px] active:scale-[0.96] motion-reduce:transform-none"
        :aria-label="`Preview ${context.collectionLabel} entry: ${selected?.title ?? 'No entry available'}`"
      >
        <AppIcon name="collections" :size="13" class="shrink-0 text-primary" aria-hidden="true" />
        <span class="truncate font-medium">{{ selected?.title ?? context.collectionLabel }}</span>
        <AppIcon name="chevronDown" :size="11" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" side="bottom" :side-offset="5" class="w-80 p-0">
      <Command>
        <CommandInput :placeholder="`Search ${context.collectionLabel} entries`" />
        <CommandList>
          <CommandEmpty>No entries found.</CommandEmpty>
          <CommandGroup :heading="`${context.collectionLabel} preview entry`">
            <CommandItem
              v-for="entry in context.entries"
              :key="entry.id"
              :value="`${entry.title} ${entry.slug} ${entry.status ?? ''}`"
              class="cursor-pointer"
              @select="choose(entry.id)"
            >
              <AppIcon
                :name="entry.id === context.selectedEntryId ? 'check' : 'page'"
                :size="13"
                :class="entry.id === context.selectedEntryId ? 'text-primary' : 'text-muted-foreground'"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-xs">{{ entry.title }}</span>
                <span class="block truncate text-[10px] text-muted-foreground">/{{ entry.slug }}<template v-if="entry.status"> · {{ entry.status }}</template></span>
              </span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
