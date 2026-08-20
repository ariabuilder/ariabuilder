<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  inferComposerContentBindingSource,
  isComposerContentBindingSource,
  type ComposerContentBindingSource,
} from "../../../../shared/composer"
import InspectorPropertySection from "../design/InspectorPropertySection.vue"
import { tryUseComposerBeacon } from "../selection/useComposerBeacon"
import { tryUseComposerDocument } from "../useComposerDocumentSession"
import ComposerCmsSection from "./ComposerCmsSection.vue"
import ComposerDataSection from "./ComposerDataSection.vue"
import ComposerTranslationSection from "./ComposerTranslationSection.vue"

const beacon = tryUseComposerBeacon()
const doc = tryUseComposerDocument()
const selectedPath = computed(() => beacon?.selectedPath.value ?? null)
const inferred = computed((): ComposerContentBindingSource => {
  const model = doc?.model.value
  const path = selectedPath.value
  return model && path ? inferComposerContentBindingSource(model, path) : "none"
})
const source = ref<ComposerContentBindingSource>("none")
const explicitPath = ref<string | null>(null)
const open = ref(false)

watch(
  [selectedPath, inferred],
  ([path, next], previous) => {
    const pathChanged = previous?.[0] !== path
    if (explicitPath.value !== path) explicitPath.value = null
    if (explicitPath.value == null) source.value = next
    if (pathChanged) open.value = false
  },
  { immediate: true },
)

function onSource(value: unknown) {
  if (!isComposerContentBindingSource(value)) return
  explicitPath.value = selectedPath.value
  source.value = value
  open.value = true
}
</script>

<template>
  <InspectorPropertySection
    title="Content binding"
    v-model:open="open"
    :has-changes="source !== 'none'"
    :data-content-binding-source="source"
  >
    <div class="space-y-3">
      <label class="block space-y-1.5">
        <Label class="text-[10px] text-muted-foreground">Source type</Label>
        <Select :model-value="source" @update:model-value="onSource">
          <SelectTrigger class="h-8 text-xs" aria-label="Source type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="project">Project data</SelectItem>
            <SelectItem value="translations">Project translations</SelectItem>
            <SelectItem value="cms">Aria CMS</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <p v-if="source === 'none'" class="text-[11px] leading-relaxed text-muted-foreground">
        This selection uses authored content. Choose a source to bind it.
      </p>
      <ComposerDataSection v-else-if="source === 'project'" />
      <ComposerTranslationSection v-else-if="source === 'translations'" />
      <ComposerCmsSection v-else-if="source === 'cms'" embedded active />
    </div>
  </InspectorPropertySection>
</template>
