<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { getPageThumb } from "@/lib/thumbs"
import {
  getCollections,
  getPagesMeta,
  updatePageConfig,
} from "@/lib/workspace"
import { m } from "@/paraglide/messages.js"
import type {
  AriaCollectionDef,
  CollectionsState,
  PageMetaRecord,
  PageRole,
  PageSeoMeta,
  PagesMetaState,
} from "@/types/aria"
import {
  StudioDocumentInspectorPanel,
  type StudioDocumentInspectorTab,
} from "@/workspace/studio/core"
import type { ScanPage } from "@/workspace/types"
import { pageDisplayName } from "../pagesDisplay"
import PageDetailOverviewTab from "./PageDetailOverviewTab.vue"
import PageDetailSeoTab from "./PageDetailSeoTab.vue"
import PageDetailTypeTab from "./PageDetailTypeTab.vue"
import {
  inferPageRole,
  isNavigableScanPage,
  resolvePageRole,
} from "../../../../../shared/pages"
import { guardDirtyNavigation, registerDirtyState } from "@/workspace/dirtyState"

type DetailTab = "overview" | "type" | "seo"

const props = defineProps<{
  page: ScanPage
  projectRoot: string
}>()

const emit = defineEmits<{
  back: []
  openComposer: [route: string]
  saved: []
}>()

const activeTab = ref<DetailTab>("overview")
const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)
const errorSource = ref<"load" | "save" | null>(null)
const previewThumb = ref<string | null>(null)

const draftTitle = ref("")
const draftDescription = ref("")
const draftRole = ref<PageRole>("standard")
const draftSeo = ref<PageSeoMeta>({})
const assignedCollectionId = ref<string | null>(null)

const pagesMeta = ref<PagesMetaState>({ pages: {} })
const collections = ref<AriaCollectionDef[]>([])

const baseline = ref("")

const loadError = computed(
  () => (errorSource.value === "load" ? error.value : null),
)
const saveError = computed(
  () => (errorSource.value === "save" ? error.value : null),
)

const tabs = computed<StudioDocumentInspectorTab[]>(() => [
  { id: "overview" as const, label: m.pages_detail_tab_overview() },
  { id: "type" as const, label: m.pages_detail_tab_type() },
  { id: "seo" as const, label: m.pages_detail_tab_seo() },
])

const headerTitle = computed(
  () =>
    draftTitle.value.trim() ||
    props.page.title?.trim() ||
    pageDisplayName(props.page.file),
)

const draftSnapshot = computed(() =>
  JSON.stringify({
    title: draftTitle.value.trim(),
    description: draftDescription.value.trim(),
    role: draftRole.value,
    seo: normalizeSeoForCompare(draftSeo.value),
    assignedCollectionId: assignedCollectionId.value,
  }),
)

const isDirty = computed(
  () => !loading.value && draftSnapshot.value !== baseline.value,
)
const canOpenDirectly = computed(() => isNavigableScanPage(props.page))

function normalizeSeoForCompare(seo: PageSeoMeta): PageSeoMeta {
  const next: PageSeoMeta = {}
  if (seo.title?.trim()) next.title = seo.title.trim()
  if (seo.description?.trim()) next.description = seo.description.trim()
  if (seo.canonical?.trim()) next.canonical = seo.canonical.trim()
  if (seo.ogTitle?.trim()) next.ogTitle = seo.ogTitle.trim()
  if (seo.ogDescription?.trim()) next.ogDescription = seo.ogDescription.trim()
  if (seo.ogImage?.trim()) next.ogImage = seo.ogImage.trim()
  if (seo.noindex) next.noindex = true
  if (seo.nofollow) next.nofollow = true
  return next
}

function findAssignedCollectionId(
  file: string,
  role: PageRole,
  defs: AriaCollectionDef[],
): string | null {
  if (role === "cms-collection") {
    return defs.find((c) => c.listPageFile === file)?.id ?? null
  }
  if (role === "cms-entry") {
    return defs.find((c) => c.templatePageFile === file)?.id ?? null
  }
  return null
}

function applyLoadedState(
  meta: PagesMetaState,
  state: CollectionsState,
) {
  pagesMeta.value = meta
  collections.value = state.collections
  const record = meta.pages[props.page.file] ?? {}
  const role =
    record.role ??
    resolvePageRole(props.page, meta, state) ??
    inferPageRole(props.page.route, props.page.file)

  draftTitle.value = record.title ?? props.page.title ?? ""
  draftDescription.value = record.description ?? ""
  draftRole.value = role
  draftSeo.value = { ...(record.seo ?? {}) }
  assignedCollectionId.value = findAssignedCollectionId(
    props.page.file,
    role,
    state.collections,
  )

  baseline.value = JSON.stringify({
    title: draftTitle.value.trim(),
    description: draftDescription.value.trim(),
    role: draftRole.value,
    seo: normalizeSeoForCompare(draftSeo.value),
    assignedCollectionId: assignedCollectionId.value,
  })
}

async function load() {
  loading.value = true
  error.value = null
  errorSource.value = null
  try {
    const [meta, cols] = await Promise.all([
      getPagesMeta(props.projectRoot),
      getCollections(props.projectRoot),
    ])
    applyLoadedState(meta, cols)
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err)
    errorSource.value = "load"
  } finally {
    loading.value = false
  }
}

async function loadPreview() {
  if (!isNavigableScanPage(props.page)) {
    previewThumb.value = null
    return
  }
  const route = props.page.route
  const file = props.page.file
  try {
    const result = await getPageThumb({
      projectPath: props.projectRoot,
      route,
      mtimeMs: props.page.mtimeMs,
    })
    if (props.page.file === file && result?.dataUrl) previewThumb.value = result.dataUrl
  } catch {
    /* Keep the previous preview while the runtime recovers. */
  }
}

watch(
  () => [props.projectRoot, props.page.file] as const,
  () => {
    activeTab.value = "overview"
    void load()
    void loadPreview()
  },
  { immediate: true },
)

function buildPageRecord(): PageMetaRecord | null {
  const record: PageMetaRecord = {}
  // Always persist explicit role so inference doesn't fight the user's choice.
  record.role = draftRole.value
  const title = draftTitle.value.trim()
  const description = draftDescription.value.trim()
  if (title) record.title = title
  if (description) record.description = description
  const seo = normalizeSeoForCompare(draftSeo.value)
  if (Object.keys(seo).length > 0) record.seo = seo
  return record
}

function applyCollectionAssignment(
  defs: AriaCollectionDef[],
): AriaCollectionDef[] {
  const file = props.page.file
  const role = draftRole.value
  const assignedId = assignedCollectionId.value

  return defs.map((collection) => {
    let listPageFile = collection.listPageFile
    let templatePageFile = collection.templatePageFile

    // Clear this file from any prior binding.
    if (listPageFile === file) listPageFile = null
    if (templatePageFile === file) templatePageFile = null

    if (assignedId && collection.id === assignedId) {
      if (role === "cms-collection") listPageFile = file
      if (role === "cms-entry") templatePageFile = file
    }

    return {
      ...collection,
      listPageFile,
      templatePageFile,
    }
  })
}

async function save() {
  if (saving.value || loading.value) return
  saving.value = true
  error.value = null
  errorSource.value = null
  try {
    const record = buildPageRecord()
    const nextPages = { ...pagesMeta.value.pages }
    if (record) nextPages[props.page.file] = record
    else delete nextPages[props.page.file]

    const result = await updatePageConfig(props.projectRoot, {
      pagesMeta: { pages: nextPages },
      collections: {
        collections: applyCollectionAssignment(collections.value),
      },
    })

    applyLoadedState(result.meta, result.collections)
    emit("saved")
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err)
    errorSource.value = "save"
  } finally {
    saving.value = false
  }
}

function retryError() {
  if (errorSource.value === "save") {
    void save()
    return
  }
  void load()
}

const unregisterDirtyState = registerDirtyState(
  props.projectRoot,
  `page-detail:${props.page.file}`,
  {
    label: m.dirty_navigation_page_details(),
    isDirty: () => isDirty.value,
    save: async () => {
      await save()
      return !isDirty.value
    },
    discard: load,
  },
)
onUnmounted(unregisterDirtyState)

async function requestBack() {
  if (!(await guardDirtyNavigation(props.projectRoot))) return
  emit("back")
}
</script>

<template>
  <StudioDocumentInspectorPanel
    :title="headerTitle"
    :description="page.route"
    :close-label="m.studio_document_close_inspector()"
    :tabs="tabs"
    :active-tab="activeTab"
    @close="requestBack"
    @update:active-tab="activeTab = $event as DetailTab"
  >
    <template #actions>
      <Button
        v-if="canOpenDirectly || page.role === 'cms-entry'"
        type="button"
        variant="ghost"
        size="icon-sm"
        class="size-8"
        :aria-label="m.pages_action_edit_in_composer()"
        @click="emit('openComposer', page.route)"
      >
        <AppIcon name="edit" class="size-3.5" aria-hidden="true" />
      </Button>
      <Button type="button" size="sm" class="h-8" :disabled="!isDirty || saving || loading" @click="save">
        {{ saving ? m.pages_detail_saving() : m.pages_detail_save() }}
      </Button>
    </template>

    <template #preview>
      <div class="relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-md bg-card shadow-[inset_0_0_0_1px_var(--border)]">
        <img v-if="previewThumb" :src="previewThumb" alt="" class="absolute inset-0 size-full object-cover object-top outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10" />
        <AppIcon v-else name="pages" :size="30" class="text-muted-foreground/60" aria-hidden="true" />
      </div>
    </template>

    <div v-if="loading" class="flex items-center justify-center py-16" role="status">
      <AppIcon name="refresh" class="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
    </div>
    <div v-else-if="loadError" class="rounded-md bg-destructive/5 p-3 text-sm">
      <p class="text-destructive">{{ loadError }}</p>
      <Button class="mt-3" variant="outline" size="sm" @click="retryError">{{ m.studio_document_retry() }}</Button>
    </div>
    <div v-else>
      <div v-if="saveError" class="mb-4 rounded-md bg-destructive/5 p-3 text-sm">
        <p class="text-destructive">{{ saveError }}</p>
        <Button class="mt-3" variant="outline" size="sm" @click="retryError">{{ m.studio_document_retry() }}</Button>
      </div>
      <PageDetailOverviewTab v-if="activeTab === 'overview'" v-model:title="draftTitle" v-model:description="draftDescription" :route="page.route" :file="page.file" :mtime-ms="page.mtimeMs" :role="draftRole" @open-type="activeTab = 'type'" />
      <PageDetailTypeTab v-else-if="activeTab === 'type'" v-model:role="draftRole" v-model:assigned-collection-id="assignedCollectionId" :collections="collections" />
      <PageDetailSeoTab v-else v-model:seo="draftSeo" :route="page.route" :fallback-title="draftTitle" :fallback-description="draftDescription" />
    </div>
  </StudioDocumentInspectorPanel>
</template>
