<script setup lang="ts">
import { computed, ref } from "vue"
import { Button } from "@/components/ui/button"
import { AppIcon } from "@/components/ui/app-icon"
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
import {
  getInferenceBackendDefinition,
  type InferenceBackendId,
} from "../../../../shared/agent"
import { useAgentPanel } from "../composables/useAgentPanel"

export type AgentModelOption = {
  provider: InferenceBackendId
  modelId: string
  label: string
}

const props = defineProps<{
  models: AgentModelOption[]
  activeProvider?: InferenceBackendId
  activeModelId?: string
  disabled?: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  selectModel: [provider: InferenceBackendId, modelId: string]
}>()

const panel = useAgentPanel()
const isOpen = ref(false)

const groupedModels = computed(() => {
  const groups = new Map<
    InferenceBackendId,
    { backendId: InferenceBackendId; label: string; models: AgentModelOption[] }
  >()
  for (const model of props.models) {
    let group = groups.get(model.provider)
    if (!group) {
      group = {
        backendId: model.provider,
        label: getInferenceBackendDefinition(model.provider).label,
        models: [],
      }
      groups.set(model.provider, group)
    }
    group.models.push(model)
  }
  return Array.from(groups.values())
})

const effectiveSelection = computed(() => {
  if (
    props.activeProvider &&
    props.activeModelId &&
    props.models.some(
      (model) =>
        model.provider === props.activeProvider &&
        model.modelId === props.activeModelId,
    )
  ) {
    return {
      provider: props.activeProvider,
      modelId: props.activeModelId,
    }
  }

  const first = props.models[0]
  if (!first) return null
  return { provider: first.provider, modelId: first.modelId }
})

const selectedModelLabel = computed(() => {
  const active = effectiveSelection.value
  if (!active) return "Select model"
  const match = props.models.find(
    (model) =>
      model.provider === active.provider && model.modelId === active.modelId,
  )
  return match?.label ?? active.modelId
})

function handleSelectModel(provider: InferenceBackendId, modelId: string) {
  emit("selectModel", provider, modelId)
  isOpen.value = false
}

function openSettings() {
  isOpen.value = false
  panel.closePanel()
  panel.openAgentSettings()
}
</script>

<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        :class="
          compact
            ? 'h-7 w-full min-w-0 justify-start gap-0 px-1.5 text-xs font-normal text-muted-foreground hover:text-foreground'
            : 'h-7 max-w-[240px] min-w-0 justify-start gap-0 px-3 text-xs font-normal text-muted-foreground hover:text-foreground'
        "
        :disabled="disabled || groupedModels.length === 0"
      >
        <span :class="compact ? 'min-w-0 truncate text-left' : 'ml-2 truncate text-left'">{{ selectedModelLabel }}</span>
        <AppIcon name="chevronDown" class="ml-auto size-3 shrink-0 opacity-60" />
      </Button>
    </PopoverTrigger>

    <PopoverContent
      class="w-74 -mb-1 ml-1 overflow-hidden! rounded-sm! border-0.5 border-border! p-0"
      align="start"
      :side-offset="6"
    >
      <Command>
        <div
          class="flex items-center gap-0.5 border-b border-dashed border-border pt-1 pr-2.5 pb-1 pl-2.5"
        >
          <CommandInput
            placeholder="Search models…"
            wrapper-class="min-w-0 h-8! min-h-8! flex-1 gap-0 border-0 bg-transparent py-0 pr-0 pl-1 [&>svg]:hidden"
            class="h-8! min-h-8! px-2 py-0 text-xs! caret-foreground placeholder:text-muted-foreground/50"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Open Agent settings"
            @click="openSettings"
          >
            <AppIcon name="settings" class="size-3.5" />
          </Button>
        </div>
        <CommandList>
          <CommandEmpty>No models available</CommandEmpty>
          <CommandGroup
            v-for="group in groupedModels"
            :key="group.backendId"
            :heading="group.label"
          >
            <CommandItem
              v-for="model in group.models"
              :key="`${group.backendId}:${model.modelId}`"
              :value="`${group.label} ${model.label} ${model.modelId}`"
              @select="handleSelectModel(group.backendId, model.modelId)"
            >
              <span class="mr-2 ml-2.5 truncate">{{ model.label }}</span>
              <AppIcon
                v-if="
                  effectiveSelection?.provider === group.backendId &&
                  effectiveSelection?.modelId === model.modelId
                "
                name="lightning"
                class="mr-2.5 ml-auto size-3.5 shrink-0 text-primary"
              />
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
