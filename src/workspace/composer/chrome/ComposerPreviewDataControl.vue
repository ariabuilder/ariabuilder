<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type {
  ComposerComponentPreviewData,
  ComposerComponentPreviewSession,
  ComposerPreviewValue,
} from "../../../../shared/composer"

const props = defineProps<{ session: ComposerComponentPreviewSession }>()
const emit = defineEmits<{ update: [data: ComposerComponentPreviewData] }>()

function cloneData(data: ComposerComponentPreviewData): ComposerComponentPreviewData {
  return JSON.parse(JSON.stringify(data)) as ComposerComponentPreviewData
}

const draft = ref<ComposerComponentPreviewData>(cloneData(props.session.data))
watch(
  () => props.session,
  (session) => { draft.value = cloneData(session.data) },
  { deep: true },
)

const editableProps = computed<Array<[string, string | number | boolean]>>(() =>
  Object.entries(draft.value.props).filter((entry): entry is [string, string | number | boolean] => {
    const value = entry[1]
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  }),
)

function setProp(name: string, value: ComposerPreviewValue) {
  draft.value.props = { ...draft.value.props, [name]: value }
}

function apply() {
  emit("update", cloneData(draft.value))
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="h-6 gap-1.5 px-2 text-[11px]"
        aria-label="Edit component preview data"
      >
        <AppIcon name="settings" :size="13" aria-hidden="true" />
        Preview data
        <span
          v-if="session.data.diagnostics.length"
          class="size-1.5 rounded-full bg-amber-500"
          aria-hidden="true"
        />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-80 p-0">
      <div class="border-b border-border px-3 py-2.5">
        <p class="text-xs font-semibold">Preview data</p>
        <p class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          Local values used only by the standalone canvas.
        </p>
      </div>
      <div class="max-h-80 space-y-4 overflow-y-auto p-3">
        <fieldset v-if="editableProps.length" class="space-y-2.5">
          <legend class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Props</legend>
          <label
            v-for="([name, value]) in editableProps"
            :key="name"
            class="grid gap-1 text-[11px]"
          >
            <span class="font-medium">{{ name }}</span>
            <input
              v-if="typeof value === 'string'"
              :value="value"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @input="setProp(name, ($event.target as HTMLInputElement).value)"
            />
            <input
              v-else-if="typeof value === 'number'"
              type="number"
              :value="value"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @input="setProp(name, Number(($event.target as HTMLInputElement).value))"
            />
            <input
              v-else
              type="checkbox"
              :checked="value"
              class="size-4 accent-primary"
              @change="setProp(name, ($event.target as HTMLInputElement).checked)"
            />
          </label>
        </fieldset>

        <fieldset v-if="Object.keys(draft.slots).length" class="space-y-2.5">
          <legend class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Slots</legend>
          <label v-for="(value, name) in draft.slots" :key="name" class="grid gap-1 text-[11px]">
            <span class="font-medium">{{ name }}</span>
            <input
              :value="value"
              class="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @input="draft.slots[name] = ($event.target as HTMLInputElement).value"
            />
          </label>
        </fieldset>

        <div v-if="draft.diagnostics.length" class="space-y-1.5" role="status">
          <p
            v-for="diagnostic in draft.diagnostics"
            :key="`${diagnostic.field}:${diagnostic.message}`"
            class="rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300"
          >{{ diagnostic.message }}</p>
        </div>
        <p v-if="!editableProps.length && !Object.keys(draft.slots).length" class="text-xs text-muted-foreground">
          This component has no primitive preview values.
        </p>
      </div>
      <div class="flex justify-end border-t border-border px-3 py-2">
        <Button type="button" size="sm" class="h-7 text-xs" @click="apply">Apply</Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
