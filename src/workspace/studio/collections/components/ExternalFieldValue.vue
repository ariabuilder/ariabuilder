<script setup lang="ts">
import { computed } from "vue"
import { formatExternalFieldValue } from "../../../../../shared/externalCollectionEntries"
import type { FieldType } from "../../../../../shared/cms"

defineOptions({ name: "ExternalFieldValue" })

const props = withDefaults(defineProps<{
  value: unknown
  type?: FieldType
  depth?: number
}>(), {
  type: undefined,
  depth: 0,
})

const isArray = computed(() => Array.isArray(props.value))
const isObject = computed(() =>
  Boolean(props.value) && typeof props.value === "object" && !isArray.value,
)
const objectEntries = computed(() =>
  isObject.value ? Object.entries(props.value as Record<string, unknown>) : [],
)
</script>

<template>
  <span v-if="depth >= 8" class="text-muted-foreground">Depth limited</span>
  <ul v-else-if="isArray" class="space-y-2">
    <li
      v-for="(item, index) in value as unknown[]"
      :key="index"
      class="rounded-md bg-muted/25 px-3 py-2"
    >
      <ExternalFieldValue :value="item" :depth="depth + 1" />
    </li>
  </ul>
  <dl v-else-if="isObject" class="space-y-2">
    <div
      v-for="([key, child]) in objectEntries"
      :key="key"
      class="grid min-w-0 gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4"
    >
      <dt class="break-words text-xs text-muted-foreground">{{ key }}</dt>
      <dd class="min-w-0 break-words text-sm">
        <ExternalFieldValue :value="child" :depth="depth + 1" />
      </dd>
    </div>
  </dl>
  <span v-else class="break-words">{{ formatExternalFieldValue(value, type) }}</span>
</template>

