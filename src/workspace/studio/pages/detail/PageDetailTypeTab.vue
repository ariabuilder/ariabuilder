<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import type { AriaCollectionDef, PageRole } from "@/types/aria"
import { PAGE_ROLES } from "../../../../../shared/pages"

const role = defineModel<PageRole>("role", { required: true })
const assignedCollectionId = defineModel<string | null>("assignedCollectionId", {
  required: true,
})

const props = defineProps<{
  collections: AriaCollectionDef[]
}>()

const roleCards = computed(() =>
  PAGE_ROLES.map((id) => {
    switch (id) {
      case "not-found":
        return {
          id,
          label: m.pages_type_not_found_label(),
          description: m.pages_type_not_found_description(),
        }
      case "cms-collection":
        return {
          id,
          label: m.pages_type_collection_label(),
          description: m.pages_type_collection_description(),
        }
      case "cms-entry":
        return {
          id,
          label: m.pages_type_entry_label(),
          description: m.pages_type_entry_description(),
        }
      default:
        return {
          id,
          label: m.pages_type_standard_label(),
          description: m.pages_type_standard_description(),
        }
    }
  }),
)

const showAssignment = computed(
  () => role.value === "cms-collection" || role.value === "cms-entry",
)

const noneValue = "__none__"

const selectValue = computed({
  get: () => assignedCollectionId.value ?? noneValue,
  set: (value: string) => {
    assignedCollectionId.value = value === noneValue ? null : value
  },
})

function selectRole(next: PageRole) {
  role.value = next
  if (next !== "cms-collection" && next !== "cms-entry") {
    assignedCollectionId.value = null
  }
}
</script>

<template>
  <div class="grid w-full gap-5">
    <div class="grid gap-3 sm:grid-cols-2">
      <Button
        v-for="card in roleCards"
        :key="card.id"
        type="button"
        variant="outline"
        :class="
          cn(
            'h-auto flex-col items-start gap-1 rounded-sm! px-4 py-3 text-left whitespace-normal',
            role === card.id && 'border-primary bg-primary/5',
          )
        "
        @click="selectRole(card.id)"
      >
        <span class="flex w-full items-center justify-between gap-2">
          <span class="text-sm font-medium text-foreground">{{ card.label }}</span>
          <AppIcon
            v-if="role === card.id"
            name="checkLinear"
            :size="14"
            class="text-primary"
          />
        </span>
        <span class="text-xs font-regular text-muted-foreground">
          {{ card.description }}
        </span>
      </Button>
    </div>

    <p
      v-if="role === 'cms-entry'"
      class="rounded-sm border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
    >
      {{ m.pages_type_entry_notice() }}
    </p>

    <div v-if="showAssignment" class="space-y-3">
      <div>
        <Label class="text-sm font-regular">
          {{ m.pages_type_assign_collection() }}
        </Label>
        <p class="mt-1 text-xs text-muted-foreground/70">
          {{ m.pages_type_assign_collection_hint() }}
        </p>
      </div>

      <p
        v-if="collections.length === 0"
        class="text-xs text-muted-foreground"
      >
        {{ m.pages_type_no_collections() }}
      </p>

      <Select v-else v-model="selectValue">
        <SelectTrigger class="w-full max-w-sm rounded-sm!">
          <SelectValue :placeholder="m.pages_type_unassigned()" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem :value="noneValue">
            {{ m.pages_type_unassigned() }}
          </SelectItem>
          <SelectItem
            v-for="collection in collections"
            :key="collection.id"
            :value="collection.id"
          >
            {{ collection.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>
