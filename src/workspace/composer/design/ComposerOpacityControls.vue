<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue"
import { Slider } from "@/components/ui/slider"
import { VariableAssignableInput } from "@/components/ui/variable-reference-picker"
import { m } from "@/paraglide/messages.js"
import {
  extractVariableReferenceKey,
  type VariableReferenceOption,
} from "@/workspace/design/lib/variableReferences"
import {
  composerOpacityPercentage,
  parseComposerOpacityValue,
  type ComposerOpacityError,
  type ComposerStyleCommitResult,
} from "./composerOpacity"

const props = withDefaults(defineProps<{
  modelValue: string
  variableOptions: readonly VariableReferenceOption[]
  inherited?: boolean
  disabled?: boolean
  persisting?: boolean
  externalError?: string
  previewValue: (value: string) => void
  commitValue: (value: string) => Promise<ComposerStyleCommitResult>
  cancelPreview: () => void
}>(), {
  inherited: false,
  disabled: false,
  persisting: false,
  externalError: "",
})

const draftValue = ref(props.modelValue || "1")
const percentage = ref(composerOpacityPercentage(draftValue.value))
const errorMessage = ref("")
const committing = ref(false)
const errorId = useId()
const inheritedId = useId()

const isVariableAssigned = computed(
  () => extractVariableReferenceKey(draftValue.value) !== null,
)
const effectiveDisabled = computed(
  () => props.disabled || props.persisting || committing.value,
)
const displayedError = computed(() => errorMessage.value || props.externalError)
const descriptionIds = computed(() => [
  props.inherited ? inheritedId : "",
  displayedError.value ? errorId : "",
].filter(Boolean).join(" ") || undefined)

watch(
  () => props.modelValue,
  (nextValue) => {
    errorMessage.value = ""
    draftValue.value = nextValue || "1"
    percentage.value = composerOpacityPercentage(draftValue.value)
  },
)

function localizedError(error: ComposerOpacityError): string {
  return error === "incompatible-variable"
    ? m.composer_opacity_incompatible_variable()
    : m.composer_opacity_invalid()
}

function previewParsed(rawValue: string): boolean {
  const parsed = parseComposerOpacityValue(rawValue, props.variableOptions)
  if (!parsed.ok) return false
  errorMessage.value = ""
  draftValue.value = parsed.value.cssValue
  if (parsed.value.percentage !== null) {
    percentage.value = parsed.value.percentage
  }
  props.previewValue(parsed.value.cssValue)
  return true
}

async function restorePreview(): Promise<void> {
  props.cancelPreview()
  await nextTick()
  draftValue.value = props.modelValue || "1"
  percentage.value = composerOpacityPercentage(draftValue.value)
}

async function persist(rawValue: string): Promise<boolean> {
  const parsed = parseComposerOpacityValue(rawValue, props.variableOptions)
  if (!parsed.ok) {
    errorMessage.value = localizedError(parsed.error)
    await restorePreview()
    return false
  }

  draftValue.value = parsed.value.cssValue
  if (parsed.value.percentage !== null) {
    percentage.value = parsed.value.percentage
  }
  props.previewValue(parsed.value.cssValue)
  committing.value = true
  const result = await props.commitValue(parsed.value.cssValue)
  committing.value = false
  if (!result.ok) {
    errorMessage.value = result.error || m.composer_opacity_save_failed()
    await restorePreview()
    return false
  }

  errorMessage.value = ""
  return true
}

function handleInputUpdate(value: string | number): void {
  const nextValue = String(value)
  draftValue.value = nextValue
  previewParsed(nextValue)
}

function handleSliderUpdate(value: number[] | undefined): void {
  const nextValue = value?.[0]
  if (typeof nextValue !== "number") return
  const normalized = Math.min(100, Math.max(0, Math.round(nextValue)))
  percentage.value = normalized
  previewParsed(String(normalized / 100))
}

function handleSliderCommit(value: number[]): void {
  const nextValue = value[0]
  if (typeof nextValue !== "number") return
  const normalized = Math.min(100, Math.max(0, Math.round(nextValue)))
  void persist(String(normalized / 100))
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex min-w-0 items-center gap-2">
      <VariableAssignableInput
        v-model="draftValue"
        data-testid="opacity-input"
        class="min-w-0 flex-1"
        input-class="h-9 min-w-0 border-dashed border-border/70 bg-sidebar font-mono text-xs"
        :disabled="effectiveDisabled"
        :options="variableOptions"
        :placeholder="isVariableAssigned ? m.composer_opacity_variable() : '100%'"
        :aria-label="m.composer_opacity_input()"
        :aria-describedby="descriptionIds"
        :aria-invalid="Boolean(displayedError)"
        @update:model-value="handleInputUpdate"
        @commit="(value) => void persist(String(value))"
      >
        <template v-if="!isVariableAssigned" #control>
          <div class="flex h-9 items-center pe-9 ps-2">
            <Slider
              data-testid="opacity-slider"
              class="w-full"
              :model-value="[percentage]"
              :min="0"
              :max="100"
              :step="1"
              :disabled="effectiveDisabled"
              :aria-label="m.composer_opacity_slider()"
              :aria-valuetext="m.composer_opacity_percent({ value: percentage })"
              :aria-describedby="descriptionIds"
              :aria-invalid="Boolean(displayedError) || undefined"
              @update:model-value="handleSliderUpdate"
              @value-commit="handleSliderCommit"
            />
          </div>
        </template>
      </VariableAssignableInput>

      <span
        v-if="!isVariableAssigned"
        data-testid="opacity-value"
        class="w-10 shrink-0 text-end text-xs tabular-nums text-muted-foreground"
      >
        {{ percentage }}%
      </span>
    </div>

    <span v-if="inherited" :id="inheritedId" class="sr-only">
      {{ m.composer_opacity_inherited() }}
    </span>
    <p
      :id="errorId"
      data-testid="opacity-error"
      :class="displayedError ? 'text-xs text-destructive' : 'sr-only'"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ displayedError }}
    </p>
  </div>
</template>
