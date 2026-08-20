<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { VariableAssignableInput } from "@/components/ui/variable-reference-picker"
import { m } from "@/paraglide/messages.js"
import {
  applyNodeMotion,
  DEFAULT_NODE_MOTION,
  labelForNode,
  MOTION_DELAYS,
  MOTION_DISTANCES,
  MOTION_EASINGS,
  MOTION_EFFECTS,
  MOTION_HOVERS,
  MOTION_LOOPS,
  MOTION_PRESETS,
  MOTION_SPEEDS,
  MOTION_TRIGGERS,
  motionPreviewCss,
  nodeAtMarkerPath,
  PARALLAX_ANCHORS,
  PARALLAX_DIRECTIONS,
  PARALLAX_EFFECTS,
  PARALLAX_PRESETS,
  PARALLAX_SPEEDS,
  parseNodeMotion,
  type MotionEffect,
  type MotionHover,
  type MotionParallaxEffect,
  type NodeMotion,
} from "../../../../shared/composer"
import type { EditableNode } from "../../../../shared/composer/types"
import { tryUseComposerBeacon } from "../selection/useComposerBeacon"
import { tryUseComposerDocument } from "../useComposerDocumentSession"

const beacon = tryUseComposerBeacon()
const doc = tryUseComposerDocument()
const error = ref("")
const selectedPath = computed(() => beacon?.selectedPath.value ?? null)
const selectedNode = computed<EditableNode | null>(() => {
  const path = selectedPath.value
  return path && doc?.model.value ? nodeAtMarkerPath(doc.model.value.nodes, path) : null
})
const propsMap = computed(() => {
  const node = selectedNode.value
  return node && (node.kind === "element" || node.kind === "component" || node.kind === "slot" || node.kind === "raw") ? node.props : null
})
const supportsMotion = computed(() => Boolean(propsMap.value))
const motion = computed(() => propsMap.value ? parseNodeMotion(propsMap.value) : { ...DEFAULT_NODE_MOTION })
const nodeTitle = computed(() => selectedNode.value ? labelForNode(selectedNode.value) : "")

watch(selectedPath, () => {
  error.value = ""
})

function commit(next: NodeMotion, label: string) {
  const path = selectedPath.value
  if (!path || !doc) return
  error.value = ""
  const ok = doc.commitInspectorMutation(label, (model) => {
    const node = nodeAtMarkerPath(model.nodes, path)
    if (!node) return { ok: false, reason: "Selection changed." }
    const result = applyNodeMotion(node, next)
    if (!result.ok) error.value = result.reason ?? "Motion could not be applied."
    return { ...result, selectPath: path }
  })
  if (!ok && !error.value) error.value = "Motion could not be applied."
  if (ok) doc.previewStyle(path, motionPreviewCss(next))
}

function patch(value: Partial<NodeMotion>, label = "Update motion") {
  const next = structuredClone(motion.value)
  Object.assign(next, value)
  commit(next, label)
}

function toggleEnabled(enabled: boolean) {
  if (!enabled) return commit({ ...structuredClone(motion.value), enabled: false }, "Disable motion")
  const base = motion.value.effects.length || motion.value.parallax?.enabled
    ? { ...structuredClone(motion.value), enabled: true }
    : structuredClone(MOTION_PRESETS[1]!.motion)
  commit(base, "Enable motion")
}

function applyPreset(id: string) {
  const preset = MOTION_PRESETS.find((item) => item.id === id)
  if (preset) commit(structuredClone(preset.motion), `Apply ${preset.label} motion`)
}

function toggleEffect(effect: MotionEffect, checked: boolean) {
  const effects = checked
    ? [...new Set([...motion.value.effects, effect])]
    : motion.value.effects.filter((item) => item !== effect)
  const next = { ...structuredClone(motion.value), enabled: true, effects, preset: undefined }
  doc?.previewStyle(selectedPath.value ?? "", motionPreviewCss(next))
  commit(next, "Update motion effects")
}

function toggleHover(hover: MotionHover, checked: boolean) {
  const current = motion.value.hover ?? []
  patch({ hover: checked ? [...new Set([...current, hover])] : current.filter((item) => item !== hover), preset: undefined })
}

function setParallaxEnabled(enabled: boolean) {
  const next = structuredClone(motion.value)
  next.enabled = enabled || next.effects.length > 0
  next.parallax = enabled ? (next.parallax ?? structuredClone(PARALLAX_PRESETS[0]!.parallax)) : undefined
  commit(next, enabled ? "Enable parallax" : "Disable parallax")
}

function patchParallax(value: Partial<NonNullable<NodeMotion["parallax"]>>) {
  const next = structuredClone(motion.value)
  next.enabled = true
  next.parallax = { ...(next.parallax ?? structuredClone(PARALLAX_PRESETS[0]!.parallax)), ...value }
  commit(next, "Update parallax")
}

function applyParallaxPreset(id: string) {
  const preset = PARALLAX_PRESETS.find((item) => item.id === id)
  if (preset) patch({ enabled: true, parallax: structuredClone(preset.parallax) }, `Apply ${preset.label} parallax`)
}

function toggleParallaxEffect(effect: MotionParallaxEffect["effect"], checked: boolean) {
  const current = motion.value.parallax?.effects ?? []
  patchParallax({ effects: checked ? [...current.filter((item) => item.effect !== effect), { effect }] : current.filter((item) => item.effect !== effect) })
}
</script>

<template>
  <div v-if="!selectedNode" class="text-xs text-muted-foreground">{{ m.composer_motion_select() }}</div>
  <div v-else-if="!supportsMotion" class="space-y-2 text-xs leading-relaxed text-muted-foreground">
    {{ m.composer_motion_unavailable() }}
  </div>
  <div v-else class="space-y-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 space-y-0.5">
        <div class="flex items-center gap-2">
          <AppIcon name="design" :size="14" class="text-muted-foreground" aria-hidden="true" />
          <h3 class="truncate text-sm font-medium">{{ nodeTitle }}</h3>
        </div>
        <p class="text-[11px] text-muted-foreground">Aria Motion</p>
      </div>
      <Switch :model-value="motion.enabled" :disabled="!doc?.editable.value" :aria-label="m.composer_motion_enable()" @update:model-value="toggleEnabled" />
    </div>

    <p v-if="error" role="alert" class="rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">{{ error }}</p>

    <template v-if="motion.enabled">
      <section class="space-y-2">
        <Label class="text-[10px] uppercase tracking-wide text-muted-foreground">{{ m.composer_motion_presets() }}</Label>
        <div class="grid grid-cols-2 gap-1.5">
          <Button v-for="preset in MOTION_PRESETS" :key="preset.id" type="button" variant="outline" size="sm" class="h-auto min-h-8 justify-start whitespace-normal px-2 py-1.5 text-left text-[11px]" :aria-pressed="motion.preset === preset.id" @click="applyPreset(preset.id)">{{ preset.label }}</Button>
        </div>
      </section>

      <details open class="rounded-md bg-muted/20">
        <summary class="cursor-pointer list-none rounded-md px-2 py-2 text-[11px] font-medium focus-visible:ring-2 focus-visible:ring-ring">{{ m.composer_motion_effects_trigger() }}</summary>
        <div class="space-y-3 px-2 pb-3">
          <div class="grid grid-cols-2 gap-x-2 gap-y-1.5">
            <label v-for="effect in MOTION_EFFECTS" :key="effect" class="flex min-h-6 items-center gap-2 text-[10px]"><Checkbox :checked="motion.effects.includes(effect)" @update:checked="toggleEffect(effect, $event === true)" /><span>{{ effect }}</span></label>
          </div>
          <label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_trigger() }}</span><Select :model-value="motion.trigger" @update:model-value="patch({ trigger: String($event) as NodeMotion['trigger'], preset: undefined })"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in MOTION_TRIGGERS" :key="item" :value="item">{{ item }}</SelectItem></SelectContent></Select></label>
          <div class="grid grid-cols-2 gap-2">
            <label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_speed() }}</span><Select :model-value="String(motion.speed ?? 'normal')" @update:model-value="patch({ speed: String($event) as NodeMotion['speed'], preset: undefined })"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in MOTION_SPEEDS" :key="item" :value="item">{{ item }}</SelectItem></SelectContent></Select></label>
            <label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_easing() }}</span><Select :model-value="motion.easing ?? 'smooth'" @update:model-value="patch({ easing: String($event) as NodeMotion['easing'], preset: undefined })"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in MOTION_EASINGS" :key="item" :value="item">{{ item }}</SelectItem></SelectContent></Select></label>
            <label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_distance() }}</span><Select :model-value="motion.distance ?? 'md'" @update:model-value="patch({ distance: String($event) as NodeMotion['distance'], preset: undefined })"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in MOTION_DISTANCES" :key="item" :value="item">{{ item }}</SelectItem></SelectContent></Select></label>
            <label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_delay() }}</span><Select :model-value="String(motion.delay ?? '0')" @update:model-value="patch({ delay: String($event) as NodeMotion['delay'], preset: undefined })"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in MOTION_DELAYS" :key="item" :value="item">{{ item }} ms</SelectItem></SelectContent></Select></label>
          </div>
          <div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_duration_variable() }}</span><VariableAssignableInput :model-value="motion.durationVar ?? ''" placeholder="var(--duration)" input-class="h-8 text-xs" @commit="patch({ durationVar: $event || undefined })" /></label><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_delay_variable() }}</span><VariableAssignableInput :model-value="motion.delayVar ?? ''" placeholder="var(--delay)" input-class="h-8 text-xs" @commit="patch({ delayVar: $event || undefined })" /></label></div>
          <div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_custom_duration() }}</span><Input type="number" min="1" class="h-8 text-xs" :model-value="typeof motion.speed === 'number' ? motion.speed : ''" placeholder="600" @change="patch({ speed: Number(($event.target as HTMLInputElement).value) || undefined, preset: undefined })" /></label><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_custom_delay() }}</span><Input type="number" min="0" class="h-8 text-xs" :model-value="typeof motion.delay === 'number' ? motion.delay : ''" placeholder="0" @change="patch({ delay: Number(($event.target as HTMLInputElement).value) || 0, preset: undefined })" /></label></div>
          <label v-if="motion.trigger === 'scrub'" class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_scrub_travel() }}</span><Input type="number" min="1" class="h-8 text-xs" :model-value="motion.scrub?.travel ?? 200" @change="patch({ scrub: { ...motion.scrub, travel: Math.max(1, Number(($event.target as HTMLInputElement).value)) } })" /></label>
        </div>
      </details>

      <details class="rounded-md bg-muted/20"><summary class="cursor-pointer list-none rounded-md px-2 py-2 text-[11px] font-medium focus-visible:ring-2 focus-visible:ring-ring">{{ m.composer_motion_hover_loop_text() }}</summary><div class="space-y-3 px-2 pb-3">
        <div class="grid grid-cols-2 gap-x-2 gap-y-1.5"><label v-for="hover in MOTION_HOVERS" :key="hover" class="flex min-h-6 items-center gap-2 text-[10px]"><Checkbox :checked="motion.hover?.includes(hover)" @update:checked="toggleHover(hover, $event === true)" /><span>{{ hover.replace('hover-', '') }}</span></label></div>
        <label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_loop() }}</span><Select :model-value="motion.loop ?? '__none__'" @update:model-value="patch({ loop: String($event) === '__none__' ? undefined : String($event) as NodeMotion['loop'] })"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">{{ m.composer_motion_none() }}</SelectItem><SelectItem v-for="item in MOTION_LOOPS" :key="item" :value="item">{{ item }}</SelectItem></SelectContent></Select></label>
        <div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_text_split() }}</span><Select :model-value="motion.text?.mode ?? '__none__'" @update:model-value="patch({ text: String($event) === '__none__' ? undefined : { mode: String($event) as 'words' | 'chars', stagger: motion.text?.stagger ?? 60 } })"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">{{ m.composer_motion_none() }}</SelectItem><SelectItem value="words">{{ m.composer_motion_words() }}</SelectItem><SelectItem value="chars">{{ m.composer_motion_characters() }}</SelectItem></SelectContent></Select></label><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_text_stagger() }}</span><Input type="number" class="h-8 text-xs" :model-value="motion.text?.stagger ?? 60" :disabled="!motion.text" @change="patch({ text: motion.text ? { ...motion.text, stagger: Number(($event.target as HTMLInputElement).value) } : undefined })" /></label></div>
        <div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_child_stagger() }}</span><Input type="number" min="1" class="h-8 text-xs" :model-value="motion.stagger?.interval ?? 90" @change="patch({ stagger: { interval: Math.max(1, Number(($event.target as HTMLInputElement).value)) } })" /></label><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_magnetic_strength() }}</span><Input type="number" min="0" max="1" step="0.05" class="h-8 text-xs" :model-value="motion.magnetic?.strength ?? 0" @change="patch({ magnetic: Number(($event.target as HTMLInputElement).value) > 0 ? { strength: Number(($event.target as HTMLInputElement).value) } : undefined })" /></label></div>
      </div></details>

      <details class="rounded-md bg-muted/20"><summary class="flex cursor-pointer list-none items-center justify-between rounded-md px-2 py-2 text-[11px] font-medium focus-visible:ring-2 focus-visible:ring-ring"><span>{{ m.composer_motion_parallax() }}</span><Switch :model-value="Boolean(motion.parallax?.enabled)" :aria-label="m.composer_motion_enable_parallax()" @click.stop @update:model-value="setParallaxEnabled" /></summary><div v-if="motion.parallax?.enabled" class="space-y-3 px-2 pb-3">
        <div class="grid grid-cols-2 gap-1.5"><Button v-for="preset in PARALLAX_PRESETS" :key="preset.id" type="button" variant="outline" size="sm" class="h-auto min-h-8 justify-start whitespace-normal px-2 py-1.5 text-left text-[10px]" @click="applyParallaxPreset(preset.id)">{{ preset.label }}</Button></div>
        <div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_direction() }}</span><Select :model-value="motion.parallax.direction" @update:model-value="patchParallax({ direction: String($event) as NonNullable<NodeMotion['parallax']>['direction'] })"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in PARALLAX_DIRECTIONS" :key="item" :value="item">{{ item }}</SelectItem></SelectContent></Select></label><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_speed() }}</span><Select :model-value="motion.parallax.speed" @update:model-value="patchParallax({ speed: String($event) as NonNullable<NodeMotion['parallax']>['speed'] })"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in PARALLAX_SPEEDS" :key="item" :value="item">{{ item }}</SelectItem></SelectContent></Select></label><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_anchor() }}</span><Select :model-value="motion.parallax.anchor" @update:model-value="patchParallax({ anchor: String($event) as NonNullable<NodeMotion['parallax']>['anchor'] })"><SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="item in PARALLAX_ANCHORS" :key="item" :value="item">{{ item }}</SelectItem></SelectContent></Select></label><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_travel() }}</span><Input type="number" min="0" class="h-8 text-xs" :model-value="motion.parallax.travel" @change="patchParallax({ travel: Math.max(0, Number(($event.target as HTMLInputElement).value)) })" /></label><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_easing() }}</span><Input class="h-8 text-xs" :model-value="motion.parallax.easing ?? ''" placeholder="ease-out" @change="patchParallax({ easing: (($event.target as HTMLInputElement).value || undefined) as NonNullable<NodeMotion['parallax']>['easing'] })" /></label><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_layer_group() }}</span><Input class="h-8 text-xs" :model-value="motion.parallax.layerGroup ?? ''" @change="patchParallax({ layerGroup: ($event.target as HTMLInputElement).value || undefined })" /></label></div>
        <div class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_start_offset() }}</span><Input class="h-8 text-xs" :model-value="motion.parallax.startOffset ?? ''" placeholder="top bottom" @change="patchParallax({ startOffset: ($event.target as HTMLInputElement).value || undefined })" /></label><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_end_offset() }}</span><Input class="h-8 text-xs" :model-value="motion.parallax.endOffset ?? ''" placeholder="bottom top" @change="patchParallax({ endOffset: ($event.target as HTMLInputElement).value || undefined })" /></label><label class="col-span-2 space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_container() }}</span><Input class="h-8 font-mono text-xs" :model-value="motion.parallax.containerRef ?? ''" placeholder="#scroll-region" @change="patchParallax({ containerRef: ($event.target as HTMLInputElement).value || undefined })" /></label></div>
        <div class="grid grid-cols-2 gap-x-2 gap-y-1.5"><label v-for="effect in PARALLAX_EFFECTS" :key="effect" class="flex min-h-6 items-center gap-2 text-[10px]"><Checkbox :checked="motion.parallax.effects.some((item) => item.effect === effect)" @update:checked="toggleParallaxEffect(effect, $event === true)" /><span>{{ effect }}</span></label></div>
        <div class="grid grid-cols-2 gap-2"><label class="flex items-center justify-between gap-2 text-[10px]"><span>{{ m.composer_motion_velocity() }}</span><Switch :model-value="motion.parallax.velocity" @update:model-value="patchParallax({ velocity: $event })" /></label><label class="flex items-center justify-between gap-2 text-[10px]"><span>{{ m.composer_motion_disable_mobile() }}</span><Switch :model-value="motion.parallax.disableOnMobile" @update:model-value="patchParallax({ disableOnMobile: $event })" /></label><label class="flex items-center justify-between gap-2 text-[10px]"><span>{{ m.composer_motion_pin() }}</span><Switch :model-value="Boolean(motion.parallax.pin?.enabled)" @update:model-value="patchParallax({ pin: $event ? { enabled: true, duration: '400px' } : undefined })" /></label></div>
        <div v-if="motion.parallax.pin?.enabled" class="grid grid-cols-2 gap-2"><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_pin_duration() }}</span><Input class="h-8 text-xs" :model-value="motion.parallax.pin.duration ?? ''" placeholder="400px" @change="patchParallax({ pin: { ...motion.parallax!.pin!, duration: ($event.target as HTMLInputElement).value || undefined } })" /></label><label class="space-y-1"><span class="text-[10px] text-muted-foreground">{{ m.composer_motion_pin_offset() }}</span><Input class="h-8 text-xs" :model-value="motion.parallax.pin.offset ?? ''" placeholder="top 0px" @change="patchParallax({ pin: { ...motion.parallax!.pin!, offset: ($event.target as HTMLInputElement).value || undefined } })" /></label></div>
      </div></details>
    </template>
  </div>
</template>
