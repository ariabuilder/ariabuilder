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
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  detectFontsourceRuntime,
  uploadDesignFont,
  revealDesignFont,
  deleteDesignFont,
} from "@/lib/design"
import { confirm } from "@/composables/useConfirm"
import { useWorkspaceTerminal } from "@/composables/useWorkspaceTerminal"
import AppContextMenu from "@/components/menu/AppContextMenu.vue"
import AppDropdownMenuItems from "@/components/menu/AppDropdownMenuItems.vue"
import {
  ExpandableSearchInput,
  HeaderActionDropdownTooltip,
} from "@/workspace/studio/core"
import type {
  DesignCustomFont,
  DesignFonts,
  DesignFontsourceFont,
  DesignFontsourceRuntimeStatus,
  DesignSnapshot,
} from "../../../../shared/design"
import {
  fontsourcePackageName,
  normalizeFontsourceId,
} from "../../../../shared/design"
import { m } from "@/paraglide/messages.js"
import DesignHeaderTeleport from "../components/DesignHeaderTeleport.vue"
import { customFontMenuItems } from "../lib/customFontMenuItems"
import {
  listGoogleFonts,
  type GoogleFontCatalogEntry,
  type GoogleFontCategory,
} from "../lib/googleFontCatalog"
import {
  fontsourceCdnPreviewUrl,
  listFontsourceFonts,
  syntheticFontsourceEntries,
  type FontsourceCatalogEntry,
  type FontsourceCategory,
} from "../lib/fontsourceCatalog"

const FONTS_TABS = [
  { id: "fontsource" as const },
  { id: "google" as const },
  { id: "custom" as const },
]

const PAGE_SIZE = 32
const SEARCH_DEBOUNCE_MS = 250
const PREVIEW_BATCH_SIZE = 30
const PREVIEW_IDLE_TIMEOUT_MS = 750
const RUNTIME_POLL_MS = 2000

const props = defineProps<{
  projectRoot: string
  snapshot: DesignSnapshot | null
  saving?: boolean
}>()

const emit = defineEmits<{
  save: [fonts: DesignFonts]
}>()

const { openAndRun } = useWorkspaceTerminal(toRef(props, "projectRoot"))

const activeTab = ref<"fontsource" | "google" | "custom">("fontsource")
const search = ref("")
const category = ref<FontsourceCategory>("all")
const variableOnly = ref(false)
const enabledGoogle = ref<string[]>([])
const enabledFontsource = ref<DesignFontsourceFont[]>([])
const customFonts = ref<DesignFonts["custom"]>([])
const uploading = ref(false)

const googleFonts = ref<GoogleFontCatalogEntry[]>([])
const googleFontsTotal = ref(0)
const isLoadingGoogle = ref(false)
const isLoadingMoreGoogle = ref(false)
const googleSentinelRef = ref<HTMLDivElement | null>(null)

const fontsourceFonts = ref<FontsourceCatalogEntry[]>([])
const fontsourceFontsTotal = ref(0)
const isLoadingFontsource = ref(false)
const isLoadingMoreFontsource = ref(false)
const fontsourceError = ref<string | null>(null)
const fontsourceSentinelRef = ref<HTMLDivElement | null>(null)

const loadedPreviewFamilies = ref<Record<string, true>>({})
const loadedPreviewFontsource = ref<Record<string, true>>({})

const runtime = ref<DesignFontsourceRuntimeStatus | null>(null)

let googleSentinelObserver: IntersectionObserver | null = null
let fontsourceSentinelObserver: IntersectionObserver | null = null
let googleRequestSeq = 0
let fontsourceRequestSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null
let previewLoadTimer: ReturnType<typeof setTimeout> | null = null
let previewIdleHandle: number | null = null
let googleSentinelIntersecting = false
let fontsourceSentinelIntersecting = false
let runtimePollTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.snapshot,
  (snap) => {
    enabledGoogle.value = (snap?.fonts.google ?? []).map((g) => g.family)
    enabledFontsource.value = [...(snap?.fonts.fontsource ?? [])]
    customFonts.value = [...(snap?.fonts.custom ?? [])]
    if (activeTab.value === "google") {
      loadGoogleFonts({ append: false })
    }
    if (activeTab.value === "fontsource") {
      void loadFontsourceFonts({ append: false })
    }
  },
  { immediate: true },
)

const enabledGoogleSet = computed(() => {
  const set = new Set<string>()
  for (const family of enabledGoogle.value) {
    set.add(family.toLowerCase())
  }
  return set
})

const enabledFontsourceSet = computed(() => {
  const set = new Set<string>()
  for (const font of enabledFontsource.value) {
    const id = normalizeFontsourceId(font.id)
    if (id) set.add(id)
  }
  return set
})

const installedPackageSet = computed(
  () => new Set(runtime.value?.installedPackages ?? []),
)

const sortedGoogleFonts = computed(() => {
  return googleFonts.value.slice().sort((left, right) => {
    const leftEnabled = enabledGoogleSet.value.has(left.family.toLowerCase())
      ? 0
      : 1
    const rightEnabled = enabledGoogleSet.value.has(right.family.toLowerCase())
      ? 0
      : 1
    return (
      leftEnabled - rightEnabled || left.family.localeCompare(right.family)
    )
  })
})

const sortedFontsourceFonts = computed(() => {
  return fontsourceFonts.value.slice().sort((left, right) => {
    const leftEnabled = enabledFontsourceSet.value.has(left.id) ? 0 : 1
    const rightEnabled = enabledFontsourceSet.value.has(right.id) ? 0 : 1
    return leftEnabled - rightEnabled || left.family.localeCompare(right.family)
  })
})

const hasMoreGoogleFonts = computed(
  () => googleFonts.value.length < googleFontsTotal.value,
)

const hasMoreFontsourceFonts = computed(
  () => fontsourceFonts.value.length < fontsourceFontsTotal.value,
)

const showCatalogSearch = computed(
  () => activeTab.value === "fontsource" || activeTab.value === "google",
)

function tabLabel(id: (typeof FONTS_TABS)[number]["id"]): string {
  if (id === "fontsource") return m.design_fonts_tab_fontsource()
  if (id === "google") return m.design_fonts_tab_google()
  return m.design_fonts_tab_custom()
}

function isGoogleEnabled(family: string) {
  return enabledGoogleSet.value.has(family.toLowerCase())
}

function isFontsourceEnabled(id: string) {
  return enabledFontsourceSet.value.has(normalizeFontsourceId(id))
}

function hasFontsourcePackage(font: Pick<DesignFontsourceFont, "id" | "variable">) {
  return installedPackageSet.value.has(fontsourcePackageName(font))
}

function toggleGoogle(family: string) {
  if (props.saving) return
  if (isGoogleEnabled(family)) {
    enabledGoogle.value = enabledGoogle.value.filter(
      (f) => f.toLowerCase() !== family.toLowerCase(),
    )
  } else {
    enabledGoogle.value = [...enabledGoogle.value, family]
    injectGooglePreviewCSS([family])
  }
  save()
}

async function toggleFontsource(entry: FontsourceCatalogEntry) {
  if (props.saving) return
  const id = normalizeFontsourceId(entry.id)
  if (!id) return
  const nextFont: DesignFontsourceFont = {
    id,
    family: entry.family,
    variable: entry.variable,
  }

  if (isFontsourceEnabled(id)) {
    const current = enabledFontsource.value.find(
      (font) => normalizeFontsourceId(font.id) === id,
    )
    enabledFontsource.value = enabledFontsource.value.filter(
      (font) => normalizeFontsourceId(font.id) !== id,
    )
    save()
    if (current && hasFontsourcePackage(current)) {
      const shouldUninstall = await confirm({
        title: m.design_fonts_disable_uninstall_title({ name: current.family }),
        description: m.design_fonts_disable_uninstall_description({
          packageName: fontsourcePackageName(current),
        }),
        confirmLabel: m.design_fonts_disable_uninstall_package(),
        cancelLabel: m.design_fonts_disable_keep_package(),
        destructive: true,
      })
      if (shouldUninstall) {
        openAndRun(`npm uninstall ${fontsourcePackageName(current)}`)
        startRuntimePoll(fontsourcePackageName(current), false)
      }
    }
    return
  }

  enabledFontsource.value = [...enabledFontsource.value, nextFont]
  injectFontsourcePreviewCSS([nextFont])
  save()
  if (!hasFontsourcePackage(nextFont)) {
    openAndRun(`npm install ${fontsourcePackageName(nextFont)}`)
    startRuntimePoll(fontsourcePackageName(nextFont), true)
  }
}

function injectGooglePreviewCSS(families: string[]): void {
  const toLoad = families.filter((f) => !loadedPreviewFamilies.value[f])
  if (toLoad.length === 0) return

  const encoded = toLoad
    .map((f) => `family=${encodeURIComponent(f)}:wght@400`)
    .join("&")
  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = `https://fonts.googleapis.com/css2?${encoded}&display=swap`
  document.head.appendChild(link)

  const next = { ...loadedPreviewFamilies.value }
  for (const family of toLoad) next[family] = true
  loadedPreviewFamilies.value = next
}

function injectFontsourcePreviewCSS(
  fonts: Pick<DesignFontsourceFont, "id" | "variable">[],
): void {
  const next = { ...loadedPreviewFontsource.value }
  for (const font of fonts) {
    const id = normalizeFontsourceId(font.id)
    if (!id || next[id]) continue
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = fontsourceCdnPreviewUrl({ id, variable: font.variable })
    document.head.appendChild(link)
    next[id] = true
  }
  loadedPreviewFontsource.value = next
}

function scheduleIdleWork(callback: () => void): void {
  if (previewLoadTimer) {
    clearTimeout(previewLoadTimer)
    previewLoadTimer = null
  }
  if (
    previewIdleHandle !== null &&
    typeof cancelIdleCallback !== "undefined"
  ) {
    cancelIdleCallback(previewIdleHandle)
    previewIdleHandle = null
  }

  const run = () => {
    previewLoadTimer = null
    previewIdleHandle = null
    callback()
  }

  if (typeof requestIdleCallback !== "undefined") {
    previewIdleHandle = requestIdleCallback(run, {
      timeout: PREVIEW_IDLE_TIMEOUT_MS,
    })
    return
  }

  previewLoadTimer = setTimeout(run, 0)
}

function scheduleVisibleGoogleFontPreviews(): void {
  const families = sortedGoogleFonts.value
    .map((font) => font.family)
    .filter((family) => !loadedPreviewFamilies.value[family])
    .slice(0, PREVIEW_BATCH_SIZE)

  if (families.length === 0) return
  scheduleIdleWork(() => injectGooglePreviewCSS(families))
}

function scheduleVisibleFontsourcePreviews(): void {
  const fonts = sortedFontsourceFonts.value
    .filter((font) => !loadedPreviewFontsource.value[font.id])
    .slice(0, PREVIEW_BATCH_SIZE)
  if (fonts.length === 0) return
  scheduleIdleWork(() => injectFontsourcePreviewCSS(fonts))
}

function loadGoogleFonts(options: { append?: boolean } = {}) {
  const append = Boolean(options.append)

  if (append) {
    if (isLoadingMoreGoogle.value || !hasMoreGoogleFonts.value) return
    isLoadingMoreGoogle.value = true
  } else {
    isLoadingGoogle.value = true
  }

  const requestSeq = ++googleRequestSeq
  const offset = append ? googleFonts.value.length : 0

  const result = listGoogleFonts({
    search: search.value.trim() || undefined,
    category: category.value as GoogleFontCategory,
    limit: PAGE_SIZE,
    offset,
    preferFamilies: append ? undefined : enabledGoogle.value,
  })

  if (requestSeq !== googleRequestSeq) return

  const nextFonts = append
    ? [...googleFonts.value, ...result.fonts]
    : result.fonts

  googleFonts.value = Array.from(
    new Map(nextFonts.map((font) => [font.family, font])).values(),
  )
  googleFontsTotal.value = result.total

  if (append) {
    isLoadingMoreGoogle.value = false
  } else {
    isLoadingGoogle.value = false
  }

  void nextTick(() => {
    scheduleVisibleGoogleFontPreviews()
    if (googleSentinelIntersecting && hasMoreGoogleFonts.value) {
      loadGoogleFonts({ append: true })
    }
  })
}

async function loadFontsourceFonts(options: { append?: boolean } = {}) {
  const append = Boolean(options.append)
  const requestSeq = ++fontsourceRequestSeq

  if (append) {
    if (isLoadingMoreFontsource.value || !hasMoreFontsourceFonts.value) return
    isLoadingMoreFontsource.value = true
  } else {
    isLoadingFontsource.value = true
    fontsourceError.value = null
  }

  try {
    const result = await listFontsourceFonts(
      {
        search: search.value.trim() || undefined,
        category: category.value,
        variableOnly: variableOnly.value,
        limit: PAGE_SIZE,
        offset: append ? fontsourceFonts.value.length : 0,
        preferIds: append
          ? undefined
          : enabledFontsource.value.map((font) => font.id),
      },
      syntheticFontsourceEntries(enabledFontsource.value),
    )

    if (requestSeq !== fontsourceRequestSeq) return

    const nextFonts = append
      ? [...fontsourceFonts.value, ...result.fonts]
      : result.fonts

    fontsourceFonts.value = Array.from(
      new Map(nextFonts.map((font) => [font.id, font])).values(),
    )
    fontsourceFontsTotal.value = result.total
    if (!append) {
      fontsourceError.value = result.catalogFailed
        ? m.design_fonts_catalog_error()
        : null
    }
  } catch (error) {
    if (requestSeq !== fontsourceRequestSeq) return
    if (!append) {
      fontsourceError.value =
        error instanceof Error ? error.message : m.design_fonts_catalog_error()
      fontsourceFonts.value = syntheticFontsourceEntries(enabledFontsource.value)
      fontsourceFontsTotal.value = fontsourceFonts.value.length
    }
  } finally {
    if (requestSeq === fontsourceRequestSeq) {
      if (append) isLoadingMoreFontsource.value = false
      else isLoadingFontsource.value = false
    }
  }

  void nextTick(() => {
    scheduleVisibleFontsourcePreviews()
    if (fontsourceSentinelIntersecting && hasMoreFontsourceFonts.value) {
      void loadFontsourceFonts({ append: true })
    }
  })
}

function setupObserver(
  current: IntersectionObserver | null,
  el: HTMLDivElement | null,
  onIntersect: (visible: boolean) => void,
): IntersectionObserver | null {
  current?.disconnect()
  if (!el) return null
  const observer = new IntersectionObserver(
    (entries) => {
      onIntersect(Boolean(entries[0]?.isIntersecting))
    },
    { threshold: 0.1 },
  )
  observer.observe(el)
  return observer
}

watch(googleSentinelRef, (el) => {
  googleSentinelObserver = setupObserver(
    googleSentinelObserver,
    el,
    (visible) => {
      googleSentinelIntersecting = visible
      if (visible) loadGoogleFonts({ append: true })
    },
  )
})

watch(fontsourceSentinelRef, (el) => {
  fontsourceSentinelObserver = setupObserver(
    fontsourceSentinelObserver,
    el,
    (visible) => {
      fontsourceSentinelIntersecting = visible
      if (visible) void loadFontsourceFonts({ append: true })
    },
  )
})

watch([search, category, variableOnly], () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    if (activeTab.value === "google") loadGoogleFonts({ append: false })
    if (activeTab.value === "fontsource") void loadFontsourceFonts({ append: false })
  }, SEARCH_DEBOUNCE_MS)
})

watch(activeTab, (tab) => {
  if (tab === "google") loadGoogleFonts({ append: false })
  if (tab === "fontsource") void loadFontsourceFonts({ append: false })
})

watch(sortedGoogleFonts, () => {
  scheduleVisibleGoogleFontPreviews()
})

watch(sortedFontsourceFonts, () => {
  scheduleVisibleFontsourcePreviews()
})

async function refreshRuntime() {
  try {
    runtime.value = await detectFontsourceRuntime(props.projectRoot)
  } catch {
    runtime.value = { installedPackages: [] }
  }
}

function startRuntimePoll(packageName: string, shouldExist: boolean) {
  stopRuntimePoll()
  let attempts = 0
  const tick = async () => {
    await refreshRuntime()
    attempts += 1
    const present = (runtime.value?.installedPackages ?? []).includes(packageName)
    if (present === shouldExist || attempts >= 15) return
    runtimePollTimer = setTimeout(() => {
      void tick()
    }, RUNTIME_POLL_MS)
  }
  void tick()
}

function stopRuntimePoll() {
  if (runtimePollTimer) {
    clearTimeout(runtimePollTimer)
    runtimePollTimer = null
  }
}

onMounted(() => {
  void refreshRuntime()
  void nextTick(() => {
    scheduleVisibleGoogleFontPreviews()
    scheduleVisibleFontsourcePreviews()
  })
})

onBeforeUnmount(() => {
  googleSentinelObserver?.disconnect()
  fontsourceSentinelObserver?.disconnect()
  googleSentinelIntersecting = false
  fontsourceSentinelIntersecting = false
  stopRuntimePoll()
  if (searchTimer) clearTimeout(searchTimer)
  if (previewLoadTimer) clearTimeout(previewLoadTimer)
  if (
    previewIdleHandle !== null &&
    typeof cancelIdleCallback !== "undefined"
  ) {
    cancelIdleCallback(previewIdleHandle)
  }
})

async function uploadCustom() {
  uploading.value = true
  try {
    const result = await uploadDesignFont(props.projectRoot)
    if ("canceled" in result && result.canceled) return
    if ("family" in result) {
      const next = {
        family: String(result.family),
        file: String(result.file),
      }
      if (!customFonts.value.some((c) => c.file === next.file)) {
        customFonts.value = [...customFonts.value, next]
      }
      activeTab.value = "custom"
    }
  } catch (err) {
    console.error("Font upload failed:", err)
  } finally {
    uploading.value = false
  }
}

function removeCustom(file: string) {
  customFonts.value = customFonts.value.filter((c) => c.file !== file)
}

async function onCustomFontAction(id: string, font: DesignCustomFont) {
  if (id === "reveal") {
    try {
      await revealDesignFont(props.projectRoot, font.file)
    } catch (err) {
      console.error("Reveal font failed:", err)
    }
    return
  }

  if (id === "delete") {
    try {
      await deleteDesignFont(props.projectRoot, font.file)
    } catch (err) {
      console.error("Delete font file failed:", err)
    }
    removeCustom(font.file)
    save()
  }
}

function save() {
  emit("save", {
    google: enabledGoogle.value.map((family) => ({
      family: String(family),
      weights: [400, 500, 600, 700],
    })),
    custom: customFonts.value.map((font) => ({
      family: String(font.family),
      file: String(font.file),
    })),
    fontsource: enabledFontsource.value.map((font) => ({
      id: normalizeFontsourceId(font.id),
      family: String(font.family),
      variable: Boolean(font.variable),
    })),
    bodyFamily: props.snapshot?.fonts.bodyFamily,
    headingFamily: props.snapshot?.fonts.headingFamily,
  })
}
</script>

<template>
  <DesignHeaderTeleport target="search">
    <ExpandableSearchInput
      v-if="showCatalogSearch"
      v-model="search"
      :placeholder="m.design_fonts_search_placeholder()"
    />
  </DesignHeaderTeleport>

  <DesignHeaderTeleport target="toolbar">
    <HeaderActionDropdownTooltip
      v-if="showCatalogSearch"
      :label="m.design_fonts_category()"
    >
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="headerAction"
            size="icon-header"
            :class="
              category !== 'all' ? 'text-foreground' : 'text-muted-foreground'
            "
            :aria-label="m.design_fonts_category()"
          >
            <AppIcon name="filter" class="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-40">
          <DropdownMenuItem
            :class="category === 'all' ? 'bg-input text-primary' : ''"
            @select="category = 'all'"
          >
            {{ m.design_fonts_category_all() }}
          </DropdownMenuItem>
          <DropdownMenuItem
            :class="category === 'sans-serif' ? 'bg-input text-primary' : ''"
            @select="category = 'sans-serif'"
          >
            Sans
          </DropdownMenuItem>
          <DropdownMenuItem
            :class="category === 'serif' ? 'bg-input text-primary' : ''"
            @select="category = 'serif'"
          >
            Serif
          </DropdownMenuItem>
          <DropdownMenuItem
            :class="category === 'display' ? 'bg-input text-primary' : ''"
            @select="category = 'display'"
          >
            Display
          </DropdownMenuItem>
          <DropdownMenuItem
            :class="category === 'handwriting' ? 'bg-input text-primary' : ''"
            @select="category = 'handwriting'"
          >
            {{ m.design_fonts_category_handwriting() }}
          </DropdownMenuItem>
          <DropdownMenuItem
            :class="category === 'monospace' ? 'bg-input text-primary' : ''"
            @select="category = 'monospace'"
          >
            Mono
          </DropdownMenuItem>
          <DropdownMenuItem
            v-if="activeTab === 'fontsource'"
            :class="variableOnly ? 'bg-input text-primary' : ''"
            @select="variableOnly = !variableOnly"
          >
            {{ m.design_fonts_variable_only() }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </HeaderActionDropdownTooltip>
  </DesignHeaderTeleport>

  <DesignHeaderTeleport target="importExport">
    <HeaderActionDropdownTooltip :label="m.design_fonts_upload()">
      <Button
        variant="headerAction"
        size="icon-header"
        :disabled="uploading"
        :aria-label="m.design_fonts_upload()"
        @click="uploadCustom"
      >
        <AppIcon name="upload" class="size-3.5" />
      </Button>
    </HeaderActionDropdownTooltip>
  </DesignHeaderTeleport>

  <div
    class="sticky top-0 z-10 flex h-12 shrink-0 items-stretch gap-1 border-y border-dashed border-border bg-background px-7"
  >
    <Button
      v-for="tab in FONTS_TABS"
      :key="tab.id"
      type="button"
      size="tab"
      :variant="activeTab === tab.id ? 'tab-active' : 'tab'"
      @click="activeTab = tab.id"
    >
      {{ tabLabel(tab.id) }}
    </Button>
  </div>

  <div v-if="activeTab === 'fontsource'" class="space-y-5 px-7 pt-8 pb-10">
    <p
      v-if="fontsourceError"
      class="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground"
    >
      {{ m.design_fonts_catalog_error() }}
    </p>

    <div v-if="isLoadingFontsource" class="flex h-40 items-center justify-center">
      <AppIcon
        name="loading"
        class="size-5 animate-spin text-muted-foreground"
      />
    </div>

    <div
      v-else-if="fontsourceFontsTotal === 0"
      class="flex h-40 flex-col items-center justify-center gap-2"
    >
      <AppIcon name="search" class="size-8 text-muted-foreground/30" />
      <p class="text-sm text-muted-foreground/60">
        {{ m.design_fonts_no_results() }}
      </p>
    </div>

    <template v-else>
      <div class="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
        <div
          v-for="font in sortedFontsourceFonts"
          :key="font.id"
          :class="[
            'group relative flex flex-col justify-between gap-6 rounded-md border px-5 py-5 transition-colors',
            isFontsourceEnabled(font.id)
              ? 'border-primary/50 bg-primary/2 hover:border-dashed'
              : 'border-border/50 hover:border-border hover:bg-card/50',
          ]"
        >
          <div class="flex items-start justify-between gap-2">
            <p
              class="min-w-0 truncate text-lg font-medium text-muted-foreground"
            >
              {{ font.family }}
            </p>
            <Button
              size="xs"
              :disabled="saving"
              :variant="isFontsourceEnabled(font.id) ? 'default' : 'outline'"
              @click="toggleFontsource(font)"
            >
              {{
                isFontsourceEnabled(font.id)
                  ? m.design_fonts_active()
                  : m.design_fonts_enable()
              }}
            </Button>
          </div>
          <p
            class="select-none text-4xl leading-none text-muted-foreground"
            :style="{ fontFamily: font.family }"
          >
            Aa
          </p>
        </div>
      </div>

      <div
        v-if="hasMoreFontsourceFonts"
        ref="fontsourceSentinelRef"
        class="flex h-10 items-center justify-center"
      >
        <AppIcon
          name="loading"
          :class="
            isLoadingMoreFontsource
              ? 'size-4 animate-spin text-muted-foreground/40'
              : 'size-4 text-muted-foreground/40'
          "
        />
      </div>

      <p
        v-if="fontsourceFontsTotal > 0"
        class="pb-4 text-center text-[10px] text-muted-foreground/40"
      >
        {{
          m.design_fonts_count_summary({
            loaded: fontsourceFonts.length,
            total: fontsourceFontsTotal,
          })
        }}
      </p>
    </template>
  </div>

  <div v-else-if="activeTab === 'google'" class="space-y-5 px-7 pt-8 pb-10">
    <div v-if="isLoadingGoogle" class="flex h-40 items-center justify-center">
      <AppIcon
        name="loading"
        class="size-5 animate-spin text-muted-foreground"
      />
    </div>

    <div
      v-else-if="googleFontsTotal === 0"
      class="flex h-40 flex-col items-center justify-center gap-2"
    >
      <AppIcon name="search" class="size-8 text-muted-foreground/30" />
      <p class="text-sm text-muted-foreground/60">
        {{ m.design_fonts_no_results() }}
      </p>
    </div>

    <template v-else>
      <div class="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
        <div
          v-for="font in sortedGoogleFonts"
          :key="font.family"
          :class="[
            'group relative flex flex-col justify-between gap-6 rounded-md border px-5 py-5 transition-colors',
            isGoogleEnabled(font.family)
              ? 'border-primary/50 bg-primary/2 hover:border-dashed'
              : 'border-border/50 hover:border-border hover:bg-card/50',
          ]"
        >
          <div class="flex items-start justify-between gap-2">
            <p
              class="min-w-0 truncate text-lg font-medium text-muted-foreground"
            >
              {{ font.family }}
            </p>
            <Button
              size="xs"
              :disabled="saving"
              :variant="isGoogleEnabled(font.family) ? 'default' : 'outline'"
              @click="toggleGoogle(font.family)"
            >
              {{
                isGoogleEnabled(font.family)
                  ? m.design_fonts_active()
                  : m.design_fonts_enable()
              }}
            </Button>
          </div>
          <p
            class="select-none text-4xl leading-none text-muted-foreground"
            :style="{ fontFamily: font.family }"
          >
            Aa
          </p>
        </div>
      </div>

      <div
        v-if="hasMoreGoogleFonts"
        ref="googleSentinelRef"
        class="flex h-10 items-center justify-center"
      >
        <AppIcon
          name="loading"
          :class="
            isLoadingMoreGoogle
              ? 'size-4 animate-spin text-muted-foreground/40'
              : 'size-4 text-muted-foreground/40'
          "
        />
      </div>

      <p
        v-if="googleFontsTotal > 0"
        class="pb-4 text-center text-[10px] text-muted-foreground/40"
      >
        {{
          m.design_fonts_count_summary({
            loaded: googleFonts.length,
            total: googleFontsTotal,
          })
        }}
      </p>
    </template>
  </div>

  <div v-else class="mx-auto max-w-4xl space-y-6 px-7 pt-7 pb-10">
    <div class="flex items-center justify-between gap-3">
      <h2 class="m-0 text-2xl font-medium tracking-tight">
        {{ m.design_fonts_custom_title() }}
      </h2>
      <Button size="sm" :disabled="uploading" @click="uploadCustom">
        {{ m.design_fonts_upload() }}
      </Button>
    </div>

    <p
      v-if="customFonts.length === 0"
      class="rounded-lg border border-dashed border-border/70 px-4 py-12 text-center text-sm text-muted-foreground"
    >
      {{ m.design_fonts_custom_empty() }}
    </p>

    <ul v-else class="space-y-2">
      <AppContextMenu
        v-for="font in customFonts"
        :key="font.file"
        :items="customFontMenuItems(font)"
        @action="(id) => onCustomFontAction(id, font)"
      >
        <li
          class="group flex items-center justify-between gap-3 rounded-md border border-border/60 px-4 py-3"
        >
          <div class="min-w-0">
            <p
              class="truncate text-lg text-foreground"
              :style="{ fontFamily: `'${font.family}', sans-serif` }"
            >
              Aa — {{ font.family }}
            </p>
            <p class="truncate font-mono text-2xs text-muted-foreground">
              {{ font.file }}
            </p>
          </div>
          <div
            class="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100"
            @click.stop
            @pointerdown.stop
          >
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="font.family"
                >
                  <AppIcon name="moreHorizontal" :size="16" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-52 p-0">
                <DropdownMenuGroup>
                  <AppDropdownMenuItems
                    :items="customFontMenuItems(font)"
                    :dispatch="(id) => onCustomFontAction(id, font)"
                  />
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </li>
      </AppContextMenu>
    </ul>
  </div>
</template>
