<script setup lang="ts">
import { computed, ref } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  describeComposerCmsSelection,
  nodeAtMarkerPath,
} from "../../../../shared/composer"
import type { EditableNode } from "../../../../shared/composer/types"
import ComposerCmsSection from "../props/ComposerCmsSection.vue"
import { tryUseComposerDocument } from "../useComposerDocumentSession"

const props = defineProps<{
  path: string
}>()

type Control = {
  id: "text" | "src" | "alt" | "href" | "loop"
  label: string
  icon: "databaseLine" | "image" | "link" | "collections"
  targetProp?: string
  mode?: "context" | "entry" | "loop"
}

const doc = tryUseComposerDocument()
const openControl = ref<Control["id"] | null>(null)
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
    result.push(
      { id: "src", label: "Bind image source", icon: "image", targetProp: "src" },
      { id: "alt", label: "Bind alternative text", icon: "databaseLine", targetProp: "alt" },
    )
  } else if (tag === "a") {
    result.push({ id: "href", label: "Bind link destination", icon: "link", targetProp: "href" })
    if (state.canBindText) result.push({ id: "text", label: "Bind link label", icon: "databaseLine" })
  } else if (state.canBindText) {
    result.push({ id: "text", label: "Bind text field", icon: "databaseLine" })
  } else if (state.canBindProps) {
    result.push({ id: "text", label: "Bind element property", icon: "databaseLine" })
  }
  if (state.canRepeat) {
    result.push({ id: "loop", label: value.kind === "map" ? "Manage collection loop" : "Repeat from collection", icon: "collections", mode: "loop" })
  }
  return result
})

function propIsBound(targetProp?: string): boolean {
  const value = node.value
  if (!value || !targetProp || !("props" in value)) return false
  const prop = value.props[targetProp]
  return prop?.type === "expr" && (
    prop.value.includes("@aria-cms-fallback") ||
    (selection.value?.contexts ?? []).some((context) => new RegExp(`\\b${context}\\b`).test(prop.value))
  )
}

function isActive(control: Control): boolean {
  if (control.id === "loop") return selection.value?.ownership !== "none"
  if (control.targetProp) return propIsBound(control.targetProp)
  return Boolean(selection.value?.field || selection.value?.bindingCount)
}

function tooltip(control: Control): string {
  const state = selection.value
  if (!isActive(control) || !state) return control.label
  const detail = state.field ?? state.collection
  return detail ? `${control.label}: ${detail}` : control.label
}
</script>

<template>
  <template v-for="control in controls" :key="control.id">
    <Popover
      :open="openControl === control.id"
      @update:open="openControl = $event ? control.id : null"
    >
      <Tooltip>
        <TooltipTrigger as-child>
          <PopoverTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              class="h-6! w-6! shrink-0 cursor-pointer transition-colors active:scale-[0.96] motion-reduce:transform-none"
              :class="isActive(control) ? 'border border-primary/45 bg-primary/10 text-primary' : ''"
              :aria-label="tooltip(control)"
              :aria-pressed="isActive(control)"
              @click.stop
            >
              <AppIcon :name="control.icon" :size="14" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{{ tooltip(control) }}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="bottom"
        align="start"
        :side-offset="6"
        class="w-80 p-0"
        @click.stop
      >
        <ComposerCmsSection
          embedded
          :active="openControl === control.id"
          :initial-mode="control.mode ?? 'context'"
          :initial-target-prop="control.targetProp"
        />
      </PopoverContent>
    </Popover>
  </template>
</template>
