<script setup lang="ts">
import { AppIcon } from "@/components/ui/app-icon"
import { m } from "@/paraglide/messages.js"

defineProps<{
  reason?: string | null
  /** Whether the Code surface is available for recovery. */
  enabled?: boolean
}>()
</script>

<template>
  <div
    class="flex shrink-0 items-start gap-2.5 border-b border-dashed border-amber-500/30 bg-amber-500/5 px-3 py-2"
    data-aria-composer-code-fallback
    :data-enabled="enabled ? '1' : '0'"
  >
    <AppIcon
      name="code"
      :size="14"
      class="mt-0.5 shrink-0 text-amber-700 dark:text-amber-400"
    />
    <div class="min-w-0 flex-1 space-y-0.5">
      <p class="text-xs font-medium text-foreground">
        {{ m.composer_code_fallback_title() }}
        <span
          v-if="!enabled"
          class="ml-1.5 font-normal text-muted-foreground"
        >
          · {{ m.composer_code_fallback_disabled() }}
        </span>
      </p>
      <p class="text-[11px] leading-relaxed text-muted-foreground">
        {{ reason || m.composer_code_fallback_body() }}
      </p>
    </div>
  </div>
</template>
