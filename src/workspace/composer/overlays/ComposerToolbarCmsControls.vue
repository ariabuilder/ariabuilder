<script setup lang="ts">
import { computed } from "vue"
import {
  describeComposerCmsSelection,
  nodeAtMarkerPath,
} from "../../../../shared/composer"
import type { EditableNode } from "../../../../shared/composer/types"
import { tryUseComposerDocument } from "../useComposerDocumentSession"
import ComposerCmsQuickPicker from "./ComposerCmsQuickPicker.vue"
import {
  composerCmsQuickTargetExpression,
  composerCmsQuickTargets,
  type ComposerCmsQuickControl,
} from "./composerCmsQuickTargets"

const props = defineProps<{
  path: string
}>()

type Control = {
  id: ComposerCmsQuickControl
  label: string
  icon: "databaseLine" | "image" | "link" | "collections"
}

const doc = tryUseComposerDocument()
const node = computed(() => doc?.model.value
  ? nodeAtMarkerPath(doc.model.value.nodes, props.path)
  : null)
const selection = computed(() => doc?.model.value
  ? describeComposerCmsSelection(doc.model.value, props.path)
  : null)

function tagName(value: EditableNode | null): string {
  return value && "name" in value ? value.name.toLowerCase() : ""
}

const controls = computed<Control[]>(() => {
  const value = node.value
  const state = selection.value
  if (!value || !state) return []
  const tag = tagName(value)
  const result: Control[] = []
  if (tag === "img" || tag === "picture") {
    result.push({ id: "image", label: "Bind image fields", icon: "image" })
  } else if (tag === "a") {
    result.push({ id: "link", label: "Bind link fields", icon: "link" })
  } else if (state.canBindText) {
    result.push({ id: "text", label: "Bind text field", icon: "databaseLine" })
  }
  if (state.canRepeat) {
    result.push({
      id: "loop",
      label: value.kind === "map" ? "Manage collection loop" : "Repeat from collection",
      icon: "collections",
    })
  }
  return result
})

function isActive(control: Control): boolean {
  if (control.id === "loop") return selection.value?.ownership !== "none"
  const model = doc?.model.value
  if (!model) return false
  return composerCmsQuickTargets(model, props.path, control.id).some((target) => {
    const expression = composerCmsQuickTargetExpression(model, target)
    return expression.includes("@aria-cms-fallback") || expression.includes("@aria-cms-field:")
  })
}
</script>

<template>
  <ComposerCmsQuickPicker
    v-for="control in controls"
    :key="control.id"
    :path="path"
    :control="control.id"
    :icon="control.icon"
    :label="control.label"
    :active="isActive(control)"
  />
</template>
