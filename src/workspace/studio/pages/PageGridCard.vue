<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import AppContextMenuItems from "@/components/menu/AppContextMenuItems.vue"
import AppDropdownMenuItems from "@/components/menu/AppDropdownMenuItems.vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardTitle,
} from "@/components/ui/card"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { AppIconName } from "@/icons/registry"
import { openExternalUrl } from "@/lib/project"
import { previewPageUrl } from "@/lib/preview"
import { getPageThumb, onPageThumbReady } from "@/lib/thumbs"
import type { MenuItemDef } from "@/menu/types"
import { m } from "@/paraglide/messages.js"
import { formatPageUpdated } from "./pagesDisplay"
import type { PagesTableRow } from "./usePagesTable"
import { isNavigableScanPage } from "../../../../shared/pages"

const props = defineProps<{
  page: PagesTableRow
  projectPath: string
  items: MenuItemDef[]
  /** Local Astro preview base URL when the preview server is live. */
  previewBaseUrl?: string | null
  selected?: boolean
}>()

const emit = defineEmits<{
  open: [file: string]
  editInComposer: [route: string]
  action: [id: string]
}>()

const thumbUrl = ref<string | null>(null)
const thumbLoading = ref(false)
const overflowOpen = ref(false)
let overflowCloseTimer: ReturnType<typeof setTimeout> | null = null

const updatedLabel = computed(() => formatPageUpdated(props.page.mtimeMs))
const isNavigable = computed(() => isNavigableScanPage(props.page))
const canEditInComposer = computed(() => isNavigable.value || props.page.role === "cms-entry")
const canLoadThumb = computed(() => isNavigable.value || props.page.role === "cms-entry")

const previewHref = computed(() => {
  if (!isNavigable.value) return null
  const base = props.previewBaseUrl?.trim()
  if (!base) return null
  return previewPageUrl(base, props.page.route)
})

type PreviewAction = {
  key: "edit" | "preview" | "open"
  icon: AppIconName
  label: string
  disabled: boolean
  handler: () => void
}

const previewActions = computed((): PreviewAction[] => {
  const openAction: PreviewAction = {
    key: "open",
    icon: "settings01",
    label: m.pages_action_open(),
    disabled: false,
    handler: () => emit("open", props.page.file),
  }
  if (!isNavigable.value) {
    return canEditInComposer.value
      ? [{
          key: "edit",
          icon: "edit",
          label: m.pages_action_edit_in_composer(),
          disabled: false,
          handler: () => emit("editInComposer", props.page.route),
        }, openAction]
      : [openAction]
  }

  return [
    {
      key: "edit",
      icon: "edit",
      label: m.pages_action_edit_in_composer(),
      disabled: false,
      handler: () => emit("editInComposer", props.page.route),
    },
    {
      key: "preview",
      icon: "eye",
      label: m.pages_action_preview(),
      disabled: !previewHref.value,
      handler: () => {
        const href = previewHref.value
        if (!href) return
        void openExternalUrl(href).catch((error: unknown) => console.error(error))
      },
    },
    openAction,
  ]
})

function dispatchAction(id: string) {
  emit("action", id)
}

function clearOverflowCloseTimer() {
  if (!overflowCloseTimer) return
  clearTimeout(overflowCloseTimer)
  overflowCloseTimer = null
}

function scheduleCloseOverflow() {
  clearOverflowCloseTimer()
  overflowCloseTimer = setTimeout(() => {
    overflowOpen.value = false
    overflowCloseTimer = null
  }, 120)
}

/**
 * Open overflow keeps focus on the trigger, which would otherwise stick
 * hover chrome via focus-within after the pointer leaves for another card.
 * Close on leave; delay so the pointer can reach the portaled menu.
 */
function onCardPointerLeave() {
  if (!overflowOpen.value) return
  scheduleCloseOverflow()
}

function onOverflowMenuPointerEnter() {
  clearOverflowCloseTimer()
}

function onOverflowMenuPointerLeave() {
  scheduleCloseOverflow()
}

function samePath(a: string, b: string) {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "")
  return norm(a) === norm(b)
}

async function loadThumb() {
  if (!canLoadThumb.value) {
    thumbUrl.value = null
    thumbLoading.value = false
    return
  }
  const projectPath = props.projectPath
  const route = props.page.route
  thumbLoading.value = true
  try {
    const result = await getPageThumb({
      projectPath,
      route,
      mtimeMs: props.page.mtimeMs,
    })
    // Identity may have changed while the IPC was in flight.
    if (props.projectPath !== projectPath || props.page.route !== route) return
    // Keep the last good thumb until a replacement arrives.
    if (result?.dataUrl) thumbUrl.value = result.dataUrl
  } catch {
    /* keep previous thumbUrl */
  } finally {
    thumbLoading.value = false
  }
}

watch(
  () => [props.projectPath, props.page.route, props.page.role] as const,
  () => {
    thumbUrl.value = null
  },
)

watch(
  () =>
    [
      props.projectPath,
      props.page.route,
      props.page.mtimeMs,
      props.page.role,
    ] as const,
  () => {
    void loadThumb()
  },
  { immediate: true },
)

let stopThumbReady: (() => void) | undefined

onMounted(() => {
  try {
    stopThumbReady = onPageThumbReady((payload) => {
      if (!samePath(payload.projectPath, props.projectPath)) return
      if (payload.route !== props.page.route) return
      void loadThumb()
    })
  } catch {
    /* bridge unavailable in non-Electron contexts */
  }
})

onUnmounted(() => {
  clearOverflowCloseTimer()
  stopThumbReady?.()
})
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <Card
        class="group overflow-hidden"
        :data-page-file="page.file"
        :data-state="selected ? 'selected' : undefined"
        @click="emit('open', page.file)"
        @pointerleave="onCardPointerLeave"
      >
        <CardContent class="p-0">
          <div
            class="relative flex aspect-video items-center justify-center overflow-hidden rounded-sm bg-card"
          >
            <img
              v-if="thumbUrl"
              :src="thumbUrl"
              alt=""
              class="absolute inset-0 size-full object-cover object-top"
            />
            <div
              v-else
              class="flex flex-col items-center gap-2 text-muted-foreground/70"
            >
              <AppIcon name="pages" :size="28" />
            </div>

            <!-- Overflow menu (top-right, hover-only) -->
            <div
              class="preview-actions absolute right-3 top-3 z-30 opacity-0 transition-opacity group-hover:opacity-100 data-[open=true]:opacity-100"
              :data-open="overflowOpen ? 'true' : undefined"
              @click.stop
              @pointerdown.stop
            >
              <DropdownMenu v-model:open="overflowOpen">
                <DropdownMenuTrigger as-child>
                  <Button
                    variant="sidebar-action"
                    size="icon-sm"
                    class="size-8! shrink-0 cursor-pointer"
                    :aria-label="m.pages_actions()"
                  >
                    <AppIcon name="moreHorizontal" :size="16" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  class="page-overflow-menu w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                  @click.stop
                  @pointerenter="onOverflowMenuPointerEnter"
                  @pointerleave="onOverflowMenuPointerLeave"
                >
                  <DropdownMenuGroup>
                    <AppDropdownMenuItems
                      :items="items"
                      :dispatch="dispatchAction"
                    />
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <!-- Centered hover action overlay -->
            <div
              class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
            >
              <div
                class="action-overlay flex translate-y-2.5 scale-[0.92] items-center gap-1 rounded-lg border border-dashed border-border bg-input p-0.5 opacity-0 shadow-xs backdrop-blur-md transition duration-200 ease-out group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100"
              >
                <TooltipProvider :delay-duration="0" :skip-delay-duration="0">
                  <Tooltip
                    v-for="action in previewActions"
                    :key="action.key"
                  >
                    <TooltipTrigger as-child>
                      <Button
                        type="button"
                        variant="card-action-primary"
                        size="icon"
                        class="pointer-events-auto size-8! cursor-pointer"
                        :class="action.disabled ? 'cursor-wait opacity-60' : ''"
                        :aria-label="action.label"
                        :disabled="action.disabled"
                        @click.stop="action.handler()"
                      >
                        <AppIcon
                          :name="action.icon"
                          :size="18"
                          aria-hidden="true"
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {{ action.label }}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </div>
        </CardContent>

        <CardFooter class="flex-col items-stretch gap-0.5 px-3 pb-3 pt-2.5">
          <CardTitle class="truncate text-sm font-regular leading-snug">
            {{ page.displayName }}
          </CardTitle>
          <div
            class="flex min-w-0 items-center justify-between gap-3 text-[10px] text-muted-foreground/70"
          >
            <CardDescription
              class="min-w-0 truncate font-mono text-[10px] text-muted-foreground/60"
            >
              {{ page.file }}
            </CardDescription>
            <span class="shrink-0 tabular-nums text-muted-foreground/60">{{
              updatedLabel
            }}</span>
          </div>
        </CardFooter>
      </Card>
    </ContextMenuTrigger>

    <ContextMenuContent class="w-48">
      <ContextMenuGroup>
        <AppContextMenuItems :items="items" :dispatch="dispatchAction" />
      </ContextMenuGroup>
    </ContextMenuContent>
  </ContextMenu>
</template>

<style scoped>
.preview-actions :deep(button) {
  background-color: color-mix(in oklch, var(--sidebar) 88%, transparent) !important;
  backdrop-filter: blur(4px);
  border-color: color-mix(in oklch, var(--border) 65%, transparent) !important;
}

.preview-actions :deep(button:hover),
.preview-actions :deep(button[data-state="open"]) {
  background-color: var(--sidebar) !important;
  border-color: var(--border) !important;
  border-style: solid !important;
  color: var(--foreground) !important;
}

@media (hover: none) {
  .action-overlay {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .preview-actions {
    opacity: 1;
  }
}
</style>

<!-- Portaled dropdown content — unscoped so styles reach the menu. -->
<style>
.page-overflow-menu [data-slot="dropdown-menu-item"] {
  border: 0 !important;
  border-radius: calc(var(--radius-sm));
  padding: 0.375rem 0.5rem;
  font-size: 0.75rem;
  line-height: 1rem;
}

.page-overflow-menu [data-slot="dropdown-menu-label"] {
  padding: 0.375rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 400;
  color: color-mix(in oklch, var(--muted-foreground) 80%, transparent);
  user-select: none;
}
</style>
