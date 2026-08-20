<script setup lang="ts">
import { computed, nextTick, ref } from "vue"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { AppIcon } from "@/components/ui/app-icon"
import type { AgentComposerMode, InferenceBackendId } from "../../../../shared/agent"
import { getComposerModeDefinition } from "../lib/composerMode"
import AgentModePicker from "./AgentModePicker.vue"
import AgentModelPicker, {
  type AgentModelOption,
} from "./AgentModelPicker.vue"

const props = defineProps<{
  draft: string
  disabled?: boolean
  streaming?: boolean
  error?: string | null
  compact?: boolean
  composerMode: AgentComposerMode
  inferenceProvider?: InferenceBackendId
  modelId?: string
  models: AgentModelOption[]
}>()

const emit = defineEmits<{
  "update:draft": [value: string]
  send: []
  stop: []
  "update:composerMode": [mode: AgentComposerMode]
  "update:model": [provider: InferenceBackendId, modelId: string]
}>()

const composerInputRef = ref<InstanceType<typeof Textarea> | null>(null)

const placeholder = computed(
  () => getComposerModeDefinition(props.composerMode).placeholder,
)

const canSend = computed(
  () =>
    !props.disabled && props.draft.trim().length > 0 && !props.streaming,
)

function composerTextareaEl(): HTMLTextAreaElement | null {
  const el = composerInputRef.value?.$el
  return el instanceof HTMLTextAreaElement ? el : null
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && props.streaming) {
    event.preventDefault()
    emit("stop")
    return
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault()
    if (props.streaming) emit("stop")
    else if (canSend.value) emit("send")
  }
}

defineExpose({
  focusInput: async () => {
    await nextTick()
    composerTextareaEl()?.focus()
  },
})
</script>

<template>
  <div
    :class="[
      'border-t border-dashed border-border bg-background dark:bg-sidebar',
      compact ? 'p-0' : 'p-3',
    ]"
  >
    <p v-if="error" class="mb-2 text-xs text-destructive">{{ error }}</p>

    <div
      class="agent-composer-card overflow-hidden bg-input transition-shadow focus-within:border-border focus-within:ring-1 focus-within:ring-ring/40"
    >
      <div class="relative">
        <Textarea
          ref="composerInputRef"
          :model-value="draft"
          rows="2"
          :class="[
            'max-h-40 w-full resize-none overflow-y-auto rounded-none border-0! bg-background dark:bg-sidebar! text-xs! font-normal! text-foreground shadow-none! outline-none placeholder:text-muted-foreground/70 hover:bg-transparent! focus-visible:border-0! focus-visible:bg-transparent! focus-visible:ring-0!',
            compact
              ? 'min-h-16! px-3 py-2.5 pr-10'
              : 'min-h-18! px-3 py-2.5 pr-10',
          ]"
          :disabled="disabled && !streaming"
          :placeholder="placeholder"
          @update:model-value="emit('update:draft', String($event))"
          @keydown="handleKeydown"
        />

        <div :class="['absolute right-2', compact ? 'bottom-1.5' : 'bottom-2']">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            :disabled="!canSend && !streaming"
            :class="streaming ? 'text-destructive' : ''"
            :aria-label="streaming ? 'Stop generation' : 'Send message'"
            @click="streaming ? emit('stop') : emit('send')"
          >
            <AppIcon
              :name="streaming ? 'element' : 'arrowUp'"
              class="size-3.5 shrink-0"
            />
          </Button>
        </div>
      </div>

      <div
        v-if="!compact"
        class="flex min-w-0 items-center gap-1 border-t border-dashed border-border px-2 py-1.5"
      >
        <div class="ml-auto flex min-w-0 items-center gap-2">
          <AgentModePicker
            :model-value="composerMode"
            :disabled="disabled"
            @update:model-value="emit('update:composerMode', $event)"
          />
          <AgentModelPicker
            :models="models"
            :active-provider="inferenceProvider"
            :active-model-id="modelId"
            :disabled="disabled"
            @select-model="(provider, model) => emit('update:model', provider, model)"
          />
        </div>
      </div>

      <div
        v-else
        class="flex h-10 min-w-0 items-center gap-1 border-t border-dashed border-border bg-background dark:bg-sidebar px-1.5 pb-0.5"
      >
        <AgentModePicker
          compact
          :model-value="composerMode"
          :disabled="disabled"
          @update:model-value="emit('update:composerMode', $event)"
        />
        <div class="min-w-0 flex-1">
          <AgentModelPicker
            compact
            :models="models"
            :active-provider="inferenceProvider"
            :active-model-id="modelId"
            :disabled="disabled"
            @select-model="(provider, model) => emit('update:model', provider, model)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
