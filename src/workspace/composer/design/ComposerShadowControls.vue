<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { ColorField } from "@/components/ui/color-picker"
import { VariableAssignableInput } from "@/components/ui/variable-reference-picker"
import { m } from "@/paraglide/messages.js"
import {
  createDefaultShadowLayer,
  parseShadowValue,
  serializeShadowValue,
  type ShadowKind,
  type ShadowLayer,
} from "../../../../shared/composer"
import { beginPointerScrub } from "../inspector/useInspectorLiveStyleSession"

type ShadowProperty = "box-shadow" | "text-shadow"
type ShadowField = "offsetX" | "offsetY" | "blur" | "spread"
type ShadowEditorState = {
  mode: "layers" | "raw"
  layers: ShadowLayer[]
  raw: string
  error: string
}

const props = withDefaults(defineProps<{
  values: Partial<Record<ShadowProperty, string>>
  inheritedProperties?: readonly string[]
  resetKey?: string
  disabled?: boolean
}>(), {
  inheritedProperties: () => [],
  resetKey: "",
  disabled: false,
})

const emit = defineEmits<{
  preview: [updates: Record<string, string>]
  commit: [updates: Record<string, string>]
  cancel: []
}>()

const PROPERTY_BY_KIND: Record<ShadowKind, ShadowProperty> = {
  box: "box-shadow",
  text: "text-shadow",
}

const FIELD_ICON: Record<ShadowField, "arrowLeftRight" | "arrowUpDown" | "blur" | "expandHuge"> = {
  offsetX: "arrowLeftRight",
  offsetY: "arrowUpDown",
  blur: "blur",
  spread: "expandHuge",
}

const states = ref<Record<ShadowKind, ShadowEditorState>>({
  box: { mode: "layers", layers: [], raw: "none", error: "" },
  text: { mode: "layers", layers: [], raw: "none", error: "" },
})
const forcedRaw = ref<Record<ShadowKind, boolean>>({ box: false, text: false })
const scrubbing = new Set<string>()
const committedLengthDrafts = new Map<string, string>()

const valueSignature = computed(() => [
  props.values["box-shadow"] ?? "",
  props.values["text-shadow"] ?? "",
].join("\u0000"))

function kindLabel(kind: ShadowKind): string {
  return kind === "box" ? m.composer_shadow_box() : m.composer_shadow_text()
}

function rawValue(kind: ShadowKind): string {
  return props.values[PROPERTY_BY_KIND[kind]]?.trim() || "none"
}

function syncKind(kind: ShadowKind): void {
  const source = rawValue(kind)
  const parsed = parseShadowValue(kind, source)
  if (forcedRaw.value[kind] || parsed.mode === "raw") {
    states.value[kind] = {
      mode: "raw",
      layers: parsed.mode === "layers" ? parsed.layers : [],
      raw: source,
      error: "",
    }
    return
  }
  states.value[kind] = { mode: "layers", layers: parsed.layers, raw: source, error: "" }
}

function syncAll(): void {
  syncKind("box")
  syncKind("text")
}

watch(valueSignature, syncAll, { immediate: true })
watch(() => props.resetKey, () => {
  forcedRaw.value = { box: false, text: false }
  syncAll()
})

function inherited(kind: ShadowKind): boolean {
  return props.inheritedProperties.includes(PROPERTY_BY_KIND[kind])
}

function serialized(kind: ShadowKind): string {
  const state = states.value[kind]
  return state.mode === "raw" ? state.raw.trim() : serializeShadowValue(kind, state.layers)
}

function updateFor(kind: ShadowKind, value = serialized(kind)): Record<string, string> {
  return { [PROPERTY_BY_KIND[kind]]: value }
}

function validCss(kind: ShadowKind, value: string): boolean {
  if (!value.trim()) return true
  const property = PROPERTY_BY_KIND[kind]
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    return CSS.supports(property, value)
  }
  if (typeof document === "undefined") return true
  const style = document.createElement("div").style
  style.setProperty(property, value)
  return Boolean(style.getPropertyValue(property))
}

function previewKind(kind: ShadowKind): void {
  states.value[kind].error = ""
  emit("preview", updateFor(kind))
}

function commitKind(kind: ShadowKind): void {
  const value = serialized(kind)
  if (!validCss(kind, value)) {
    const rejected = {
      ...states.value[kind],
      layers: states.value[kind].layers.map((layer) => ({ ...layer })),
    }
    emit("cancel")
    void nextTick(() => {
      states.value[kind] = {
        ...rejected,
        error: m.composer_shadow_invalid({ property: kindLabel(kind) }),
      }
    })
    return
  }
  states.value[kind].error = ""
  emit("commit", updateFor(kind, value))
}

function layerCopy(kind: ShadowKind): ShadowLayer[] {
  return states.value[kind].layers.map((layer) => ({ ...layer }))
}

function setLayers(kind: ShadowKind, layers: ShadowLayer[], commit = false): void {
  states.value[kind] = { ...states.value[kind], mode: "layers", layers, error: "" }
  if (commit) commitKind(kind)
  else previewKind(kind)
}

function updateLayer(kind: ShadowKind, index: number, field: keyof ShadowLayer, value: string | boolean, commit = false): void {
  const layers = layerCopy(kind)
  const layer = layers[index]
  if (!layer) return
  layers[index] = { ...layer, [field]: value }
  setLayers(kind, layers, commit)
}

function scrubKey(kind: ShadowKind, index: number, field: ShadowField): string {
  return `${kind}:${index}:${field}`
}

function updateLength(kind: ShadowKind, index: number, field: ShadowField, value: string): void {
  committedLengthDrafts.delete(scrubKey(kind, index, field))
  updateLayer(kind, index, field, value)
}

function commitLength(kind: ShadowKind, index: number, field: ShadowField, value: string): void {
  const key = scrubKey(kind, index, field)
  if (scrubbing.has(key) || committedLengthDrafts.get(key) === value) return
  committedLengthDrafts.set(key, value)
  updateLayer(kind, index, field, value, true)
}

function startScrub(kind: ShadowKind, index: number, field: ShadowField, event: MouseEvent): void {
  if (props.disabled || !(event.target instanceof HTMLInputElement)) return
  const layer = states.value[kind].layers[index]
  const source = layer?.[field]
  if (typeof source !== "string") return
  const matched = source.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))([a-zA-Z%]+)?$/)
  if (!matched) return
  const key = scrubKey(kind, index, field)
  const unit = matched[2] ?? "px"
  const format = (value: number) => `${Math.round(value)}${unit}`
  scrubbing.add(key)
  beginPointerScrub({
    event,
    value: Number.parseFloat(matched[1] ?? "0"),
    pixelsPerStep: 1,
    onPreview: (value) => updateLayer(kind, index, field, format(value)),
    onCommit: (value) => {
      scrubbing.delete(key)
      updateLayer(kind, index, field, format(value), true)
    },
    onCancel: () => {
      scrubbing.delete(key)
      emit("cancel")
    },
  })
  const release = () => scrubbing.delete(key)
  window.addEventListener("pointerup", release, { once: true })
  window.addEventListener("mouseup", release, { once: true })
}

function addLayer(kind: ShadowKind): void {
  setLayers(kind, [...layerCopy(kind), createDefaultShadowLayer(kind)], true)
}

function duplicateLayer(kind: ShadowKind, index: number): void {
  const layers = layerCopy(kind)
  const layer = layers[index]
  if (!layer) return
  layers.splice(index + 1, 0, { ...layer })
  setLayers(kind, layers, true)
}

function deleteLayer(kind: ShadowKind, index: number): void {
  const layers = layerCopy(kind)
  layers.splice(index, 1)
  setLayers(kind, layers, true)
}

function moveLayer(kind: ShadowKind, index: number, direction: -1 | 1): void {
  const layers = layerCopy(kind)
  const destination = index + direction
  if (destination < 0 || destination >= layers.length) return
  const [layer] = layers.splice(index, 1)
  if (!layer) return
  layers.splice(destination, 0, layer)
  setLayers(kind, layers, true)
}

function editRaw(kind: ShadowKind): void {
  forcedRaw.value[kind] = true
  states.value[kind] = {
    ...states.value[kind],
    mode: "raw",
    raw: serialized(kind),
    error: "",
  }
}

function editLayers(kind: ShadowKind): void {
  const parsed = parseShadowValue(kind, states.value[kind].raw)
  if (parsed.mode === "raw") {
    states.value[kind].error = m.composer_shadow_cannot_structure()
    return
  }
  forcedRaw.value[kind] = false
  states.value[kind] = { mode: "layers", layers: parsed.layers, raw: states.value[kind].raw, error: "" }
}

function previewRaw(kind: ShadowKind, value: string): void {
  states.value[kind].raw = value
  states.value[kind].error = ""
  emit("preview", updateFor(kind, value))
}

function commitRaw(kind: ShadowKind, value: string): void {
  states.value[kind].raw = value
  commitKind(kind)
}

function actionClass(disabled: boolean): string[] {
  return [
    "inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors",
    "hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
    disabled ? "pointer-events-none opacity-35" : "",
  ]
}
</script>

<template>
  <div data-testid="composer-shadow-controls" class="space-y-6 py-1">
    <section v-for="kind in (['box', 'text'] as const)" :key="kind" class="space-y-3" :aria-label="kindLabel(kind)">
      <div class="flex min-h-7 flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-1.5">
          <span class="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">{{ kindLabel(kind) }}</span>
          <span v-if="inherited(kind)" class="size-1.5 shrink-0 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" :aria-label="m.composer_inspector_inherited_value()" />
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            :class="actionClass(disabled)"
            :aria-label="states[kind].mode === 'raw' ? m.composer_shadow_edit_layers() : m.composer_shadow_edit_css()"
            :title="states[kind].mode === 'raw' ? m.composer_shadow_edit_layers() : m.composer_shadow_edit_css()"
            :disabled="disabled"
            :data-testid="`${kind}-shadow-mode-toggle`"
            @click="states[kind].mode === 'raw' ? editLayers(kind) : editRaw(kind)"
          >
            <AppIcon :name="states[kind].mode === 'raw' ? 'layersLinear' : 'code'" :size="14" aria-hidden="true" />
          </button>
          <button
            v-if="states[kind].mode === 'layers'"
            type="button"
            :class="actionClass(disabled)"
            :aria-label="m.composer_shadow_add({ property: kindLabel(kind) })"
            :title="m.composer_shadow_add({ property: kindLabel(kind) })"
            :disabled="disabled"
            :data-testid="`${kind}-shadow-add`"
            @click="addLayer(kind)"
          >
            <AppIcon name="plus" :size="14" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div v-if="states[kind].mode === 'raw'" class="space-y-2">
        <label class="block space-y-1">
          <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{{ m.composer_shadow_css_value() }}</span>
          <VariableAssignableInput
            :model-value="states[kind].raw"
            input-class="h-8 min-w-0 font-mono text-xs"
            :aria-label="m.composer_shadow_css_label({ property: kindLabel(kind) })"
            :aria-invalid="Boolean(states[kind].error)"
            :aria-describedby="states[kind].error ? `${kind}-shadow-error` : undefined"
            :disabled="disabled"
            :data-testid="`${kind}-shadow-raw`"
            @update:model-value="previewRaw(kind, String($event))"
            @commit="commitRaw(kind, String($event))"
          />
        </label>
      </div>

      <div v-else-if="states[kind].layers.length" class="space-y-3">
        <article
          v-for="(layer, index) in states[kind].layers"
          :key="`${kind}-${index}`"
          class="space-y-3 rounded-md border border-dashed border-border/70 bg-sidebar/25 p-3"
          :aria-label="m.composer_shadow_layer({ number: index + 1 })"
          :data-testid="`${kind}-shadow-layer-${index}`"
        >
          <div class="flex min-h-6 items-center justify-between gap-2">
            <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              {{ m.composer_shadow_layer({ number: index + 1 }) }}
              <span v-if="index === 0 && states[kind].layers.length > 1" class="normal-case tracking-normal">· {{ m.composer_shadow_topmost() }}</span>
            </span>
            <div class="flex items-center gap-0.5">
              <button type="button" :class="actionClass(disabled || index === 0)" :disabled="disabled || index === 0" :aria-label="m.composer_shadow_move_up({ number: index + 1 })" :title="m.composer_shadow_move_up({ number: index + 1 })" @click="moveLayer(kind, index, -1)"><AppIcon name="arrowUp" :size="13" aria-hidden="true" /></button>
              <button type="button" :class="actionClass(disabled || index === states[kind].layers.length - 1)" :disabled="disabled || index === states[kind].layers.length - 1" :aria-label="m.composer_shadow_move_down({ number: index + 1 })" :title="m.composer_shadow_move_down({ number: index + 1 })" @click="moveLayer(kind, index, 1)"><AppIcon name="arrowDown" :size="13" aria-hidden="true" /></button>
              <button type="button" :class="actionClass(disabled)" :disabled="disabled" :aria-label="m.composer_shadow_duplicate({ number: index + 1 })" :title="m.composer_shadow_duplicate({ number: index + 1 })" @click="duplicateLayer(kind, index)"><AppIcon name="duplicate" :size="13" aria-hidden="true" /></button>
              <button type="button" :class="actionClass(disabled)" :disabled="disabled" :aria-label="m.composer_shadow_delete({ number: index + 1 })" :title="m.composer_shadow_delete({ number: index + 1 })" @click="deleteLayer(kind, index)"><AppIcon name="trash" :size="13" aria-hidden="true" /></button>
            </div>
          </div>

          <div class="space-y-1.5">
            <span class="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">{{ m.composer_shadow_offset() }}</span>
            <div class="grid grid-cols-2 gap-2">
              <div v-for="field in (['offsetX', 'offsetY'] as const)" :key="field" class="relative min-w-0">
                <AppIcon :name="FIELD_ICON[field]" :size="14" class="pointer-events-none absolute start-2.5 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
                <VariableAssignableInput
                  :model-value="layer[field]"
                  input-class="h-8 min-w-0 ps-8 font-mono text-xs cursor-ew-resize focus:cursor-text"
                  :aria-label="field === 'offsetX' ? m.composer_shadow_offset_x() : m.composer_shadow_offset_y()"
                  :aria-invalid="Boolean(states[kind].error)"
                  :aria-describedby="states[kind].error ? `${kind}-shadow-error` : undefined"
                  :disabled="disabled"
                  :data-testid="`${kind}-shadow-${index}-${field}`"
                  @update:model-value="updateLength(kind, index, field, String($event))"
                  @commit="commitLength(kind, index, field, String($event))"
                  @mousedown="startScrub(kind, index, field, $event)"
                />
              </div>
            </div>
          </div>

          <div class="space-y-1.5">
            <span class="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">{{ kind === 'box' ? m.composer_shadow_blur_spread() : m.composer_shadow_blur() }}</span>
            <div :class="kind === 'box' ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1'">
              <div v-for="field in (kind === 'box' ? ['blur', 'spread'] : ['blur']) as ShadowField[]" :key="field" class="relative min-w-0">
                <AppIcon :name="FIELD_ICON[field]" :size="14" class="pointer-events-none absolute start-2.5 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
                <VariableAssignableInput
                  :model-value="layer[field]"
                  input-class="h-8 min-w-0 ps-8 font-mono text-xs cursor-ew-resize focus:cursor-text"
                  :aria-label="field === 'blur' ? m.composer_shadow_blur() : m.composer_shadow_spread()"
                  :aria-invalid="Boolean(states[kind].error)"
                  :aria-describedby="states[kind].error ? `${kind}-shadow-error` : undefined"
                  :disabled="disabled"
                  :data-testid="`${kind}-shadow-${index}-${field}`"
                  @update:model-value="updateLength(kind, index, field, String($event))"
                  @commit="commitLength(kind, index, field, String($event))"
                  @mousedown="startScrub(kind, index, field, $event)"
                />
              </div>
            </div>
          </div>

          <div class="space-y-1.5 border-t border-border/60 pt-3">
            <span class="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">{{ m.composer_shadow_color() }}</span>
            <ColorField
              :model-value="layer.color"
              layout="unified"
              persist-mode="commit"
              show-alpha
              show-design-colors
              show-variables
              :disabled="disabled"
              content-side="left"
              content-align="center"
              :trigger-label="m.composer_shadow_color_label({ number: index + 1 })"
              :data-testid="`${kind}-shadow-${index}-color`"
              @preview="updateLayer(kind, index, 'color', $event)"
              @commit="updateLayer(kind, index, 'color', $event, true)"
            />
          </div>

          <div v-if="kind === 'box'" class="flex min-h-7 items-center justify-between gap-3">
            <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{{ m.composer_shadow_inset() }}</span>
            <button
              type="button"
              role="switch"
              class="inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border/40 bg-sidebar p-0.5 transition-colors data-[state=checked]:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50"
              :data-state="layer.inset ? 'checked' : 'unchecked'"
              :aria-checked="layer.inset"
              :aria-label="m.composer_shadow_inset_label({ number: index + 1 })"
              :disabled="disabled"
              :data-testid="`${kind}-shadow-${index}-inset`"
              @click="updateLayer(kind, index, 'inset', !layer.inset, true)"
            >
              <span class="block size-3.5 rounded-full bg-background shadow-sm transition-transform" :class="layer.inset ? 'translate-x-4 rtl:-translate-x-4' : 'translate-x-0'" aria-hidden="true" />
            </button>
          </div>
        </article>
      </div>

      <div v-else class="flex min-h-16 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/70 bg-sidebar/20 px-3 py-4 text-center">
        <span class="text-xs text-muted-foreground">{{ m.composer_shadow_none({ property: kindLabel(kind) }) }}</span>
        <button type="button" class="inline-flex min-h-7 items-center gap-1.5 rounded-sm px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50" :disabled="disabled" @click="addLayer(kind)"><AppIcon name="plus" :size="13" aria-hidden="true" />{{ m.composer_shadow_add({ property: kindLabel(kind) }) }}</button>
      </div>

      <p v-if="states[kind].error" :id="`${kind}-shadow-error`" class="text-xs text-destructive" role="alert" :data-testid="`${kind}-shadow-error`">{{ states[kind].error }}</p>
    </section>
  </div>
</template>
