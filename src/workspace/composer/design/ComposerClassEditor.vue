<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { m } from "@/paraglide/messages.js"
import {
  addClassName,
  commitStringValue,
  diffRenderedClasses,
  isAriaBemBlockClass,
  isAriaBemElementClass,
  isMotionClass,
  isLikelyUtilityClass,
  splitClassNames,
} from "../../../../shared/composer"
import type { PropValue } from "../../../../shared/composer/types"
import { tryUseComposerDesignClasses } from "../useComposerDesignContext"
import ComposerClassTagChip from "./ComposerClassTagChip.vue"
import { removeComposerSourceClass } from "./composerClassTokens"

const props = defineProps<{
  classText: string
  sourceClassNames?: string[]
  isExpr: boolean
  opaque: boolean
  renderedClasses: string[]
  customClassNames?: string[]
  activeClassName?: string | null
  canPasteStyles?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  setClass: [value: PropValue | undefined, immediate: boolean]
  addExprClass: [name: string]
  removeExprClass: [name: string]
  activateClass: [name: string]
  createClass: [name: string]
  done: []
  copyStyles: [name?: string]
  pasteStyles: [name?: string]
  editCss: [name?: string]
  rename: [name?: string]
  duplicate: [name?: string]
  forkBem: [blockClass: string]
}>()

const design = tryUseComposerDesignClasses()
const query = ref("")
const pickerOpen = ref(false)
const pickerAnchor = ref<HTMLElement | null>(null)
const expanded = ref(new Set<string>())
const detachedRenderedNames = ref(new Set<string>())
const utilityCategory = ref<string | null>(null)

const utilityCategories = [
  { id: "layout", label: "Layout", pattern: /^(block|inline|flex|grid|hidden|container|overflow-|columns-|float-|clear-)/ },
  { id: "spacing", label: "Spacing", pattern: /^(p[trblxy]?|m[trblxy]?|gap|space-[xy])-/ },
  { id: "sizing", label: "Sizing", pattern: /^(w-|h-|min-[wh]-|max-[wh]-|size-|aspect-)/ },
  { id: "type", label: "Typography", pattern: /^(text-|font-|leading-|tracking-|uppercase|lowercase|capitalize|truncate|line-clamp-)/ },
  { id: "color", label: "Colors", pattern: /^(text-|bg-|fill-|stroke-|accent-|caret-|decoration-)/ },
  { id: "border", label: "Borders", pattern: /^(border|rounded|divide-|outline-|ring-)/ },
  { id: "effect", label: "Effects", pattern: /^(shadow|opacity-|blur|backdrop-|mix-blend-|transition|duration-|ease-)/ },
  { id: "position", label: "Position", pattern: /^(static|relative|absolute|fixed|sticky|inset-|top-|right-|bottom-|left-|z-)/ },
] as const

const sourceNames = computed(() => props.sourceClassNames
  ? [...props.sourceClassNames]
  : props.isExpr ? [] : splitClassNames(props.classText).filter((name) => !isMotionClass(name)))
const customNames = computed(() => [...new Set([
  ...(design?.classNames.value ?? []),
  ...(props.customClassNames ?? []),
])].filter((name) => !isMotionClass(name)).sort((left, right) => left.localeCompare(right)))
const customSet = computed(() => new Set(customNames.value))
const utilityCandidates = computed(() => (design?.utilityCandidates.value ?? []).filter((name) => !isMotionClass(name)))
const renderedDiff = computed(() => diffRenderedClasses(
  sourceNames.value,
  props.renderedClasses.filter((name) =>
    !isMotionClass(name) && !detachedRenderedNames.value.has(name),
  ),
))
const filteredCustom = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return customNames.value.filter((name) => !sourceNames.value.includes(name))
    .filter((name) => !needle || name.toLowerCase().includes(needle)).slice(0, 12)
})
const filteredUtilities = computed(() => {
  const needle = query.value.trim().toLowerCase()
  const category = utilityCategories.find((item) => item.id === utilityCategory.value)
  return utilityCandidates.value.filter((name) => !sourceNames.value.includes(name))
    .filter((name) => needle ? name.toLowerCase().includes(needle) : category?.pattern.test(name) ?? false).slice(0, 60)
})

function setSource(names: string[]) {
  emit("setClass", commitStringValue(undefined, names.join(" ")), true)
}

function add(name: string) {
  const token = name.trim().replace(/^\./, "")
  if (!token || props.disabled || props.opaque) return
  if (props.isExpr) emit("addExprClass", token)
  else setSource(addClassName(sourceNames.value, token))
  query.value = ""
  utilityCategory.value = null
  pickerOpen.value = false
  if (customSet.value.has(token)) emit("activateClass", token)
}

function submit() {
  const token = query.value.trim().replace(/^\./, "")
  if (!token) return
  if (customSet.value.has(token) || isLikelyUtilityClass(token)) add(token)
  else emit("createClass", token)
  query.value = ""
  utilityCategory.value = null
  pickerOpen.value = false
}

function remove(name: string) {
  if (props.disabled) return
  // The source model updates synchronously, but the iframe class readout can
  // echo its previous classList until the DOM patch and next rect pass land.
  // Hide that explicit detach immediately; retain all other runtime classes.
  detachedRenderedNames.value = new Set(detachedRenderedNames.value).add(name)
  if (props.isExpr) {
    emit("removeExprClass", name)
    if (props.activeClassName === name) emit("done")
    return
  }
  const value = removeComposerSourceClass(sourceNames.value, name)
  emit("setClass", value, true)
  if (props.activeClassName === name) emit("done")
}

watch(
  [() => props.renderedClasses, sourceNames],
  ([rendered, source]) => {
    const next = new Set(detachedRenderedNames.value)
    let changed = false
    for (const name of next) {
      // Release the optimistic mask after the bridge acknowledges removal, or
      // if the user explicitly attaches the class again.
      if (!rendered.includes(name) || source.includes(name)) {
        next.delete(name)
        changed = true
      }
    }
    if (changed) detachedRenderedNames.value = next
  },
  { deep: true },
)

function toggleExpanded(name: string) {
  const next = new Set(expanded.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  expanded.value = next
}

function keepPickerOpenForAnchor(event: CustomEvent<{ originalEvent: Event }>) {
  const target = event.detail.originalEvent.target
  if (target instanceof Node && pickerAnchor.value?.contains(target)) event.preventDefault()
}
</script>

<template>
  <div class="bg-muted/50 px-3 py-4">
    <div class="space-y-3">
      <template v-if="isExpr">
        <p class="rounded-sm border border-dashed border-border/60 bg-background/40 px-2 py-1.5 font-mono text-[11px] text-muted-foreground break-all">{{ classText || '—' }}</p>
        <p class="text-[11px] leading-relaxed text-muted-foreground">{{ m.composer_inspector_classes_expression_hint() }}</p>
      </template>

      <Popover v-model:open="pickerOpen">
        <PopoverAnchor class="block w-full">
          <div ref="pickerAnchor" class="relative">
            <Input
              v-model="query"
              class="h-9 pr-9 text-xs"
              :disabled="disabled || opaque"
              :placeholder="m.composer_inspector_classes_add_placeholder()"
              :aria-label="m.composer_inspector_classes_add_placeholder()"
              @focus="pickerOpen = true"
              @keydown.down.prevent="pickerOpen = true"
              @keydown.enter.prevent="submit"
            />
            <Button type="button" size="icon-sm" variant="ghost" class="absolute right-1 top-1/2 -translate-y-1/2" :disabled="disabled || opaque" :aria-label="query ? m.composer_inspector_classes_add() : m.composer_inspector_classes_browse()" @click="query ? submit() : (pickerOpen = true)">
              <AppIcon :name="query ? 'arrowDownRight' : 'plus'" :size="14" />
            </Button>
          </div>
        </PopoverAnchor>
        <PopoverContent class="w-(--reka-popover-trigger-width) min-w-64 max-h-92 overflow-hidden rounded-sm border-border/60 bg-sidebar p-1.5 shadow-xl" align="start" :side-offset="4" @open-auto-focus.prevent @interact-outside="keepPickerOpenForAnchor">
          <div class="max-h-88 overflow-y-auto">
            <template v-if="filteredCustom.length">
              <p class="selector-label">{{ m.composer_inspector_classes_custom() }}</p>
              <button v-for="name in filteredCustom" :key="name" type="button" class="selector-row" @click="add(name)"><span class="font-mono">.{{ name }}</span><AppIcon v-if="sourceNames.includes(name)" name="checkLinear" :size="13" class="ml-auto" /></button>
            </template>
            <template v-if="query.trim() && filteredUtilities.length">
              <p class="selector-label">{{ m.composer_inspector_classes_utilities() }}</p>
              <button v-for="name in filteredUtilities" :key="name" type="button" class="selector-row font-mono" @click="add(name)">{{ name }}</button>
            </template>
            <template v-else-if="utilityCategory">
              <button type="button" class="selector-row mb-1 uppercase tracking-widest" @click="utilityCategory = null"><AppIcon name="arrowLeftLinear" :size="13" /><span class="flex-1">{{ utilityCategories.find((item) => item.id === utilityCategory)?.label }}</span><span class="rounded-sm bg-muted px-1.5 py-0.5 text-[9px]">{{ filteredUtilities.length }}</span></button>
              <button v-for="name in filteredUtilities" :key="name" type="button" class="selector-row font-mono" @click="add(name)">{{ name }}</button>
              <p v-if="!filteredUtilities.length" class="px-3 py-5 text-center text-[11px] text-muted-foreground">{{ m.composer_inspector_classes_category_empty() }}</p>
            </template>
            <template v-else-if="!query.trim() && utilityCandidates.length">
              <p class="selector-label">{{ m.composer_inspector_classes_utilities() }}</p>
              <div class="grid grid-cols-2 gap-1">
                <button v-for="category in utilityCategories" :key="category.id" type="button" class="selector-row border border-transparent bg-card/40" @click="utilityCategory = category.id">{{ category.label }}</button>
              </div>
            </template>
            <button v-if="query.trim() && !customSet.has(query.trim()) && !isLikelyUtilityClass(query.trim())" type="button" class="selector-row mt-1 text-foreground" @click="submit"><AppIcon name="addCircleLinear" :size="14" /><span>{{ m.composer_inspector_classes_create({ name: query.trim().replace(/^\./, '') }) }}</span></button>
            <p v-if="!filteredCustom.length && !filteredUtilities.length && !query.trim() && !utilityCandidates.length" class="px-3 py-6 text-center text-[11px] text-muted-foreground">{{ m.composer_inspector_classes_empty() }}</p>
          </div>
        </PopoverContent>
      </Popover>

      <div class="flex min-h-6 flex-wrap gap-1.5">
        <template v-for="name in sourceNames" :key="name">
          <ContextMenu v-if="customSet.has(name)">
            <ContextMenuTrigger as-child>
              <ComposerClassTagChip :label="`.${name}`" variant="custom" activatable :active="activeClassName === name" @activate="activeClassName === name ? emit('done') : emit('activateClass', name)" @contextmenu="emit('activateClass', name)" @remove="remove(name)" />
            </ContextMenuTrigger>
            <ContextMenuContent class="w-48">
              <ContextMenuItem @select="emit('copyStyles', name)"><AppIcon name="copy" :size="14" /><span>{{ m.composer_inspector_classes_copy() }}</span></ContextMenuItem>
              <ContextMenuItem v-if="canPasteStyles" @select="emit('pasteStyles', name)"><AppIcon name="clipboard" :size="14" /><span>{{ m.composer_inspector_classes_paste() }}</span></ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem @select="emit('editCss', name)"><AppIcon name="edit" :size="14" /><span>{{ m.composer_inspector_classes_edit_css() }}</span></ContextMenuItem>
              <ContextMenuItem @select="emit('rename', name)"><AppIcon name="rename" :size="14" /><span>{{ m.composer_inspector_classes_rename() }}</span></ContextMenuItem>
              <ContextMenuItem @select="emit('duplicate', name)"><AppIcon name="duplicate" :size="14" /><span>{{ m.composer_inspector_classes_duplicate() }}</span></ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" @select="remove(name)"><AppIcon name="unlink02" :size="14" /><span>{{ m.composer_inspector_classes_remove() }}</span></ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <ContextMenu v-else-if="isAriaBemBlockClass(name)">
            <ContextMenuTrigger as-child>
              <ComposerClassTagChip :label="name" variant="bem" :removable="!disabled && !opaque" @remove="remove(name)" />
            </ContextMenuTrigger>
            <ContextMenuContent class="w-48">
              <ContextMenuItem :disabled="disabled || opaque" @select="emit('forkBem', name)">
                <AppIcon name="duplicate" :size="14" />
                <span>{{ m.composer_inspector_bem_fork() }}</span>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" :disabled="disabled || opaque" @select="remove(name)">
                <AppIcon name="unlink02" :size="14" />
                <span>{{ m.composer_inspector_classes_remove() }}</span>
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <ComposerClassTagChip v-else :label="name" :variant="isAriaBemElementClass(name) ? 'bem' : 'utility'" :expanded="expanded.has(name)" :removable="!isAriaBemElementClass(name)" @remove="remove(name)" @toggle-expand="toggleExpanded(name)" />
        </template>
        <ComposerClassTagChip v-for="name in renderedDiff.renderedOnly" :key="`rendered-${name}`" :label="name" variant="rendered" :removable="false" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.selector-label { padding: .375rem .5rem .25rem; color: var(--muted-foreground); font-size: .625rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
.selector-row { display: flex; width: 100%; min-height: 2rem; align-items: center; gap: .5rem; border-radius: var(--radius-sm); padding: .4375rem .5rem; color: var(--muted-foreground); font-size: .75rem; text-align: left; transition: background-color 120ms ease, color 120ms ease; }
.selector-row:hover, .selector-row:focus-visible { background: color-mix(in srgb, var(--sidebar) 72%, var(--primary) 10%); color: var(--foreground); outline: 2px solid var(--primary); outline-offset: -2px; }
</style>
