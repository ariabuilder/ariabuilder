<script setup lang="ts">
import { computed, nextTick, ref } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type {
  AstroPropMap,
  PropValue,
} from "../../../../shared/composer/types"
import InspectorPropertySection from "../design/InspectorPropertySection.vue"
import { decodeAttr, encodeAttr } from "./propValueCodec"

const props = withDefaults(defineProps<{
  nodeProps: AstroPropMap
  names: string[]
  disabled?: boolean
  embedded?: boolean
}>(), {
  embedded: false,
})

const emit = defineEmits<{
  setProp: [name: string, value: PropValue | undefined, immediate: boolean]
  renameProp: [oldName: string, newName: string]
}>()

const editing = ref<string | null>(null)
const isNew = ref(false)
const draftName = ref("")
const draftValue = ref("")
const nameInput = ref<{ focus: () => void } | null>(null)
const open = ref(false)

const rows = computed(() =>
  props.names.map((name) => ({
    name,
    display: decodeAttr(props.nodeProps[name]),
  })),
)

async function openEditor(name: string | null) {
  if (props.disabled) return
  open.value = true
  isNew.value = name === null
  editing.value = name
  draftName.value = name ?? ""
  draftValue.value = name ? decodeAttr(props.nodeProps[name]) : ""
  await nextTick()
  nameInput.value?.focus()
}

function closeEditor() {
  editing.value = null
  isNew.value = false
}

function commitName() {
  const clean = draftName.value.trim().replace(/[^\w@:.-]/g, "")
  draftName.value = clean
  if (!clean) return

  if (isNew.value) {
    if (props.nodeProps[clean]) return
    emit("setProp", clean, { type: "bare" }, true)
    editing.value = clean
    isNew.value = false
    return
  }

  if (editing.value && clean !== editing.value) {
    emit("renameProp", editing.value, clean)
    editing.value = clean
  }
}

function onValueInput(next: string | number) {
  const text = String(next)
  draftValue.value = text
  if (!editing.value || isNew.value) return
  emit(
    "setProp",
    editing.value,
    encodeAttr(text, props.nodeProps[editing.value]),
    false,
  )
}

function removeAttr(name: string) {
  if (editing.value === name) closeEditor()
  emit("setProp", name, undefined, true)
}
</script>

<template>
  <InspectorPropertySection
    v-if="!embedded"
    title="Attributes"
    v-model:open="open"
    :has-changes="rows.length > 0"
    data-composer-attributes-section
  >
    <template #actions>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="size-6"
        :disabled="disabled"
        title="Add attribute"
        aria-label="Add attribute"
        @click.stop.prevent="openEditor(null)"
      >
        <AppIcon name="plus" :size="12" />
      </Button>
    </template>
    <div class="space-y-2">
      <div
        v-if="rows.length"
        class="overflow-hidden rounded-sm border border-dashed border-border/60"
      >
        <button
          v-for="row in rows"
          :key="row.name"
          type="button"
          class="group flex w-full items-center gap-1.5 border-b border-dashed border-border/50 px-2 py-1.5 text-left last:border-b-0 hover:bg-muted/40"
          :class="editing === row.name ? 'bg-muted/50' : undefined"
          :disabled="disabled"
          @click="openEditor(row.name)"
        >
          <span class="truncate font-mono text-[11px] text-foreground">{{ row.name }}</span>
          <span class="text-[11px] text-muted-foreground">=</span>
          <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {{ row.display || "true" }}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="size-6 opacity-0 group-hover:opacity-100"
            :disabled="disabled"
            @click.stop="removeAttr(row.name)"
          >
            <AppIcon name="trash" :size="11" />
          </Button>
        </button>
      </div>
      <p v-else class="text-[11px] leading-relaxed text-muted-foreground">
        No custom attributes on this selection.
      </p>

      <div
        v-if="editing !== null || isNew"
        class="space-y-2 rounded-sm border border-border/60 bg-background/40 p-2"
      >
        <div class="space-y-1">
          <Label class="text-[10px] text-muted-foreground">Name</Label>
          <Input
            ref="nameInput"
            v-model="draftName"
            class="h-8 text-xs"
            placeholder="data-attribute"
            spellcheck="false"
            :disabled="disabled"
            @blur="commitName"
            @keydown.enter.prevent="commitName"
          />
        </div>
        <div class="space-y-1">
          <Label class="text-[10px] text-muted-foreground">Value</Label>
          <Input
            class="h-8 text-xs"
            :model-value="draftValue"
            placeholder="value or {expression}"
            spellcheck="false"
            :disabled="disabled || isNew"
            @update:model-value="onValueInput"
            @keydown.enter.prevent="closeEditor"
          />
        </div>
        <div class="flex justify-end">
          <Button type="button" variant="ghost" size="sm" class="h-7 text-xs" @click="closeEditor">
            Done
          </Button>
        </div>
      </div>
    </div>
  </InspectorPropertySection>

  <div v-else class="space-y-2" data-composer-attributes-section>
    <div class="flex items-center gap-2">
      <Label class="text-[11px] font-medium tracking-wide text-muted-foreground">Attributes</Label>
      <span class="flex-1" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="size-7"
        :disabled="disabled"
        title="Add attribute"
        @click="openEditor(null)"
      >
        <AppIcon name="plus" :size="12" />
      </Button>
    </div>
    <div
      v-if="rows.length"
      class="overflow-hidden rounded-sm border border-dashed border-border/60"
    >
      <button
        v-for="row in rows"
        :key="row.name"
        type="button"
        class="group flex w-full items-center gap-1.5 border-b border-dashed border-border/50 px-2 py-1.5 text-left last:border-b-0 hover:bg-muted/40"
        :class="editing === row.name ? 'bg-muted/50' : undefined"
        :disabled="disabled"
        @click="openEditor(row.name)"
      >
        <span class="truncate font-mono text-[11px] text-foreground">{{ row.name }}</span>
        <span class="text-[11px] text-muted-foreground">=</span>
        <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {{ row.display || "true" }}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          class="size-6 opacity-0 group-hover:opacity-100"
          :disabled="disabled"
          @click.stop="removeAttr(row.name)"
        >
          <AppIcon name="trash" :size="11" />
        </Button>
      </button>
    </div>
    <div
      v-if="editing !== null || isNew"
      class="space-y-2 rounded-sm border border-border/60 bg-muted/20 p-2"
    >
      <div class="space-y-1">
        <Label class="text-[10px] text-muted-foreground">Name</Label>
        <Input
          ref="nameInput"
          v-model="draftName"
          class="h-8 text-xs"
          placeholder="data-attribute"
          spellcheck="false"
          :disabled="disabled"
          @blur="commitName"
          @keydown.enter.prevent="commitName"
        />
      </div>
      <div class="space-y-1">
        <Label class="text-[10px] text-muted-foreground">Value</Label>
        <Input
          class="h-8 text-xs"
          :model-value="draftValue"
          placeholder="value or {expression}"
          spellcheck="false"
          :disabled="disabled || isNew"
          @update:model-value="onValueInput"
          @keydown.enter.prevent="closeEditor"
        />
      </div>
      <div class="flex justify-end">
        <Button type="button" variant="ghost" size="sm" class="h-7 text-xs" @click="closeEditor">
          Done
        </Button>
      </div>
    </div>
  </div>
</template>
