<script setup lang="ts">
import { computed } from "vue"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type CollectionTemplatePageOption = {
  file: string
  route: string
  label?: string
}

const props = withDefaults(
  defineProps<{
    label: string
    description: string
    pageFile?: string
    pageOptions: readonly CollectionTemplatePageOption[]
    pathHint?: string
    disabled?: boolean
  }>(),
  {
    pageFile: "",
    pathHint: "",
    disabled: false,
  },
)

const emit = defineEmits<{
  "update:pageFile": [value: string]
}>()

const isConfigured = computed(() => Boolean(props.pageFile.trim()))
const selectedLabel = computed(() => {
  const file = props.pageFile.trim()
  if (!file) return "Not set"
  const match = props.pageOptions.find((option) => option.file === file)
  return match?.label || match?.route || file
})
</script>

<template>
  <div
    class="grid gap-3 rounded-lg border border-dashed border-border/80 bg-muted/20 p-4"
    data-testid="collection-template-card"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="grid min-w-0 gap-1">
        <Label class="text-sm font-medium">{{ label }}</Label>
        <p class="m-0 text-xs leading-snug text-muted-foreground">
          {{ description }}
        </p>
      </div>
      <Badge :variant="isConfigured ? 'secondary' : 'outline'" class="shrink-0">
        {{ isConfigured ? "Configured" : "Not set" }}
      </Badge>
    </div>

    <Select
      :model-value="pageFile || '__none__'"
      :disabled="disabled"
      @update:model-value="
        emit('update:pageFile', $event === '__none__' ? '' : String($event ?? ''))
      "
    >
      <SelectTrigger class="w-full">
        <SelectValue :placeholder="selectedLabel" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">None</SelectItem>
        <SelectItem
          v-for="option in pageOptions"
          :key="option.file"
          :value="option.file"
        >
          <span class="font-mono text-xs">{{ option.route }}</span>
          <span class="ml-2 text-muted-foreground">{{ option.file }}</span>
        </SelectItem>
      </SelectContent>
    </Select>

    <p
      v-if="pathHint"
      class="m-0 font-mono text-2xs text-muted-foreground"
    >
      {{ pathHint }}
    </p>
  </div>
</template>
