<script setup lang="ts">
import { computed } from "vue"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { m } from "@/paraglide/messages.js"
import SettingsRow from "@/workspace/settings/SettingsRow.vue"
import type { PageRole } from "@/workspace/types"
import { formatPageUpdated } from "../pagesDisplay"

const props = defineProps<{
  route: string
  file: string
  mtimeMs: number
  role: PageRole
}>()

const title = defineModel<string>("title", { default: "" })
const description = defineModel<string>("description", { default: "" })

const emit = defineEmits<{
  openType: []
}>()

const updatedLabel = computed(() => formatPageUpdated(props.mtimeMs))

const roleLabel = computed(() => {
  switch (props.role) {
    case "not-found":
      return m.pages_type_not_found_label()
    case "cms-collection":
      return m.pages_type_collection_label()
    case "cms-entry":
      return m.pages_type_entry_label()
    default:
      return m.pages_type_standard_label()
  }
})
</script>

<template>
  <div class="grid w-full gap-5">
    <SettingsRow
      :label="m.pages_detail_title()"
      :description="m.pages_detail_title_hint()"
      full-width
      input-id="page-detail-title"
    >
      <Input
        id="page-detail-title"
        v-model="title"
        :spellcheck="false"
        class="rounded-sm!"
      />
    </SettingsRow>

    <SettingsRow
      :label="m.pages_detail_description()"
      :description="m.pages_detail_description_hint()"
      full-width
      input-id="page-detail-description"
    >
      <Textarea
        id="page-detail-description"
        v-model="description"
        :rows="3"
        class="min-h-20 rounded-sm!"
      />
    </SettingsRow>

    <div class="grid gap-4">
      <div class="space-y-1">
        <p class="text-sm font-regular text-foreground">
          {{ m.pages_detail_route() }}
        </p>
        <p class="truncate font-mono text-xs text-muted-foreground">
          {{ route }}
        </p>
      </div>
      <div class="space-y-1">
        <p class="text-sm font-regular text-foreground">
          {{ m.pages_detail_file() }}
        </p>
        <p class="truncate font-mono text-xs text-muted-foreground">
          {{ file }}
        </p>
      </div>
      <div class="space-y-1">
        <p class="text-sm font-regular text-foreground">
          {{ m.pages_detail_updated() }}
        </p>
        <p class="text-xs tabular-nums text-muted-foreground">
          {{ updatedLabel }}
        </p>
      </div>
      <div class="space-y-1">
        <p class="text-sm font-regular text-foreground">
          {{ m.pages_detail_role() }}
        </p>
        <button
          type="button"
          class="text-xs text-primary underline-offset-2 hover:underline"
          @click="emit('openType')"
        >
          {{ roleLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
