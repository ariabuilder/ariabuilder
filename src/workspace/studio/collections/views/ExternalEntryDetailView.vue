<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getExternalEntry } from "@/lib/workspace"
import {
  getExternalEntryTitle,
  getExternalIdentityField,
} from "../../../../../shared/externalCollectionEntries"
import type {
  ExternalCollectionEntry,
  ExternalFieldDescriptor,
} from "../../../../../shared/types"
import ExternalFieldValue from "../components/ExternalFieldValue.vue"
import { useCollectionDetail } from "../composables/useCollectionDetail"
import type { CmsNav } from "../CollectionsSurface.vue"

const props = defineProps<{
  projectRoot: string
  collectionName: string
  entryId: string
  navigate: (nav: CmsNav) => void
}>()

const projectRootRef = toRef(props, "projectRoot")
const collectionParam = toRef(props, "collectionName")
const { collection, isLoading: isCollectionLoading, loadError: collectionError } =
  useCollectionDetail(projectRootRef, collectionParam)
const entry = ref<ExternalCollectionEntry | null>(null)
const fields = ref<ExternalFieldDescriptor[]>([])
const isEntryLoading = ref(false)
const entryError = ref<string | null>(null)

const isLoading = computed(() => isCollectionLoading.value || isEntryLoading.value)
const loadError = computed(() => collectionError.value ?? entryError.value)
const title = computed(() => entry.value ? getExternalEntryTitle(entry.value) : props.entryId)
const sourceLabel = computed(() => collection.value?.source?.label ?? "External CMS")
const isLocalAstro = computed(() => collection.value?.source?.kind === "astro-local")
const identityKey = computed(() => getExternalIdentityField(fields.value)?.key)
const visibleFields = computed(() => fields.value.filter((field) =>
  field.key !== identityKey.value &&
  entry.value?.data[field.key] != null &&
  entry.value?.data[field.key] !== "",
))

watch(
  [() => collection.value?.id, () => props.entryId, () => props.projectRoot],
  async ([collectionId, entryId, root]) => {
    if (!collectionId || !entryId || !root) return
    isEntryLoading.value = true
    entryError.value = null
    try {
      const result = await getExternalEntry(root, collectionId, entryId)
      entry.value = result?.entry ?? null
      fields.value = result?.fields ?? []
      if (!result) entryError.value = "Entry not found"
    } catch (cause) {
      entryError.value = cause instanceof Error ? cause.message : "Unable to load entry"
      entry.value = null
      fields.value = []
    } finally {
      isEntryLoading.value = false
    }
  },
  { immediate: true },
)

function navigateToCollection(): void {
  props.navigate({
    view: "detail",
    collectionName: props.collectionName,
    tab: "entries",
  })
}

function navigateToCollections(): void {
  props.navigate({ view: "list" })
}
</script>

<template>
  <div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <header class="flex min-w-0 shrink-0 items-center justify-between gap-3 px-3 pb-3 pt-3">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back to collection" @click="navigateToCollection">
          <AppIcon name="chevronLeft" :size="16" aria-hidden="true" />
        </Button>
        <nav aria-label="Breadcrumb" class="flex min-w-0 items-center gap-2 text-sm">
          <button type="button" class="shrink-0 text-muted-foreground hover:text-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" @click="navigateToCollections">
            Collections
          </button>
          <span aria-hidden="true" class="shrink-0 text-muted-foreground/50">/</span>
          <button type="button" class="min-w-0 truncate text-muted-foreground hover:text-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" @click="navigateToCollection">
            {{ collection?.label ?? collectionName }}
          </button>
          <span aria-hidden="true" class="shrink-0 text-muted-foreground/50">/</span>
          <span aria-current="page" class="truncate font-medium text-muted-foreground">{{ title }}</span>
        </nav>
      </div>
    </header>

    <main class="min-h-0 flex-1 overflow-auto">
      <div v-if="isLoading" role="status" class="flex justify-center py-16 text-sm text-muted-foreground">
        Loading entry…
      </div>
      <div v-else-if="loadError" role="alert" class="mx-auto mt-8 max-w-3xl rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
        {{ loadError }}
      </div>
      <article
        v-else-if="entry && collection"
        class="mx-auto grid w-full max-w-[88rem] gap-8 px-5 py-8 md:px-7 xl:grid-cols-[minmax(0,1fr)_20rem] xl:gap-10"
      >
        <div class="min-w-0 space-y-6">
          <h1 class="min-w-0 break-words text-3xl font-medium tracking-tight text-balance">
            {{ title }}
          </h1>

          <section v-if="entry.body" aria-labelledby="record-body-heading" class="space-y-4">
            <h2 id="record-body-heading" class="text-lg font-medium">Body</h2>
            <pre class="whitespace-pre-wrap break-words rounded-lg bg-muted/20 p-4 font-sans text-sm leading-6">{{ entry.body }}</pre>
          </section>
        </div>

        <aside
          class="grid min-w-0 content-start gap-8 xl:sticky xl:top-6 xl:self-start"
          aria-label="Entry metadata"
        >
          <section aria-labelledby="record-fields-heading" class="space-y-4">
            <h2 id="record-fields-heading" class="text-lg font-medium">Entry fields</h2>
            <dl v-if="visibleFields.length" class="grid gap-3">
              <div
                v-for="field in visibleFields"
                :key="field.key"
                class="min-w-0 rounded-lg bg-muted/20 p-3.5"
              >
                <dt class="mb-1.5 text-xs font-medium text-muted-foreground">{{ field.label }}</dt>
                <dd class="min-w-0 text-sm text-foreground">
                  <ExternalFieldValue :value="entry.data[field.key]" :type="field.type" />
                </dd>
              </div>
            </dl>
            <p v-else class="text-sm text-muted-foreground">No additional fields on this entry.</p>
          </section>

          <section aria-labelledby="record-source-heading" class="space-y-4">
            <h2 id="record-source-heading" class="text-lg font-medium">Source details</h2>
            <div class="space-y-3">
              <div class="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{{ sourceLabel }}</Badge>
                <Badge variant="outline">Read-only</Badge>
                <Badge v-if="entry.locale" variant="outline">{{ entry.locale }}</Badge>
                <Badge v-if="!isLocalAstro && collection.source?.cacheState === 'stale'" variant="outline">
                  Stale cache
                </Badge>
              </div>
              <p class="text-sm text-balance text-muted-foreground">
                {{ isLocalAstro
                  ? 'This entry comes directly from the project files.'
                  : `This entry comes from ${sourceLabel}.` }}
                Editing and publishing remain with the source until you migrate this collection.
              </p>
            </div>
            <dl class="grid gap-3 text-sm">
              <div class="min-w-0">
                <dt class="text-xs text-muted-foreground">Entry ID</dt>
                <dd class="break-all font-mono text-xs">{{ entry.id }}</dd>
              </div>
              <div class="min-w-0">
                <dt class="text-xs text-muted-foreground">Source</dt>
                <dd>{{ isLocalAstro ? 'Project files' : sourceLabel }}</dd>
              </div>
              <div v-if="entry.filePath" class="min-w-0">
                <dt class="text-xs text-muted-foreground">Source file</dt>
                <dd class="break-all font-mono text-xs">{{ entry.filePath }}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </article>
    </main>
  </div>
</template>
