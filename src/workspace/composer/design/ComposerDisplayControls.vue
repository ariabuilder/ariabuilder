<script setup lang="ts">
import { computed, ref } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { VariableAssignableInput } from "@/components/ui/variable-reference-picker"
import type { AppIconName } from "@/icons/registry"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"

export type DisplayProperty =
  | "display"
  | "visibility"
  | "overflow"
  | "flex-direction"
  | "flex-wrap"
  | "justify-content"
  | "align-items"
  | "align-content"
  | "justify-items"
  | "gap"
  | "grid-template-columns"
  | "grid-template-rows"
  | "grid-column"
  | "flow-tolerance"

type DisplayMode =
  | "flex"
  | "grid"
  | "grid-lanes"
  | "block"
  | "inline"
  | "contents"
  | "inline-block"
  | "inline-flex"
  | "inline-grid"
  | "initial"
  | "inherit"
  | "none"

type IconOption = {
  value: string
  icon: AppIconName
  label: string
  iconClass?: string
}

type IconGroup = {
  prop: DisplayProperty
  label: string
  ariaLabel?: string
  options: readonly IconOption[]
}

const FLEX_DISPLAY_MODES = ["flex", "inline-flex"] as const
const GRID_DISPLAY_MODES = ["grid", "grid-lanes", "inline-grid"] as const
const OVERFLOW_OPTIONS = ["visible", "hidden", "clip", "auto", "scroll"] as const

const props = defineProps<{
  values: Partial<Record<DisplayProperty, string>>
  inheritedProperties?: readonly string[]
  parentIsGrid?: boolean
  elementTag?: string | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  preview: [property: DisplayProperty, value: string]
  commit: [property: DisplayProperty, value: string]
}>()

const gridColumnsPresetOpen = ref(false)
const gridRowsPresetOpen = ref(false)

const DISPLAY_OPTION_GROUPS: Array<{
  id: string
  options: Array<{ value: DisplayMode; label: string }>
}> = [
  {
    id: "primary",
    options: [
      { value: "flex", label: m.composer_display_mode_flex() },
      { value: "grid", label: m.composer_display_mode_grid() },
      { value: "grid-lanes", label: m.composer_display_mode_grid_lanes() },
      { value: "block", label: m.composer_display_mode_block() },
      { value: "inline", label: m.composer_display_mode_inline() },
      { value: "contents", label: m.composer_display_mode_contents() },
    ],
  },
  {
    id: "inline-variants",
    options: [
      { value: "inline-block", label: m.composer_display_mode_inline_block() },
      { value: "inline-flex", label: m.composer_display_mode_inline_flex() },
      { value: "inline-grid", label: m.composer_display_mode_inline_grid() },
    ],
  },
  {
    id: "fallbacks",
    options: [
      { value: "initial", label: m.composer_display_mode_initial() },
      { value: "inherit", label: m.composer_display_mode_inherit() },
      { value: "none", label: m.composer_display_mode_none() },
    ],
  },
]

const FLEX_DIRECTION_OPTIONS: IconOption[] = [
  { value: "row", icon: "menu01", label: m.composer_display_direction_row(), iconClass: "rotate-90" },
  { value: "column", icon: "menu01", label: m.composer_display_direction_column() },
]

const FLEX_WRAP_OPTIONS: IconOption[] = [
  { value: "nowrap", icon: "notEqualSign", label: m.composer_display_wrap_none() },
  { value: "wrap", icon: "textWrap", label: m.composer_display_wrap_normal() },
  { value: "wrap-reverse", icon: "arrowReloadHorizontal", label: m.composer_display_wrap_reverse(), iconClass: "-scale-y-100" },
]

const FLEX_JUSTIFY_OPTIONS: IconOption[] = [
  { value: "flex-start", icon: "alignLeft", label: m.composer_display_justify_start() },
  { value: "center", icon: "alignHorizontalCenter", label: m.composer_display_justify_center() },
  { value: "flex-end", icon: "alignRight", label: m.composer_display_justify_end() },
  { value: "space-between", icon: "alignHorizontalSpaceBetween", label: m.composer_display_justify_between() },
]

const FLEX_ALIGN_ITEMS_OPTIONS: IconOption[] = [
  { value: "flex-start", icon: "alignBoxTopCenter", label: m.composer_display_align_items_start() },
  { value: "center", icon: "alignBoxMiddleCenter", label: m.composer_display_align_items_center() },
  { value: "flex-end", icon: "alignBoxBottomCenter", label: m.composer_display_align_items_end() },
  { value: "stretch", icon: "alignVerticalDistributeCenter", label: m.composer_display_align_items_stretch() },
]

const FLEX_ALIGN_CONTENT_OPTIONS: IconOption[] = [
  { value: "flex-start", icon: "alignTop", label: m.composer_display_align_content_start() },
  { value: "center", icon: "alignVerticalCenter", label: m.composer_display_align_content_center() },
  { value: "flex-end", icon: "alignBottom", label: m.composer_display_align_content_end() },
  { value: "space-between", icon: "alignVerticalSpaceBetween", label: m.composer_display_align_content_between() },
  { value: "stretch", icon: "alignVerticalDistributeCenter", label: m.composer_display_align_content_stretch() },
]

const GRID_JUSTIFY_CONTENT_OPTIONS: IconOption[] = [
  { value: "start", icon: "alignLeft", label: m.composer_display_justify_start() },
  { value: "center", icon: "alignHorizontalCenter", label: m.composer_display_justify_center() },
  { value: "end", icon: "alignRight", label: m.composer_display_justify_end() },
  { value: "space-between", icon: "alignHorizontalSpaceBetween", label: m.composer_display_justify_between() },
  { value: "stretch", icon: "alignHorizontalDistributeStart", label: m.composer_display_justify_stretch() },
]

const GRID_ALIGN_CONTENT_OPTIONS: IconOption[] = [
  { value: "start", icon: "alignTop", label: m.composer_display_align_content_start() },
  { value: "center", icon: "alignVerticalCenter", label: m.composer_display_align_content_center() },
  { value: "end", icon: "alignBottom", label: m.composer_display_align_content_end() },
  { value: "space-between", icon: "alignVerticalSpaceBetween", label: m.composer_display_align_content_between() },
  { value: "stretch", icon: "alignVerticalDistributeCenter", label: m.composer_display_align_content_stretch() },
]

const GRID_JUSTIFY_ITEMS_OPTIONS: IconOption[] = [
  { value: "start", icon: "alignLeft", label: m.composer_display_justify_start() },
  { value: "center", icon: "alignHorizontalCenter", label: m.composer_display_justify_center() },
  { value: "end", icon: "alignRight", label: m.composer_display_justify_end() },
  { value: "stretch", icon: "alignHorizontalDistributeStart", label: m.composer_display_justify_stretch() },
]

const GRID_ALIGN_ITEMS_OPTIONS: IconOption[] = [
  { value: "start", icon: "alignBoxTopCenter", label: m.composer_display_align_items_start() },
  { value: "center", icon: "alignBoxMiddleCenter", label: m.composer_display_align_items_center() },
  { value: "end", icon: "alignBoxBottomCenter", label: m.composer_display_align_items_end() },
  { value: "stretch", icon: "alignVerticalDistributeCenter", label: m.composer_display_align_items_stretch() },
]

const FLEX_GROUPS: IconGroup[] = [
  { prop: "flex-direction", label: m.composer_display_direction(), options: FLEX_DIRECTION_OPTIONS },
  { prop: "flex-wrap", label: m.composer_display_wrap(), options: FLEX_WRAP_OPTIONS },
  { prop: "justify-content", label: m.composer_display_justify(), options: FLEX_JUSTIFY_OPTIONS },
  { prop: "align-items", label: m.composer_display_items(), options: FLEX_ALIGN_ITEMS_OPTIONS },
  { prop: "align-content", label: m.composer_display_content(), options: FLEX_ALIGN_CONTENT_OPTIONS },
]

const GRID_GROUPS: IconGroup[] = [
  {
    prop: "justify-content",
    label: m.composer_display_justify(),
    ariaLabel: `${m.composer_display_justify()} ${m.composer_display_content()}`,
    options: GRID_JUSTIFY_CONTENT_OPTIONS,
  },
  { prop: "align-content", label: m.composer_display_content(), options: GRID_ALIGN_CONTENT_OPTIONS },
  {
    prop: "justify-items",
    label: m.composer_display_justify(),
    ariaLabel: `${m.composer_display_justify()} ${m.composer_display_items()}`,
    options: GRID_JUSTIFY_ITEMS_OPTIONS,
  },
  { prop: "align-items", label: m.composer_display_align(), options: GRID_ALIGN_ITEMS_OPTIONS },
]

const GRID_COLUMN_PRESETS = [
  { id: "two-columns", label: m.composer_display_preset_two_cols(), value: "repeat(2, minmax(0, 1fr))" },
  { id: "three-columns", label: m.composer_display_preset_three_cols(), value: "repeat(3, minmax(0, 1fr))" },
  { id: "four-columns", label: m.composer_display_preset_four_cols(), value: "repeat(4, minmax(0, 1fr))" },
  { id: "twelve-columns", label: m.composer_display_preset_twelve_cols(), value: "repeat(12, minmax(0, 1fr))" },
  { id: "auto-fit", label: m.composer_display_preset_auto_fit(), value: "repeat(auto-fit, minmax(16rem, 1fr))" },
  { id: "auto-fill", label: m.composer_display_preset_auto_fill(), value: "repeat(auto-fill, minmax(250px, 1fr))" },
  { id: "sidebar", label: m.composer_display_preset_sidebar(), value: "240px minmax(0, 1fr)" },
] as const

const GRID_ROW_PRESETS = [
  { id: "auto", label: m.composer_display_preset_auto(), value: "auto" },
  { id: "two-rows", label: m.composer_display_preset_two_rows(), value: "repeat(2, auto)" },
  { id: "three-rows", label: m.composer_display_preset_three_rows(), value: "repeat(3, auto)" },
  { id: "app-shell", label: m.composer_display_preset_app_shell(), value: "auto minmax(0, 1fr) auto" },
  { id: "rails", label: m.composer_display_preset_rails(), value: "min-content auto max-content" },
] as const

const tagDefaultDisplay = computed<DisplayMode>(() => {
  switch ((props.elementTag ?? "").toLowerCase()) {
    case "a":
    case "span":
    case "i":
    case "img":
    case "svg":
      return "inline"
    case "button":
      return "inline-block"
    default:
      return "block"
  }
})

function value(property: DisplayProperty): string {
  return props.values[property] ?? ""
}

function inherited(property: DisplayProperty): boolean {
  return props.inheritedProperties?.includes(property) ?? false
}

function commit(property: DisplayProperty, nextValue: string): void {
  emit("commit", property, nextValue)
}

function equivalentAlignment(left: string, right: string): boolean {
  if (left === right) return true
  const aliases: Record<string, string> = {
    start: "flex-start",
    "flex-start": "start",
    end: "flex-end",
    "flex-end": "end",
  }
  return aliases[left] === right
}

function iconActive(property: DisplayProperty, optionValue: string): boolean {
  return equivalentAlignment(value(property), optionValue)
}

const resolvedDisplay = computed(() => value("display") || tagDefaultDisplay.value)
const isFlexDisplay = computed(() =>
  FLEX_DISPLAY_MODES.includes(resolvedDisplay.value as (typeof FLEX_DISPLAY_MODES)[number]),
)
const isGridDisplay = computed(() =>
  GRID_DISPLAY_MODES.includes(resolvedDisplay.value as (typeof GRID_DISPLAY_MODES)[number]),
)
const isGridLanesDisplay = computed(() => resolvedDisplay.value === "grid-lanes")
const isVisible = computed(() => {
  const visibility = value("visibility")
  return visibility !== "hidden" && visibility !== "collapse"
})

function applyGridTemplatePreset(
  property: "grid-template-columns" | "grid-template-rows",
  nextValue: string,
): void {
  commit(property, nextValue)
  if (property === "grid-template-columns") gridColumnsPresetOpen.value = false
  else gridRowsPresetOpen.value = false
}

function setVisibility(nextVisible: boolean): void {
  if (nextVisible === isVisible.value) return
  commit("visibility", nextVisible ? "visible" : "hidden")
}

function moveRadio(
  event: KeyboardEvent,
  values: readonly string[],
  current: string,
  select: (next: string) => void,
): void {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
  event.preventDefault()
  const fallback = values[0] ?? ""
  const exactIndex = values.indexOf(current)
  const currentIndex = exactIndex >= 0
    ? exactIndex
    : Math.max(0, values.findIndex((value) => equivalentAlignment(current, value)))
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? values.length - 1
      : (currentIndex + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + values.length) % values.length
  const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]')
  const buttons = group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
  buttons?.[nextIndex]?.focus()
  select(values[nextIndex] ?? fallback)
}

function iconButtonClass(active: boolean): string {
  return cn(
    "flex h-7 flex-1 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-45",
    active && "bg-muted text-foreground",
  )
}

function presetTriggerClass(open: boolean): string {
  return cn(
    "flex size-7 items-center justify-center rounded-sm border border-transparent text-muted-foreground transition-colors hover:border-border/70 hover:bg-muted/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50",
    open && "border-primary/60 bg-primary/10 text-primary",
  )
}
</script>

<template>
  <div class="space-y-3 pb-1" data-testid="composer-display-controls">
    <div
      class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3"
      data-display-property="display"
      :data-resolved-display="resolvedDisplay"
    >
      <span class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_display_mode() }}
        <span v-if="inherited('display')" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </span>
      <Select
        :model-value="resolvedDisplay"
        :disabled="disabled"
        @update:model-value="commit('display', String($event ?? ''))"
      >
        <SelectTrigger class="h-8 w-full rounded-md px-2 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent class="min-w-0">
          <template v-for="(group, groupIndex) in DISPLAY_OPTION_GROUPS" :key="group.id">
            <SelectItem
              v-for="option in group.options"
              :key="option.value"
              :value="option.value"
              class="text-xs"
            >
              {{ option.label }}
            </SelectItem>
            <SelectSeparator v-if="groupIndex < DISPLAY_OPTION_GROUPS.length - 1" />
          </template>
        </SelectContent>
      </Select>
    </div>

    <div class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3" data-display-property="overflow">
      <span class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_display_overflow() }}
        <span v-if="inherited('overflow')" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </span>
      <Select
        :model-value="value('overflow') || '__unset__'"
        :disabled="disabled"
        @update:model-value="commit('overflow', String($event) === '__unset__' ? '' : String($event))"
      >
        <SelectTrigger class="h-8 w-full rounded-md px-2 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__unset__">—</SelectItem>
          <SelectItem v-for="option in OVERFLOW_OPTIONS" :key="option" :value="option">{{ option }}</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <template v-if="isFlexDisplay">
      <div
        v-for="group in FLEX_GROUPS"
        :key="group.prop"
        class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3"
        :data-display-property="group.prop"
      >
        <span class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
          {{ group.label }}
          <span v-if="inherited(group.prop)" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
        </span>
        <div class="flex rounded-md border border-border/50 bg-background/80 p-0.5" role="radiogroup" :aria-label="group.ariaLabel ?? group.label">
          <button
            v-for="option in group.options"
            :key="option.value"
            type="button"
            role="radio"
            :aria-checked="iconActive(group.prop, option.value)"
            :tabindex="iconActive(group.prop, option.value) || (!value(group.prop) && option.value === group.options[0]?.value) ? 0 : -1"
            :title="option.label"
            :aria-label="option.label"
            :disabled="disabled"
            :class="iconButtonClass(iconActive(group.prop, option.value))"
            @click="commit(group.prop, option.value)"
            @keydown="moveRadio($event, group.options.map((item) => item.value), value(group.prop), (next) => commit(group.prop, next))"
          >
            <AppIcon :name="option.icon" :size="15" :class="option.iconClass" aria-hidden="true" />
          </button>
        </div>
      </div>
    </template>

    <template v-else-if="isGridDisplay">
      <div class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3" data-display-property="grid-template-columns">
        <span class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
          {{ m.composer_display_columns() }}
          <span v-if="inherited('grid-template-columns')" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
        </span>
        <VariableAssignableInput
          :model-value="value('grid-template-columns')"
          :placeholder="m.composer_display_columns_placeholder()"
          :disabled="disabled"
          input-class="h-8 border-dashed bg-sidebar font-mono text-xs"
          @update:model-value="emit('preview', 'grid-template-columns', $event)"
          @commit="commit('grid-template-columns', $event)"
        >
          <template #end-actions>
            <Popover v-model:open="gridColumnsPresetOpen">
              <PopoverTrigger as-child>
                <button
                  type="button"
                  data-testid="grid-cols-helper-trigger"
                  :title="m.composer_display_grid_columns_presets()"
                  :aria-label="m.composer_display_grid_columns_presets()"
                  :disabled="disabled"
                  :class="presetTriggerClass(gridColumnsPresetOpen)"
                >
                  <AppIcon name="energy" :size="14" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" :side-offset="6" class="w-80 p-1.5" @open-auto-focus.prevent>
                <div class="space-y-1">
                  <div class="px-2 py-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {{ m.composer_display_column_presets() }}
                  </div>
                  <button
                    v-for="preset in GRID_COLUMN_PRESETS"
                    :key="preset.id"
                    type="button"
                    :data-testid="`grid-cols-preset-${preset.id}`"
                    class="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
                    @click="applyGridTemplatePreset('grid-template-columns', preset.value)"
                  >
                    <span class="min-w-0 flex-1 truncate text-xs text-foreground">{{ preset.label }}</span>
                    <span class="max-w-44 truncate text-[10px] text-muted-foreground">{{ preset.value }}</span>
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </template>
        </VariableAssignableInput>
      </div>

      <div class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3" data-display-property="grid-template-rows">
        <span class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
          {{ m.composer_display_rows() }}
          <span v-if="inherited('grid-template-rows')" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
        </span>
        <VariableAssignableInput
          :model-value="value('grid-template-rows')"
          :placeholder="m.composer_display_rows_placeholder()"
          :disabled="disabled"
          input-class="h-8 border-dashed bg-sidebar font-mono text-xs"
          @update:model-value="emit('preview', 'grid-template-rows', $event)"
          @commit="commit('grid-template-rows', $event)"
        >
          <template #end-actions>
            <Popover v-model:open="gridRowsPresetOpen">
              <PopoverTrigger as-child>
                <button
                  type="button"
                  data-testid="grid-rows-helper-trigger"
                  :title="m.composer_display_grid_rows_presets()"
                  :aria-label="m.composer_display_grid_rows_presets()"
                  :disabled="disabled"
                  :class="presetTriggerClass(gridRowsPresetOpen)"
                >
                  <AppIcon name="energy" :size="14" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" :side-offset="6" class="w-80 p-1.5" @open-auto-focus.prevent>
                <div class="space-y-1">
                  <div class="px-2 py-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {{ m.composer_display_row_presets() }}
                  </div>
                  <button
                    v-for="preset in GRID_ROW_PRESETS"
                    :key="preset.id"
                    type="button"
                    :data-testid="`grid-rows-preset-${preset.id}`"
                    class="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
                    @click="applyGridTemplatePreset('grid-template-rows', preset.value)"
                  >
                    <span class="min-w-0 flex-1 truncate text-xs text-foreground">{{ preset.label }}</span>
                    <span class="max-w-44 truncate text-[10px] text-muted-foreground">{{ preset.value }}</span>
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </template>
        </VariableAssignableInput>
      </div>

      <div
        v-for="group in GRID_GROUPS"
        :key="`${group.prop}:${group.label}`"
        class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3"
        :data-display-property="group.prop"
      >
        <span class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
          {{ group.label }}
          <span v-if="inherited(group.prop)" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
        </span>
        <div class="flex rounded-md border border-border/50 bg-background/80 p-0.5" role="radiogroup" :aria-label="group.ariaLabel ?? group.label">
          <button
            v-for="option in group.options"
            :key="option.value"
            type="button"
            role="radio"
            :aria-checked="iconActive(group.prop, option.value)"
            :tabindex="iconActive(group.prop, option.value) || (!value(group.prop) && option.value === group.options[0]?.value) ? 0 : -1"
            :title="option.label"
            :aria-label="option.label"
            :disabled="disabled"
            :class="iconButtonClass(iconActive(group.prop, option.value))"
            @click="commit(group.prop, option.value)"
            @keydown="moveRadio($event, group.options.map((item) => item.value), value(group.prop), (next) => commit(group.prop, next))"
          >
            <AppIcon :name="option.icon" :size="15" :class="option.iconClass" aria-hidden="true" />
          </button>
        </div>
      </div>
    </template>

    <div
      v-if="isFlexDisplay || isGridDisplay"
      class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3"
      data-display-property="gap"
    >
      <span class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_display_gap() }}
        <span v-if="inherited('gap')" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </span>
      <VariableAssignableInput
        :model-value="value('gap')"
        :placeholder="m.composer_display_gap_placeholder()"
        :disabled="disabled"
        input-class="h-8 border-dashed bg-sidebar font-mono text-xs"
        @update:model-value="emit('preview', 'gap', $event)"
        @commit="commit('gap', $event)"
      />
    </div>

    <div
      v-if="isGridLanesDisplay"
      class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3"
      data-display-property="flow-tolerance"
    >
      <span class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_display_tolerance() }}
        <span v-if="inherited('flow-tolerance')" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </span>
      <VariableAssignableInput
        :model-value="value('flow-tolerance')"
        :placeholder="m.composer_display_tolerance_placeholder()"
        :disabled="disabled"
        input-class="h-8 border-dashed bg-sidebar font-mono text-xs"
        @update:model-value="emit('preview', 'flow-tolerance', $event)"
        @commit="commit('flow-tolerance', $event)"
      />
    </div>

    <div
      v-if="parentIsGrid"
      class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3"
      data-display-property="grid-column"
    >
      <span class="flex min-h-8 items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_display_span() }}
        <span v-if="inherited('grid-column')" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </span>
      <VariableAssignableInput
        :model-value="value('grid-column')"
        :placeholder="m.composer_display_span_placeholder()"
        :disabled="disabled"
        input-class="h-8 border-dashed bg-sidebar font-mono text-xs"
        @update:model-value="emit('preview', 'grid-column', $event)"
        @commit="commit('grid-column', $event)"
      />
    </div>

    <div class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3" data-display-property="visibility">
      <span class="flex items-center gap-1 text-3xs font-semibold uppercase tracking-widest text-muted-foreground">
        {{ m.composer_display_visible() }}
        <span v-if="inherited('visibility')" class="size-1.5 rounded-full border border-primary/60" :title="m.composer_inspector_inherited_value()" />
      </span>
      <div class="flex flex-1 items-center justify-end">
        <Switch
          data-testid="display-visible-switch"
          :model-value="isVisible"
          :disabled="disabled"
          :aria-label="m.composer_display_visible()"
          @update:model-value="setVisibility(Boolean($event))"
        />
      </div>
    </div>
  </div>
</template>
