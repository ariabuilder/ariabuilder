<script setup lang="ts">
import { AGENT_COMPOSER_MODE_DEFINITIONS } from "../lib/composerMode"
import type { AgentComposerMode } from "../../../../shared/agent"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import type { AppIconName } from "@/icons/registry"
import { HeaderActionTooltip } from "@/workspace/studio/core"

const MODE_ICONS: Record<AgentComposerMode, AppIconName> = {
  agent: "sparkles",
  ask: "help",
}

defineProps<{
  modelValue: AgentComposerMode
  disabled?: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  "update:modelValue": [value: AgentComposerMode]
}>()
</script>

<template>
  <div
    v-if="compact"
    class="flex shrink-0 items-center"
    role="group"
    aria-label="Composer mode"
  >
    <HeaderActionTooltip
      v-for="mode in AGENT_COMPOSER_MODE_DEFINITIONS"
      :key="mode.id"
      :label="mode.label"
      side="top"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="bg-background dark:bg-sidebar"
        :disabled="disabled"
        :aria-pressed="modelValue === mode.id"
        :aria-label="mode.label"
        :class="
          modelValue === mode.id
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        "
        @click="emit('update:modelValue', mode.id)"
      >
        <AppIcon :name="MODE_ICONS[mode.id]" :size="13" aria-hidden="true" />
      </Button>
    </HeaderActionTooltip>
  </div>

  <div
    v-else
    class="grid shrink-0 grid-cols-2 rounded-none border border-dashed border-border border-t-0 bg-background"
    role="group"
    aria-label="Composer mode"
  >
    <button
      v-for="mode in AGENT_COMPOSER_MODE_DEFINITIONS"
      :key="mode.id"
      type="button"
      class="h-8 min-w-[3.25rem] cursor-pointer rounded-none px-3 text-xs font-normal transition-colors disabled:pointer-events-none disabled:opacity-50"
      :class="
        modelValue === mode.id
          ? 'bg-input/70 text-primary'
          : 'text-muted-foreground hover:text-primary'
      "
      :disabled="disabled"
      :aria-pressed="modelValue === mode.id"
      :title="mode.description"
      @click="emit('update:modelValue', mode.id)"
    >
      {{ mode.label }}
    </button>
  </div>
</template>
