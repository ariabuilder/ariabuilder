<script setup lang="ts">
import { ref } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { m } from "@/paraglide/messages.js"
import MarkdownImportPanel from "./import/MarkdownImportPanel.vue"
import WordPressImportPanel from "./import/WordPressImportPanel.vue"
import SiteExportPanel from "./export/SiteExportPanel.vue"

defineProps<{
  projectRoot: string
}>()

const activeTab = ref<"import" | "export">("import")
const importSource = ref<"wordpress" | "markdown">("wordpress")
</script>

<template>
  <div class="page-card-enter z-10 min-w-0 space-y-0 bg-background px-0">
    <Teleport defer to="#settings-tab-actions">
      <div
        class="flex items-center gap-2"
        :aria-label="m.import_export_actions()"
      >
        <Button
          type="button"
          size="sm"
          :variant="activeTab === 'import' ? 'default' : 'outline'"
          @click="activeTab = 'import'"
        >
          <AppIcon name="upload" :size="14" class="mr-1.5 size-3.5" />
          {{ m.import_export_import() }}
        </Button>
        <Button
          type="button"
          size="sm"
          :variant="activeTab === 'export' ? 'default' : 'outline'"
          @click="activeTab = 'export'"
        >
          <AppIcon name="download" :size="14" class="mr-1.5 size-3.5" />
          {{ m.import_export_export() }}
        </Button>
      </div>
    </Teleport>

    <template v-if="activeTab === 'import'">
      <div
        class="sticky top-0 z-10 inset-shadow-xs flex h-12 shrink-0 items-stretch gap-1 border-b border-dashed border-border bg-background px-7"
        role="tablist"
        :aria-label="m.import_export_source()"
      >
        <Button
          type="button"
          size="tab"
          role="tab"
          :aria-selected="importSource === 'wordpress'"
          :variant="importSource === 'wordpress' ? 'tab-active' : 'tab'"
          @click="importSource = 'wordpress'"
        >
          WordPress
        </Button>
        <Button
          type="button"
          size="tab"
          role="tab"
          :aria-selected="importSource === 'markdown'"
          :variant="importSource === 'markdown' ? 'tab-active' : 'tab'"
          @click="importSource = 'markdown'"
        >
          Markdown
        </Button>
      </div>
      <WordPressImportPanel
        v-if="importSource === 'wordpress'"
        :project-root="projectRoot"
      />
      <MarkdownImportPanel v-else :project-root="projectRoot" />
    </template>
    <SiteExportPanel v-else :project-root="projectRoot" />
  </div>
</template>
