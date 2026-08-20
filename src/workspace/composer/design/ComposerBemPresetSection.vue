<script setup lang="ts">
import { computed, nextTick, ref } from "vue"
import { Button } from "@/components/ui/button"
import { IconPickerDialog } from "@/components/ui/icon-picker"
import { m } from "@/paraglide/messages.js"
import {
  alertIconChild,
  alertIconDisplayValue,
  ariaBemPresetOnNode,
  ariaBemVisualPresets,
  isComposerAlertNode,
  isComposerBadgeNode,
  joinClassNames,
  nodeAtMarkerPath,
  setAlertIconChoice,
  setAriaBemPresetModifier,
  splitClassNames,
  syncAlertPresetIcon,
  type AriaBemBlock,
} from "../../../../shared/composer"
import type { ElementNode } from "../../../../shared/composer/types"
import { tryUseInspectorContext } from "../inspector/useInspectorContext"
import InspectorPropertySection from "./InspectorPropertySection.vue"

const props = defineProps<{ node: ElementNode; openSection?: string | null; disabled?: boolean }>()
const emit = defineEmits<{ "update:openSection": [value: string | null] }>()
const inspector = tryUseInspectorContext()
const sectionId = "variant"
const iconPickerOpen = ref(false)

const block = computed<AriaBemBlock | null>(() => {
  if (isComposerAlertNode(props.node)) return "alert"
  if (isComposerBadgeNode(props.node)) return "badge"
  return null
})
const presets = computed(() => (block.value ? ariaBemVisualPresets(block.value) ?? [] : []))
const classValue = computed(() => props.node.props.class)
const classIsDynamic = computed(() => Boolean(classValue.value && classValue.value.type !== "string"))
const classNames = computed(() =>
  classValue.value?.type === "string" ? splitClassNames(classValue.value.value) : [],
)
const current = computed(() => {
  if (!block.value) return null
  return ariaBemPresetOnNode(classNames.value, block.value)
})
const options = computed(() => {
  if (block.value === "badge") return ["default", ...presets.value]
  return [...presets.value]
})
const selected = computed(() => current.value ?? (block.value === "badge" ? "default" : "info"))
const insertDefault = computed(() => (block.value === "alert" ? "info" : null))
const hasChanges = computed(() => current.value !== insertDefault.value)
const canEdit = computed(() =>
  Boolean(block.value && !classIsDynamic.value && classNames.value.includes(`aria-${block.value}`)),
)
const resetDisabled = computed(() => props.disabled || !canEdit.value)
const title = computed(() =>
  block.value === "alert"
    ? m.composer_inspector_section_alert()
    : m.composer_inspector_section_badge(),
)
const iconNode = computed(() => (block.value === "alert" ? alertIconChild(props.node)?.node ?? null : null))
const iconValue = computed(() => alertIconDisplayValue(iconNode.value))
const iconIsDynamic = computed(() => Boolean(
  iconNode.value?.props.class && iconNode.value.props.class.type !== "string"
  || iconNode.value?.props.src && iconNode.value.props.src.type !== "string",
))

function optionLabel(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function mutateAlert(label: string, update: (node: ElementNode) => string | null) {
  const path = inspector?.selectedPath.value
  if (!path || props.disabled || !canEdit.value) return
  inspector.document.commitInspectorMutation(label, (model) => {
    const selectedNode = nodeAtMarkerPath(model.nodes, path)
    if (selectedNode?.kind !== "element" || selectedNode.id !== props.node.id) {
      return { ok: false, selectPath: path, reason: "Element selection changed" }
    }
    const reason = update(selectedNode)
    if (reason) return { ok: false, selectPath: path, reason }
    return { ok: true, selectPath: path }
  }, { immediate: true, coalesceKey: null })
}

function applyPreset(value: string) {
  const target = block.value
  if (!target) return
  const modifier = value === "default" ? null : value
  mutateAlert(`Set ${target} variant`, (selectedNode) => {
    if (selectedNode.props.class && selectedNode.props.class.type !== "string") {
      return "Classes are expression-bound"
    }
    const names = selectedNode.props.class?.type === "string"
      ? splitClassNames(selectedNode.props.class.value)
      : []
    const next = setAriaBemPresetModifier(names, target, modifier)
    if (!next.ok) return next.reason
    const joined = joinClassNames(next.names)
    if (joined) selectedNode.props.class = { type: "string", value: joined }
    else delete selectedNode.props.class
    if (target === "alert" && modifier) syncAlertPresetIcon(selectedNode, modifier)
    return null
  })
}

function resetVariant() {
  if (resetDisabled.value || !hasChanges.value) return
  applyPreset(insertDefault.value ?? "default")
}

function chooseAlertIcon(value: string) {
  iconPickerOpen.value = false
  if (iconIsDynamic.value) return
  mutateAlert(value ? "Choose alert icon" : "Remove alert icon", (selectedNode) => {
    if (iconIsDynamic.value) return "Alert icon is expression-bound"
    setAlertIconChoice(selectedNode, value)
    return null
  })
}

async function onVariantKeydown(event: KeyboardEvent) {
  if (resetDisabled.value) return
  const values = options.value
  const currentIndex = values.indexOf(selected.value)
  let index = currentIndex < 0 ? 0 : currentIndex
  if (["ArrowRight", "ArrowDown"].includes(event.key)) index = (index + 1) % values.length
  else if (["ArrowLeft", "ArrowUp"].includes(event.key)) index = (index - 1 + values.length) % values.length
  else if (event.key === "Home") index = 0
  else if (event.key === "End") index = values.length - 1
  else return
  event.preventDefault()
  const next = values[index]
  if (!next) return
  const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]')
  applyPreset(next)
  await nextTick()
  ;(group?.querySelector(`[data-bem-preset="${next}"]`) as HTMLElement | null)?.focus()
}
</script>

<template>
  <InspectorPropertySection
    v-if="block"
    :title="title"
    :open="openSection === sectionId"
    :has-changes="hasChanges"
    :show-reset="openSection === sectionId && hasChanges"
    :reset-disabled="resetDisabled"
    :reset-label="`Reset ${title}`"
    @update:open="emit('update:openSection', $event ? sectionId : openSection === sectionId ? null : openSection ?? null)"
    @reset="resetVariant"
  >
    <div class="space-y-3">
      <div
        class="grid gap-1"
        :class="options.length > 3 ? 'grid-cols-2' : 'grid-cols-3'"
        role="radiogroup"
        :aria-label="m.composer_inspector_bem_variant()"
        data-testid="bem-preset-select"
      >
        <Button
          v-for="item in options"
          :key="item"
          type="button"
          size="sm"
          :variant="selected === item ? 'default' : 'outline'"
          role="radio"
          :aria-checked="selected === item"
          :tabindex="selected === item ? 0 : -1"
          :data-bem-preset="item"
          :disabled="resetDisabled"
          class="h-8 px-1 text-[10px] capitalize"
          @click="applyPreset(item)"
          @keydown="onVariantKeydown"
        >
          {{ optionLabel(item) }}
        </Button>
      </div>

      <div v-if="block === 'alert'" class="grid grid-cols-[68px_1fr] items-center gap-2">
        <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{{ m.composer_inspector_section_icon() }}</span>
        <div class="flex min-w-0 gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            class="h-8 min-w-0 flex-1 truncate text-[11px]"
            :disabled="disabled || iconIsDynamic"
            data-testid="alert-icon-choose"
            @click="iconPickerOpen = true"
          >
            {{ iconValue ? iconValue : "Choose icon" }}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            class="h-8"
            :disabled="disabled || iconIsDynamic || !iconNode"
            aria-label="Remove alert icon"
            @click="chooseAlertIcon('')"
          >
            Clear
          </Button>
        </div>
      </div>
    </div>
    <IconPickerDialog
      v-if="block === 'alert'"
      :open="iconPickerOpen"
      :project-root="inspector?.projectPath.value ?? ''"
      :value="iconValue"
      @update:open="iconPickerOpen = $event"
      @select="chooseAlertIcon"
    />
  </InspectorPropertySection>
</template>
