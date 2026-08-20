<script setup lang="ts">
import { computed } from "vue"
import type { AppIconName } from "@/icons/registry"
import { EmptyState } from "@/workspace/studio/core"
import type { WorkspaceRailId } from "@/workspace/types"
import { m } from "@/paraglide/messages.js"

/** Rails that have a real surface already. */
export type ShippedWorkspaceRailId =
  | "composer"
  | "pages"
  | "components"
  | "layouts"
  | "collections"
  | "media"
  | "design"
  | "settings"

/** Remaining placeholder rails (none currently). */
export type PlaceholderRailId = Exclude<WorkspaceRailId, ShippedWorkspaceRailId>

const props = defineProps<{
  rail: PlaceholderRailId | WorkspaceRailId
}>()

const meta: Partial<
  Record<WorkspaceRailId, { icon: AppIconName; label: () => string }>
> = {}

const current = computed(() => meta[props.rail as WorkspaceRailId])
</script>

<template>
  <main class="min-h-0 flex-1 overflow-auto">
    <EmptyState
      v-if="current"
      :icon="current.icon"
      :entity-label="current.label()"
      :title="current.label()"
      :description="m.rail_coming_soon_description()"
      hide-action
    />
  </main>
</template>
