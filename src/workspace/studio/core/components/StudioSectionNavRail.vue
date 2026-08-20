<script setup lang="ts">
import { toRef } from "vue"
import { cn } from "@/lib/utils"
import { useStudioSectionNav } from "../composables/useStudioSectionNav"
import FlickeringNavItem from "./FlickeringNavItem.vue"
import SlidingNavIndicator from "./SlidingNavIndicator.vue"
import StudioRailFrame from "./StudioRailFrame.vue"

export type StudioSectionNavItem = {
  id: string
  label: string
}

const props = defineProps<{
  title?: string
  activeKey: string
  navAriaLabel: string
  /** Simple label list — omit when using the default slot for custom rows. */
  items?: readonly StudioSectionNavItem[]
  navClass?: string
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

const {
  indicator,
  indicatorAnimated,
  bindNavRoot,
  bindItemRef,
  onItemEnter,
  onNavLeave,
  updateIndicator,
} = useStudioSectionNav(toRef(props, "activeKey"))
</script>

<template>
  <StudioRailFrame :title="title">
    <nav
      :ref="bindNavRoot"
      :class="
        cn(
          'organizer-nav settings-nav relative min-h-0 flex-1 overflow-y-auto bg-background py-0 dark:bg-sidebar',
          navClass,
        )
      "
      :aria-label="navAriaLabel"
      @scroll="updateIndicator"
      @mouseleave="onNavLeave"
    >
      <SlidingNavIndicator
        :visible="indicator.visible"
        :top="indicator.top"
        :height="indicator.height"
        :animated="indicatorAnimated"
      />

      <slot
        :bind-item-ref="bindItemRef"
        :on-item-enter="onItemEnter"
        :active-key="activeKey"
      >
        <FlickeringNavItem
          v-for="item in items"
          :key="item.id"
          :ref="bindItemRef(item.id)"
          :active="activeKey === item.id"
          class="py-4.5"
          @mouseenter="onItemEnter(item.id)"
          @click="emit('select', item.id)"
        >
          <span class="min-w-0 truncate text-sm font-regular">{{
            item.label
          }}</span>
        </FlickeringNavItem>
      </slot>
    </nav>
  </StudioRailFrame>
</template>

<style scoped>
.organizer-nav :deep(.settings-nav-item.nav-border-inactive),
.organizer-nav :deep(.settings-nav-item.hover\:nav-border-hover:hover),
.organizer-nav :deep(.sidebar-nav-target.nav-border-inactive),
.organizer-nav :deep(.sidebar-nav-target.hover\:nav-border-hover:hover) {
  box-shadow: inset 2px 0 0 0 transparent !important;
}
</style>
