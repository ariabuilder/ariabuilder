<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useSlots } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { m } from "@/paraglide/messages.js"
import PageHeader from "./PageHeader.vue"
import StudioPanelShell from "./StudioPanelShell.vue"

export type StudioDocumentDetailTab = { id: string; label: string }

const props = defineProps<{
  title: string
  description?: string
  backLabel: string
  tabs: StudioDocumentDetailTab[]
  activeTab: string
}>()

const emit = defineEmits<{
  back: []
  "update:activeTab": [tab: string]
}>()

const slots = useSlots()
const heading = ref<HTMLElement | null>(null)
const hasAside = computed(() => Boolean(slots.aside))

onMounted(() => {
  void nextTick(() => heading.value?.focus({ preventScroll: true }))
})

function selectTab(id: string) {
  emit("update:activeTab", id)
  void nextTick(() => {
    document.getElementById(`studio-detail-tab-${id}`)?.focus()
  })
}

function onTabKeydown(event: KeyboardEvent, index: number) {
  if (!props.tabs.length) return
  let next = index
  if (event.key === "ArrowRight") next = (index + 1) % props.tabs.length
  else if (event.key === "ArrowLeft") next = (index - 1 + props.tabs.length) % props.tabs.length
  else if (event.key === "Home") next = 0
  else if (event.key === "End") next = props.tabs.length - 1
  else return
  event.preventDefault()
  selectTab(props.tabs[next]!.id)
}
</script>

<template>
  <StudioPanelShell>
    <PageHeader
      :title="title"
      :description="description"
      class="min-h-22 px-5 py-3"
      hide-search
      hide-create
      controls-align="start"
    >
      <template #title>
        <div class="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="shrink-0"
            @click="emit('back')"
          >
            <AppIcon name="arrowLeft" class="me-1.5 size-3.5" aria-hidden="true" />
            {{ backLabel }}
          </Button>
          <h1
            ref="heading"
            tabindex="-1"
            class="min-w-0 truncate text-2xl font-medium tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {{ title }}
          </h1>
        </div>
      </template>
      <template #actions>
        <slot name="actions" />
      </template>
    </PageHeader>

    <div
      class="flex h-12 shrink-0 items-stretch gap-1 overflow-x-auto border-b border-dashed border-border bg-background px-7 max-[40rem]:px-4"
      role="tablist"
      :aria-label="m.studio_document_detail_sections()"
    >
      <Button
        v-for="(tab, index) in tabs"
        :id="`studio-detail-tab-${tab.id}`"
        :key="tab.id"
        type="button"
        role="tab"
        size="tab"
        :variant="activeTab === tab.id ? 'tab-active' : 'tab'"
        :aria-selected="activeTab === tab.id"
        :aria-controls="`studio-detail-panel-${tab.id}`"
        :tabindex="activeTab === tab.id ? 0 : -1"
        @click="emit('update:activeTab', tab.id)"
        @keydown="onTabKeydown($event, index)"
      >
        {{ tab.label }}
      </Button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div
        class="mx-auto grid w-full max-w-7xl gap-6 p-5 max-[40rem]:p-4"
        :class="hasAside ? 'xl:grid-cols-[minmax(0,1fr)_20rem]' : ''"
      >
        <section
          :id="`studio-detail-panel-${activeTab}`"
          role="tabpanel"
          :aria-labelledby="`studio-detail-tab-${activeTab}`"
          class="min-w-0"
        >
          <slot />
        </section>
        <aside v-if="hasAside" class="min-w-0 space-y-6 xl:sticky xl:top-5 xl:self-start">
          <slot name="aside" />
        </aside>
      </div>
    </div>

    <p class="sr-only" role="status"><slot name="status" /></p>
  </StudioPanelShell>
</template>
