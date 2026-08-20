<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  getLayoutThumb,
  getPageThumb,
  onLayoutThumbReady,
  onPageThumbReady,
} from "@/lib/thumbs"
import { m } from "@/paraglide/messages.js"
import type { LayoutPreviewManifest } from "@/workspace/types"
import { formatComponentUpdated } from "../components/componentsDisplay"

type PreviewMode = "content" | "slots"

const props = withDefaults(defineProps<{
  manifest: LayoutPreviewManifest
  projectPath: string
  showComposerAction?: boolean
  showDetailsAction?: boolean
  previewOnly?: boolean
}>(), {
  showComposerAction: true,
  showDetailsAction: true,
  previewOnly: false,
})

const emit = defineEmits<{
  open: [layout: { name: string; file: string }]
  details: [layout: { name: string; file: string }]
}>()

const previewableConsumers = computed(() =>
  props.manifest.consumers.filter((consumer) => consumer.previewable),
)
const selectedRoute = ref<string | null>(props.manifest.representativeRoute)
const previewMode = ref<PreviewMode>("slots")
const pageThumbUrl = ref<string | null>(null)
const layoutThumbUrl = ref<string | null>(null)
const pageLoading = ref(false)
const layoutLoading = ref(false)
const pageAttempted = ref(false)
const layoutAttempted = ref(false)
const statusMessage = ref("")

const selectedConsumer = computed(
  () =>
    previewableConsumers.value.find(
      (consumer) => consumer.route === selectedRoute.value,
    ) ?? null,
)
const displayedUrl = computed(() =>
  previewMode.value === "content"
    ? pageThumbUrl.value ?? layoutThumbUrl.value
    : layoutThumbUrl.value,
)
const fallbackActive = computed(
  () =>
    previewMode.value === "content" &&
    !pageThumbUrl.value &&
    Boolean(layoutThumbUrl.value),
)
const currentLoading = computed(() =>
  previewMode.value === "content"
    ? pageLoading.value || (!pageAttempted.value && !pageThumbUrl.value)
    : layoutLoading.value || (!layoutAttempted.value && !layoutThumbUrl.value),
)
const usedByLabel = computed(() => {
  const count = props.manifest.consumers.length
  if (count === 0) return m.layouts_used_by_zero()
  if (count === 1) return m.layouts_used_by_one()
  return m.layouts_used_by_many({ count })
})
const slotCountLabel = computed(() => {
  const count = props.manifest.slots.length
  return count === 1
    ? m.layouts_slot_count_one()
    : m.layouts_slot_count_many({ count })
})
const updatedLabel = computed(() =>
  m.layouts_updated({ value: formatComponentUpdated(props.manifest.layout.mtimeMs) }),
)

function samePath(a: string, b: string) {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "")
  return normalize(a) === normalize(b)
}

async function loadPageThumb() {
  const consumer = selectedConsumer.value
  if (!consumer) {
    pageThumbUrl.value = null
    pageAttempted.value = true
    return
  }
  const route = consumer.route
  pageLoading.value = true
  try {
    const result = await getPageThumb({
      projectPath: props.projectPath,
      route,
      mtimeMs: consumer.mtimeMs,
    })
    if (selectedRoute.value !== route) return
    if (result?.dataUrl) pageThumbUrl.value = result.dataUrl
  } catch {
    /* keep the last successful capture for this route */
  } finally {
    if (selectedRoute.value === route) {
      pageLoading.value = false
      pageAttempted.value = true
    }
  }
}

async function loadLayoutThumb() {
  const id = props.manifest.layout.id
  layoutLoading.value = true
  try {
    const result = await getLayoutThumb({
      projectPath: props.projectPath,
      id,
      mtimeMs: props.manifest.layout.mtimeMs,
    })
    if (props.manifest.layout.id !== id) return
    if (result?.dataUrl) layoutThumbUrl.value = result.dataUrl
  } catch {
    /* keep the last successful specimen */
  } finally {
    if (props.manifest.layout.id === id) {
      layoutLoading.value = false
      layoutAttempted.value = true
    }
  }
}

function setPreviewMode(mode: PreviewMode) {
  if (mode === "content" && !selectedConsumer.value) return
  previewMode.value = mode
  statusMessage.value = m.layouts_preview_changed({
    name: props.manifest.layout.name,
    mode: mode === "content" ? m.layouts_preview_content() : m.layouts_preview_slots(),
  })
}

function selectRoute(route: string) {
  if (route === selectedRoute.value) return
  selectedRoute.value = route
  pageThumbUrl.value = null
  pageAttempted.value = false
  previewMode.value = "content"
  void loadPageThumb()
  statusMessage.value = m.layouts_preview_changed({
    name: props.manifest.layout.name,
    mode: m.layouts_preview_content(),
  })
}

function openDetails() {
  if (!props.showDetailsAction) return
  emit("details", {
    name: props.manifest.layout.name,
    file: props.manifest.layout.file,
  })
}

function onCardClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest("button,a,input,select,[role='menuitem']")) return
  openDetails()
}

watch(
  () => [
    props.projectPath,
    props.manifest.layout.id,
    props.manifest.layout.mtimeMs,
    props.manifest.consumers
      .map((consumer) => `${consumer.route}:${consumer.mtimeMs}:${consumer.previewable}`)
      .join("|"),
  ] as const,
  (next, previous) => {
    const identityChanged =
      !previous || next[0] !== previous[0] || next[1] !== previous[1]
    if (identityChanged) {
      selectedRoute.value = props.manifest.representativeRoute
      previewMode.value = "slots"
      pageThumbUrl.value = null
      layoutThumbUrl.value = null
      pageAttempted.value = false
      layoutAttempted.value = false
    } else if (
      selectedRoute.value &&
      !previewableConsumers.value.some(
        (consumer) => consumer.route === selectedRoute.value,
      )
    ) {
      selectedRoute.value = props.manifest.representativeRoute
      pageThumbUrl.value = null
      pageAttempted.value = false
      if (!selectedRoute.value) previewMode.value = "slots"
    }
    void Promise.all([loadPageThumb(), loadLayoutThumb()])
  },
  { immediate: true },
)

let stopPageReady: (() => void) | undefined
let stopLayoutReady: (() => void) | undefined

onMounted(() => {
  try {
    stopPageReady = onPageThumbReady((payload) => {
      if (!samePath(payload.projectPath, props.projectPath)) return
      if (payload.route !== selectedRoute.value) return
      void loadPageThumb()
    })
    stopLayoutReady = onLayoutThumbReady((payload) => {
      if (!samePath(payload.projectPath, props.projectPath)) return
      if (payload.id !== props.manifest.layout.id) return
      void loadLayoutThumb()
    })
  } catch {
    /* bridge unavailable outside Electron */
  }
})

onUnmounted(() => {
  stopPageReady?.()
  stopLayoutReady?.()
})
</script>

<template>
  <Card
    class="cursor-default overflow-hidden hover:bg-sidebar"
    :data-layout-id="manifest.layout.id"
    @click="onCardClick"
  >
    <CardContent class="p-0">
      <div class="relative flex aspect-video items-center justify-center overflow-hidden bg-card">
        <img
          v-if="displayedUrl"
          :src="displayedUrl"
          alt=""
          class="absolute inset-0 size-full object-cover object-top outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
        />
        <div
          v-else
          class="flex min-h-24 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground/70"
        >
          <AppIcon name="layouts" :size="28" aria-hidden="true" />
          <span class="text-xs">
            {{ currentLoading ? m.layouts_preview_loading() : m.layouts_preview_unavailable() }}
          </span>
        </div>

        <span
          v-if="fallbackActive"
          class="absolute left-2 top-2 rounded-sm bg-background/90 px-2 py-1 text-[10px] text-muted-foreground shadow-xs backdrop-blur-sm"
        >
          {{ m.layouts_preview_slots() }}
        </span>

        <div
          class="absolute bottom-2 left-1/2 flex -translate-x-1/2 rounded-md bg-background/92 p-0.5 shadow-sm ring-1 ring-black/10 backdrop-blur-sm dark:ring-white/10"
          role="group"
          :aria-label="m.layouts_preview_mode_label({ name: manifest.layout.name })"
        >
          <button
            type="button"
            class="min-h-7 rounded-sm px-2.5 text-[11px] font-medium text-muted-foreground transition-[background-color,color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :class="previewMode === 'slots' ? 'bg-muted text-foreground' : ''"
            :aria-pressed="previewMode === 'slots'"
            :aria-label="m.layouts_preview_show_slots({ name: manifest.layout.name })"
            @click="setPreviewMode('slots')"
          >
            {{ m.layouts_preview_slots() }}
          </button>
          <button
            type="button"
            class="min-h-7 rounded-sm px-2.5 text-[11px] font-medium text-muted-foreground transition-[background-color,color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40"
            :class="previewMode === 'content' ? 'bg-muted text-foreground' : ''"
            :disabled="!selectedConsumer"
            :aria-pressed="previewMode === 'content'"
            :aria-label="m.layouts_preview_show_content({ name: manifest.layout.name })"
            @click="setPreviewMode('content')"
          >
            {{ m.layouts_preview_content() }}
          </button>
        </div>
      </div>
    </CardContent>

    <CardFooter v-if="!previewOnly" class="flex-col items-stretch gap-2.5 px-3 pb-3 pt-3">
      <div class="min-w-0">
        <CardTitle class="truncate text-sm font-medium leading-snug">
          <button
            v-if="showDetailsAction"
            type="button"
            class="max-w-full cursor-pointer truncate text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :title="m.layouts_detail_view_details()"
            @click="openDetails"
          >
            {{ manifest.layout.name }}
          </button>
          <span v-else :title="manifest.layout.name">
            {{ manifest.layout.name }}
          </span>
        </CardTitle>
        <div class="mt-0.5 flex min-w-0 items-center justify-between gap-3">
          <span
            class="min-w-0 truncate font-mono text-[10px] text-muted-foreground/60"
            :title="manifest.layout.file"
          >
            {{ manifest.layout.file }}
          </span>
          <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
            {{ updatedLabel }}
          </span>
        </div>
      </div>

      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
        <DropdownMenu v-if="previewableConsumers.length > 0">
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="inline-flex min-h-7 min-w-0 items-center gap-1 rounded-sm border border-dashed border-border/60 bg-background/50 px-2 text-[10px] text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <AppIcon name="pages" :size="12" aria-hidden="true" />
              <span class="truncate">{{ usedByLabel }}</span>
              <AppIcon name="chevronDown" :size="11" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-64">
            <p class="px-2 py-1.5 text-xs font-medium text-foreground">
              {{ m.layouts_choose_page() }}
            </p>
            <DropdownMenuRadioGroup
              :model-value="selectedRoute ?? undefined"
              @update:model-value="selectRoute(String($event))"
            >
              <DropdownMenuRadioItem
                v-for="consumer in previewableConsumers"
                :key="consumer.file"
                :value="consumer.route"
                class="min-h-8"
              >
                <span
                  class="min-w-0 truncate"
                  :title="consumer.title || consumer.route"
                >
                  {{ consumer.title || consumer.route }}
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <span
          v-else
          class="inline-flex min-h-7 items-center gap-1 rounded-sm border border-dashed border-border/60 bg-background/50 px-2 text-[10px] text-muted-foreground"
        >
          <AppIcon name="pages" :size="12" aria-hidden="true" />
          {{ usedByLabel }}
        </span>

        <button
          type="button"
          class="inline-flex min-h-7 items-center gap-1 rounded-sm border border-dashed px-2 text-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :class="manifest.diagnostics.length ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'border-border/60 bg-background/50 text-muted-foreground hover:bg-muted/60'"
          :title="manifest.diagnostics.join('\n') || slotCountLabel"
          :aria-label="manifest.diagnostics.length ? `${m.layouts_slot_warning()}: ${manifest.diagnostics.join(' ')}` : slotCountLabel"
          @click="setPreviewMode('slots')"
        >
          <AppIcon
            :name="manifest.diagnostics.length ? 'warning' : 'layouts'"
            :size="12"
            aria-hidden="true"
          />
          {{ slotCountLabel }}
        </button>
      </div>

      <Button
        v-if="showComposerAction"
        type="button"
        variant="outline"
        size="sm"
        class="min-h-8 w-full gap-1.5 transition-transform motion-safe:active:scale-[0.96]"
        @click="emit('open', { name: manifest.layout.name, file: manifest.layout.file })"
      >
        <AppIcon name="eye" :size="14" aria-hidden="true" />
        {{ m.layouts_open_in_composer() }}
      </Button>
      <p class="sr-only" role="status" aria-live="polite">{{ statusMessage }}</p>
      <p v-if="fallbackActive" class="sr-only">
        {{ m.layouts_preview_using_slots() }}
      </p>
    </CardFooter>
  </Card>
</template>
