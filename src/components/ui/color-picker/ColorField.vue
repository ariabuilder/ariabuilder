<script setup lang="ts">
import { computed } from "vue";
import { colord } from "colord";

import {
  formatColorInput,
} from "@/workspace/design/lib/colorFormat";
import { extractCssVariableReferenceKey } from "@/workspace/design/lib/colorPickerValue";
import ColorPicker from "./ColorPicker.vue";
import { CHECKERBOARD_STYLE } from "./checkerboard";
import {
  COLOR_FIELD_TOOLBAR_SWATCH_CLASS,
  COLOR_FIELD_TOOLBAR_TRIGGER_CLASS,
  COLOR_FIELD_TRIGGER_CLASS,
} from "./panel.tokens";
import type { ColorFieldVariant, ColorPickerProps } from "./types";

const props = withDefaults(
  defineProps<
    ColorPickerProps & {
      label?: string;
      triggerLabel?: string;
      variant?: ColorFieldVariant;
    }
  >(),
  {
    resolvedModelValue: null,
    contrastAgainst: null,
    resolvedContrastAgainst: null,
    showAlpha: true,
    disabled: false,
    readOnly: false,
    placeholder: undefined,
    showDesignColors: false,
    showVariables: undefined,
    layout: "unified",
    persistMode: "commit",
    contentClass: undefined,
    contentSide: "bottom",
    contentAlign: "start",
    contentSideOffset: 8,
    contentAlignOffset: 0,
    label: undefined,
    triggerLabel: undefined,
    variant: "inspector",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  preview: [value: string];
  commit: [value: string];
}>();

const isToolbar = computed(() => props.variant === "toolbar");
const effectiveLayout = computed(() => props.layout);
const effectiveShowDesignColors = computed(
  () => props.showDesignColors,
);
const effectiveShowVariables = computed(() =>
  isToolbar.value ? (props.showVariables ?? false) : props.showVariables,
);

function browserSupportsColor(value: string): boolean {
  if (!value || extractCssVariableReferenceKey(value) !== null) return false;
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    return CSS.supports("color", value);
  }
  if (typeof document === "undefined") return false;
  const style = document.createElement("span").style;
  style.color = value;
  return Boolean(style.color);
}

function resolveBrowserColor(value: string): string | null {
  if (!browserSupportsColor(value) || typeof document === "undefined") return null;
  if (typeof CanvasRenderingContext2D === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${Number((alpha / 255).toFixed(3))})`;
}

const effectiveResolvedModelValue = computed(() =>
  props.resolvedModelValue ?? resolveBrowserColor(props.modelValue.trim()),
);

const displayValue = computed(() => {
  const trimmed = props.modelValue.trim();
  if (!trimmed || props.readOnly) {
    return props.placeholder ?? "—";
  }

  if (extractCssVariableReferenceKey(trimmed) !== null) {
    return trimmed;
  }

  const parsed = colord(trimmed);
  if (!parsed.isValid()) {
    return trimmed;
  }

  return formatColorInput(parsed, "hex", { showAlpha: props.showAlpha });
});

function triggerPreviewColor(pickerPreview: string): string {
  const direct = props.modelValue.trim();
  return direct && (colord(direct).isValid() || browserSupportsColor(direct))
    ? direct
    : pickerPreview;
}
</script>

<template>
  <div
    :class="
      label
        ? 'grid grid-cols-[72px_1fr] items-center gap-2'
        : 'contents'
    "
  >
    <span
      v-if="label"
      class="text-3xs font-medium uppercase tracking-widest text-muted-foreground"
    >
      {{ label }}
    </span>

    <ColorPicker
      :model-value="modelValue"
      :resolved-model-value="effectiveResolvedModelValue"
      :contrast-against="contrastAgainst"
      :resolved-contrast-against="resolvedContrastAgainst"
      :show-alpha="showAlpha"
      :disabled="disabled"
      :read-only="readOnly"
      :placeholder="placeholder"
      :show-design-colors="effectiveShowDesignColors"
      :show-variables="effectiveShowVariables"
      :layout="effectiveLayout"
      :persist-mode="persistMode"
      :content-class="contentClass"
      :content-side="contentSide"
      :content-align="contentAlign"
      :content-side-offset="contentSideOffset"
      :content-align-offset="contentAlignOffset"
      :variable-affordance="isToolbar ? 'inline' : 'overlay'"
      @update:model-value="emit('update:modelValue', $event)"
      @preview="emit('preview', $event)"
      @commit="emit('commit', $event)"
    >
      <template #default="{ previewColor }">
        <button
          v-if="isToolbar"
          type="button"
          :class="COLOR_FIELD_TOOLBAR_TRIGGER_CLASS"
          :disabled="disabled"
          :aria-label="triggerLabel"
          @click.stop
        >
          <span
            :class="COLOR_FIELD_TOOLBAR_SWATCH_CLASS"
            :style="{ background: CHECKERBOARD_STYLE }"
          >
            <span
              class="absolute inset-0 block size-full"
              :style="{ backgroundColor: triggerPreviewColor(previewColor) || 'transparent' }"
            />
          </span>
        </button>

        <button
          v-else
          type="button"
          :class="COLOR_FIELD_TRIGGER_CLASS"
          :disabled="disabled"
          :aria-label="triggerLabel"
          @click.stop
        >
          <span
            class="size-5 shrink-0 rounded-sm border border-border/50"
            :style="{ background: CHECKERBOARD_STYLE }"
          >
            <span
              class="block size-full rounded-sm"
              :style="{ backgroundColor: triggerPreviewColor(previewColor) || 'transparent' }"
            />
          </span>
          <span class="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
            {{ displayValue }}
          </span>
        </button>
      </template>
    </ColorPicker>
  </div>
</template>
