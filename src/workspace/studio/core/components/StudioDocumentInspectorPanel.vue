<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { m } from "@/paraglide/messages.js"

export type StudioDocumentInspectorTab = { id: string; label: string }

const props = defineProps<{
  title: string
  description?: string
  closeLabel: string
  tabs: StudioDocumentInspectorTab[]
  activeTab: string
}>()

const emit = defineEmits<{
  close: []
  "update:activeTab": [tab: string]
}>()

const heading = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)

function isInspectorPortal(target: Element): boolean {
  return Boolean(target.closest(
    '[data-slot="dropdown-menu-content"], [data-slot="dialog-content"], [data-slot="dialog-overlay"]',
  ))
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  if (panel.value?.contains(target) || isInspectorPortal(target)) return
  if (target.closest("[data-component-id], [data-layout-id], [data-page-file]")) return
  emit("close")
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return
  if (document.querySelector(
    '[data-slot="dropdown-menu-content"][data-state="open"], [data-slot="dialog-content"][data-state="open"]',
  )) return
  event.preventDefault()
  emit("close")
}

onMounted(() => {
  void nextTick(() => heading.value?.focus({ preventScroll: true }))
  document.addEventListener("pointerdown", onDocumentPointerDown)
  document.addEventListener("keydown", onDocumentKeydown)
})

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown)
  document.removeEventListener("keydown", onDocumentKeydown)
})

function selectTab(id: string) {
  emit("update:activeTab", id)
  void nextTick(() => document.getElementById(`studio-inspector-tab-${id}`)?.focus())
}

function onTabKeydown(event: KeyboardEvent, index: number) {
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
  <Transition
    appear
    enter-active-class="motion-safe:transition-[transform,opacity] motion-safe:duration-200 motion-safe:ease-out"
    enter-from-class="motion-safe:translate-x-4 motion-safe:opacity-0 motion-safe:rtl:-translate-x-4"
    enter-to-class="motion-safe:translate-x-0 motion-safe:opacity-100"
    leave-active-class="motion-safe:transition-[transform,opacity] motion-safe:duration-150 motion-safe:ease-out"
    leave-from-class="motion-safe:translate-x-0 motion-safe:opacity-100"
    leave-to-class="motion-safe:translate-x-4 motion-safe:opacity-0 motion-safe:rtl:-translate-x-4"
  >
    <aside
      ref="panel"
      class="absolute inset-y-0 end-0 z-30 flex w-[min(32rem,calc(100%-2rem))] flex-col overflow-hidden border-s border-dashed border-border bg-background shadow-[-16px_0_40px_-28px_rgb(0_0_0/0.7)]"
      :aria-labelledby="'studio-inspector-heading'"
    >
    <header class="flex min-w-0 items-start gap-3 border-b border-dashed border-border px-4 py-3">
      <div class="min-w-0 flex-1">
        <h1
          id="studio-inspector-heading"
          ref="heading"
          tabindex="-1"
          class="truncate text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {{ title }}
        </h1>
        <p v-if="description" class="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {{ description }}
        </p>
      </div>
      <slot name="actions" />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="size-8 shrink-0"
        :aria-label="closeLabel"
        @click="emit('close')"
      >
        <AppIcon name="close" :size="14" aria-hidden="true" />
      </Button>
    </header>

    <div class="shrink-0 p-4 pb-3">
      <slot name="preview" />
    </div>

    <div
      class="relative flex h-12 shrink-0 items-stretch gap-1 border-y border-dashed border-border px-4"
      role="tablist"
      :aria-label="m.studio_document_inspector_sections()"
    >
      <Button
        v-for="(tab, index) in tabs"
        :id="`studio-inspector-tab-${tab.id}`"
        :key="tab.id"
        type="button"
        role="tab"
        size="tab"
        class="h-full! min-h-0! overflow-visible! after:-bottom-px"
        :variant="activeTab === tab.id ? 'tab-active' : 'tab'"
        :aria-selected="activeTab === tab.id"
        :aria-controls="`studio-inspector-panel-${tab.id}`"
        :tabindex="activeTab === tab.id ? 0 : -1"
        @click="emit('update:activeTab', tab.id)"
        @keydown="onTabKeydown($event, index)"
      >
        {{ tab.label }}
      </Button>
    </div>

    <section
      :id="`studio-inspector-panel-${activeTab}`"
      role="tabpanel"
      :aria-labelledby="`studio-inspector-tab-${activeTab}`"
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
    >
      <slot />
    </section>

    <p class="sr-only" role="status"><slot name="status" /></p>
    </aside>
  </Transition>
</template>
