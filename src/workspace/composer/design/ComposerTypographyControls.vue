<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { ColorField } from "@/components/ui/color-picker"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { VariableAssignableInput } from "@/components/ui/variable-reference-picker"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import { extractVariableReferenceKey } from "@/workspace/design/lib/variableReferences"
import type { ComposerFontOption } from "../useComposerDesignContext"

type TypographyProperty =
  | "color"
  | "font-family"
  | "font-size"
  | "font-weight"
  | "line-height"
  | "letter-spacing"
  | "text-align"
  | "text-transform"
  | "text-decoration"
  | "text-wrap"
  | "white-space"

type NumericProperty = "font-size" | "line-height" | "letter-spacing"

const props = defineProps<{
  values: Partial<Record<TypographyProperty, string>>
  inheritedProperties?: readonly string[]
  fontOptions?: readonly ComposerFontOption[]
  headingLevel?: number | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  preview: [property: TypographyProperty, value: string]
  commit: [property: TypographyProperty, value: string]
  scrub: [event: PointerEvent, property: NumericProperty]
  headingLevel: [level: number]
}>()

const fontOpen = ref(false)
const fontSearch = ref("")
const fontSearchInput = ref<HTMLInputElement | null>(null)

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const
const UNITS = ["px", "rem", "em", "%", "vw", "vh"] as const
const UNITLESS = "__unitless__"
const FONT_WEIGHTS = [
  { value: "100", label: m.composer_typography_weight_thin() },
  { value: "200", label: m.composer_typography_weight_extra_light() },
  { value: "300", label: m.composer_typography_weight_light() },
  { value: "400", label: m.composer_typography_weight_regular() },
  { value: "500", label: m.composer_typography_weight_medium() },
  { value: "600", label: m.composer_typography_weight_semibold() },
  { value: "700", label: m.composer_typography_weight_bold() },
  { value: "800", label: m.composer_typography_weight_extra_bold() },
  { value: "900", label: m.composer_typography_weight_black() },
] as const
const ALIGNMENTS = [
  { value: "start", icon: "alignLeft", label: m.composer_typography_align_start() },
  { value: "center", icon: "alignHorizontalCenter", label: m.composer_typography_align_center() },
  { value: "end", icon: "alignRight", label: m.composer_typography_align_end() },
  { value: "justify", icon: "alignHorizontalSpaceBetween", label: m.composer_typography_align_justify() },
] as const
const TRANSFORMS = [
  { value: "uppercase", text: "AG", label: m.composer_typography_transform_uppercase() },
  { value: "capitalize", text: "Ag", label: m.composer_typography_transform_capitalize() },
  { value: "lowercase", text: "ag", label: m.composer_typography_transform_lowercase() },
] as const
const DECORATIONS = [
  { value: "none", text: "—", label: m.composer_typography_decoration_none(), class: "" },
  { value: "underline", text: "U", label: m.composer_typography_decoration_underline(), class: "underline underline-offset-2" },
  { value: "line-through", text: "S", label: m.composer_typography_decoration_line_through(), class: "line-through" },
  { value: "overline", text: "O", label: m.composer_typography_decoration_overline(), class: "overline" },
] as const

const currentFontFamily = computed(() => value("font-family"))
const isVariableFontFamily = computed(() => extractVariableReferenceKey(currentFontFamily.value) !== null)
const isVariableWeight = computed(() => extractVariableReferenceKey(value("font-weight")) !== null)
const normalizedSearch = computed(() => fontSearch.value.trim().toLocaleLowerCase())
const allFontOptions = computed<ComposerFontOption[]>(() => {
  const options = new Map<string, ComposerFontOption>()
  for (const option of props.fontOptions ?? []) {
    options.set(option.family.toLocaleLowerCase(), option)
  }
  const authored = currentFontFamily.value.trim()
  if (
    authored
    && authored !== "inherit"
    && extractVariableReferenceKey(authored) === null
    && !options.has(authored.toLocaleLowerCase())
  ) {
    options.set(authored.toLocaleLowerCase(), {
      family: authored,
      source: "custom",
      weights: [],
    })
  }
  return [...options.values()].sort((left, right) => left.family.localeCompare(right.family))
})
const filteredFonts = computed(() => {
  const query = normalizedSearch.value
  return query
    ? allFontOptions.value.filter((option) => option.family.toLocaleLowerCase().includes(query))
    : allFontOptions.value
})
const customFonts = computed(() => filteredFonts.value.filter((font) => font.source === "custom"))
const fontsourceFonts = computed(() => filteredFonts.value.filter((font) => font.source === "fontsource"))
const googleFonts = computed(() => filteredFonts.value.filter((font) => font.source === "google"))

watch(fontOpen, (open) => {
  if (!open) {
    fontSearch.value = ""
    return
  }
  void nextTick(() => fontSearchInput.value?.focus())
})

function value(property: TypographyProperty): string {
  return props.values[property] ?? ""
}

function inherited(property: TypographyProperty): boolean {
  return props.inheritedProperties?.includes(property) ?? false
}

function commit(property: TypographyProperty, nextValue: string): void {
  emit("commit", property, nextValue)
}

function selectFont(family: string): void {
  commit("font-family", family)
  fontOpen.value = false
}

function numericParts(property: NumericProperty): { number: string; unit: string } {
  const raw = value(property).trim()
  const match = raw.match(/^(-?(?:\d+\.?\d*|\.\d+))([a-zA-Z%]+)?$/)
  if (!match) return { number: raw, unit: property === "line-height" ? UNITLESS : property === "letter-spacing" ? "em" : "px" }
  return {
    number: match[1] ?? raw,
    unit: match[2] ?? UNITLESS,
  }
}

function numericDisplay(property: NumericProperty): string {
  return numericParts(property).number
}

function numericUnit(property: NumericProperty): string {
  return numericParts(property).unit
}

function numericValue(property: NumericProperty, raw: string): string {
  const next = raw.trim()
  if (!next || extractVariableReferenceKey(next) !== null || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(next)) return next
  const unit = numericUnit(property)
  return unit === UNITLESS ? next : `${next}${unit}`
}

function changeNumericUnit(property: NumericProperty, unit: unknown): void {
  if (typeof unit !== "string") return
  const current = numericParts(property)
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(current.number)) return
  commit(property, unit === UNITLESS ? current.number : `${current.number}${unit}`)
}

function onNumericPointerDown(event: PointerEvent, property: NumericProperty): void {
  if (event.target instanceof HTMLInputElement) emit("scrub", event, property)
}

function moveRadio(
  event: KeyboardEvent,
  values: readonly (string | number)[],
  current: string | number,
  select: (next: never) => void,
): void {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
  event.preventDefault()
  const currentIndex = Math.max(0, values.indexOf(current))
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? values.length - 1
      : (currentIndex + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + values.length) % values.length
  const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]')
  const buttons = group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
  buttons?.[nextIndex]?.focus()
  select(values[nextIndex] as never)
}

function selectHeading(level: number): void {
  if (level !== props.headingLevel) emit("headingLevel", level)
}
</script>

<template>
  <div class="space-y-4 pb-1" data-testid="composer-typography-controls">
    <div class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3">
      <div class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_typography_font() }}
        <span v-if="inherited('font-family')" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </div>
      <VariableAssignableInput
        :model-value="currentFontFamily"
        :disabled="disabled"
        :placeholder="m.composer_typography_select_font()"
        input-class="h-8 border-dashed bg-sidebar text-xs"
        @update:model-value="emit('preview', 'font-family', $event)"
        @commit="commit('font-family', $event)"
      >
        <template v-if="!isVariableFontFamily" #control>
          <Popover v-model:open="fontOpen">
            <PopoverTrigger as-child>
              <button
                type="button"
                class="flex h-8 w-full min-w-0 items-center gap-2 rounded-sm px-3 text-left text-xs text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50"
                :disabled="disabled"
                :aria-label="m.composer_typography_select_font()"
              >
                <span class="min-w-0 flex-1 truncate" :style="{ fontFamily: currentFontFamily || 'inherit' }">
                  {{ currentFontFamily || m.composer_typography_select_font() }}
                </span>
                <AppIcon name="chevronDown" :size="14" :class="cn('text-muted-foreground transition-transform', fontOpen && 'rotate-180')" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" :side-offset="4" class="w-66 overflow-hidden p-0">
              <div class="border-b border-dashed border-border p-2">
                <div class="relative">
                  <AppIcon name="search" :size="14" class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input
                    ref="fontSearchInput"
                    v-model="fontSearch"
                    type="search"
                    class="h-8 w-full rounded-sm border border-dashed border-border bg-sidebar pl-7 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-primary/50"
                    :placeholder="m.composer_typography_search_fonts()"
                    :aria-label="m.composer_typography_search_fonts()"
                  />
                </div>
              </div>
              <div class="max-h-60 overflow-y-auto p-1">
                <button type="button" class="w-full rounded-sm px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary" @click="selectFont('inherit')">
                  {{ m.composer_typography_inherit() }}
                </button>
                <template v-if="customFonts.length">
                  <p class="px-2 py-1.5 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">{{ m.composer_typography_custom_fonts() }}</p>
                  <button
                    v-for="font in customFonts"
                    :key="`custom:${font.family}`"
                    type="button"
                    :class="cn('w-full rounded-sm px-3 py-2 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary', currentFontFamily === font.family ? 'bg-muted text-foreground' : 'text-muted-foreground')"
                    :style="{ fontFamily: font.family }"
                    @click="selectFont(font.family)"
                  >{{ font.family }}</button>
                </template>
                <template v-if="fontsourceFonts.length">
                  <p :class="cn('px-2 py-1.5 text-3xs font-semibold uppercase tracking-widest text-muted-foreground', customFonts.length && 'mt-1 border-t border-dashed border-border pt-2')">{{ m.composer_typography_fontsource_fonts() }}</p>
                  <button
                    v-for="font in fontsourceFonts"
                    :key="`fontsource:${font.family}`"
                    type="button"
                    :class="cn('w-full rounded-sm px-3 py-2 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary', currentFontFamily === font.family ? 'bg-muted text-foreground' : 'text-muted-foreground')"
                    :style="{ fontFamily: font.family }"
                    @click="selectFont(font.family)"
                  >{{ font.family }}</button>
                </template>
                <template v-if="googleFonts.length">
                  <p :class="cn('px-2 py-1.5 text-3xs font-semibold uppercase tracking-widest text-muted-foreground', (customFonts.length || fontsourceFonts.length) && 'mt-1 border-t border-dashed border-border pt-2')">{{ m.composer_typography_google_fonts() }}</p>
                  <button
                    v-for="font in googleFonts"
                    :key="`google:${font.family}`"
                    type="button"
                    :class="cn('w-full rounded-sm px-3 py-2 text-left text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary', currentFontFamily === font.family ? 'bg-muted text-foreground' : 'text-muted-foreground')"
                    :style="{ fontFamily: font.family }"
                    @click="selectFont(font.family)"
                  >{{ font.family }}</button>
                </template>
                <p v-if="!customFonts.length && !fontsourceFonts.length && !googleFonts.length" class="px-3 py-4 text-center text-xs text-muted-foreground">{{ m.composer_typography_no_fonts() }}</p>
              </div>
            </PopoverContent>
          </Popover>
        </template>
      </VariableAssignableInput>
    </div>

    <div v-if="headingLevel" class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3">
      <span class="flex min-h-9 items-center text-3xs font-semibold uppercase tracking-widest text-muted-foreground">{{ m.composer_typography_level() }}</span>
      <div class="flex h-9 overflow-hidden rounded-md border border-border/50 bg-background/80 p-0.5" role="radiogroup" :aria-label="m.composer_typography_level()">
        <button
          v-for="level in HEADING_LEVELS"
          :key="level"
          type="button"
          role="radio"
          :aria-checked="headingLevel === level"
          :tabindex="headingLevel === level ? 0 : -1"
          :disabled="disabled"
          :class="cn('flex-1 rounded-sm border text-xs font-medium tracking-wide transition-[border-color,background-color,color] focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary', headingLevel === level ? 'border-dashed border-primary/70 bg-primary/20 text-foreground' : 'border-transparent text-muted-foreground hover:border-border/50 hover:bg-muted/40 hover:text-foreground')"
          @click="selectHeading(level)"
          @keydown="moveRadio($event, HEADING_LEVELS, headingLevel, selectHeading)"
        >H{{ level }}</button>
      </div>
    </div>

    <div class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3">
      <span class="flex items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_typography_color() }}
        <span v-if="inherited('color')" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </span>
      <ColorField
        :model-value="value('color')"
        layout="unified"
        persist-mode="commit"
        show-design-colors
        show-variables
        :disabled="disabled"
        content-side="left"
        content-align="center"
        placeholder="—"
        :trigger-label="m.composer_typography_color()"
        @preview="emit('preview', 'color', $event)"
        @commit="commit('color', $event)"
      />
    </div>

    <div class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3">
      <span class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_typography_weight() }}
        <span v-if="inherited('font-weight')" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </span>
      <VariableAssignableInput
        :model-value="value('font-weight')"
        :disabled="disabled"
        :placeholder="m.composer_typography_select_weight()"
        input-class="h-8 border-dashed bg-sidebar text-xs"
        @update:model-value="emit('preview', 'font-weight', $event)"
        @commit="commit('font-weight', $event)"
      >
        <template v-if="!isVariableWeight" #control>
          <Select :model-value="value('font-weight') || '__unset__'" :disabled="disabled" @update:model-value="commit('font-weight', String($event) === '__unset__' ? '' : String($event))">
            <SelectTrigger hide-icon class="h-8 w-full justify-start border-0 bg-transparent px-3 text-xs shadow-none focus:ring-0"><SelectValue :placeholder="m.composer_typography_select_weight()" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__unset__">—</SelectItem>
              <SelectItem v-for="weight in FONT_WEIGHTS" :key="weight.value" :value="weight.value" :style="{ fontWeight: weight.value }">{{ weight.label }}</SelectItem>
            </SelectContent>
          </Select>
        </template>
      </VariableAssignableInput>
    </div>

    <div
      v-for="field in ([
        { property: 'font-size', label: m.composer_typography_size(), icon: 'textFontSize', placeholder: m.composer_typography_size_placeholder() },
        { property: 'line-height', label: m.composer_typography_line_height(), icon: 'lineHeight', placeholder: m.composer_typography_auto() },
        { property: 'letter-spacing', label: m.composer_typography_spacing(), icon: 'letterSpacing', placeholder: '0' },
      ] as const)"
      :key="field.property"
      class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3"
      :data-typography-property="field.property"
    >
      <span class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ field.label }}
        <span v-if="inherited(field.property)" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </span>
      <div class="grid grid-cols-[minmax(0,1fr)_3.25rem] items-center gap-2">
        <div class="relative min-w-0" @pointerdown="onNumericPointerDown($event, field.property)">
          <AppIcon :name="field.icon" :size="14" class="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-muted-foreground/70" aria-hidden="true" />
          <VariableAssignableInput
            :model-value="numericDisplay(field.property)"
            :disabled="disabled"
            :placeholder="field.placeholder"
            input-class="h-8 border-dashed bg-sidebar pl-8 font-mono text-xs tabular-nums cursor-ew-resize focus:cursor-text"
            @update:model-value="emit('preview', field.property, numericValue(field.property, $event))"
            @commit="commit(field.property, numericValue(field.property, $event))"
          />
        </div>
        <Select :model-value="numericUnit(field.property)" :disabled="disabled" @update:model-value="changeNumericUnit(field.property, $event)">
          <SelectTrigger hide-icon class="h-8 justify-center border-dashed bg-sidebar px-1 text-xs text-muted-foreground focus:ring-0"><SelectValue /></SelectTrigger>
          <SelectContent align="end" class="min-w-16">
            <SelectItem v-if="field.property === 'line-height'" :value="UNITLESS">{{ m.composer_typography_unitless() }}</SelectItem>
            <SelectItem v-for="unit in UNITS" :key="unit" :value="unit">{{ unit }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <div v-for="field in ([
      { property: 'text-wrap', label: m.composer_typography_wrap(), options: [
        ['wrap', m.composer_typography_wrap_normal()], ['nowrap', m.composer_typography_wrap_none()], ['balance', m.composer_typography_wrap_balance()], ['pretty', m.composer_typography_wrap_pretty()], ['stable', m.composer_typography_wrap_stable()],
      ] },
      { property: 'white-space', label: m.composer_typography_white_space(), options: [
        ['normal', m.composer_typography_white_space_normal()], ['nowrap', m.composer_typography_white_space_nowrap()], ['pre', m.composer_typography_white_space_pre()], ['pre-wrap', m.composer_typography_white_space_pre_wrap()], ['break-spaces', m.composer_typography_white_space_break_spaces()],
      ] },
    ] as const)" :key="field.property" class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3" :data-typography-property="field.property">
      <span class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ field.label }}
        <span v-if="inherited(field.property)" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </span>
      <Select :model-value="value(field.property) || '__unset__'" :disabled="disabled" @update:model-value="commit(field.property, String($event) === '__unset__' ? '' : String($event))">
        <SelectTrigger class="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__unset__">—</SelectItem>
          <SelectItem v-for="option in field.options" :key="option[0]" :value="option[0]">{{ option[1] }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <div class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3 pt-1" data-typography-property="text-align">
      <span class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_typography_align() }}
        <span v-if="inherited('text-align')" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </span>
      <div class="flex rounded-md border border-border/50 bg-background/80 p-0.5" role="radiogroup" :aria-label="m.composer_typography_align()">
        <button
          v-for="align in ALIGNMENTS"
          :key="align.value"
          type="button"
          role="radio"
          :aria-checked="value('text-align') === align.value"
          :tabindex="value('text-align') === align.value || (!value('text-align') && align.value === 'start') ? 0 : -1"
          :title="align.label"
          :aria-label="align.label"
          :disabled="disabled"
          :class="cn('flex h-7 flex-1 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary', value('text-align') === align.value && 'bg-muted text-foreground')"
          @click="commit('text-align', align.value)"
          @keydown="moveRadio($event, ALIGNMENTS.map((item) => item.value), value('text-align') || 'start', (next) => commit('text-align', next))"
        ><AppIcon :name="align.icon" :size="15" aria-hidden="true" /></button>
      </div>
    </div>

    <div class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3" data-typography-property="text-transform">
      <span class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_typography_transform() }}
        <span v-if="inherited('text-transform')" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </span>
      <div class="flex rounded-md border border-border/50 bg-background/80 p-0.5" role="group" :aria-label="m.composer_typography_transform()">
        <button
          v-for="transform in TRANSFORMS"
          :key="transform.value"
          type="button"
          :aria-pressed="value('text-transform') === transform.value"
          :aria-label="transform.label"
          :title="transform.label"
          :disabled="disabled"
          :class="cn('flex h-7 flex-1 items-center justify-center rounded-sm text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary', value('text-transform') === transform.value && 'bg-muted text-foreground')"
          @click="commit('text-transform', value('text-transform') === transform.value ? 'none' : transform.value)"
        >{{ transform.text }}</button>
      </div>
    </div>

    <div class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3" data-typography-property="text-decoration">
      <span class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_typography_decoration() }}
        <span v-if="inherited('text-decoration')" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </span>
      <div class="flex rounded-md border border-border/50 bg-background/80 p-0.5" role="radiogroup" :aria-label="m.composer_typography_decoration()">
        <button
          v-for="decoration in DECORATIONS"
          :key="decoration.value"
          type="button"
          role="radio"
          :aria-checked="(value('text-decoration') || 'none') === decoration.value"
          :tabindex="(value('text-decoration') || 'none') === decoration.value ? 0 : -1"
          :aria-label="decoration.label"
          :title="decoration.label"
          :disabled="disabled"
          :class="cn('flex h-7 flex-1 items-center justify-center rounded-sm text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary', decoration.class, (value('text-decoration') || 'none') === decoration.value && 'bg-muted text-foreground')"
          @click="commit('text-decoration', decoration.value)"
          @keydown="moveRadio($event, DECORATIONS.map((item) => item.value), value('text-decoration') || 'none', (next) => commit('text-decoration', next))"
        >{{ decoration.text }}</button>
      </div>
    </div>
  </div>
</template>
