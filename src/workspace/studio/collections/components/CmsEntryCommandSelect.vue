<script setup lang="ts">
import { computed, ref, toRef, useAttrs, watch } from "vue"
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { getCmsEntry } from "@/lib/cms"
import { useCmsEntriesList } from "../composables/useCmsEntriesList"
import { cmsEntryLabel, cmsEntryLabelFromRecord } from "../lib/cmsEntryLabels"
import type { CmsEntryRow } from "../lib/entryRow"

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(
  defineProps<{
    modelValue?: string
    projectRoot: string
    targetCollection: string
    disabled?: boolean
    placeholder?: string
    emptyLabel?: string
    clearable?: boolean
  }>(),
  {
    modelValue: "",
    disabled: false,
    placeholder: "",
    emptyLabel: "",
    clearable: false,
  },
)

const emit = defineEmits<{
  "update:modelValue": [value: string]
  select: [entry: CmsEntryRow]
  clear: []
}>()

const attrs = useAttrs()
const open = defineModel<boolean>("open", { default: false })

const projectRootRef = toRef(props, "projectRoot")
const targetCollectionId = toRef(props, "targetCollection")

const {
  rows,
  total,
  page,
  totalPages,
  searchQuery,
  isLoading,
  loadError,
  setPage,
} = useCmsEntriesList(projectRootRef, targetCollectionId, open)

const hydratedLabel = ref("")
let hydrateGeneration = 0

const selectedEntry = computed(
  () => rows.value.find((row) => row.id === props.modelValue) ?? null,
)

const triggerLabel = computed(() => {
  if (selectedEntry.value) return cmsEntryLabel(selectedEntry.value)
  if (hydratedLabel.value) return hydratedLabel.value
  if (props.modelValue) return props.modelValue
  return props.placeholder || "Choose entry…"
})

watch(
  () =>
    [props.modelValue, props.projectRoot, props.targetCollection] as const,
  async ([id, root, collectionId]) => {
    const entryId = id.trim()
    const projectRoot = root.trim()
    const targetCollection = collectionId.trim()
    if (!entryId || !projectRoot || !targetCollection) {
      hydratedLabel.value = ""
      return
    }
    const fromRows = rows.value.find((row) => row.id === entryId)
    if (fromRows) {
      hydratedLabel.value = cmsEntryLabel(fromRows)
      return
    }
    const generation = ++hydrateGeneration
    try {
      const record = await getCmsEntry(projectRoot, targetCollection, entryId)
      if (generation !== hydrateGeneration) return
      hydratedLabel.value = record ? cmsEntryLabelFromRecord(record) : ""
    } catch {
      if (generation !== hydrateGeneration) return
      hydratedLabel.value = ""
    }
  },
  { immediate: true },
)

function selectEntry(entry: CmsEntryRow): void {
  hydratedLabel.value = cmsEntryLabel(entry)
  emit("update:modelValue", entry.id)
  emit("select", entry)
  open.value = false
}

function clearSelection(event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
  hydratedLabel.value = ""
  emit("update:modelValue", "")
  emit("clear")
}
</script>

<template>
  <div v-bind="attrs" class="relative min-w-0 w-full">
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button
          type="button"
          variant="outline"
          class="relative h-9! w-full min-w-0 justify-start px-3 text-left text-sm font-normal"
          :disabled="disabled || !targetCollection"
        >
          <span
            :class="[
              'block min-w-0 flex-1 truncate text-left',
              clearable && modelValue ? 'pr-10' : 'pr-6',
            ]"
          >
            {{ triggerLabel }}
          </span>
          <AppIcon
            name="chevronDown"
            :size="14"
            class="absolute right-3 top-1/2 -translate-y-1/2 opacity-60"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        class="w-[var(--reka-popover-trigger-width)] p-0"
        :side-offset="6"
      >
        <Command>
          <CommandInput
            v-model="searchQuery"
            placeholder="Search entries…"
          />
          <CommandList class="max-h-72">
            <CommandEmpty>
              {{ emptyLabel || "No entries found" }}
            </CommandEmpty>
            <CommandGroup>
              <div
                v-if="loadError"
                class="px-3 py-4 text-xs text-destructive"
              >
                {{ loadError }}
              </div>
              <div
                v-else-if="isLoading"
                class="px-3 py-4 text-xs text-muted-foreground"
              >
                Loading…
              </div>
              <CommandItem
                v-for="entry in rows"
                v-else
                :key="entry.id"
                :value="`${entry.title} ${entry.slug} ${entry.id}`"
                class="gap-3"
                @pointerdown.prevent="selectEntry(entry)"
                @click.stop="selectEntry(entry)"
                @select="selectEntry(entry)"
              >
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm text-foreground">
                    {{ entry.title }}
                  </span>
                  <span class="block truncate text-2xs text-muted-foreground">
                    {{ entry.slug }} · {{ entry.status }}
                  </span>
                </span>
                <AppIcon
                  v-if="entry.id === modelValue"
                  name="checkLinear"
                  :size="14"
                  class="shrink-0 text-primary"
                />
              </CommandItem>
            </CommandGroup>
          </CommandList>
          <div
            class="flex items-center justify-between border-t border-dashed border-border/50 px-3 py-2 text-2xs text-muted-foreground"
          >
            <span>{{ total }} entries</span>
            <div v-if="totalPages > 1" class="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="h-7! px-2 text-2xs"
                :disabled="page <= 1 || isLoading"
                @click="setPage(page - 1)"
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="h-7! px-2 text-2xs"
                :disabled="page >= totalPages || isLoading"
                @click="setPage(page + 1)"
              >
                Next
              </Button>
            </div>
          </div>
        </Command>
      </PopoverContent>
    </Popover>

    <Button
      v-if="clearable && modelValue"
      type="button"
      variant="ghost"
      size="icon"
      class="absolute right-7 top-1/2 z-10 size-6! -translate-y-1/2 text-muted-foreground hover:text-foreground"
      :disabled="disabled"
      aria-label="Clear reference"
      title="Clear reference"
      @pointerdown.stop
      @click="clearSelection"
    >
      <AppIcon name="close" :size="14" />
    </Button>
  </div>
</template>
