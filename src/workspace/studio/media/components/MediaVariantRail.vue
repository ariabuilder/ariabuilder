<script setup lang="ts">
import { computed, ref } from "vue"
import type { MediaTransformVariant } from "@/lib/media"
import {
  FlickeringNavItem,
  StudioInlineCreateNavRow,
  StudioSectionNavRail,
} from "@/workspace/studio/core"
import { m } from "@/paraglide/messages.js"

const props = withDefaults(
  defineProps<{
    variants: readonly MediaTransformVariant[]
    selectedVariantId: string | null
    draftVariantName: string | null
    sourceDimensions?: { width: number; height: number } | null
    canCreate?: boolean
  }>(),
  { sourceDimensions: null, canCreate: true },
)

const emit = defineEmits<{
  selectOriginal: []
  selectVariant: [id: string]
  createVariant: [name: string]
}>()

const activeKey = computed(() =>
  props.draftVariantName
    ? "draft"
    : props.selectedVariantId
      ? `variant:${props.selectedVariantId}`
      : "original",
)

const createRowRef = ref<InstanceType<typeof StudioInlineCreateNavRow> | null>(
  null,
)

function startCreate(): void {
  createRowRef.value?.startCreate()
}

defineExpose({ startCreate })
</script>

<template>
  <StudioSectionNavRail
    :title="m.media_detail_variants()"
    :active-key="activeKey"
    :nav-aria-label="m.media_detail_variants()"
    nav-class="page-card-enter"
  >
    <template #default="{ bindItemRef, onItemEnter, activeKey: key }">
      <FlickeringNavItem
        :ref="bindItemRef('original')"
        :active="key === 'original'"
        class="py-4.5"
        @click="emit('selectOriginal')"
        @mouseenter="onItemEnter('original')"
      >
        <span class="min-w-0 truncate">{{ m.media_detail_original() }}</span>
        <span class="shrink-0 text-2xs tabular-nums text-muted-foreground/60">
          {{ sourceDimensions?.width ?? "—" }} ×
          {{ sourceDimensions?.height ?? "—" }}
        </span>
      </FlickeringNavItem>

      <FlickeringNavItem
        v-if="draftVariantName"
        :ref="bindItemRef('draft')"
        :active="key === 'draft'"
        class="group"
        @mouseenter="onItemEnter('draft')"
      >
        <span class="min-w-0 truncate">{{ draftVariantName }}</span>
        <span class="shrink-0 text-2xs text-muted-foreground">{{
          m.media_detail_draft()
        }}</span>
      </FlickeringNavItem>

      <FlickeringNavItem
        v-for="variant in variants"
        :key="variant.id"
        :ref="bindItemRef(`variant:${variant.id}`)"
        :active="key === `variant:${variant.id}`"
        @click="emit('selectVariant', variant.id)"
        @mouseenter="onItemEnter(`variant:${variant.id}`)"
      >
        <span class="min-w-0 truncate" :title="variant.name">{{
          variant.name
        }}</span>
        <span class="shrink-0 text-2xs tabular-nums text-muted-foreground/60">
          {{ variant.output.width ?? "—" }} ×
          {{ variant.output.height ?? "—" }}
        </span>
      </FlickeringNavItem>

      <StudioInlineCreateNavRow
        ref="createRowRef"
        :label="m.media_detail_new_crop()"
        :placeholder="m.media_detail_variant_name()"
        :hint="m.media_detail_create_hint()"
        icon="plus"
        :disabled="!canCreate"
        @create="emit('createVariant', $event)"
      />
    </template>
  </StudioSectionNavRail>
</template>
