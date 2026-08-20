<script setup lang="ts">
import BulkSelectionToolbar from "./BulkSelectionToolbar.vue"
import ExpandableSearchInput from "./ExpandableSearchInput.vue"

const props = withDefaults(
  defineProps<{
    count: number
    entityLabel: string
    searchQuery?: string
    searchPlaceholder?: string
    showBulk?: boolean
    showDuplicate?: boolean
    showDelete?: boolean
  }>(),
  {
    searchQuery: "",
    searchPlaceholder: undefined,
    showBulk: true,
    showDuplicate: true,
    showDelete: true,
  },
)

const emit = defineEmits<{
  "update:searchQuery": [value: string]
  duplicate: []
  delete: []
}>()
</script>

<template>
  <div class="inline-flex shrink-0">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 -translate-x-2"
      enter-to-class="opacity-100 translate-x-0"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 translate-x-0"
      leave-to-class="opacity-0 -translate-x-2"
      mode="out-in"
    >
      <BulkSelectionToolbar
        v-if="props.showBulk && props.count > 0"
        key="batch"
        :count="props.count"
        :entity-label="props.entityLabel"
        :show-duplicate="props.showDuplicate"
        :show-delete="props.showDelete"
        @duplicate="emit('duplicate')"
        @delete="emit('delete')"
      >
        <template #actions>
          <slot name="bulk-actions" />
        </template>
      </BulkSelectionToolbar>
      <div v-else key="search">
        <slot name="search">
          <ExpandableSearchInput
            :model-value="props.searchQuery"
            :placeholder="props.searchPlaceholder"
            @update:model-value="emit('update:searchQuery', $event)"
          />
        </slot>
      </div>
    </Transition>
  </div>
</template>
