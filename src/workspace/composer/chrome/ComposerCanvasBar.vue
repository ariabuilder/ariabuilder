<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import ViewportControls from "@/workspace/ViewportControls.vue"
import type { DevicePreview } from "@/workspace/types"
import type {
  ComposerCodeLayout,
  ComposerSurfaceMode,
} from "./composerPreviewMode"
import type {
  ComposerComponentPreviewData,
  ComposerComponentPreviewSession,
  ComposerCmsEntryTemplatePreviewContext,
} from "../../../../shared/composer"
import ComposerPreviewDataControl from "./ComposerPreviewDataControl.vue"
import ComposerCmsPreviewEntryControl from "./ComposerCmsPreviewEntryControl.vue"
import ComposerOptionsMenu from "./ComposerOptionsMenu.vue"
import type { ComposerDisplayMode } from "./useComposerOptions"

const props = withDefaults(
  defineProps<{
    mode: ComposerSurfaceMode
    device: DevicePreview
    codeLayout?: ComposerCodeLayout
    codeDirty?: boolean
    codeCanApply?: boolean
    codeApplying?: boolean
    codeRecoveryConflict?: boolean
    /** Dirty while model differs from last successful write. */
    dirty?: boolean
    /** A document or staged Code edit is being written to disk. */
    saving?: boolean
    /** Manual Save can persist the current dirty state. */
    canSave?: boolean
    /** Undo stack has entries. */
    canUndo?: boolean
    /** Redo stack has entries. */
    canRedo?: boolean
    /** Autosave paused because the source revision changed on disk. */
    saveBlocked?: boolean
    saveConflict?: string | null
    /** Non-mtime save failure (shown when there is no disk conflict). */
    saveError?: string | null
    componentPreviewSession?: ComposerComponentPreviewSession | null
    cmsEntryTemplatePreview?: ComposerCmsEntryTemplatePreviewContext | null
    cmsListCollectionLabel?: string | null
    displayMode?: ComposerDisplayMode
    showSelectionToolbar?: boolean
    showSelectionSizing?: boolean
    showLayoutSlots?: boolean
    showDocumentLayers?: boolean
    hideComments?: boolean
    previewHref?: string | null
    translationLocales?: string[]
    translationLocale?: string
  }>(),
  {
    dirty: false,
    saving: false,
    canSave: false,
    canUndo: false,
    canRedo: false,
    saveBlocked: false,
    saveConflict: null,
    saveError: null,
    componentPreviewSession: null,
    cmsEntryTemplatePreview: null,
    cmsListCollectionLabel: null,
    codeLayout: "vertical",
    codeDirty: false,
    codeCanApply: false,
    codeApplying: false,
    codeRecoveryConflict: false,
    displayMode: "normal",
    showSelectionToolbar: true,
    showSelectionSizing: true,
    showLayoutSlots: true,
    showDocumentLayers: true,
    hideComments: false,
    previewHref: null,
    translationLocales: () => [],
    translationLocale: "",
  },
)

const emit = defineEmits<{
  "update:mode": [mode: ComposerSurfaceMode]
  "update:code-layout": [layout: ComposerCodeLayout]
  "apply-code": []
  "discard-code": []
  "mark-code-merged": []
  save: []
  undo: []
  redo: []
  "device-change": [device: DevicePreview]
  "reload-preview": []
  "reload-conflict": []
  "dismiss-conflict": []
  "update-preview-data": [data: ComposerComponentPreviewData]
  "select-cms-preview-entry": [entryId: string]
  "update:display-mode": [value: ComposerDisplayMode]
  "update:show-selection-toolbar": [value: boolean]
  "update:show-selection-sizing": [value: boolean]
  "update:show-layout-slots": [value: boolean]
  "update:show-document-layers": [value: boolean]
  "update:hide-comments": [value: boolean]
  "select-translation-locale": [locale: string]
}>()

const modes: Array<{
  id: ComposerSurfaceMode
  label: () => string
  icon: "composer" | "eye" | "code"
}> = [
  {
    id: "design",
    label: () => m.composer_mode_design(),
    icon: "composer",
  },
  {
    id: "code",
    label: () => m.composer_mode_code(),
    icon: "code",
  },
  {
    id: "interactive",
    label: () => m.composer_mode_interactive(),
    icon: "eye",
  },
]

const focusedMode = ref<ComposerSurfaceMode>(props.mode)
watch(() => props.mode, (mode) => { focusedMode.value = mode })

function activateMode(mode: ComposerSurfaceMode) {
  focusedMode.value = mode
  emit("update:mode", mode)
}

function onViewportChange(next: DevicePreview | null) {
  if (next) emit("device-change", next)
}

function onModeKeydown(event: KeyboardEvent, index: number) {
  let next = index
  if (event.key === "ArrowRight") next = (index + 1) % modes.length
  else if (event.key === "ArrowLeft") next = (index - 1 + modes.length) % modes.length
  else if (event.key === "Home") next = 0
  else if (event.key === "End") next = modes.length - 1
  else return
  event.preventDefault()
  focusedMode.value = modes[next]!.id
  const tablist = (event.currentTarget as HTMLElement).closest('[role="tablist"]')
  requestAnimationFrame(() => {
    tablist?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
  })
}

const codeLayouts: Array<{
  id: ComposerCodeLayout
  label: () => string
  icon: "code2Line" | "layoutTwoColumn" | "layoutTwoRow"
}> = [
  {
    id: "full",
    label: () => m.composer_code_layout_full(),
    icon: "code2Line",
  },
  {
    id: "vertical",
    label: () => m.composer_code_layout_vertical(),
    icon: "layoutTwoColumn",
  },
  {
    id: "horizontal",
    label: () => m.composer_code_layout_horizontal(),
    icon: "layoutTwoRow",
  },
]

function activateCodeLayout(layout: ComposerCodeLayout) {
  emit("update:code-layout", layout)
}

const saveStatus = computed(() => {
  if (props.saveBlocked) {
    return {
      label: m.composer_canvas_save_blocked(),
      icon: "warning" as const,
      className: "text-destructive",
      spinning: false,
      disabled: true,
    }
  }
  if (props.saveError) {
    return {
      label: m.composer_canvas_save_failed(),
      icon: "warning" as const,
      className: "text-destructive",
      spinning: false,
      disabled: !props.canSave,
    }
  }
  if (props.saving) {
    return {
      label: m.composer_canvas_saving(),
      icon: "refresh" as const,
      className: "text-primary",
      spinning: true,
      disabled: true,
    }
  }
  if (props.dirty && props.canSave) {
    return {
      label: m.composer_canvas_save(),
      icon: "save" as const,
      className: "text-red-500",
      spinning: false,
      disabled: false,
    }
  }
  if (props.dirty && props.codeDirty && !props.codeCanApply) {
    return {
      label: m.composer_canvas_save_code_blocked(),
      icon: "warning" as const,
      className: "text-destructive",
      spinning: false,
      disabled: true,
    }
  }
  if (props.dirty) {
    return {
      label: m.composer_canvas_save_unavailable(),
      icon: "warning" as const,
      className: "text-destructive",
      spinning: false,
      disabled: true,
    }
  }
  return {
    label: m.composer_canvas_clean(),
    icon: "save" as const,
    className: "text-foreground/35",
    spinning: false,
    disabled: true,
  }
})

function onSaveClick() {
  if (saveStatus.value.disabled) return
  emit("save")
}
</script>

<template>
  <div
    class="relative flex h-9 shrink-0 items-center gap-2 border-b border-dashed border-border bg-background dark:bg-sidebar px-2"
    data-aria-composer-canvas-bar
  >
    <ComposerOptionsMenu
      :display-mode="displayMode"
      :design-active="mode === 'design'"
      :show-selection-toolbar="showSelectionToolbar"
      :show-selection-sizing="showSelectionSizing"
      :show-layout-slots="showLayoutSlots"
      :show-document-layers="showDocumentLayers"
      :hide-comments="hideComments"
      :preview-href="previewHref"
      @update:display-mode="emit('update:display-mode', $event)"
      @update:show-selection-toolbar="emit('update:show-selection-toolbar', $event)"
      @update:show-selection-sizing="emit('update:show-selection-sizing', $event)"
      @update:show-layout-slots="emit('update:show-layout-slots', $event)"
      @update:show-document-layers="emit('update:show-document-layers', $event)"
      @update:hide-comments="emit('update:hide-comments', $event)"
    />

    <div class="h-3 w-px shrink-0 bg-border" aria-hidden="true" />

    <div
      class="flex items-center gap-0.5"
      role="tablist"
      :aria-label="m.composer_mode_label()"
    >
      <Tooltip v-for="entry in modes" :key="entry.id">
        <TooltipTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            :class="
              cn(
                'size-7 p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
                props.mode === entry.id
                  ? 'bg-transparent text-primary hover:bg-transparent hover:text-primary'
                  : 'bg-transparent',
              )
            "
            role="tab"
            :aria-label="entry.label()"
            :aria-selected="props.mode === entry.id"
            :id="`composer-mode-tab-${entry.id}`"
            aria-controls="composer-work-area"
            :tabindex="focusedMode === entry.id ? 0 : -1"
            @click="activateMode(entry.id)"
            @keydown="onModeKeydown($event, modes.indexOf(entry))"
          >
            <AppIcon :name="entry.icon" :size="16" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ entry.label() }}</TooltipContent>
      </Tooltip>
    </div>

    <template v-if="props.mode === 'code'">
      <div class="mx-0.5 h-3 w-px shrink-0 bg-border" aria-hidden="true" />
      <div
        class="flex items-center gap-0.5"
        role="group"
        :aria-label="m.composer_code_layout_label()"
      >
        <Tooltip v-for="entry in codeLayouts" :key="entry.id">
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              :class="
                cn(
                  'size-7 p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
                  props.codeLayout === entry.id
                    ? 'bg-transparent text-primary hover:bg-transparent hover:text-primary'
                    : 'bg-transparent',
                )
              "
              :aria-label="entry.label()"
              :aria-pressed="props.codeLayout === entry.id"
              @click="activateCodeLayout(entry.id)"
            >
              <AppIcon :name="entry.icon" :size="16" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ entry.label() }}</TooltipContent>
        </Tooltip>
      </div>
    </template>

    <div
      v-if="props.mode === 'code'"
      class="mx-0.5 h-3 w-px shrink-0 bg-border"
      aria-hidden="true"
    />

    <ComposerPreviewDataControl
      v-if="componentPreviewSession"
      :session="componentPreviewSession"
      @update="emit('update-preview-data', $event)"
    />

    <ComposerCmsPreviewEntryControl
      v-if="cmsEntryTemplatePreview"
      :context="cmsEntryTemplatePreview"
      @select="emit('select-cms-preview-entry', $event)"
    />

    <div
      v-else-if="cmsListCollectionLabel"
      class="inline-flex h-6 max-w-48 items-center gap-1.5 rounded-md border border-border/70 bg-muted/35 px-2 text-[11px] text-muted-foreground"
      :title="`Collection list: ${cmsListCollectionLabel}`"
      aria-label="Assigned CMS collection"
    >
      <AppIcon name="collections" :size="12" class="shrink-0 text-primary" aria-hidden="true" />
      <span class="truncate">{{ cmsListCollectionLabel }}</span>
    </div>

    <Select
      v-if="translationLocales.length > 1"
      :model-value="translationLocale"
      @update:model-value="typeof $event === 'string' && emit('select-translation-locale', $event)"
    >
      <SelectTrigger
        class="h-6! w-20 px-2 text-[10px] font-medium uppercase"
        aria-label="Canvas locale"
        title="Canvas locale"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="locale in translationLocales" :key="locale" :value="locale">{{ locale }}</SelectItem>
      </SelectContent>
    </Select>

    <div class="flex-1" />

    <ViewportControls
      class="absolute left-1/2 -translate-x-1/2"
      :device="device"
      @change="onViewportChange"
    />

    <div v-if="props.mode === 'code'" class="flex shrink-0 items-center gap-1.5">
      <Button
        v-if="props.codeRecoveryConflict"
        type="button"
        variant="outline"
        size="sm"
        class="h-6 px-2 text-[10px]"
        @click="emit('mark-code-merged')"
      >{{ m.composer_code_mark_merged() }}</Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="h-6 px-2 text-[10px]"
        :disabled="!props.codeDirty || props.codeApplying"
        @click="emit('discard-code')"
      >{{ m.composer_code_discard() }}</Button>
      <Button
        type="button"
        size="sm"
        class="h-6 px-2 text-[10px]"
        :disabled="!props.codeCanApply"
        @click="emit('apply-code')"
      >{{ m.composer_code_apply() }}</Button>
    </div>

    <div
      v-if="props.saveConflict"
      class="flex min-w-0 max-w-[42%] items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive"
      role="alert"
    >
      <AppIcon name="warning" :size="12" aria-hidden="true" />
      <span class="truncate">Page changed on disk. Save is paused.</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="h-6 px-1.5 text-[10px]"
        @click="emit('reload-conflict')"
      >Reload</Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="h-6 px-1.5 text-[10px]"
        @click="emit('dismiss-conflict')"
      >Keep editing</Button>
    </div>
    <div
      v-else-if="props.saveError"
      class="flex min-w-0 max-w-[42%] items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive"
      role="alert"
    >
      <AppIcon name="warning" :size="12" aria-hidden="true" />
      <span class="truncate" :title="props.saveError">{{ props.saveError }}</span>
    </div>

    <div class="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger as-child>
          <span class="inline-flex">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              class="size-6!"
              :disabled="!props.canUndo"
              :aria-label="m.composer_undo()"
              @click="emit('undo')"
            >
              <AppIcon name="undo" :size="13" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {{
            props.canUndo
              ? m.composer_undo()
              : m.composer_history_unavailable()
          }}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <span class="inline-flex">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              class="size-6!"
              :disabled="!props.canRedo"
              :aria-label="m.composer_redo()"
              @click="emit('redo')"
            >
              <AppIcon name="redo" :size="13" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {{
            props.canRedo
              ? m.composer_redo()
              : m.composer_history_unavailable()
          }}
        </TooltipContent>
      </Tooltip>

      <div class="mx-0.5 h-4 w-px shrink-0 bg-border/70" aria-hidden="true" />

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            class="size-6!"
            :aria-label="m.composer_reload_canvas()"
            @click="emit('reload-preview')"
          >
            <AppIcon name="refresh" :size="13" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ m.composer_reload_canvas() }}</TooltipContent>
      </Tooltip>

      <div class="mx-0.5 h-4 w-px shrink-0 bg-border/70" aria-hidden="true" />

      <Tooltip>
        <TooltipTrigger as-child>
          <span class="inline-flex">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              class="size-6!"
              :disabled="saveStatus.disabled"
              :aria-label="saveStatus.label"
              :aria-busy="saveStatus.spinning || undefined"
              @click="onSaveClick"
            >
              <AppIcon
                :name="saveStatus.icon"
                :size="14"
                :class="cn(
                  saveStatus.className,
                  saveStatus.spinning && 'animate-spin motion-reduce:animate-none',
                )"
                aria-hidden="true"
              />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ props.saveError || saveStatus.label }}</TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>
