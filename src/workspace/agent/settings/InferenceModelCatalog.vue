<script setup lang="ts">
import { computed, ref, useId } from "vue"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { AppIcon } from "@/components/ui/app-icon"
import type { CatalogModel } from "../../../../shared/agent"

const props = defineProps<{
  models: CatalogModel[]
  enabledModelIds: string[]
  defaultModelId?: string
  siteDefaultModelId?: string
  canEdit?: boolean
  disabled?: boolean
  loading?: boolean
  error?: string | null
  needsCredentials?: boolean
}>()

const emit = defineEmits<{
  toggleModel: [modelId: string, enabled: boolean]
  setDefault: [modelId: string]
}>()

const query = ref("")
const searchId = useId()

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[-_/]+/g, " ")
}

const filteredModels = computed(() => {
  const q = normalizeSearchText(query.value.trim())
  if (!q) return props.models
  return props.models.filter((model) => {
    const haystack = normalizeSearchText(`${model.name} ${model.id}`)
    return haystack.includes(q)
  })
})

const enabledCount = computed(() =>
  props.models.reduce(
    (count, model) => count + (props.enabledModelIds.includes(model.id) ? 1 : 0),
    0,
  ),
)

function isEnabled(modelId: string): boolean {
  return props.enabledModelIds.includes(modelId)
}

const emptyMessage = computed(() => {
  if (props.loading) return ""
  if (props.needsCredentials) return "Add an API key to browse models."
  if (props.error) return props.error
  if (query.value.trim()) return "No models match your search."
  return "No models available yet."
})
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-3">
      <h4 class="m-0 text-sm font-medium">Models</h4>
      <span class="text-xs text-muted-foreground" role="status">
        {{ enabledCount }} active
      </span>
    </div>

    <div>
      <label :for="searchId" class="sr-only">Search models</label>
      <Input
        :id="searchId"
        v-model="query"
        name="aria-model-catalog-search"
        autocomplete="off"
        placeholder="Search models…"
        class="h-9 bg-background text-xs"
        :disabled="disabled || loading"
      />
    </div>

    <ul
      v-if="loading"
      class="max-h-80 divide-y divide-border/40 overflow-y-auto rounded-lg border border-border/50 bg-background"
    >
      <li
        v-for="n in 5"
        :key="n"
        class="flex min-h-14 items-center gap-3 px-3 py-2"
      >
        <Skeleton class="size-3.5 shrink-0 rounded-full" />
        <span class="min-w-0 flex-1 space-y-1">
          <Skeleton class="h-3 w-2/3" />
          <Skeleton class="h-2.5 w-1/2" />
        </span>
        <Skeleton class="h-5 w-8 shrink-0 rounded-full" />
      </li>
    </ul>

    <div
      v-else-if="filteredModels.length === 0"
      class="rounded-lg border border-dashed border-border/50 bg-background px-3 py-5 text-center text-xs"
      :class="error ? 'text-destructive' : 'text-muted-foreground'"
    >
      {{ emptyMessage }}
    </div>

    <ul
      v-else
      class="max-h-80 divide-y divide-border/40 overflow-y-auto rounded-lg border border-border/50 bg-background"
    >
      <li
        v-for="model in filteredModels"
        :key="model.id"
        class="flex min-h-14 items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/30"
      >
        <button
          type="button"
          class="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canEdit || disabled || !isEnabled(model.id)"
          :aria-label="`Set ${model.name} as site default`"
          :aria-pressed="siteDefaultModelId === model.id"
          @click="emit('setDefault', model.id)"
        >
          <AppIcon
            name="star"
            :size="16"
            :class="
              siteDefaultModelId === model.id
                ? 'text-primary'
                : 'text-muted-foreground/50'
            "
          />
        </button>

        <span class="min-w-0 flex-1 space-y-0.5">
          <span class="flex min-w-0 items-center gap-2">
            <span class="truncate text-xs font-medium">{{ model.name }}</span>
            <span
              v-if="siteDefaultModelId === model.id"
              class="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary"
            >
              Default
            </span>
          </span>
          <span class="block truncate text-[10px] text-muted-foreground">
            {{ model.id }}
          </span>
        </span>

        <Switch
          :model-value="isEnabled(model.id)"
          :disabled="!canEdit || disabled"
          :aria-label="`Use ${model.name}`"
          @update:model-value="emit('toggleModel', model.id, Boolean($event))"
        />
      </li>
    </ul>
  </div>
</template>
