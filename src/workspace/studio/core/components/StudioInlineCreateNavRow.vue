<script setup lang="ts">
import { nextTick, ref } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import type { AppIconName } from "@/icons/registry"

function isValidName(name: string): boolean {
  return name.trim().length > 0
}

const props = withDefaults(
  defineProps<{
    label: string
    placeholder: string
    hint: string
    icon?: AppIconName
    disabled?: boolean
  }>(),
  { icon: "folderAdd", disabled: false },
)

const emit = defineEmits<{ create: [name: string] }>()

const isCreating = ref(false)
const value = ref("")
const inputRef = ref<HTMLInputElement | null>(null)

function startCreate(): void {
  if (props.disabled) return
  isCreating.value = true
  value.value = ""
  void nextTick(() => inputRef.value?.focus())
}

function cancelCreate(): void {
  isCreating.value = false
  value.value = ""
}

function submitCreate(): void {
  const trimmed = value.value.trim()
  if (isValidName(trimmed)) emit("create", trimmed)
  cancelCreate()
}

defineExpose({ startCreate })
</script>

<template>
  <div
    v-if="isCreating"
    class="px-6 py-3"
  >
    <input
      ref="inputRef"
      v-model="value"
      type="text"
      :placeholder="placeholder"
      class="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
      @keydown.enter.prevent="submitCreate"
      @keydown.esc.prevent="cancelCreate"
      @blur="submitCreate"
    />
    <p class="mt-1 text-2xs text-muted-foreground/50">{{ hint }}</p>
  </div>

  <div class="border-b border-dashed border-border px-3 py-2">
    <Button
      variant="ghost"
      size="sm"
      class="w-full justify-start gap-2 px-3 text-muted-foreground/80 cursor-pointer bg-transparent! hover:bg-transparent!"
      :disabled="disabled"
      @click="startCreate"
    >
      <AppIcon :name="icon" :size="16" />
      {{ label }}
    </Button>
  </div>
</template>
