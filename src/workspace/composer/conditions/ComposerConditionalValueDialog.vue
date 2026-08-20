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
  allocConditionId,
  cloneConditionSet,
  type ConditionEvaluationContext,
  type ConditionSet,
  type ConditionSourceOption,
} from "../../../../shared/conditions"
import {
  conditionalPropValue,
  evaluateComposerConditionalValue,
  parseManagedConditionalPropValue,
  validateComposerConditionalValue,
  type ComposerConditionalValue,
} from "../../../../shared/composer/conditionalValues"
import type { PropField, PropValue } from "../../../../shared/composer/types"
import ComposerPropField from "../props/ComposerPropField.vue"
import ComposerConditionBuilder from "./ComposerConditionBuilder.vue"

type DraftCase = {
  id: string
  when?: ConditionSet
  value: PropValue
}

const props = defineProps<{
  field: PropField | null
  value?: PropValue
  sources: readonly ConditionSourceOption[]
  context?: ConditionEvaluationContext
  disabled?: boolean
  sourcesLoading?: boolean
  sourcesError?: string
  hasRegisteredCollections?: boolean
}>()
const open = defineModel<boolean>("open", { default: false })
const emit = defineEmits<{ save: [value: PropValue] }>()

const cases = ref<DraftCase[]>([])
const fallback = ref<PropValue>({ type: "string", value: "" })
const error = ref("")
const existing = computed(() => parseManagedConditionalPropValue(props.value))
const hasCmsSources = computed(() => props.sources.some((source) => source.source.provider === "cms"))

function clonePropValue(value: PropValue): PropValue {
  return value.type === "bare" ? { type: "bare" } : { ...value }
}

function defaultValue(): PropValue {
  if (props.value && !parseManagedConditionalPropValue(props.value)) return clonePropValue(props.value)
  const value = props.field?.default
  if (typeof value === "boolean") return value ? { type: "bare" } : { type: "expr", value: "false" }
  if (typeof value === "number") return { type: "expr", value: String(value) }
  return { type: "string", value: typeof value === "string" ? value : "" }
}

watch(open, (value) => {
  if (!value) return
  const current = existing.value
  fallback.value = clonePropValue(current?.fallback ?? defaultValue())
  cases.value = current?.cases.map((candidate) => ({
    id: candidate.id,
    when: cloneConditionSet(candidate.when),
    value: clonePropValue(candidate.value),
  })) ?? []
  error.value = ""
})

function addCase() {
  cases.value.push({ id: allocConditionId("case"), value: clonePropValue(fallback.value) })
}

function setCaseValue(index: number, value: PropValue | undefined) {
  const candidate = cases.value[index]
  if (candidate) candidate.value = clonePropValue(value ?? defaultValue())
}

function setFallback(value: PropValue | undefined) {
  fallback.value = clonePropValue(value ?? defaultValue())
}

const complete = computed(() => cases.value.length > 0 && cases.value.every((candidate) => candidate.when?.groups.length))
const draftValue = computed((): ComposerConditionalValue | null => complete.value ? {
  version: 1,
  cases: cases.value.map((candidate) => ({
    id: candidate.id,
    when: cloneConditionSet(candidate.when!),
    value: clonePropValue(candidate.value),
  })),
  fallback: clonePropValue(fallback.value),
} : null)
const currentMatch = computed(() => {
  if (!draftValue.value) return null
  return evaluateComposerConditionalValue(draftValue.value, props.context ?? { providers: {} })
})

function save() {
  if (!draftValue.value || props.disabled) return
  const issues = validateComposerConditionalValue(draftValue.value)
  const value = issues.length ? null : conditionalPropValue(draftValue.value)
  if (!value) {
    error.value = issues[0] ?? "This conditional value cannot be saved."
    return
  }
  emit("save", value)
  open.value = false
}

function removeConditionalValue() {
  emit("save", clonePropValue(fallback.value))
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[88vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Set conditional value</DialogTitle>
        <DialogDescription>
          The first matching case sets {{ field?.name ?? "this value" }}. Otherwise is always used as a safe fallback.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-3">
        <p v-if="sourcesLoading" role="status" class="text-xs text-muted-foreground">
          Loading CMS condition options…
        </p>
        <p v-else-if="sourcesError" role="status" class="text-xs text-muted-foreground">
          CMS fields could not be loaded. In-scope variables are still available.
        </p>
        <p
          v-else-if="hasRegisteredCollections && !hasCmsSources"
          class="rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
        >
          CMS conditions appear when this content is inside a CMS loop or the page has loaded a CMS entry. Bind CMS content first, then choose its fields here.
        </p>
        <p
          v-else-if="!hasCmsSources"
          class="rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
        >
          No CMS collection is available to this page yet. Create or connect a collection, then bind its content before adding a CMS condition.
        </p>
        <section
          v-for="(candidate, index) in cases"
          :key="candidate.id"
          class="space-y-3 rounded-md border border-dashed border-border/70 p-3"
          :aria-labelledby="`conditional-value-case-${candidate.id}`"
        >
          <div class="flex items-center justify-between gap-3">
            <h3 :id="`conditional-value-case-${candidate.id}`" class="text-sm font-medium">Case {{ index + 1 }}</h3>
            <Button type="button" variant="ghost" size="icon-sm" :aria-label="`Remove case ${index + 1}`" @click="cases.splice(index, 1)">
              <AppIcon name="trash" :size="13" aria-hidden="true" />
            </Button>
          </div>
          <ComposerConditionBuilder v-model="candidate.when" :sources="sources" :disabled="disabled" />
          <div class="border-t border-dashed border-border/70 pt-3">
            <ComposerPropField
              v-if="field"
              :field="field"
              :value="candidate.value"
              :disabled="disabled"
              @change="(value) => setCaseValue(index, value)"
            />
          </div>
        </section>

        <Button type="button" variant="outline" size="sm" class="w-full border-dashed" :disabled="disabled" @click="addCase">
          <AppIcon name="plus" :size="13" aria-hidden="true" />
          Add case
        </Button>

        <section class="space-y-2 rounded-md border border-border bg-muted/15 p-3" aria-labelledby="conditional-value-otherwise">
          <div>
            <h3 id="conditional-value-otherwise" class="text-sm font-medium">Otherwise</h3>
            <p class="text-xs text-muted-foreground">Required fallback when no case matches.</p>
          </div>
          <ComposerPropField
            v-if="field"
            :field="field"
            :value="fallback"
            :disabled="disabled"
            @change="setFallback"
          />
        </section>

        <p v-if="draftValue" class="text-xs text-muted-foreground" role="status">
          Current context: {{ currentMatch?.result === true ? `Case ${cases.findIndex((candidate) => candidate.id === currentMatch?.caseId) + 1}` : currentMatch?.result === "unknown" ? "Unknown — preview uses Otherwise" : "Otherwise" }}
        </p>
        <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
      </div>

      <DialogFooter class="sm:justify-between">
        <Button v-if="existing" type="button" variant="ghost" class="text-destructive hover:text-destructive" :disabled="disabled" @click="removeConditionalValue">
          Remove conditional value
        </Button>
        <span v-else />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="outline" @click="open = false">Cancel</Button>
          <Button type="button" :disabled="disabled || !complete" @click="save">Save conditional value</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
