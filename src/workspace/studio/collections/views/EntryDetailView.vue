<script setup lang="ts">
import { computed, onUnmounted, ref, toRef, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AriaCollectionDef } from "@/types/aria"
import { m } from "@/paraglide/messages.js"
import { getSiteSettings } from "@/lib/workspace"
import { updateCmsEntry } from "@/lib/cms"
import { HeaderActionTooltip } from "@/workspace/studio/core"
import type {
  AriaEntryRecord,
  EntryFieldWidth,
  FieldSchema,
  SystemEntryFieldKey,
} from "../../../../../shared/cms"
import {
  isCoverImageField,
  localeCodesEqual,
  normalizeEntryFieldOrder,
  systemCoverField,
} from "../../../../../shared/cms"
import ActivityTimeline from "../components/ActivityTimeline.vue"
import CmsFrontmatterField from "../components/CmsFrontmatterField.vue"
import CmsRelationField from "../components/CmsRelationField.vue"
import EntryPublishOverflowMenu from "../components/EntryPublishOverflowMenu.vue"
import EntryPublishSplitButton from "../components/EntryPublishSplitButton.vue"
import EntryRevisionsPanel from "../components/EntryRevisionsPanel.vue"
import StructuredTextEditor from "../components/StructuredTextEditor.vue"
import { useCollectionDetail } from "../composables/useCollectionDetail"
import { useCmsEntryActions } from "../composables/useCmsEntryActions"
import { useEditEntryForm } from "../composables/useEditEntryForm"
import DeleteEntryDialog from "../dialogs/DeleteEntryDialog.vue"
import { collectionSupportsBody } from "../lib/collectionBodySupport"
import { buildCmsEntryActivityItems } from "../lib/entryActivity"
import { getOrderedEntryFieldPlacement } from "../lib/entryFieldPlacement"
import {
  getEntryFieldWidthClass,
  normalizeEntryFieldWidth,
} from "../lib/entryFieldWidth"
import { isEditableCmsField } from "../lib/frontmatterForm"
import { mapEntryRecordToRow } from "../lib/entryRow"
import { entryHasLocale, matchEntryLocale } from "../lib/entryLocales"
import type { CmsNav } from "../CollectionsSurface.vue"
import { guardDirtyNavigation, registerDirtyState } from "@/workspace/dirtyState"
import {
  clearAgentSurfaceContext,
  updateAgentSurfaceContext,
} from "@/workspace/agent/surfaceContext"

const props = defineProps<{
  projectRoot: string
  collectionName: string
  entryIdOrSlug: string
  locale?: string
  navigate: (nav: CmsNav) => void
}>()

const projectRootRef = toRef(props, "projectRoot")
const collectionParam = toRef(props, "collectionName")

const {
  collection,
  isLoading: isCollectionLoading,
  loadError: collectionLoadError,
} = useCollectionDetail(projectRootRef, collectionParam)

const {
  currentEntryRecord,
  resolvedEntryId,
  activeLocale,
  entryLocales,
  title,
  slug,
  status,
  bodyDocument,
  frontmatterDraft,
  relationDraft,
  createdAt,
  updatedAt,
  publishedAt,
  isLoading: isEntryLoading,
  isSaving,
  hasUnsavedChanges,
  loadError: entryLoadError,
  errors,
  loadEntry,
  updateSlugFromTitle,
  markSlugEdited,
  setRelationValue,
  applyEntryRecord,
  submitUpdate,
  switchLocale,
  addLocale,
} = useEditEntryForm()

const entryActions = useCmsEntryActions(projectRootRef)
const isDeleteDialogOpen = ref(false)
const revisionsPanelKey = ref(0)
const configuredLocales = ref<Array<{ code: string; label: string }>>([])

type EntryFormItem =
  | {
      id: string
      kind: "system"
      key: SystemEntryFieldKey
      width: EntryFieldWidth
    }
  | {
      id: string
      kind: "frontmatter"
      field: FieldSchema
      width: EntryFieldWidth
    }
  | {
      id: string
      kind: "relation"
      field: FieldSchema & { type: "relation" }
      width: EntryFieldWidth
    }

function entryFieldsForDef(collection: AriaCollectionDef): FieldSchema[] {
  const schemaFields = (collection.schema?.fields ?? []) as FieldSchema[]
  if (schemaFields.some(isCoverImageField)) {
    return schemaFields
  }
  return (collection.supports ?? []).includes("cover")
    ? [systemCoverField(), ...schemaFields]
    : schemaFields
}

const fields = computed(() =>
  collection.value ? entryFieldsForDef(collection.value) : [],
)

const bodyEnabled = computed(() => collectionSupportsBody(collection.value))

const entryFormLayout = computed<{
  main: EntryFormItem[]
  sidebar: EntryFormItem[]
}>(() => {
  if (!collection.value) {
    return { main: [], sidebar: [] }
  }

  const fieldsByKey = new Map(fields.value.map((field) => [field.key, field]))
  const main: EntryFormItem[] = []
  const sidebar: EntryFormItem[] = []

  for (const item of normalizeEntryFieldOrder({
    fields: fields.value,
    entryFieldOrder: collection.value.schema?.entryFieldOrder,
    supportsBody: bodyEnabled.value,
  })) {
    if (item.kind === "system") {
      if (item.key === "body" && !bodyEnabled.value) {
        continue
      }
      main.push({
        id: `system:${item.key}`,
        kind: "system",
        key: item.key,
        width: "full",
      })
      continue
    }

    const field = fieldsByKey.get(item.key)
    if (!field) continue

    let formItem: EntryFormItem | null = null
    const width = normalizeEntryFieldWidth(item.width)
    if (field.type === "relation") {
      formItem = {
        id: `relation:${field.key}`,
        kind: "relation",
        field: field as FieldSchema & { type: "relation" },
        width,
      }
    } else if (isEditableCmsField(field)) {
      formItem = {
        id: `frontmatter:${field.key}`,
        kind: "frontmatter",
        field,
        width,
      }
    }

    if (!formItem) continue

    const placement = getOrderedEntryFieldPlacement(item, field)
    ;(placement === "sidebar" ? sidebar : main).push(formItem)
  }

  return { main, sidebar }
})

const mainEntryFormItems = computed(() => entryFormLayout.value.main)
const sidebarEntryFormItems = computed(() => entryFormLayout.value.sidebar)

const authorship = computed(() => currentEntryRecord.value?.authorship)

const entryActivityItems = computed(() =>
  buildCmsEntryActivityItems({
    createdAt: createdAt.value,
    createdBy:
      authorship.value?.createdBy?.username ??
      authorship.value?.author?.username ??
      null,
    updatedAt: updatedAt.value,
    updatedBy:
      authorship.value?.updatedBy?.username ??
      authorship.value?.author?.username ??
      null,
    publishedAt: publishedAt.value,
    publishedBy: authorship.value?.publishedBy?.username ?? null,
    targetLabel: title.value || m.cms_entries_untitled(),
  }),
)

const collectionLabel = computed(
  () => collection.value?.label ?? props.collectionName,
)
const isLoading = computed(
  () => isCollectionLoading.value || isEntryLoading.value,
)
const loadError = computed(
  () => collectionLoadError.value ?? entryLoadError.value,
)

const supportsRevisions = computed(() =>
  (collection.value?.supports ?? []).includes("revisions"),
)
const showRevisionsPanel = computed(
  () => supportsRevisions.value || Boolean(resolvedEntryId.value),
)
const showSidebar = computed(
  () =>
    sidebarEntryFormItems.value.length > 0 ||
    Boolean(resolvedEntryId.value) ||
    showRevisionsPanel.value,
)
const activeLocaleRecord = computed(() =>
  matchEntryLocale(entryLocales.value, activeLocale.value),
)
const localeOptions = computed(() =>
  configuredLocales.value.length
    ? configuredLocales.value
    : entryLocales.value.map((item) => ({
        code: item.locale,
        label: item.locale,
      })),
)
const selectedLocaleLabel = computed(() => {
  const code = activeLocale.value.trim()
  if (!code) return ""
  return (
    localeOptions.value.find((locale) => localeCodesEqual(locale.code, code))
      ?.label ?? code
  )
})
function localeIsPresent(code: string): boolean {
  return entryHasLocale(entryLocales.value, code, activeLocale.value)
}
const activeLocaleIsSource = computed(() => activeLocaleRecord.value?.isSource ?? true)
const activeLocaleStatus = computed(() =>
  activeLocaleIsSource.value
    ? status.value
    : activeLocaleRecord.value?.status ?? "draft",
)
const statusLabel = computed(() => {
  switch (activeLocaleStatus.value) {
    case "draft":
      return m.cms_status_draft()
    case "published":
      return m.cms_status_published()
    default:
      return m.cms_status_archived()
  }
})

watch(
  () => props.projectRoot,
  async (root) => {
    try {
      const settings = await getSiteSettings(root)
      configuredLocales.value = (settings.localization?.content.locales ?? [])
        .filter((locale) => locale.enabled)
        .map((locale) => ({ code: locale.code, label: locale.label }))
    } catch {
      configuredLocales.value = []
    }
  },
  { immediate: true },
)

async function onLocaleSelected(value: unknown) {
  if (typeof value !== "string" || !collection.value || !resolvedEntryId.value) return
  const existing = matchEntryLocale(entryLocales.value, value)
  if (existing) {
    switchLocale(existing.locale, fields.value)
    return
  }
  await addLocale(props.projectRoot, collection.value.id, resolvedEntryId.value, value, fields.value)
}

watch(
  [
    () => collection.value?.id,
    () => props.entryIdOrSlug,
    () => props.projectRoot,
    () => props.locale,
  ],
  async ([collectionId, entryIdOrSlug, root, locale]) => {
    if (!collectionId || !entryIdOrSlug || !root) return
    await loadEntry(root, collectionId, entryIdOrSlug, fields.value, locale)
  },
  { immediate: true },
)

watch(
  [
    currentEntryRecord,
    activeLocale,
    hasUnsavedChanges,
    () => collection.value?.id,
  ],
  () => {
    const record = currentEntryRecord.value
    const collectionId = collection.value?.id
    if (!record || !collectionId) {
      clearAgentSurfaceContext(props.projectRoot, "cmsContext")
      return
    }
    updateAgentSurfaceContext(props.projectRoot, {
      cmsContext: {
        collectionId,
        entryId: record.entry.id,
        version: record.entry.version,
        status: record.entry.status,
        sourceLocale:
          record.locales.find((locale) => locale.isSource)?.locale ?? null,
        activeLocale: activeLocale.value || null,
        locales: record.locales.map((locale) => locale.locale).slice(0, 40),
        dirty: hasUnsavedChanges.value,
      },
    })
  },
  { immediate: true },
)

onUnmounted(() => {
  clearAgentSurfaceContext(props.projectRoot, "cmsContext")
})

watch(
  () => fields.value,
  (nextFields) => {
    if (!currentEntryRecord.value) return
    for (const field of nextFields) {
      if (field.type === "relation") {
        if (!(field.key in relationDraft.value)) {
          relationDraft.value = {
            ...relationDraft.value,
            [field.key]: [],
          }
        }
        continue
      }
      if (!isEditableCmsField(field)) continue
      if (!(field.key in frontmatterDraft.value)) {
        frontmatterDraft.value = {
          ...frontmatterDraft.value,
          [field.key]: field.default ?? "",
        }
      }
    }
  },
)

async function navigateToCollection() {
  if (!(await guardDirtyNavigation(props.projectRoot))) return
  props.navigate({
    view: "detail",
    collectionName: props.collectionName,
    tab: "entries",
  })
}

async function navigateToCollections() {
  if (!(await guardDirtyNavigation(props.projectRoot))) return
  props.navigate({ view: "list" })
}

async function reloadEntry(): Promise<void> {
  if (!collection.value) return
  await loadEntry(
    props.projectRoot,
    collection.value.id,
    resolvedEntryId.value || props.entryIdOrSlug,
    fields.value,
    activeLocale.value || props.locale,
  )
  revisionsPanelKey.value += 1
}

async function saveEntry() {
  if (!collection.value || !resolvedEntryId.value) return
  await submitUpdate(
    props.projectRoot,
    collection.value.id,
    resolvedEntryId.value,
    fields.value,
    bodyEnabled.value,
  )
}

const unregisterDirtyState = registerDirtyState(
  props.projectRoot,
  `cms-entry:${props.collectionName}:${props.entryIdOrSlug}`,
  {
    label: m.dirty_navigation_cms_entry(),
    isDirty: () => hasUnsavedChanges.value,
    save: async () => {
      await saveEntry()
      return !hasUnsavedChanges.value
    },
    discard: () => {
      if (currentEntryRecord.value) {
        applyEntryRecord(
          currentEntryRecord.value,
          fields.value,
          activeLocale.value,
        )
      }
    },
  },
)
onUnmounted(unregisterDirtyState)

async function withSavedEntry(
  action: (record: AriaEntryRecord) => Promise<boolean>,
): Promise<void> {
  let record = currentEntryRecord.value
  if (!record) return
  if (hasUnsavedChanges.value) {
    const saved = await submitUpdate(
      props.projectRoot,
      collection.value!.id,
      resolvedEntryId.value,
      fields.value,
      bodyEnabled.value,
      { showSuccessToast: false },
    )
    if (!saved) return
    record = saved
  }
  await action(record)
}

async function publishEntry() {
  if (!currentEntryRecord.value) return
  if (!activeLocaleIsSource.value) {
    await transitionActiveLocale("published")
    return
  }
  await withSavedEntry(async (record) =>
    entryActions.publishEntries(
      [mapEntryRecordToRow(record)],
      async () => {
        await reloadEntry()
      },
    ),
  )
}

async function unpublishEntry() {
  if (!currentEntryRecord.value) return
  if (!activeLocaleIsSource.value) {
    await transitionActiveLocale("draft")
    return
  }
  await withSavedEntry(async (record) =>
    entryActions.unpublishEntries([mapEntryRecordToRow(record)], async () => {
      await reloadEntry()
    }),
  )
}

async function archiveEntry() {
  if (!currentEntryRecord.value) return
  if (!activeLocaleIsSource.value) {
    await transitionActiveLocale("archived")
    return
  }
  await withSavedEntry(async (record) =>
    entryActions.archiveEntries([mapEntryRecordToRow(record)], async () => {
      await reloadEntry()
    }),
  )
}

async function transitionActiveLocale(nextStatus: "draft" | "published" | "archived") {
  await withSavedEntry(async (record) => {
    const updated = await updateCmsEntry(props.projectRoot, {
      collectionId: record.entry.collectionId,
      id: record.entry.id,
      version: record.entry.version,
      patch: { upsertLocale: { locale: activeLocale.value, status: nextStatus } },
    })
    applyEntryRecord(updated, fields.value, activeLocale.value)
    revisionsPanelKey.value += 1
    return true
  })
}

async function confirmDelete() {
  if (!currentEntryRecord.value) return
  const row = mapEntryRecordToRow(currentEntryRecord.value)
  const ok = await entryActions.deleteEntries([row])
  if (ok) {
    isDeleteDialogOpen.value = false
    navigateToCollection()
  }
}

function setFrontmatterValue(key: string, value: unknown) {
  frontmatterDraft.value = {
    ...frontmatterDraft.value,
    [key]: value,
  }
}

function handleRevisionRestored(record: AriaEntryRecord) {
  applyEntryRecord(record, fields.value)
  revisionsPanelKey.value += 1
}
</script>

<template>
  <div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <header
      class="flex min-w-0 shrink-0 items-center justify-between gap-3 px-3 pt-3 pb-3"
    >
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <Button variant="ghost" size="icon" @click="navigateToCollection">
          <AppIcon name="chevronLeft" :size="16" />
        </Button>
        <nav class="flex min-w-0 items-center gap-2 text-sm">
          <button
            type="button"
            class="shrink-0 cursor-pointer text-muted-foreground transition-colors hover:text-primary/80"
            @click="navigateToCollections"
          >
            {{ m.cms_collections_title() }}
          </button>
          <span class="shrink-0 text-muted-foreground/50">/</span>
          <button
            type="button"
            class="min-w-0 cursor-pointer truncate text-muted-foreground transition-colors hover:text-primary/80"
            @click="navigateToCollection"
          >
            {{ collectionLabel }}
          </button>
          <span class="shrink-0 text-muted-foreground/50">/</span>
          <span class="truncate font-medium text-muted-foreground">
            {{ title || m.cms_entries_untitled() }}
          </span>
        </nav>
        <Select
          v-if="configuredLocales.length || entryLocales.length > 1"
          :model-value="activeLocale"
          :disabled="isSaving || isLoading"
          @update:model-value="onLocaleSelected"
        >
          <SelectTrigger class="ms-2 h-8 w-auto min-w-28" aria-label="Entry locale">
            <SelectValue>{{ selectedLocaleLabel }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="locale in localeOptions"
              :key="locale.code"
              :value="locale.code"
            >
              {{ locale.label }}
              <template #trailing>
                <span
                  v-if="!localeIsPresent(locale.code)"
                  class="shrink-0 text-muted-foreground"
                >
                  · Missing
                </span>
              </template>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <Badge
          variant="secondary"
          class="capitalize"
          :class="
            activeLocaleStatus === 'published' && hasUnsavedChanges
              ? 'border-primary/40 bg-primary/10 text-foreground'
              : undefined
          "
        >
          {{ statusLabel }}
          <span
            v-if="activeLocaleStatus === 'published' && hasUnsavedChanges"
            class="ml-1 font-normal text-muted-foreground"
          >
            · {{ m.cms_entry_publish_changes() }}
          </span>
        </Badge>
        <Badge v-if="!activeLocaleIsSource" variant="outline">
          {{ activeLocaleRecord?.translationMeta?.method === 'ai' ? 'AI translation' : 'Translation' }}
        </Badge>
        <HeaderActionTooltip :label="m.cms_entry_save()">
          <Button
            variant="outline"
            size="md"
            :disabled="isSaving || isLoading || !hasUnsavedChanges"
            @click="saveEntry"
          >
            {{ isSaving ? m.cms_entry_saving() : m.cms_entry_save() }}
          </Button>
        </HeaderActionTooltip>

        <div
          class="flex shrink-0 items-center gap-0 [&_[data-slot=button]:hover]:z-10 [&_[data-slot=button]:focus-visible]:z-10 [&_[data-slot=button][data-state=open]]:z-10"
        >
          <EntryPublishSplitButton
            :status="activeLocaleStatus"
            :is-busy="entryActions.isTransitioning.value || isSaving"
            :is-modified-since-publish="hasUnsavedChanges"
            @publish-now="publishEntry()"
          />
          <EntryPublishOverflowMenu
            :status="activeLocaleStatus"
            :is-busy="entryActions.isTransitioning.value || isSaving"
            :is-deleting="entryActions.isDeleting.value"
            :emphasize="
              activeLocaleStatus === 'draft' ||
              activeLocaleStatus === 'archived' ||
              (activeLocaleStatus === 'published' && hasUnsavedChanges)
            "
            split-trigger
            @unpublish="unpublishEntry"
            @archive="archiveEntry"
            @delete="isDeleteDialogOpen = true"
          />
        </div>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-auto">
      <div
        v-if="loadError"
        class="mx-7 my-4 rounded-sm border border-destructive/20 bg-destructive/10 p-4"
      >
        <p class="text-2xs text-destructive">{{ loadError }}</p>
      </div>

      <div
        v-else-if="isLoading"
        class="flex items-center justify-center py-16 text-sm text-muted-foreground"
      >
        Loading entry…
      </div>

      <div
        v-else
        class="mx-auto grid w-full max-w-[88rem] gap-8 px-5 py-6 md:px-7 xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-10"
      >
        <main class="entry-form-container grid min-w-0 content-start gap-8">
          <section class="entry-form-grid content-start">
            <template v-for="item in mainEntryFormItems" :key="item.id">
              <div
                v-if="item.kind === 'system' && item.key === 'title'"
                :class="[getEntryFieldWidthClass(item.width), 'grid gap-2']"
              >
                <Label for="entry-title" class="text-sm text-muted-foreground">
                  {{ m.cms_entries_column_title() }}
                </Label>
                <Input
                  id="entry-title"
                  :model-value="title"
                  class="text-lg font-medium"
                  :aria-invalid="errors.title ? 'true' : undefined"
                  :aria-describedby="errors.title ? 'entry-title-error' : undefined"
                  @update:model-value="
                    title = String($event ?? '');
                    updateSlugFromTitle()
                  "
                />
                <p v-if="errors.title" id="entry-title-error" class="text-2xs text-destructive" role="alert">
                  {{ errors.title }}
                </p>
              </div>

              <div
                v-else-if="item.kind === 'system' && item.key === 'slug'"
                :class="[getEntryFieldWidthClass(item.width), 'grid gap-2']"
              >
                <Label for="entry-slug" class="text-sm text-muted-foreground">
                  {{ m.cms_entries_column_slug() }}
                </Label>
                <Input
                  id="entry-slug"
                  :model-value="slug"
                  class="font-mono text-xs"
                  :aria-invalid="errors.slug ? 'true' : undefined"
                  :aria-describedby="errors.slug ? 'entry-slug-error' : undefined"
                  @update:model-value="
                    markSlugEdited();
                    slug = String($event ?? '')
                  "
                />
                <p v-if="errors.slug" id="entry-slug-error" class="text-2xs text-destructive" role="alert">
                  {{ errors.slug }}
                </p>
              </div>

              <div
                v-else-if="item.kind === 'system' && item.key === 'body'"
                :class="[getEntryFieldWidthClass(item.width), 'grid gap-2']"
              >
                <Label class="text-sm text-muted-foreground">
                  {{ m.cms_entry_body() }}
                </Label>
                <StructuredTextEditor
                  v-model="bodyDocument"
                  :project-root="projectRoot"
                  placeholder="Write entry body…"
                  min-height-class="min-h-96"
                />
                <p v-if="errors.body" class="text-2xs text-destructive">
                  {{ errors.body }}
                </p>
              </div>

              <CmsFrontmatterField
                v-else-if="item.kind === 'frontmatter'"
                :field="item.field"
                :model-value="frontmatterDraft[item.field.key]"
                :project-root="projectRoot"
                :collection-id="collection?.id"
                :class="getEntryFieldWidthClass(item.width)"
                @update:model-value="setFrontmatterValue(item.field.key, $event)"
              />

              <CmsRelationField
                v-else-if="item.kind === 'relation'"
                :field="item.field"
                :model-value="relationDraft[item.field.key] ?? []"
                :project-root="projectRoot"
                :class="getEntryFieldWidthClass(item.width)"
                @update:model-value="setRelationValue(item.field.key, $event)"
              />
            </template>

            <p
              v-if="errors.frontmatter"
              id="entry-frontmatter-error"
              class="entry-field-width-full text-2xs text-destructive"
              role="alert"
            >
              {{ errors.frontmatter }}
            </p>
          </section>
        </main>

        <aside
          v-if="showSidebar"
          class="grid min-w-0 content-start gap-6 xl:sticky xl:top-6 xl:self-start"
        >
          <section
            v-if="sidebarEntryFormItems.length > 0"
            class="grid gap-7"
          >
            <template v-for="item in sidebarEntryFormItems" :key="item.id">
              <CmsFrontmatterField
                v-if="item.kind === 'frontmatter'"
                :field="item.field"
                :model-value="frontmatterDraft[item.field.key]"
                :project-root="projectRoot"
                :collection-id="collection?.id"
                @update:model-value="
                  setFrontmatterValue(item.field.key, $event)
                "
              />
              <CmsRelationField
                v-else-if="item.kind === 'relation'"
                :field="item.field"
                :model-value="relationDraft[item.field.key] ?? []"
                :project-root="projectRoot"
                @update:model-value="setRelationValue(item.field.key, $event)"
              />
            </template>
          </section>

          <ActivityTimeline
            v-if="resolvedEntryId"
            :items="entryActivityItems"
          />

          <EntryRevisionsPanel
            v-if="showRevisionsPanel && resolvedEntryId"
            :key="`${revisionsPanelKey}:${resolvedEntryId}`"
            :project-root="projectRoot"
            :entry-id="resolvedEntryId"
            :entry-version="currentEntryRecord?.entry.version ?? ''"
            @restored="handleRevisionRestored"
          />
        </aside>
      </div>
    </div>

    <DeleteEntryDialog
      :open="isDeleteDialogOpen"
      :title="title || m.cms_entries_untitled()"
      :is-deleting="entryActions.isDeleting.value"
      @update:open="isDeleteDialogOpen = $event"
      @confirm="confirmDelete"
    />

  </div>
</template>

<style scoped>
.entry-form-container {
  container-type: inline-size;
}

.entry-form-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  column-gap: 1.5rem;
  row-gap: 1.75rem;
}

.entry-form-grid > * {
  grid-column: span 12;
  min-width: 0;
}

@container (min-width: 48rem) {
  .entry-form-grid > .entry-field-width-half {
    grid-column: span 6;
  }

  .entry-form-grid > .entry-field-width-third {
    grid-column: span 4;
  }

  .entry-form-grid > .entry-field-width-quarter {
    grid-column: span 3;
  }
}
</style>
