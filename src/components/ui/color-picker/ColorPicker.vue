<!--
  ColorPicker — unified builder color panel (Custom / Design / Variables).
-->
<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { colord } from "colord";
import { Button } from "@/components/ui/button";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useEyeDropper } from "@/composables/useEyeDropper";
import { useColorPickerRecents } from "@/composables/useColorPickerRecents";
import { useVariableReferenceOptions } from "@/composables/useVariableReferenceOptions";
import {
  formatColorInput,
  resolveColorPickerPopoverWidthClass,
} from "@/workspace/design/lib/colorFormat";
import {
  extractCssVariableReferenceKey,
  normalizeRawColorInput,
} from "@/workspace/design/lib/colorPickerValue";
import { buildVariableManagerTokenOptions } from "@/workspace/design/lib/variableManagerTokens";
import { useDesignColorPickerContext } from "@/workspace/design/composables/useDesignColorPickerContext";
import ColorPickerContrast from "./ColorPickerContrast.vue";
import ColorPickerDesignPanel from "./ColorPickerDesignPanel.vue";
import ColorPickerHeroPreview from "./ColorPickerHeroPreview.vue";
import ColorPickerPanel from "./ColorPickerPanel.vue";
import ColorPickerRecents from "./ColorPickerRecents.vue";
import ColorPickerSurface from "./ColorPickerSurface.vue";
import { VariableReferenceAssignButton } from "@/components/ui/variable-reference-picker";
import { createVariableReferenceValue } from "@/workspace/design/lib/variableReferences";
import ColorPickerValueFooter from "./ColorPickerValueFooter.vue";
import { CHECKERBOARD_STYLE } from "./checkerboard";
import { SECTION_DIVIDER_CLASS, SECTION_SCROLL_CLASS } from "./panel.tokens";
import type { ColorPickerProps, ColorPickerTriggerSlotProps } from "./types";
import { useColorPickerContrast } from "./useColorPickerContrast";
import { useColorPickerDesign } from "./useColorPickerDesign";
import {
  resolveColorPickerSurfaceCommitValue,
  resolveColorPickerSurfacePreviewValue,
  useColorPickerState,
} from "./useColorPickerState";

defineSlots<{
  default(props: ColorPickerTriggerSlotProps): unknown;
}>();

const props = withDefaults(defineProps<ColorPickerProps>(), {
  resolvedModelValue: null,
  showAlpha: true,
  disabled: false,
  readOnly: false,
  placeholder: undefined,
  showDesignColors: false,
  showVariables: undefined,
  layout: "compact",
  persistMode: "commit",
  contentClass: undefined,
  contentSide: "bottom",
  contentAlign: "start",
  contentSideOffset: 8,
  contentAlignOffset: 0,
  variableAffordance: "overlay",
  contrastAgainst: null,
  resolvedContrastAgainst: null,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  preview: [value: string];
  commit: [value: string];
}>();

const isCommitPersistMode = computed(() => props.persistMode === "commit");
const hasPendingPreview = ref(false);
const lastCommittedSerialized = ref<string | null>(null);

const isUnified = computed(() => props.layout === "unified");
const showVariablesTab = computed(
  () =>
    props.showVariables ??
    (isUnified.value && !props.disabled && !props.readOnly),
);

const isOpen = ref(false);
const copyAnnounced = ref(false);

const { isSupported: isEyeDropperSupported, open: openEyeDropper } =
  useEyeDropper();
const { recents, pushRecent, refreshFromStorage } = useColorPickerRecents();

const { palettes, semanticColors, variables } = useDesignColorPickerContext();

const { variableReferenceOptions } = useVariableReferenceOptions();

const modelValueRef = toRef(props, "modelValue");
const resolvedModelValueRef = toRef(props, "resolvedModelValue");
const contrastAgainstRef = toRef(props, "contrastAgainst");
const resolvedContrastAgainstRef = toRef(props, "resolvedContrastAgainst");
const showAlphaRef = toRef(props, "showAlpha");

const variableManagerTokenOptions = computed(() =>
  buildVariableManagerTokenOptions(
    palettes.value.map((palette) => ({
      name: palette.name,
      label: palette.name,
      shades: palette.shades,
    })),
    semanticColors.value,
  ),
);

const colorPickerPreviewContext = computed(() => ({
  palettes: palettes.value.map((palette) => ({
    name: palette.name,
    label: palette.name,
    shades: palette.shades,
  })),
  semanticColors: semanticColors.value,
}));

function emitUpdate(value: string): void {
  emit("update:modelValue", value);
}

function recordRecentFromModelValue(): void {
  const value = props.modelValue.trim();
  if (!value) {
    return;
  }
  pushRecent(value, props.showAlpha);
}

function emitCommitValue(value: string = props.modelValue): void {
  emit("commit", value);
  recordRecentFromModelValue();
  lastCommittedSerialized.value = value.trim();
  hasPendingPreview.value = false;
}

function emitPreviewFromSurface(): void {
  const previewValue = resolveColorPickerSurfacePreviewValue(
    state.valueMode.value,
    props.modelValue,
    state.serializedColorValue.value,
  );

  if (!previewValue) {
    return;
  }

  hasPendingPreview.value = true;
  emit("preview", previewValue);
}

function commitFromSurface(options: { detachReference?: boolean } = {}): void {
  const detachReference = options.detachReference === true;

  if (detachReference || state.valueMode.value === "literal") {
    state.applyLiteralFromSurface();
  }

  const commitValue = resolveColorPickerSurfaceCommitValue(
    state.valueMode.value,
    props.modelValue,
    state.serializedColorValue.value,
    detachReference,
  );

  if (
    !hasPendingPreview.value &&
    lastCommittedSerialized.value !== null &&
    lastCommittedSerialized.value === commitValue
  ) {
    return;
  }

  emitCommitValue(commitValue);
}

const state = useColorPickerState({
  modelValue: modelValueRef,
  resolvedModelValue: resolvedModelValueRef,
  showAlpha: showAlphaRef,
  variables,
  tokenOptions: variableManagerTokenOptions,
  previewContext: colorPickerPreviewContext,
  onUpdate: emitUpdate,
  onCommit: emitCommitValue,
});

const design = useColorPickerDesign(
  () => props.showDesignColors && isOpen.value,
);

const { contrastEvaluation } = useColorPickerContrast({
  previewColor: computed(() => state.previewColor.value),
  contrastAgainst: contrastAgainstRef,
  resolvedContrastAgainst: resolvedContrastAgainstRef,
  variables,
  tokenOptions: variableManagerTokenOptions,
  previewContext: colorPickerPreviewContext,
});

const showDesignSection = computed(
  () => props.showDesignColors && isUnified.value,
);
const popoverContentClass = computed(() => [
  "box-border min-w-0 overflow-hidden border-0 bg-transparent p-0 shadow-none max-w-[calc(100vw-2rem)]",
  resolveColorPickerPopoverWidthClass({
    layout: props.layout,
    showDesignColors: props.showDesignColors,
    contentClass: props.contentClass,
  }),
]);

const isRawFormatActive = computed(() => state.activeFormat.value === "raw");

const activeFormatInputValue = computed(() => {
  if (isRawFormatActive.value) {
    return props.modelValue.trim();
  }

  if (state.storedVariableReference.value) {
    return state.storedVariableReference.value;
  }

  return formatColorInput(state.editableColor.value, state.activeFormat.value, {
    showAlpha: props.showAlpha,
  });
});

const resolvedStoredColorLabel = computed(() => {
  if (isRawFormatActive.value || !state.storedVariableReference.value) {
    return null;
  }

  const resolved = state.pickerColorValue.value.trim();
  if (!resolved || resolved === state.storedVariableReference.value) {
    return null;
  }

  const parsed = colord(resolved);
  if (!parsed.isValid()) {
    return null;
  }

  return formatColorInput(parsed, state.activeFormat.value, {
    showAlpha: props.showAlpha,
  });
});

const showDetach = computed(
  () =>
    state.valueMode.value === "reference" ||
    state.valueMode.value === "reference-unresolved",
);

const surfaceInactive = computed(
  () => props.disabled || props.readOnly,
);

const showInlineVariableAssign = computed(
  () =>
    isUnified.value &&
    showVariablesTab.value &&
    !props.disabled &&
    !props.readOnly,
);
const variableOverlay = computed(
  () => showInlineVariableAssign.value && props.variableAffordance === "overlay",
);

const isInlineVariablePickerOpen = ref(false);

watch(isOpen, (open) => {
  if (open) {
    lastCommittedSerialized.value = props.modelValue.trim() || null;
    hasPendingPreview.value = false;
    refreshFromStorage();
    return;
  }

  if (hasPendingPreview.value) {
    commitFromSurface();
  }
});

function onSurfaceChange(): void {
  if (state.isDragging.value) {
    emitPreviewFromSurface();
    return;
  }

  if (isCommitPersistMode.value) {
    commitFromSurface();
    return;
  }

  state.applyLiteralFromSurface();
}

function onHueUpdate(value: number): void {
  state.localHue.value = value;
  onSurfaceChange();
}

function onSaturationUpdate(value: number): void {
  state.localSaturation.value = value;
  onSurfaceChange();
}

function onValueUpdate(value: number): void {
  state.localValue.value = value;
  onSurfaceChange();
}

function onAlphaUpdate(value: number): void {
  state.localAlpha.value = value;
  onSurfaceChange();
}

function handleFormatInput(rawValue: string): void {
  if (state.activeFormat.value === "raw") {
    const normalized = normalizeRawColorInput(rawValue, {
      showAlpha: props.showAlpha,
    });
    if (normalized) {
      state.setStoredValue(normalized);
    }
    return;
  }

  if (extractCssVariableReferenceKey(rawValue) !== null) {
    state.emitReferenceUpdate(rawValue);
    return;
  }

  const parsed = state.parseColorInput(rawValue, state.activeFormat.value);
  if (!parsed) {
    return;
  }

  state.detachToLiteral();
  state.syncColorFromColord(parsed);
  state.applyLiteralFromSurface();
}

async function handleEyedropperPick(): Promise<void> {
  const pickedHex = await openEyeDropper();
  if (!pickedHex) {
    return;
  }

  const parsed = colord(pickedHex);
  if (!parsed.isValid()) {
    return;
  }

  state.detachToLiteral();
  state.syncColorFromColord(parsed);
  if (isCommitPersistMode.value) {
    commitFromSurface();
  } else {
    state.applyLiteralFromSurface();
  }
}

async function handleCopy(): Promise<void> {
  const text =
    state.storedVariableReference.value ??
    activeFormatInputValue.value ??
    state.previewColor.value;

  try {
    await navigator.clipboard.writeText(text);
    copyAnnounced.value = true;
    window.setTimeout(() => {
      copyAnnounced.value = false;
    }, 1500);
  } catch {
    // ignore
  }
}

function onSaturationKeydown(event: KeyboardEvent): void {
  if (surfaceInactive.value) {
    return;
  }

  const step = event.shiftKey ? 5 : 1;
  let handled = false;

  switch (event.key) {
    case "ArrowLeft":
      state.localSaturation.value = Math.max(
        0,
        state.localSaturation.value - step,
      );
      handled = true;
      break;
    case "ArrowRight":
      state.localSaturation.value = Math.min(
        100,
        state.localSaturation.value + step,
      );
      handled = true;
      break;
    case "ArrowUp":
      state.localValue.value = Math.min(100, state.localValue.value + step);
      handled = true;
      break;
    case "ArrowDown":
      state.localValue.value = Math.max(0, state.localValue.value - step);
      handled = true;
      break;
    default:
      break;
  }

  if (!handled) {
    return;
  }

  event.preventDefault();
  onSurfaceChange();
}

function handleDetach(): void {
  state.detachToLiteral();
  if (isCommitPersistMode.value) {
    commitFromSurface();
  } else {
    state.applyLiteralFromSurface();
  }
}

function handleDesignSelect(
  options: Parameters<typeof design.previewDesignColorAssignment>[0],
): void {
  if (options.paletteName) {
    design.setActiveDesignSwatch({
      kind: "palette",
      name: options.paletteName,
    });
  } else if (options.semanticKey) {
    design.setActiveDesignSwatch({
      kind: "semantic",
      key: options.semanticKey,
    });
  }

  const assignment = props.showDesignColors
    ? design.previewDesignColorAssignment(options)
    : options.fallbackColor;

  state.setStoredValue(assignment);

  if (isCommitPersistMode.value) {
    hasPendingPreview.value = true;
    emit("preview", assignment);
    emitCommitValue(assignment);
    return;
  }

  recordRecentFromModelValue();
}

function onPickerDragEnd(): void {
  state.setDragging(false);
  if (isCommitPersistMode.value) {
    commitFromSurface({
      detachReference: state.valueMode.value === "reference",
    });
    return;
  }

  state.applyLiteralFromSurface();
  recordRecentFromModelValue();
}

function handleRecentSelect(color: string): void {
  state.setColor(color);
  if (isCommitPersistMode.value) {
    commitFromSurface();
  }
}

function onFooterCommit(): void {
  emitCommitValue(props.modelValue);
}

function applyVariableReference(nextKey: string | null): void {
  if (!nextKey) {
    const currentKey = extractCssVariableReferenceKey(props.modelValue.trim());
    const optionDirectValue = currentKey
      ? variableReferenceOptions.value.find((option) => option.value === currentKey)?.directValue?.trim() ?? ""
      : "";
    const resolvedPickerValue = state.pickerColorValue.value.trim();
    const restore =
      state.lastDirectValue.value.trim()
      || optionDirectValue
      || (colord(resolvedPickerValue).isValid() ? resolvedPickerValue : "");
    state.setStoredValue(restore);
    emitCommitValue(restore);
    return;
  }

  const resolved = createVariableReferenceValue(nextKey);
  state.activeFormat.value = "raw";
  state.setStoredValue(resolved);
  emitCommitValue(resolved);
}

defineExpose({
  setColor: state.setColor,
  handleDesignSelect,
  applyVariableReference,
});
</script>

<template>
  <div
    :class="
      showInlineVariableAssign
        ? variableOverlay
          ? 'group/variable relative min-w-0'
          : 'flex min-w-0 items-center gap-1.5'
        : 'contents'
    "
  >
    <div :class="showInlineVariableAssign ? 'min-w-0 flex-1' : 'contents'">
      <Popover v-model:open="isOpen">
        <PopoverTrigger as-child>
          <slot
            :preview-color="state.previewColor.value"
            :value-mode="state.valueMode.value"
          >
            <Button
              type="button"
              variant="headerAction"
              size="icon-sm"
              :disabled="disabled"
              class="group relative shrink-0 overflow-hidden"
              :style="{
                background: CHECKERBOARD_STYLE,
                borderStyle: 'solid',
              }"
            >
              <div
                class="absolute inset-0"
                :style="{
                  backgroundColor: state.previewColor.value || 'transparent',
                }"
              />
            </Button>
          </slot>
        </PopoverTrigger>

        <PopoverContent
          :class="popoverContentClass"
          :side="contentSide"
          :align="contentAlign"
          :side-offset="contentSideOffset"
          :align-offset="contentAlignOffset"
        >
          <ColorPickerPanel>
            <ColorPickerHeroPreview
              :preview-color="state.previewColor.value"
              :stored-reference="state.storedVariableReference.value"
              :value-mode="state.valueMode.value"
              :resolved-label="resolvedStoredColorLabel"
              :show-detach="showDetach"
              :is-eye-dropper-supported="isEyeDropperSupported"
              :disabled="disabled"
              @eyedropper="handleEyedropperPick"
              @copy="handleCopy"
              @detach="handleDetach"
            />

            <span class="sr-only" aria-live="polite">{{
              copyAnnounced ? "Copied" : ""
            }}</span>

            <ColorPickerSurface
              :layout="layout"
              :hue="state.localHue.value"
              :saturation="state.localSaturation.value"
              :value="state.localValue.value"
              :alpha="state.localAlpha.value"
              :show-alpha="showAlpha"
              :preview-color="state.previewColor.value"
              :disabled="disabled"
              :read-only="surfaceInactive"
              @keydown="onSaturationKeydown"
              @update:hue="onHueUpdate"
              @update:saturation="onSaturationUpdate"
              @update:value="onValueUpdate"
              @update:alpha="onAlphaUpdate"
              @drag-start="state.setDragging(true)"
              @drag-end="onPickerDragEnd"
              @surface-change="onSurfaceChange"
            />

            <ColorPickerValueFooter
              :active-format="state.activeFormat.value"
              :input-value="activeFormatInputValue"
              :resolved-subtitle="resolvedStoredColorLabel"
              :value-mode="state.valueMode.value"
              :placeholder="placeholder"
              :disabled="disabled"
              :variable-options="variableReferenceOptions"
              @update:active-format="state.activeFormat.value = $event"
              @input="handleFormatInput"
              @commit="onFooterCommit"
              @variable-select="applyVariableReference"
            />

            <ColorPickerRecents
              v-if="recents.length > 0"
              :colors="recents"
              :disabled="disabled || surfaceInactive"
              @select="handleRecentSelect"
            />

            <section
              v-if="showDesignSection"
              :class="[
                SECTION_DIVIDER_CLASS,
                SECTION_SCROLL_CLASS,
                'max-h-52 min-w-0',
              ]"
            >
              <ColorPickerDesignPanel
                :is-loading="design.isDesignSystemLoading.value"
                :design-palettes="design.designPalettes.value"
                :semantic-color-options="design.semanticColorOptions.value"
                :active-shade-source="design.activeShadeSource.value"
                :active-design-swatch="design.activeDesignSwatch.value"
                :is-active-palette-swatch="design.isActivePaletteSwatch"
                :is-active-semantic-swatch="design.isActiveSemanticSwatch"
                :design-swatch-title="design.designSwatchTitle"
                :palette-token-source-key="design.paletteTokenSourceKey"
                :semantic-token-source-key="design.semanticTokenSourceKey"
                :disabled="disabled"
                @set-active-swatch="design.setActiveDesignSwatch"
                @select-color="handleDesignSelect"
              />
            </section>

            <ColorPickerContrast
              :class="SECTION_DIVIDER_CLASS"
              :evaluation="contrastEvaluation"
            />
          </ColorPickerPanel>
        </PopoverContent>
      </Popover>
    </div>

    <VariableReferenceAssignButton
      v-if="showInlineVariableAssign"
      v-model:open="isInlineVariablePickerOpen"
      :model-value="modelValue"
      :disabled="disabled"
      :options="variableReferenceOptions"
      :side-offset="14"
      :appearance="variableAffordance"
      :icon-size="variableOverlay ? undefined : 14"
      :button-class="variableOverlay ? 'absolute end-2 top-1/2 z-10 -translate-y-1/2' : 'size-7! border-0 border-solid bg-transparent hover:bg-muted hover:text-foreground'"
      @select="applyVariableReference"
    />
  </div>
</template>
