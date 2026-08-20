<script setup lang="ts">
import type { GitFileChange } from "@/lib/git"
import { Separator } from "@/components/ui/separator"

defineProps<{
  title: string
  files: GitFileChange[]
  emptyLabel: string
  interactive?: boolean
}>()

const emit = defineEmits<{
  select: [path: string]
}>()
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="control-room-eyebrow">{{ title }}</p>
    <p
      v-if="files.length === 0"
      class="text-xs text-muted-foreground"
    >
      {{ emptyLabel }}
    </p>
    <ul
      v-else
      class="max-h-56 overflow-auto border border-dashed"
      style="border-color: var(--cr-frame, var(--border))"
    >
      <li
        v-for="(file, index) in files"
        :key="`${file.code}:${file.path}`"
        class="flex flex-col"
      >
        <button
          v-if="interactive"
          type="button"
          class="flex w-full items-baseline gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/60"
          @click="emit('select', file.path)"
        >
          <span class="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
            {{ file.code }}
          </span>
          <span class="min-w-0 truncate font-mono text-xs">{{ file.path }}</span>
        </button>
        <div
          v-else
          class="flex items-baseline gap-2 px-3 py-1.5"
        >
          <span class="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
            {{ file.code }}
          </span>
          <span class="min-w-0 truncate font-mono text-xs">{{ file.path }}</span>
        </div>
        <Separator v-if="index < files.length - 1" class="opacity-50" />
      </li>
    </ul>
  </div>
</template>
