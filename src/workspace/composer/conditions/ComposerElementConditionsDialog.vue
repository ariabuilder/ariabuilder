<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  addOtherwiseBranchAtPath,
  conditionalPathAtOrAbove,
  removeConditionAtPath,
  setConditionAtPath,
  wrapNodesInConditionAtPaths,
} from "../../../../shared/composer/conditions"
import type { ConditionalNode } from "../../../../shared/composer/types"
import { cloneConditionSet, type ConditionSet } from "../../../../shared/conditions"
import { locateAtPath } from "../../../../shared/composer/mutate"
import { tryUseInspectorContext } from "../inspector/useInspectorContext"
import { conditionSourcesForDocument } from "./conditionSources"
import { useConditionCollections } from "./useConditionCollections"
import ComposerConditionBuilder from "./ComposerConditionBuilder.vue"

const open = defineModel<boolean>("open", { default: false })
const inspector = tryUseInspectorContext()
const error = ref("")
const draft = ref<ConditionSet | undefined>()
const addOtherwise = ref(false)
const removeOpen = ref(false)

const model = computed(() => inspector?.document.model.value ?? null)
const selectedPath = computed(() => inspector?.selectedPath.value ?? null)
const projectPath = computed(() => inspector?.document.projectPath.value ?? "")
const {
  collections,
  loading: sourcesLoading,
  error: sourcesError,
  hasRegisteredCollections,
} = useConditionCollections(open, projectPath)
const conditionPath = computed(() => {
  const current = model.value
  const path = selectedPath.value
  return current && path ? conditionalPathAtOrAbove(current, path) : null
})
const conditionNode = computed((): ConditionalNode | null => {
  const current = model.value
  const path = conditionPath.value
  const node = current && path ? locateAtPath(current.nodes, path)?.node : null
  return node?.kind === "conditional" ? node : null
})
const custom = computed(() => Boolean(conditionNode.value && !conditionNode.value.condition))
const sources = computed(() => conditionSourcesForDocument(model.value, selectedPath.value, collections.value))
const hasCmsSources = computed(() => sources.value.some((source) => source.source.provider === "cms"))
const readOnly = computed(() => !inspector?.document.editable.value || Boolean(inspector?.isContextSelection.value))

watch(open, (value) => {
  if (!value) return
  draft.value = conditionNode.value?.condition ? cloneConditionSet(conditionNode.value.condition) : undefined
  addOtherwise.value = conditionNode.value?.mode === "ternary"
  error.value = ""
  removeOpen.value = false
})

function save() {
  const path = selectedPath.value
  const currentConditionPath = conditionPath.value
  const next = draft.value
  if (!path || !next || readOnly.value) return
  const committed = inspector?.document.commitInspectorMutation(
    currentConditionPath ? "Edit condition" : "Add condition",
    (nextModel) => {
      if (currentConditionPath) {
        const result = setConditionAtPath(nextModel, currentConditionPath, next)
        if (!result.ok) return result
        const node = locateAtPath(nextModel.nodes, currentConditionPath)?.node
        if (addOtherwise.value && node?.kind === "conditional" && node.mode !== "ternary") {
          const branch = addOtherwiseBranchAtPath(nextModel, currentConditionPath)
          return branch.ok ? { ...branch, selectPath: path } : branch
        }
        return { ...result, selectPath: path }
      }
      const selections = inspector.selection.selections.value.map((selection) => selection.path)
      const result = wrapNodesInConditionAtPaths(nextModel, selections, path, next)
      if (!result.ok || !addOtherwise.value || !result.selectPath) return result
      const wrappedPath = conditionalPathAtOrAbove(nextModel, result.selectPath)
      if (!wrappedPath) return { ok: false, selectPath: result.selectPath, reason: "Unable to open the Otherwise branch." }
      const branch = addOtherwiseBranchAtPath(nextModel, wrappedPath)
      return branch.ok ? result : branch
    },
    { immediate: true, coalesceKey: null },
  ) ?? false
  if (!committed) {
    error.value = inspector?.document.saveError.value || "Unable to save this condition. Check the selected elements and try again."
    return
  }
  open.value = false
}

function remove(choice: "shown" | "otherwise" | "both") {
  const path = conditionPath.value
  if (!path || readOnly.value) return
  const committed = inspector?.document.commitInspectorMutation(
    "Remove condition",
    (nextModel) => removeConditionAtPath(nextModel, path, choice),
    { immediate: true, coalesceKey: null },
  ) ?? false
  if (!committed) {
    error.value = "Unable to remove this condition. Reload the document and try again."
    removeOpen.value = false
    return
  }
  removeOpen.value = false
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[85vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ conditionNode ? "Edit conditions" : "Add conditions" }}</DialogTitle>
        <DialogDescription>
          Show this content when every rule in any alternative matches.
        </DialogDescription>
      </DialogHeader>

      <div
        v-if="custom"
        class="rounded-md border border-dashed border-border/70 bg-muted/25 px-3 py-3 text-sm"
      >
        <p class="font-medium text-foreground">Custom condition</p>
        <p class="mt-1 text-xs leading-relaxed text-muted-foreground">This expression is preserved exactly. Edit it in Code to avoid changing its meaning.</p>
        <code class="mt-2 block overflow-x-auto rounded-sm bg-muted px-2 py-1.5 text-[11px]">{{ conditionNode?.test }}</code>
      </div>

      <ComposerConditionBuilder
        v-else
        v-model="draft"
        :sources="sources"
        :disabled="readOnly"
      />

      <p v-if="!custom && sourcesLoading" role="status" class="text-xs text-muted-foreground">
        Loading CMS condition options…
      </p>
      <p v-else-if="!custom && sourcesError" role="status" class="text-xs text-muted-foreground">
        CMS fields could not be loaded. In-scope variables are still available.
      </p>
      <p
        v-else-if="!custom && hasRegisteredCollections && !hasCmsSources"
        class="rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
      >
        CMS conditions appear when this content is inside a CMS loop or the page has loaded a CMS entry. Bind CMS content first, then choose its fields here.
      </p>
      <p
        v-else-if="!custom && !hasCmsSources"
        class="rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
      >
        No CMS collection is available to this page yet. Create or connect a collection, then bind its content before adding a CMS condition.
      </p>

      <label
        v-if="!custom && draft"
        class="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-md border border-dashed border-border/70 px-3 py-2 text-sm"
      >
        <span>
          <span class="block font-medium text-foreground">Add Otherwise content</span>
          <span class="block text-xs text-muted-foreground">Show a second branch when the condition does not match.</span>
        </span>
        <input v-model="addOtherwise" type="checkbox" class="size-4 accent-primary" :disabled="readOnly || conditionNode?.mode === 'ternary'" />
      </label>

      <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>

      <DialogFooter class="sm:justify-between">
        <Button
          v-if="conditionNode && !custom"
          type="button"
          variant="ghost"
          class="text-destructive hover:text-destructive"
          :disabled="readOnly"
          @click="conditionNode.mode === 'ternary' ? removeOpen = true : remove('shown')"
        >
          <AppIcon name="trash" :size="14" aria-hidden="true" />
          Remove condition
        </Button>
        <span v-else />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="outline" @click="open = false">Cancel</Button>
          <Button v-if="!custom" type="button" :disabled="readOnly || !draft" @click="save">Save conditions</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="removeOpen">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>Remove condition</DialogTitle>
        <DialogDescription>Choose which content stays in the page. Nothing is discarded until you choose.</DialogDescription>
      </DialogHeader>
      <div class="grid gap-2">
        <Button type="button" variant="outline" class="justify-start" @click="remove('shown')">Keep shown content</Button>
        <Button type="button" variant="outline" class="justify-start" @click="remove('otherwise')">Keep Otherwise content</Button>
        <Button type="button" variant="outline" class="justify-start" @click="remove('both')">Keep both</Button>
      </div>
      <DialogFooter><Button type="button" variant="ghost" @click="removeOpen = false">Cancel</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>
