<script setup lang="ts">
import { computed } from "vue"
import type { CollectionKind } from "../../../../../shared/cms"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import CollectionTemplateCard, {
  type CollectionTemplatePageOption,
} from "./CollectionTemplateCard.vue"

const props = withDefaults(
  defineProps<{
    listPageFile?: string
    templatePageFile?: string
    urlPattern?: string
    pageOptions?: readonly CollectionTemplatePageOption[]
    urlPatternError?: string
    collectionKind?: CollectionKind
    disabled?: boolean
  }>(),
  {
    listPageFile: "",
    templatePageFile: "",
    urlPattern: "",
    pageOptions: () => [],
    urlPatternError: "",
    collectionKind: "content",
    disabled: false,
  },
)

const emit = defineEmits<{
  "update:listPageFile": [value: string]
  "update:templatePageFile": [value: string]
  "update:urlPattern": [value: string]
}>()

const showUrlPatternControls = computed(() =>
  Boolean(props.templatePageFile.trim()),
)

const entryTemplateLabel = computed(() =>
  props.collectionKind === "tags" ? "Tag URL template" : "Entry page",
)

const entryTemplateDescription = computed(() =>
  props.collectionKind === "tags"
    ? "Page used to render a single tag archive."
    : "Dynamic page used to render a single entry (e.g. src/pages/blog/[slug].astro).",
)

const listTemplateDescription = computed(() =>
  props.collectionKind === "tags"
    ? "Page used to list all tags."
    : "Index page that lists entries in this collection.",
)

const listPathHint = computed(() => {
  const match = props.pageOptions.find((p) => p.file === props.listPageFile)
  return match?.route ?? ""
})

const entryPathHint = computed(() => {
  const match = props.pageOptions.find((p) => p.file === props.templatePageFile)
  return match?.route ?? ""
})
</script>

<template>
  <section class="grid gap-5" data-testid="collection-publishing-section">
    <div class="grid gap-1">
      <h2 class="m-0 text-sm font-medium text-muted-foreground">Publishing</h2>
      <p class="m-0 text-xs leading-snug text-muted-foreground">
        Bind list and entry templates, then set the public URL pattern for
        entries.
      </p>
    </div>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
      <CollectionTemplateCard
        class="min-w-0"
        label="List template"
        :description="listTemplateDescription"
        :page-file="listPageFile"
        :page-options="pageOptions"
        :path-hint="listPathHint"
        :disabled="disabled"
        @update:page-file="emit('update:listPageFile', $event)"
      />
      <CollectionTemplateCard
        class="min-w-0"
        :label="entryTemplateLabel"
        :description="entryTemplateDescription"
        :page-file="templatePageFile"
        :page-options="pageOptions"
        :path-hint="entryPathHint"
        :disabled="disabled"
        @update:page-file="emit('update:templatePageFile', $event)"
      />
    </div>

    <div v-if="showUrlPatternControls" class="grid gap-2">
      <div class="flex items-center gap-2">
        <Label>URL pattern</Label>
        <Badge variant="outline" class="text-2xs">
          e.g. /blog/{'{'}slug{'}'}
        </Badge>
      </div>
      <Input
        :model-value="urlPattern"
        :disabled="disabled"
        placeholder="/blog/{slug}"
        class="font-mono text-xs"
        @update:model-value="emit('update:urlPattern', String($event ?? ''))"
      />
      <p v-if="urlPatternError" class="m-0 text-2xs text-destructive">
        {{ urlPatternError }}
      </p>
      <p v-else class="m-0 text-2xs text-muted-foreground">
        Must include a single <code class="font-mono">{'{'}slug{'}'}</code> segment.
      </p>
    </div>
  </section>
</template>
