<script setup lang="ts">
import { watch } from "vue"
import type { CollectionKind } from "../../../../../shared/cms"
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
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { m } from "@/paraglide/messages.js"
import { COLLECTION_KIND_OPTIONS } from "../lib/collectionKindOptions"
import {
  useCreateCollectionForm,
  type CreatedCollectionResult,
} from "../composables/useCreateCollectionForm"
import type { Ref } from "vue"

const props = defineProps<{
  open: boolean
  projectRoot: string
  existingNames: readonly string[]
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  created: [collection: CreatedCollectionResult]
}>()

const projectRootRef = {
  get value() {
    return props.projectRoot
  },
} as Ref<string>

const existingNamesRef = {
  get value() {
    return props.existingNames
  },
} as Ref<readonly string[]>

const {
  label,
  name,
  kind,
  isNameEdited,
  isCreating,
  errors,
  updateNameFromLabel,
  resetForm,
  submitCreate,
} = useCreateCollectionForm(projectRootRef, existingNamesRef)

watch(
  () => props.open,
  (open) => {
    if (!open) resetForm()
  },
)

async function handleSubmit() {
  const collection = await submitCreate()
  if (!collection) return
  emit("created", collection)
  emit("update:open", false)
}

function handleClose(open: boolean) {
  if (!open) resetForm()
  emit("update:open", open)
}
</script>

<template>
  <Dialog :open="open" @update:open="handleClose">
    <DialogContent class="sm:max-w-[525px]">
      <DialogHeader>
        <DialogTitle>{{ m.cms_create_collection_title() }}</DialogTitle>
        <DialogDescription>
          {{ m.cms_create_collection_description() }}
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4 py-2">
        <div class="grid gap-2">
          <Label>{{ m.cms_create_collection_label() }}</Label>
          <Input
            :model-value="label"
            @update:model-value="
              label = String($event ?? '');
              updateNameFromLabel()
            "
          />
          <p v-if="errors.label" class="text-2xs text-destructive">
            {{ errors.label }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label>{{ m.cms_create_collection_name() }}</Label>
          <Input
            :model-value="name"
            class="font-mono text-xs"
            @update:model-value="
              isNameEdited = true;
              name = String($event ?? '')
            "
          />
          <p v-if="errors.name" class="text-2xs text-destructive">
            {{ errors.name }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label>{{ m.cms_create_collection_kind() }}</Label>
          <Select
            :model-value="kind"
            @update:model-value="kind = ($event as CollectionKind)"
          >
            <SelectTrigger class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="option in COLLECTION_KIND_OPTIONS"
                :key="option.value"
                :value="option.value"
              >
                <div class="flex flex-col gap-0.5 py-0.5">
                  <span>{{ option.label }}</span>
                  <span class="text-2xs text-muted-foreground">
                    {{ option.description }}
                  </span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          size="sm"
          class="h-9!"
          :disabled="isCreating"
          @click="handleClose(false)"
        >
          {{ m.cms_common_cancel() }}
        </Button>
        <Button
          size="sm"
          class="h-9!"
          :disabled="isCreating"
          @click="handleSubmit"
        >
          {{
            isCreating
              ? m.cms_create_collection_creating()
              : m.cms_create_collection_submit()
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
