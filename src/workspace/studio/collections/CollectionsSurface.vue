<script setup lang="ts">
import { ref, watch } from "vue"
import {
  StudioPanelShell,
} from "@/workspace/studio/core"
import CollectionDetailView from "./views/CollectionDetailView.vue"
import CollectionsView from "./views/CollectionsView.vue"
import EntryDetailView from "./views/EntryDetailView.vue"
import ExternalEntryDetailView from "./views/ExternalEntryDetailView.vue"
import {
  clearPendingCmsNavigation,
  usePendingCmsNavigation,
} from "@/workspace/globalSearchNavigation"

export type CmsNav =
  | { view: "list" }
  | {
      view: "detail"
      collectionName: string
      tab: "entries" | "configure"
    }
  | {
      view: "entry"
      collectionName: string
      entryIdOrSlug: string
      locale?: string
    }
  | {
      view: "external-entry"
      collectionName: string
      entryId: string
    }

const props = defineProps<{
  projectRoot: string
}>()

const nav = ref<CmsNav>({ view: "list" })
const pendingGlobalNavigation = usePendingCmsNavigation()

watch(
  () => props.projectRoot,
  () => {
    nav.value = { view: "list" }
  },
  { immediate: true },
)

function navigate(next: CmsNav) {
  nav.value = next
}

watch(
  pendingGlobalNavigation,
  (pending) => {
    if (!pending) return
    nav.value = pending
    clearPendingCmsNavigation(pending)
  },
  { immediate: true },
)
</script>

<template>
  <StudioPanelShell variant="rail" content-class="page-card-enter">
    <KeepAlive :include="['CollectionsView', 'CollectionDetailView']">
      <CollectionsView
        v-if="nav.view === 'list'"
        :key="`list:${projectRoot}`"
        :project-root="projectRoot"
        :navigate="navigate"
      />
      <CollectionDetailView
        v-else-if="nav.view === 'detail'"
        :key="`detail:${projectRoot}:${nav.collectionName}:${nav.tab}`"
        :project-root="projectRoot"
        :collection-name="nav.collectionName"
        :tab="nav.tab"
        :navigate="navigate"
      />
      <EntryDetailView
        v-else-if="nav.view === 'entry'"
        :key="`entry:${projectRoot}:${nav.collectionName}:${nav.entryIdOrSlug}:${nav.locale ?? ''}`"
        :project-root="projectRoot"
        :collection-name="nav.collectionName"
        :entry-id-or-slug="nav.entryIdOrSlug"
        :locale="nav.locale"
        :navigate="navigate"
      />
      <ExternalEntryDetailView
        v-else
        :key="`external-entry:${projectRoot}:${nav.collectionName}:${nav.entryId}`"
        :project-root="projectRoot"
        :collection-name="nav.collectionName"
        :entry-id="nav.entryId"
        :navigate="navigate"
      />
    </KeepAlive>
  </StudioPanelShell>
</template>
