<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { EmptyState, PageHeader, StudioNameCreateDialog, StudioPanelShell } from "@/workspace/studio/core"
import { createWorkspaceLayout, inspectWorkspaceLayouts } from "@/lib/workspace"
import { requestComposerDrill } from "@/workspace/composer/composerDrillRequest"
import type { LayoutPreviewManifest, ScanComponent } from "@/workspace/types"
import type { StudioDocumentUsage } from "../../../../shared/types"
import { m } from "@/paraglide/messages.js"
import LayoutGridCard from "./LayoutGridCard.vue"
import LayoutInspectorPanel from "./detail/LayoutInspectorPanel.vue"

const props = defineProps<{
  layouts: ScanComponent[]
  loading?: boolean
  error?: string | null
  projectRoot: string
  onRefresh?: () => void
  onOpenComposer?: () => void
  onOpenUsage: (usage: StudioDocumentUsage) => void
}>()

const sorted = computed(() =>
  [...props.layouts].sort(
    (a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file),
  ),
)
const manifests = ref<LayoutPreviewManifest[]>([])
const inventoryLoading = ref(false)
const inventoryError = ref<string | null>(null)
let inventoryGeneration = 0

const sortedManifests = computed(() =>
  [...manifests.value].sort(
    (a, b) =>
      a.layout.name.localeCompare(b.layout.name) ||
      a.layout.file.localeCompare(b.layout.file),
  ),
)
const surfaceError = computed(() => props.error || inventoryError.value)
const createOpen = ref(false)
const createBusy = ref(false)
const createError = ref<string | null>(null)
const selectedLayoutFile = ref<string | null>(null)
const selectedManifest = computed(() =>
  selectedLayoutFile.value
    ? manifests.value.find((manifest) => manifest.layout.file === selectedLayoutFile.value) ?? null
    : null,
)

function openInComposer(layout: Pick<ScanComponent, "name" | "file">) {
  if (!/\.astro$/i.test(layout.file)) return
  requestComposerDrill(props.projectRoot, {
    kind: "layout",
    name: layout.name,
    file: layout.file,
    focusPath: null,
  })
  props.onOpenComposer?.()
}

async function loadInventory() {
  const generation = ++inventoryGeneration
  inventoryLoading.value = true
  inventoryError.value = null
  try {
    const result = await inspectWorkspaceLayouts(props.projectRoot)
    if (generation !== inventoryGeneration) return
    manifests.value = result
  } catch (error) {
    if (generation !== inventoryGeneration) return
    inventoryError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (generation === inventoryGeneration) inventoryLoading.value = false
  }
}

async function refresh() {
  await props.onRefresh?.()
  await loadInventory()
}

watch(
  () => [
    props.projectRoot,
    props.layouts.map((layout) => `${layout.id}:${layout.mtimeMs}`).join("|"),
  ] as const,
  () => void loadInventory(),
  { immediate: true },
)

watch(
  () => props.projectRoot,
  () => {
    selectedLayoutFile.value = null
  },
)

watch(
  () => manifests.value.map((manifest) => manifest.layout.file).join("|"),
  () => {
    if (selectedLayoutFile.value && !selectedManifest.value) {
      selectedLayoutFile.value = null
    }
  },
)

function openDetails(layout: Pick<ScanComponent, "file">) {
  selectedLayoutFile.value = layout.file
}

function openDuplicatedLayout(layout: ScanComponent) {
  selectedLayoutFile.value = layout.file
}

async function closeLayoutInspector() {
  const layoutId = selectedManifest.value?.layout.id
  selectedLayoutFile.value = null
  await nextTick()
  if (!layoutId) return
  const card = [...document.querySelectorAll<HTMLElement>("[data-layout-id]")]
    .find((element) => element.dataset.layoutId === layoutId)
  card?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true })
}

async function submitCreate(name: string) {
  createBusy.value = true
  createError.value = null
  try {
    const created = await createWorkspaceLayout(props.projectRoot, name)
    await props.onRefresh?.()
    createOpen.value = false
    openInComposer(created)
  } catch (error) {
    createError.value = error instanceof Error ? error.message : String(error)
  } finally {
    createBusy.value = false
  }
}
</script>

<template>
  <StudioPanelShell class="flex-row">
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
    <PageHeader
      :title="m.rail_layouts()"
      :description="m.layouts_surface_description()"
      hide-search
      :create-label="m.layouts_create_action()"
      @create="createOpen = true"
    >
      <template v-if="onRefresh" #actions>
        <Button
          type="button"
          variant="outline"
          size="md"
          class="gap-1.5"
          :disabled="loading || inventoryLoading"
          @click="refresh"
        >
          <AppIcon name="refresh" :size="14" />
          {{ m.workspace_refresh_preview() }}
        </Button>
      </template>
    </PageHeader>

    <p
      v-if="surfaceError"
      class="px-7 py-3 text-sm text-destructive"
    >
      {{ surfaceError }}
    </p>

    <EmptyState
      v-else-if="!loading && !inventoryLoading && sorted.length === 0"
      icon="layouts"
      :entity-label="m.rail_layouts()"
      :title="m.layouts_empty_title()"
      :description="m.layouts_empty_body()"
      hide-action
    />

    <ul
      v-else-if="inventoryLoading && sortedManifests.length === 0"
      class="grid grid-cols-1 gap-7 p-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
      :aria-label="m.layouts_preview_loading()"
    >
      <li v-for="layout in sorted" :key="layout.id">
        <div class="overflow-hidden rounded-md border border-border/40 bg-sidebar">
          <div class="aspect-video animate-pulse bg-muted/60 motion-reduce:animate-none" />
          <div class="space-y-2 p-3">
            <div class="h-4 w-2/5 animate-pulse rounded bg-muted/70 motion-reduce:animate-none" />
            <div class="h-3 w-3/4 animate-pulse rounded bg-muted/50 motion-reduce:animate-none" />
            <div class="h-8 animate-pulse rounded bg-muted/50 motion-reduce:animate-none" />
          </div>
        </div>
      </li>
    </ul>

    <ul
      v-else
      class="grid grid-cols-1 gap-7 p-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
      data-aria-layouts-list
    >
      <li
        v-for="manifest in sortedManifests"
        :key="manifest.layout.id"
      >
        <LayoutGridCard
          :manifest="manifest"
          :project-path="projectRoot"
          @open="openInComposer"
          @details="openDetails"
        />
      </li>
    </ul>

    <StudioNameCreateDialog
      v-model:open="createOpen"
      :busy="createBusy"
      :error="createError"
      :title="m.layouts_create_title()"
      :description="m.layouts_create_description()"
      :placeholder="m.layouts_create_placeholder()"
      :cancel-label="m.confirm_cancel()"
      :submit-label="m.layouts_create_submit()"
      :creating-label="m.layouts_create_creating()"
      @submit="submitCreate"
    />
    </div>

    <LayoutInspectorPanel
      v-if="selectedManifest"
      :manifest="selectedManifest"
      :project-root="projectRoot"
      :on-refresh="refresh"
      :on-open-composer="openInComposer"
      :on-open-usage="onOpenUsage"
      @close="closeLayoutInspector"
      @duplicated="openDuplicatedLayout"
    />
  </StudioPanelShell>
</template>
