<script setup lang="ts">
import { computed } from "vue";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VariableReferenceAssignButton } from "@/components/ui/variable-reference-picker";
import {
  COLOR_INPUT_FORMATS,
  colorInputPlaceholder,
  type ColorInputFormat,
} from "@/workspace/design/lib/colorFormat";
import { cn } from "@/lib/utils";
import {
  extractVariableReferenceKey,
  type VariableReferenceOption,
} from "@/workspace/design/lib/variableReferences";
import type { ColorPickerValueMode } from "./types";

const props = defineProps<{
  activeFormat: ColorInputFormat;
  inputValue: string;
  resolvedSubtitle: string | null;
  valueMode: ColorPickerValueMode;
  placeholder?: string;
  disabled?: boolean;
  variableOptions: readonly VariableReferenceOption[];
}>();

const emit = defineEmits<{
  "update:activeFormat": [format: ColorInputFormat];
  input: [value: string];
  commit: [];
  "variable-select": [value: string | null];
}>();

const formatPlaceholder = computed(() =>
  colorInputPlaceholder(props.activeFormat),
);

const variableKey = computed(() =>
  extractVariableReferenceKey(props.inputValue),
);

const isVariableAssigned = computed(() => variableKey.value !== null);

const showResolvedSubtitle = computed(
  () => props.resolvedSubtitle && props.valueMode === "literal",
);

function handleInputUpdate(nextValue: string | number): void {
  emit("input", String(nextValue));
}

function handleVariableSelect(nextValue: string | null): void {
  if (!nextValue) {
    emit("variable-select", null);
    return;
  }

  emit("variable-select", nextValue);
}

function handleInputBlur(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (next instanceof Element && next.closest("[data-variable-reference-trigger]")) return;
  emit("commit");
}
</script>

<template>
  <div
    :class="['min-w-0 overflow-hidden px-2 py-2', $attrs.class]"
  >
    <div class="flex min-w-0 items-center gap-1">
      <div class="group/variable relative min-w-0 flex-1 overflow-hidden">
        <Input
          :model-value="inputValue"
          spellcheck="false"
          :placeholder="placeholder ?? formatPlaceholder"
          :disabled="disabled"
          :class="
            cn(
              'h-7! w-full min-w-0 px-2 font-mono text-2xs!',
              isVariableAssigned &&
                'border-primary/50 text-foreground selection:bg-primary/20',
            )
          "
          @update:model-value="handleInputUpdate"
          @blur="handleInputBlur"
          @keydown.enter.prevent="emit('commit')"
        />
        <VariableReferenceAssignButton
          :model-value="inputValue"
          :disabled="disabled"
          :options="variableOptions"
          appearance="overlay"
          button-class="absolute end-1 top-1/2 z-10 -translate-y-1/2"
          @select="handleVariableSelect"
        />
      </div>

      <Select
        class="shrink-0"
        :model-value="activeFormat"
        @update:model-value="
          emit('update:activeFormat', $event as ColorInputFormat)
        "
      >
        <SelectTrigger
          class="!h-7 !w-auto min-w-[3.5rem] shrink-0 gap-1 pl-2 pr-1.5 text-2xs font-semibold uppercase [&>span:first-child]:truncate-none"
          :disabled="disabled"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            v-for="format in COLOR_INPUT_FORMATS"
            :key="format.key"
            :value="format.key"
            class="text-xs uppercase"
          >
            {{ format.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <p
      v-if="showResolvedSubtitle"
      class="mt-1 truncate px-0.5 font-mono text-2xs text-muted-foreground/80"
    >
      {{ resolvedSubtitle }}
    </p>
  </div>
</template>
