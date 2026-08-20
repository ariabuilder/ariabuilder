<script lang="ts">
export default {
  name: "VariableManagerSourceCell",
}
</script>

<script setup lang="ts">
import type { PropType } from "vue"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { m } from "@/paraglide/messages.js"
import type { DesignVariableAlias } from "../../../../shared/design"
import type { VariableManagerRow } from "../lib/variableManagerTable"
import type { VariableManagerTokenOption } from "../lib/variableManagerTokens"
import DesignTokenPicker from "./DesignTokenPicker.vue"

const COMPACT_TRIGGER_CLASS =
  "h-7! w-full min-w-0 rounded-md border-transparent bg-transparent px-2 text-xs! shadow-none transition-colors hover:border-border/50 hover:bg-card/30 focus:ring-0 focus-visible:border-border focus-visible:bg-background"

function sourceTypeButtonClass(active: boolean): string {
  return [
    "inline-flex h-5 flex-1 items-center justify-center rounded-sm px-1 text-2xs font-medium transition-colors",
    active
      ? "bg-card text-foreground shadow-sm"
      : "text-muted-foreground hover:text-foreground",
  ].join(" ")
}

function getCustomSourceLabel(): string {
  return props.row.kind === "alias" && props.row.alias.sourceKey
    ? props.row.sourceLabel
    : m.design_variables_source_choose_variable()
}

const props = defineProps({
  row: {
    type: Object as PropType<VariableManagerRow>,
    required: true,
  },
  customVariableOptions: {
    type: Array as PropType<readonly { value: string; label: string }[]>,
    required: true,
  },
  designTokenOptions: {
    type: Array as PropType<readonly VariableManagerTokenOption[]>,
    required: true,
  },
  tokenOptionsLoading: {
    type: Boolean,
    default: false,
  },
  onUpdateAliasSourceType: {
    type: Function as PropType<
      (alias: DesignVariableAlias, value: string) => void
    >,
    required: true,
  },
  onUpdateAliasTokenSource: {
    type: Function as PropType<
      (alias: DesignVariableAlias, optionValue: string | null) => void
    >,
    required: true,
  },
  onUpdateAliasCustomSource: {
    type: Function as PropType<
      (alias: DesignVariableAlias, sourceKey: string) => void
    >,
    required: true,
  },
})
</script>

<template>
  <!-- Custom vars are always a direct value — keep this quiet so Value can breathe. -->
  <div
    v-if="row.kind === 'custom'"
    class="flex h-7 items-center px-1 text-2xs font-medium uppercase tracking-wider text-muted-foreground/70"
  >
    {{ m.design_variables_source_direct() }}
  </div>

  <!--
    Aliases stack: type switch on top, target picker below.
    Vertical layout lets Source stay narrow without side-by-side waste.
  -->
  <div v-else class="flex min-w-0 flex-col gap-1 py-0.5">
    <div
      class="inline-flex h-6 w-full items-center gap-0.5 rounded-md border border-border/40 bg-transparent p-0.5"
      role="group"
      :aria-label="m.design_variables_column_source()"
    >
      <button
        type="button"
        :class="sourceTypeButtonClass(row.alias.sourceType === 'custom')"
        @click="onUpdateAliasSourceType(row.alias, 'custom')"
      >
        {{ m.design_variables_source_variable() }}
      </button>
      <button
        type="button"
        :class="sourceTypeButtonClass(row.alias.sourceType === 'token')"
        @click="onUpdateAliasSourceType(row.alias, 'token')"
      >
        {{ m.design_variables_source_token() }}
      </button>
    </div>

    <Select
      v-if="row.alias.sourceType === 'custom'"
      :model-value="row.alias.sourceKey"
      @update:model-value="
        onUpdateAliasCustomSource(row.alias, String($event))
      "
    >
      <SelectTrigger
        :class="`${COMPACT_TRIGGER_CLASS} text-left text-foreground`"
      >
        <SelectValue>
          {{ getCustomSourceLabel() }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem
          v-for="option in customVariableOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </SelectItem>
      </SelectContent>
    </Select>

    <div
      v-else-if="tokenOptionsLoading"
      class="flex h-7 items-center rounded-md px-2 text-xs text-muted-foreground"
    >
      {{ m.design_variables_source_loading_tokens() }}
    </div>

    <DesignTokenPicker
      v-else
      :model-value="row.alias.sourceKey"
      :options="designTokenOptions"
      :placeholder="m.design_variables_source_choose_token()"
      :trigger-class="`${COMPACT_TRIGGER_CLASS} text-foreground`"
      content-class="rounded-xl border-border/50 bg-background/96 shadow-xl backdrop-blur"
      @update:model-value="onUpdateAliasTokenSource(row.alias, $event)"
    />
  </div>
</template>
