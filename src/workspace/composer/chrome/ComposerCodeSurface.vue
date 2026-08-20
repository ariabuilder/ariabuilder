<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { m } from "@/paraglide/messages.js"
import ComposerCodeEditor from "./ComposerCodeEditor.vue"

defineProps<{
  source: string
  projectPath: string
  file: string | null
  status: "idle" | "checking" | "valid" | "invalid" | "unsupported"
  message: string | null
  selectionRange?: { from: number; to: number } | null
  /** Increments when layers/canvas/api change selection (triggers CM reveal). */
  selectionRevealNonce?: number
}>()

const emit = defineEmits<{
  "update:source": [source: string]
  select: [range: { from: number; to: number }]
}>()

const WORD_WRAP_KEY = "aria.composer.code-word-wrap"
const wordWrap = ref(localStorage.getItem(WORD_WRAP_KEY) !== "0")
const cursor = ref<{ line: number; column: number } | null>(null)

const cursorLabel = computed(() =>
  cursor.value ? `${cursor.value.line}:${cursor.value.column}` : null,
)

watch(wordWrap, (enabled) => {
  try {
    localStorage.setItem(WORD_WRAP_KEY, enabled ? "1" : "0")
  } catch {
    /* editor-only preference is best effort */
  }
})

function toggleWordWrap() {
  wordWrap.value = !wordWrap.value
}

function onCursor(position: { line: number; column: number }) {
  cursor.value = position
}
</script>

<template>
  <section
    class="flex h-full min-h-0 min-w-0 flex-col bg-background [--code-editor-bg:var(--background)] dark:bg-sidebar dark:[--code-editor-bg:var(--sidebar)]"
    aria-labelledby="composer-code-file"
    data-aria-composer-code-surface
  >
    <header class="flex min-h-8 shrink-0 items-center gap-2 border-b border-border/60 px-3 text-[11px]">
      <AppIcon name="code" :size="13" class="text-muted-foreground" aria-hidden="true" />
      <span id="composer-code-file" class="min-w-0 flex-1 truncate font-mono text-foreground">
        {{ file || m.composer_code_editor_label() }}
      </span>
      <span
        class="size-1.5 shrink-0 rounded-full"
        :class="{
          'animate-pulse bg-muted-foreground': status === 'checking',
          'bg-emerald-500': status === 'valid',
          'bg-amber-500': status === 'unsupported',
          'bg-destructive': status === 'invalid',
          'bg-muted-foreground/40': status === 'idle',
        }"
        aria-hidden="true"
      />
    </header>
    <ComposerCodeEditor
      class="min-h-0 flex-1"
      :model-value="source"
      :project-path="projectPath"
      :file="file"
      :selection-range="selectionRange"
      :selection-reveal-nonce="selectionRevealNonce"
      :line-wrapping="wordWrap"
      @update:model-value="emit('update:source', $event)"
      @select="emit('select', $event)"
      @cursor="onCursor"
    />
    <div
      class="flex min-h-8 shrink-0 items-center gap-2 border-t border-border/60 px-2 py-1 text-[11px] leading-4"
      :class="status === 'invalid' ? 'text-destructive' : 'text-muted-foreground'"
    >
      <p
        class="min-w-0 flex-1 truncate px-1"
        :role="status === 'invalid' ? 'alert' : 'status'"
        aria-atomic="true"
      >
        {{ message || " " }}
      </p>
      <span
        v-if="cursorLabel"
        class="shrink-0 tabular-nums text-muted-foreground"
        :aria-label="m.composer_code_cursor_position({ line: String(cursor!.line), column: String(cursor!.column) })"
      >
        {{ cursorLabel }}
      </span>
      <TooltipProvider :delay-duration="0" :skip-delay-duration="0">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              class="shrink-0 text-muted-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground"
              :aria-label="m.composer_code_word_wrap()"
              :aria-pressed="wordWrap"
              @click="toggleWordWrap"
            >
              <AppIcon name="textWrap" :size="14" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {{
              wordWrap
                ? m.composer_code_word_wrap_disable()
                : m.composer_code_word_wrap_enable()
            }}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </section>
</template>
