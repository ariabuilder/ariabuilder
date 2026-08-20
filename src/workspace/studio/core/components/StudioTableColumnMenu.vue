<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { m } from "@/paraglide/messages.js"
import { getStudioTableColumnLabel } from "../lib/studioTableHeader"
import HeaderActionDropdownTooltip from "./HeaderActionDropdownTooltip.vue"

export interface StudioTableColumnMenuColumn {
  id: string
  columnDef: {
    header?: unknown
  }
  getIsVisible: () => boolean
  toggleVisibility: () => void
}

const props = withDefaults(
  defineProps<{
    columns: readonly StudioTableColumnMenuColumn[]
    lockedColumnIds?: readonly string[]
    label?: string
    contentClass?: string
  }>(),
  {
    lockedColumnIds: () => [],
    contentClass: "w-36",
  },
)

const emit = defineEmits<{
  reorder: [columns: StudioTableColumnMenuColumn[]]
}>()

const tooltipLabel = computed(() => props.label ?? m.studio_columns())

const menuColumns = ref<StudioTableColumnMenuColumn[]>([])
const lockedColumnIdSet = computed(() => new Set(props.lockedColumnIds))

watch(
  () => props.columns,
  (columns) => {
    menuColumns.value = [...columns]
  },
  { immediate: true },
)

function isColumnLocked(column: StudioTableColumnMenuColumn): boolean {
  return lockedColumnIdSet.value.has(column.id)
}

function toggleColumn(column: StudioTableColumnMenuColumn): void {
  if (isColumnLocked(column)) {
    return
  }

  column.toggleVisibility()
}

function moveColumn(index: number, direction: -1 | 1): void {
  const next = index + direction
  if (next < 0 || next >= menuColumns.value.length) return
  const copy = [...menuColumns.value]
  const [item] = copy.splice(index, 1)
  copy.splice(next, 0, item)
  menuColumns.value = copy
  emit("reorder", [...menuColumns.value])
}
</script>

<template>
  <HeaderActionDropdownTooltip :label="tooltipLabel">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button
          variant="headerAction"
          size="icon-header"
          :aria-label="tooltipLabel"
        >
          <AppIcon name="columns" :size="14" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" :class="contentClass">
        <div
          v-for="(column, index) in menuColumns"
          :key="column.id"
          role="menuitemcheckbox"
          :aria-checked="column.getIsVisible()"
          tabindex="-1"
          class="group relative flex cursor-pointer select-none items-center gap-2 rounded-none border-b border-dashed border-border/50 px-3 py-2 text-xs text-muted-foreground outline-hidden transition-colors last:border-0 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground dark:hover:bg-muted dark:focus:bg-muted"
          @click="toggleColumn(column)"
        >
          <button
            type="button"
            class="mr-0.5 inline-flex size-3.5 shrink-0 items-center justify-center text-muted-foreground opacity-40 hover:opacity-100"
            :aria-label="m.studio_column_move_up()"
            :disabled="index === 0"
            @click.stop="moveColumn(index, -1)"
          >
            <AppIcon name="chevronUp" :size="12" />
          </button>
          <AppIcon
            v-if="column.getIsVisible()"
            name="checkLinear"
            :size="14"
            class="mr-0.5 text-primary"
          />
          <span v-else class="mr-0.5 w-3.5" />
          <span class="min-w-0 flex-1 truncate">
            {{ getStudioTableColumnLabel(column) }}
          </span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  </HeaderActionDropdownTooltip>
</template>
