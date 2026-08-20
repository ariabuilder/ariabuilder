<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { m } from "@/paraglide/messages.js"
import HeaderActionTooltip from "@/workspace/studio/core/components/HeaderActionTooltip.vue"
import { normalizeClassSelectorSuffix } from "../../../../shared/composer"

const props = withDefaults(defineProps<{
  modelValue: string
  disabled?: boolean
  compact?: boolean
}>(), { disabled: false, compact: false })

const emit = defineEmits<{ "update:modelValue": [value: string] }>()

const categories = [
  { id: "popover", label: "Popover", icon: "layoutGrid" as const, values: [":popover-open", "::backdrop"] },
  { id: "states", label: "States", icon: "cursor" as const, values: ["hover", "focus", "active", "focus-visible", "focus-within", "visited"] },
  { id: "forms", label: "Forms", icon: "inspectorTabProps" as const, values: ["disabled", "enabled", "checked", "indeterminate", "required", "optional", "valid", "invalid", "read-only"] },
  { id: "structure", label: "Structure", icon: "layers" as const, values: ["first-child", "last-child", "only-child", "first-of-type", "last-of-type", "only-of-type", "nth-child(odd)", "nth-child(even)", "empty"] },
  { id: "relational", label: "Relational", icon: "link" as const, values: ["has(*)", "has(> *)", "not(:first-child)", "is(:hover, :focus-visible)", "where(:hover, :focus-visible)"] },
  { id: "elements", label: "Elements", icon: "sparkles" as const, values: ["::before", "::after", "::placeholder", "::selection", "::marker", "::file-selector-button"] },
]

const open = ref(false)
const query = ref("")
const categoryId = ref<string | null>(null)
const validationError = ref("")
const triggerClass = computed(() => props.compact
  ? "size-6 cursor-pointer rounded-sm"
  : "size-7 rounded-sm")
const triggerIconSize = computed(() => props.compact ? 12 : 16)
const currentCategory = computed(() => categories.find((item) => item.id === categoryId.value) ?? null)
const normalizedQuery = computed(() => normalizeClassSelectorSuffix(query.value))
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return []
  return categories.flatMap((category) => category.values)
    .filter((value) => value.toLowerCase().includes(needle))
})

watch(open, (value) => {
  if (!value) {
    query.value = ""
    categoryId.value = null
    validationError.value = ""
  }
})

function select(value: string) {
  const normalized = normalizeClassSelectorSuffix(value)
  if (normalized == null || props.disabled) return
  emit("update:modelValue", normalized || "default")
  open.value = false
}

function applyCustom() {
  if (normalizedQuery.value == null || normalizedQuery.value === "") {
    validationError.value = m.composer_inspector_pseudo_invalid()
    return
  }
  select(normalizedQuery.value)
}
</script>

<template>
  <Tooltip v-if="disabled">
    <TooltipTrigger as-child>
      <span class="inline-flex">
        <Button type="button" variant="ghost" size="icon-sm" :class="triggerClass" disabled>
          <AppIcon name="pseudoState" :size="triggerIconSize" aria-hidden="true" />
        </Button>
      </span>
    </TooltipTrigger>
    <TooltipContent side="bottom">{{ m.composer_inspector_pseudo_disabled() }}</TooltipContent>
  </Tooltip>

  <HeaderActionTooltip v-else :label="m.composer_inspector_pseudo_action()">
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          :class="[triggerClass, modelValue !== 'default' && 'text-primary']"
          :aria-label="m.composer_inspector_pseudo_action()"
        >
          <AppIcon name="pseudoState" :size="triggerIconSize" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        :side-offset="8"
        class="w-66 overflow-hidden rounded-sm border-border/80 p-2 shadow-xl"
        @open-auto-focus.prevent
      >
      <button
        type="button"
        class="mb-2 flex min-h-8 w-full items-center justify-between rounded-sm border border-primary/10 px-3 text-xs transition-colors hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-primary"
        :class="modelValue === 'default' ? 'bg-primary/15 text-foreground' : 'text-muted-foreground'"
        @click="select('default')"
      >
        <span>{{ m.composer_inspector_pseudo_normal() }}</span>
        <AppIcon v-if="modelValue === 'default'" name="checkLinear" :size="13" />
      </button>

      <Input
        v-model="query"
        class="mb-2 h-8 text-xs"
        :placeholder="m.composer_inspector_pseudo_search()"
        :aria-label="m.composer_inspector_pseudo_search()"
        @keydown.enter.prevent="applyCustom"
      />

      <div v-if="query.trim()" class="max-h-72 overflow-y-auto">
        <p class="px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{{ m.composer_inspector_pseudo_presets() }}</p>
        <button
          v-for="value in filtered"
          :key="value"
          type="button"
          class="flex min-h-8 w-full items-center rounded-sm px-2 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-primary/15 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          @click="select(value)"
        >{{ normalizeClassSelectorSuffix(value) }}</button>
        <button
          type="button"
          class="mt-1 flex min-h-8 w-full items-center rounded-sm border border-dashed border-border px-2 font-mono text-[11px] text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-45"
          :disabled="normalizedQuery == null || normalizedQuery === ''"
          @click="applyCustom"
        >{{ m.composer_inspector_pseudo_apply({ selector: query.trim() }) }}</button>
        <p v-if="validationError" role="alert" class="px-2 pt-1 text-[10px] text-destructive">{{ validationError }}</p>
      </div>

      <div v-else-if="currentCategory" class="max-h-72 overflow-y-auto">
        <button
          type="button"
          class="flex min-h-8 w-full items-center gap-1.5 rounded-sm px-2 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
          @click="categoryId = null"
        >
          <AppIcon name="arrowLeftLinear" :size="13" />
          <span class="flex-1 text-left">{{ currentCategory.label }}</span>
          <span class="rounded-sm bg-muted px-1.5 py-0.5">{{ currentCategory.values.length }}</span>
        </button>
        <div class="flex flex-wrap gap-1.5 p-1">
          <button
            v-for="value in currentCategory.values"
            :key="value"
            type="button"
            class="min-h-7 rounded-sm border border-transparent bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/15 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            :class="modelValue === normalizeClassSelectorSuffix(value) && 'border-primary/60 bg-primary/15 text-foreground'"
            @click="select(value)"
          >{{ normalizeClassSelectorSuffix(value) }}</button>
        </div>
      </div>

      <div v-else class="grid gap-1.5">
        <button
          v-for="category in categories"
          :key="category.id"
          type="button"
          class="flex min-h-9 items-center gap-2 rounded-sm border border-transparent bg-card/50 px-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/15 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          @click="categoryId = category.id"
        >
          <AppIcon :name="category.icon" :size="14" class="opacity-60" />
          <span>{{ category.label }}</span>
        </button>
      </div>
      </PopoverContent>
    </Popover>
  </HeaderActionTooltip>
</template>
