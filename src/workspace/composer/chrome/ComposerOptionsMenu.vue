<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAppearance } from "@/composables/useAppearance"
import { useWindowFullscreen } from "@/composables/useWindowFullscreen"
import { openExternalUrl } from "@/lib/project"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import type { AppIconName } from "@/icons/registry"
import HeaderActionDropdownTooltip from "@/workspace/studio/core/components/HeaderActionDropdownTooltip.vue"
import type { ComposerDisplayMode } from "./useComposerOptions"

const props = defineProps<{
  displayMode: ComposerDisplayMode
  designActive: boolean
  showSelectionToolbar: boolean
  showSelectionSizing: boolean
  showLayoutSlots: boolean
  showDocumentLayers: boolean
  hideComments: boolean
  previewHref?: string | null
}>()

const emit = defineEmits<{
  "update:display-mode": [value: ComposerDisplayMode]
  "update:show-selection-toolbar": [value: boolean]
  "update:show-selection-sizing": [value: boolean]
  "update:show-layout-slots": [value: boolean]
  "update:show-document-layers": [value: boolean]
  "update:hide-comments": [value: boolean]
}>()

const displayModes: Array<{
  id: ComposerDisplayMode
  label: () => string
  icon: AppIconName
}> = [
  { id: "normal", label: () => m.composer_options_normal(), icon: "cursor" },
  { id: "outlines", label: () => m.composer_options_outlines(), icon: "boxLine" },
  { id: "wireframe", label: () => m.composer_options_wireframe(), icon: "grid" },
]

const { isDark, updateAppearance } = useAppearance()
const { fullscreen } = useWindowFullscreen()
const appearanceLabel = computed(() => isDark.value
  ? m.composer_options_light_mode()
  : m.composer_options_dark_mode())

function selectDisplayMode(mode: ComposerDisplayMode) {
  if (!props.designActive) return
  emit("update:display-mode", mode)
}

function toggleAppearance() {
  void updateAppearance({ colorScheme: isDark.value ? "light" : "dark" })
}

async function toggleFullscreen() {
  await window.aria?.window.setFullscreen?.(!fullscreen.value)
}

function openPreview() {
  if (props.previewHref) void openExternalUrl(props.previewHref)
}
</script>

<template>
  <HeaderActionDropdownTooltip :label="m.composer_options_label()">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          class="size-7! shrink-0"
          :aria-label="m.composer_options_label()"
        >
          <AppIcon name="tuning" :size="14" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>

    <DropdownMenuContent align="start" :side-offset="6" class="w-60 p-1">
      <DropdownMenuLabel class="text-2xs text-muted-foreground">
        {{ m.composer_options_canvas() }}
      </DropdownMenuLabel>
      <div
        role="group"
        :aria-label="m.composer_options_display_mode()"
        class="flex items-center justify-between gap-3 px-2 py-1.5"
      >
        <span class="text-xs text-muted-foreground">{{ m.composer_options_display_mode() }}</span>
        <div class="flex items-center gap-1">
          <Tooltip v-for="mode in displayModes" :key="mode.id">
            <TooltipTrigger as-child>
              <button
                type="button"
                :disabled="!designActive"
                :aria-label="mode.label()"
                :aria-pressed="displayMode === mode.id"
                :class="cn(
                  'flex size-7 items-center justify-center rounded-sm border border-transparent text-muted-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40',
                  displayMode === mode.id
                    ? 'border-border bg-accent text-accent-foreground shadow-xs'
                    : 'hover:border-border/60 hover:bg-muted/60 hover:text-foreground',
                )"
                @click.stop="selectDisplayMode(mode.id)"
              >
                <AppIcon :name="mode.icon" :size="16" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{{ mode.label() }}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <DropdownMenuCheckboxItem
        class="text-xs"
        :model-value="showSelectionToolbar"
        :disabled="!designActive"
        @update:model-value="emit('update:show-selection-toolbar', Boolean($event))"
      >{{ m.composer_options_selection_toolbar() }}</DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        class="text-xs"
        :model-value="showSelectionSizing"
        :disabled="!designActive"
        @update:model-value="emit('update:show-selection-sizing', Boolean($event))"
      >{{ m.composer_options_selection_sizing() }}</DropdownMenuCheckboxItem>

      <DropdownMenuSeparator />
      <DropdownMenuLabel class="text-2xs text-muted-foreground">
        {{ m.composer_options_layers() }}
      </DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        class="text-xs"
        :model-value="showLayoutSlots"
        @update:model-value="emit('update:show-layout-slots', Boolean($event))"
      >{{ m.composer_options_layout_slots() }}</DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        class="text-xs"
        :model-value="showDocumentLayers"
        @update:model-value="emit('update:show-document-layers', Boolean($event))"
      >{{ m.composer_options_document() }}</DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        class="text-xs"
        :model-value="hideComments"
        @update:model-value="emit('update:hide-comments', Boolean($event))"
      >{{ m.composer_options_hide_comments() }}</DropdownMenuCheckboxItem>

      <DropdownMenuSeparator />
      <DropdownMenuLabel class="text-2xs text-muted-foreground">
        {{ m.composer_options_appearance() }}
      </DropdownMenuLabel>
      <DropdownMenuItem @select="toggleAppearance">
        <AppIcon :name="isDark ? 'themeSun' : 'themeMoon'" :size="16" aria-hidden="true" />
        {{ appearanceLabel }}
      </DropdownMenuItem>
      <DropdownMenuItem @select="toggleFullscreen">
        <AppIcon :name="fullscreen ? 'minimizeScreen' : 'fullScreen'" :size="16" aria-hidden="true" />
        {{ fullscreen ? m.composer_options_exit_fullscreen() : m.composer_options_enter_fullscreen() }}
      </DropdownMenuItem>

      <DropdownMenuItem :disabled="!previewHref" @select="openPreview">
        <AppIcon name="externalLink" :size="16" aria-hidden="true" />
        {{ m.composer_options_view_browser() }}
      </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </HeaderActionDropdownTooltip>
</template>
