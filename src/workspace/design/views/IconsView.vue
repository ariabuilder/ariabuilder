<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toRef,
  watch,
} from "vue"
import { toast } from "vue-sonner"
import { AppIcon } from "@/components/ui/app-icon"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { detectIconRuntime } from "@/lib/design"
import { confirm } from "@/composables/useConfirm"
import { useWorkspaceTerminal } from "@/composables/useWorkspaceTerminal"
import {
  ExpandableSearchInput,
  HeaderActionDropdownTooltip,
} from "@/workspace/studio/core"
import type {
  DesignIconPackId,
  DesignIconRuntimeStatus,
  DesignSnapshot,
} from "../../../../shared/design"
import { m } from "@/paraglide/messages.js"
import DesignHeaderTeleport from "../components/DesignHeaderTeleport.vue"
import {
  iconifySvgUrl,
  listIconifyCategories,
  listIconifyCollections,
  type IconifyCatalogEntry,
} from "../lib/iconifyCatalog"

const PAGE_SIZE = 32
const SEARCH_DEBOUNCE_MS = 250
const RUNTIME_POLL_MS = 2000
const ASTRO_ICON_INSTALL_CMD = "npx astro add astro-icon --yes"
const SKELETON_CARD_COUNT = 9
const SKELETON_MORE_COUNT = 3

const props = defineProps<{
  projectRoot: string
  snapshot: DesignSnapshot | null
  saving?: boolean
}>()

const emit = defineEmits<{
  save: [enabledPacks: DesignIconPackId[]]
}>()

const { openAndRun } = useWorkspaceTerminal(toRef(props, "projectRoot"))

const enabled = ref<DesignIconPackId[]>([])
const search = ref("")
const category = ref<string>("all")
const categories = ref<string[]>([])
const collections = ref<IconifyCatalogEntry[]>([])
const collectionsTotal = ref(0)
const isLoading = ref(false)
const isLoadingMore = ref(false)
const loadError = ref<string | null>(null)
const sentinelRef = ref<HTMLDivElement | null>(null)

const runtime = ref<DesignIconRuntimeStatus | null>(null)
const runtimeChecking = ref(false)
const waitingForInstall = ref(false)
const showReadyAlert = ref(false)
const dismissedReadyAlert = ref(false)

let sentinelObserver: IntersectionObserver | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null
let runtimePollTimer: ReturnType<typeof setTimeout> | null = null
let catalogRequestSeq = 0
let sentinelIsIntersecting = false
let sawMissingRuntime = false

watch(
  () => props.snapshot,
  (snap) => {
    enabled.value = [...(snap?.icons.enabledPacks ?? [])]
  },
  { immediate: true },
)

const enabledSet = computed(() => new Set(enabled.value.map((p) => p.toLowerCase())))

const installedJsonSet = computed(
  () => new Set((runtime.value?.installedJsonPrefixes ?? []).map((p) => p.toLowerCase())),
)

const hasMore = computed(() => collections.value.length < collectionsTotal.value)

const hasAstroIcon = computed(() => Boolean(runtime.value?.hasAstroIcon))

/** Enabled packs stay pinned at the top of the visible list. */
const displayedCollections = computed(() => {
  const prefer = enabledSet.value
  return collections.value.slice().sort((a, b) => {
    const aOn = prefer.has(a.prefix.toLowerCase())
    const bOn = prefer.has(b.prefix.toLowerCase())
    if (aOn && !bOn) return -1
    if (!aOn && bOn) return 1
    return 0
  })
})

function isEnabled(prefix: string) {
  return enabledSet.value.has(prefix.toLowerCase())
}

function hasJsonPack(prefix: string) {
  return installedJsonSet.value.has(prefix.toLowerCase())
}

function sampleStyle(prefix: string, name: string): Record<string, string> {
  const url = iconifySvgUrl(prefix, name)
  return {
    maskImage: `url("${url}")`,
    WebkitMaskImage: `url("${url}")`,
    maskSize: "contain",
    WebkitMaskSize: "contain",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskPosition: "center",
  }
}

async function loadCollections(options: { append?: boolean } = {}) {
  const append = Boolean(options.append)
  const requestId = ++catalogRequestSeq

  if (append) {
    if (!hasMore.value || isLoadingMore.value) return
    isLoadingMore.value = true
  } else {
    isLoading.value = true
    loadError.value = null
  }

  try {
    const result = await listIconifyCollections({
      search: search.value,
      category: category.value,
      preferPrefixes: enabled.value,
      limit: PAGE_SIZE,
      offset: append ? collections.value.length : 0,
    })
    if (requestId !== catalogRequestSeq) return

    collectionsTotal.value = result.total
    if (append) {
      collections.value = [...collections.value, ...result.collections]
    } else {
      collections.value = result.collections
    }
  } catch (err) {
    if (requestId !== catalogRequestSeq) return
    if (!append) {
      collections.value = []
      collectionsTotal.value = 0
      loadError.value =
        err instanceof Error ? err.message : m.design_icons_load_error()
    }
  } finally {
    if (requestId === catalogRequestSeq) {
      isLoading.value = false
      isLoadingMore.value = false
      if (sentinelIsIntersecting && hasMore.value) {
        void loadCollections({ append: true })
      }
    }
  }
}

async function loadCategories() {
  try {
    categories.value = await listIconifyCategories()
  } catch {
    categories.value = []
  }
}

async function refreshRuntime() {
  runtimeChecking.value = true
  try {
    const next = await detectIconRuntime(props.projectRoot)
    const wasMissing = sawMissingRuntime || runtime.value?.hasAstroIcon === false
    if (!next.hasAstroIcon) {
      sawMissingRuntime = true
    }
    if (wasMissing && next.hasAstroIcon && !dismissedReadyAlert.value) {
      showReadyAlert.value = true
      waitingForInstall.value = false
      stopRuntimePoll()
      toast.success(m.design_icons_runtime_ready_toast())
    }
    runtime.value = next
    if (next.hasAstroIcon) {
      waitingForInstall.value = false
    }
  } catch {
    /* keep prior status */
  } finally {
    runtimeChecking.value = false
  }
}

function startRuntimePoll() {
  stopRuntimePoll()
  const tick = async () => {
    await refreshRuntime()
    if (!hasAstroIcon.value && waitingForInstall.value) {
      runtimePollTimer = setTimeout(() => {
        void tick()
      }, RUNTIME_POLL_MS)
    }
  }
  void tick()
}

function stopRuntimePoll() {
  if (runtimePollTimer) {
    clearTimeout(runtimePollTimer)
    runtimePollTimer = null
  }
}

function installAstroIcon() {
  waitingForInstall.value = true
  dismissedReadyAlert.value = false
  openAndRun(ASTRO_ICON_INSTALL_CMD)
  startRuntimePoll()
}

function installJsonPack(prefix: string) {
  openAndRun(`npm install @iconify-json/${prefix}`)
  waitingForInstall.value = true
  startRuntimePoll()
}

function uninstallJsonPack(prefix: string) {
  openAndRun(`npm uninstall @iconify-json/${prefix}`)
  waitingForInstall.value = true
  startRuntimePoll()
}

function dismissReadyAlert() {
  showReadyAlert.value = false
  dismissedReadyAlert.value = true
}

function applyEnabledPacks(next: DesignIconPackId[]) {
  enabled.value = next
  emit("save", [...next])
}

async function toggle(prefix: string) {
  if (props.saving) return
  const key = prefix.toLowerCase()
  const isCurrentlyEnabled = enabled.value.some((p) => p.toLowerCase() === key)

  if (isCurrentlyEnabled) {
    const next = enabled.value.filter((p) => p.toLowerCase() !== key)
    if (hasJsonPack(prefix)) {
      const pack = collections.value.find(
        (entry) => entry.prefix.toLowerCase() === key,
      )
      const name = pack?.name ?? prefix
      const shouldUninstall = await confirm({
        title: m.design_icons_disable_uninstall_title({ name }),
        description: m.design_icons_disable_uninstall_description({
          prefix,
        }),
        confirmLabel: m.design_icons_disable_uninstall_package(),
        cancelLabel: m.design_icons_disable_keep_package(),
        destructive: true,
      })
      applyEnabledPacks(next)
      if (shouldUninstall) {
        uninstallJsonPack(prefix)
      }
      return
    }
    applyEnabledPacks(next)
    return
  }

  const next = [...enabled.value, prefix]
  applyEnabledPacks(next)
  if (hasAstroIcon.value && !hasJsonPack(prefix)) {
    installJsonPack(prefix)
  }
}

function scheduleReload() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void loadCollections({ append: false })
  }, SEARCH_DEBOUNCE_MS)
}

function bindSentinel() {
  sentinelObserver?.disconnect()
  sentinelObserver = null
  const el = sentinelRef.value
  if (!el) return
  sentinelObserver = new IntersectionObserver(
    (entries) => {
      sentinelIsIntersecting = entries.some((entry) => entry.isIntersecting)
      if (sentinelIsIntersecting) {
        void loadCollections({ append: true })
      }
    },
    { root: null, rootMargin: "200px 0px", threshold: 0 },
  )
  sentinelObserver.observe(el)
}

// Avoid an immediate duplicate fetch on mount — onMounted loads once.
let filtersReady = false
watch([search, category], () => {
  if (!filtersReady) {
    filtersReady = true
    return
  }
  scheduleReload()
})

watch(
  () => props.projectRoot,
  () => {
    sawMissingRuntime = false
    dismissedReadyAlert.value = false
    showReadyAlert.value = false
    waitingForInstall.value = false
    void refreshRuntime()
  },
)

onMounted(async () => {
  await Promise.all([loadCategories(), loadCollections({ append: false }), refreshRuntime()])
  await nextTick()
  bindSentinel()
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
  stopRuntimePoll()
  sentinelObserver?.disconnect()
})

watch(sentinelRef, async () => {
  await nextTick()
  bindSentinel()
})
</script>

<template>
  <DesignHeaderTeleport target="search">
    <ExpandableSearchInput
      v-model="search"
      :placeholder="m.design_icons_search_placeholder()"
    />
  </DesignHeaderTeleport>

  <DesignHeaderTeleport target="toolbar">
    <HeaderActionDropdownTooltip :label="m.design_icons_category()">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="headerAction"
            size="icon-header"
            :class="
              category !== 'all' ? 'text-foreground' : 'text-muted-foreground'
            "
            :aria-label="m.design_icons_category()"
          >
            <AppIcon name="filter" class="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="max-h-80 w-52 overflow-auto">
          <DropdownMenuItem
            :class="category === 'all' ? 'bg-input text-primary' : ''"
            @select="category = 'all'"
          >
            {{ m.design_icons_category_all() }}
          </DropdownMenuItem>
          <DropdownMenuItem
            v-for="entry in categories"
            :key="entry"
            :class="category === entry ? 'bg-input text-primary' : ''"
            @select="category = entry"
          >
            {{ entry }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </HeaderActionDropdownTooltip>
  </DesignHeaderTeleport>

  <div class="space-y-5 px-0 pt-2 pb-10">
    <Alert
      v-if="runtime && !hasAstroIcon"
      class="border-amber-500/40 bg-amber-500/5 has-[>svg]:grid-cols-[calc(var(--spacing)*4)_minmax(0,1fr)] sm:has-[>svg]:grid-cols-[calc(var(--spacing)*4)_minmax(0,1fr)_auto] sm:items-center"
    >
      <AppIcon name="warning" class="size-4 text-amber-600" />
      <div class="col-start-2 min-w-0 space-y-1">
        <AlertTitle class="col-start-auto">
          {{ m.design_icons_runtime_missing_title() }}
        </AlertTitle>
        <AlertDescription class="col-start-auto">
          {{ m.design_icons_runtime_missing_description() }}
        </AlertDescription>
      </div>
      <Button
        size="sm"
        class="col-start-2 mt-3 w-fit shrink-0 sm:col-start-3 sm:mt-0 sm:justify-self-end"
        :disabled="waitingForInstall && runtimeChecking"
        @click="installAstroIcon"
      >
        {{
          waitingForInstall
            ? m.design_icons_runtime_installing()
            : m.design_icons_runtime_install()
        }}
      </Button>
    </Alert>

    <Alert
      v-else-if="showReadyAlert"
      class="border-emerald-500/40 bg-emerald-500/5 has-[>svg]:grid-cols-[calc(var(--spacing)*4)_minmax(0,1fr)] sm:has-[>svg]:grid-cols-[calc(var(--spacing)*4)_minmax(0,1fr)_auto] sm:items-center"
    >
      <AppIcon name="checkCircleLinear" class="size-4 text-emerald-600" />
      <div class="col-start-2 min-w-0 space-y-1">
        <AlertTitle class="col-start-auto">
          {{ m.design_icons_runtime_ready_title() }}
        </AlertTitle>
        <AlertDescription class="col-start-auto">
          {{ m.design_icons_runtime_ready_description() }}
        </AlertDescription>
      </div>
      <Button
        size="sm"
        variant="outline"
        class="col-start-2 mt-3 w-fit shrink-0 sm:col-start-3 sm:mt-0 sm:justify-self-end"
        @click="dismissReadyAlert"
      >
        {{ m.design_icons_runtime_dismiss() }}
      </Button>
    </Alert>

    <div
      v-if="isLoading"
      class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      aria-busy="true"
      aria-label="Loading icon sets"
    >
      <div
        v-for="index in SKELETON_CARD_COUNT"
        :key="`icon-skeleton-${index}`"
        class="flex flex-col gap-4 rounded-md border border-border/50 px-5 py-5"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1 space-y-2">
            <Skeleton class="h-5 w-2/3" />
            <Skeleton class="h-3 w-1/2" />
          </div>
          <Skeleton class="h-7 w-16 shrink-0" />
        </div>
        <div class="flex items-center gap-2.5">
          <Skeleton
            v-for="sample in 6"
            :key="`icon-skeleton-${index}-sample-${sample}`"
            class="size-5 rounded-sm"
          />
        </div>
      </div>
    </div>

    <div
      v-else-if="loadError"
      class="flex h-40 flex-col items-center justify-center gap-3"
    >
      <p class="max-w-md text-center text-sm text-muted-foreground">
        {{ m.design_icons_load_error() }}
      </p>
      <Button size="sm" variant="outline" @click="loadCollections({ append: false })">
        {{ m.design_icons_retry() }}
      </Button>
    </div>

    <div
      v-else-if="collectionsTotal === 0"
      class="flex h-40 flex-col items-center justify-center gap-2"
    >
      <AppIcon name="search" class="size-8 text-muted-foreground/30" />
      <p class="text-sm text-muted-foreground/60">
        {{ m.design_icons_no_results() }}
      </p>
    </div>

    <template v-else>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div
          v-for="pack in displayedCollections"
          :key="pack.prefix"
          :class="[
            'flex flex-col gap-4 rounded-md border px-5 py-5 transition-colors',
            isEnabled(pack.prefix)
              ? 'border-primary/50 bg-primary/2'
              : 'border-border/50 hover:border-border hover:bg-card/50',
          ]"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 space-y-1">
              <p class="truncate text-base font-medium text-foreground">
                {{ pack.name }}
              </p>
              <p class="truncate font-mono text-xs text-muted-foreground">
                {{ pack.prefix }}
                <span class="text-muted-foreground/50">·</span>
                {{
                  m.design_icons_icon_count({
                    count: String(pack.total),
                  })
                }}
              </p>
            </div>
            <Button
              size="xs"
              class="shrink-0"
              :disabled="saving"
              :variant="isEnabled(pack.prefix) ? 'default' : 'outline'"
              @click="toggle(pack.prefix)"
            >
              {{
                isEnabled(pack.prefix)
                  ? m.design_icons_enabled()
                  : m.design_icons_enable()
              }}
            </Button>
          </div>

          <div
            v-if="pack.samples.length"
            class="flex flex-wrap items-center gap-2.5"
            aria-hidden="true"
          >
            <span
              v-for="sample in pack.samples.slice(0, 6)"
              :key="sample"
              class="inline-block size-5 bg-foreground/80"
              :style="sampleStyle(pack.prefix, sample)"
              :title="`${pack.prefix}:${sample}`"
            />
          </div>

          <div
            v-if="isEnabled(pack.prefix) && hasAstroIcon && !hasJsonPack(pack.prefix)"
            class="flex items-center justify-between gap-2 rounded-sm border border-dashed border-border/70 px-2.5 py-2"
          >
            <p class="min-w-0 truncate text-xs text-muted-foreground">
              {{
                m.design_icons_pack_json_missing({
                  prefix: pack.prefix,
                })
              }}
            </p>
            <Button
              size="xs"
              variant="outline"
              class="shrink-0"
              @click="installJsonPack(pack.prefix)"
            >
              {{ m.design_icons_pack_json_install() }}
            </Button>
          </div>
        </div>

        <template v-if="isLoadingMore">
          <div
            v-for="index in SKELETON_MORE_COUNT"
            :key="`icon-more-skeleton-${index}`"
            class="flex flex-col gap-4 rounded-md border border-border/50 px-5 py-5"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1 space-y-2">
                <Skeleton class="h-5 w-2/3" />
                <Skeleton class="h-3 w-1/2" />
              </div>
              <Skeleton class="h-7 w-16 shrink-0" />
            </div>
            <div class="flex items-center gap-2.5">
              <Skeleton
                v-for="sample in 6"
                :key="`icon-more-skeleton-${index}-sample-${sample}`"
                class="size-5 rounded-sm"
              />
            </div>
          </div>
        </template>
      </div>

      <div
        v-if="hasMore"
        ref="sentinelRef"
        class="h-4"
        aria-hidden="true"
      />

      <p
        v-if="collectionsTotal > 0"
        class="pb-4 text-center text-[10px] text-muted-foreground/40"
      >
        {{
          m.design_icons_count_summary({
            loaded: String(collections.length),
            total: String(collectionsTotal),
          })
        }}
      </p>
    </template>
  </div>
</template>
