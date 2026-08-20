<script setup lang="ts">
import { computed } from "vue"
import { StudioSectionNavRail } from "@/workspace/studio/core"
import { m } from "@/paraglide/messages.js"
import {
  DESIGN_SECTION_ORDER,
  type DesignSectionId,
} from "./types"

const props = defineProps<{
  activeSection: DesignSectionId
}>()

const emit = defineEmits<{
  selectSection: [section: DesignSectionId]
}>()

function labelFor(id: DesignSectionId) {
  switch (id) {
    case "colors":
      return m.design_section_colors()
    case "typography":
      return m.design_section_fonts()
    case "global-styles":
      return m.design_section_global_styles()
    case "icons":
      return m.design_section_icons()
    case "stylesheets":
      return m.design_section_stylesheets()
    case "class-manager":
      return m.design_section_class_manager()
    case "variable-manager":
      return m.design_section_variable_manager()
  }
}

const items = computed(() =>
  DESIGN_SECTION_ORDER.map((id) => ({
    id,
    label: labelFor(id),
  })),
)

function onSelect(id: string) {
  emit("selectSection", id as DesignSectionId)
}
</script>

<template>
  <StudioSectionNavRail
    :title="m.design_title()"
    :active-key="props.activeSection"
    :nav-aria-label="m.design_sidebar_label()"
    :items="items"
    @select="onSelect"
  />
</template>
