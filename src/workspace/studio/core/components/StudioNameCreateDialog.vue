<script setup lang="ts">
import { ref, watch } from "vue"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { m } from "@/paraglide/messages.js"
import type { PropField } from "../../../../../shared/composer/types"

const props = defineProps<{
  open: boolean
  busy?: boolean
  error?: string | null
  title: string
  description: string
  placeholder: string
  cancelLabel: string
  submitLabel: string
  creatingLabel: string
  initialValue?: string
  choiceLabel?: string
  choiceModelValue?: string
  choiceOptions?: Array<{ value: string; label: string }>
  choiceFields?: PropField[]
  choiceFieldValues?: Record<string, string | boolean>
  choiceFieldsBusy?: boolean
  choiceFieldsError?: string | null
}>()

const emit = defineEmits<{
  "update:open": [open: boolean]
  submit: [name: string]
  "update:choiceModelValue": [value: string]
  "update:choiceFieldValue": [name: string, value: string | boolean]
}>()

const name = ref("")

watch(
  () => props.open,
  (open) => {
    if (open) {
      name.value = props.initialValue ?? ""
    }
  },
)

function close() {
  if (props.busy) return
  emit("update:open", false)
}

function submit() {
  const value = name.value.trim()
  if (!value || props.busy) return
  emit("submit", value)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          {{ description }}
        </DialogDescription>
      </DialogHeader>

      <form class="space-y-3" @submit.prevent="submit">
        <Input
          v-model="name"
          :placeholder="placeholder"
          spellcheck="false"
          autofocus
          :disabled="busy"
        />
        <label v-if="choiceOptions?.length" class="block space-y-1.5 text-sm font-medium">
          <span>{{ choiceLabel }}</span>
          <select
            :value="choiceModelValue ?? ''"
            class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="busy"
            @change="emit('update:choiceModelValue', ($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="option in choiceOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <div
          v-if="choiceFieldsBusy"
          class="text-xs text-muted-foreground"
          role="status"
        >
          {{ m.composer_layout_props_loading() }}
        </div>
        <fieldset
          v-else-if="choiceFields?.length"
          class="space-y-3 rounded-md border border-dashed border-border p-3"
        >
          <legend class="px-1 text-xs font-medium text-muted-foreground">
            {{ m.composer_layout_required_props() }}
          </legend>
          <label
            v-for="field in choiceFields"
            :key="field.name"
            class="block space-y-1.5 text-sm font-medium"
          >
            <span>{{ field.name }}</span>
            <input
              v-if="field.type === 'boolean'"
              type="checkbox"
              class="size-4 rounded border-input accent-primary"
              :checked="choiceFieldValues?.[field.name] === true"
              :disabled="busy"
              @change="emit('update:choiceFieldValue', field.name, ($event.target as HTMLInputElement).checked)"
            />
            <select
              v-else-if="field.type === 'enum'"
              :value="String(choiceFieldValues?.[field.name] ?? '')"
              class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="busy"
              @change="emit('update:choiceFieldValue', field.name, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="option in field.options ?? []" :key="option" :value="option">
                {{ option }}
              </option>
            </select>
            <Input
              v-else
              :type="field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'"
              :model-value="String(choiceFieldValues?.[field.name] ?? '')"
              :disabled="busy"
              @update:model-value="emit('update:choiceFieldValue', field.name, String($event))"
            />
          </label>
        </fieldset>
        <p v-if="choiceFieldsError" class="text-xs text-destructive">
          {{ choiceFieldsError }}
        </p>
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
        <DialogFooter class="gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            :disabled="busy"
            @click="close"
          >
            {{ cancelLabel }}
          </Button>
          <Button type="submit" :disabled="busy || choiceFieldsBusy || Boolean(choiceFieldsError) || !name.trim()">
            {{ busy ? creatingLabel : submitLabel }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
