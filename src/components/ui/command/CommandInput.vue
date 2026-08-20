<script setup lang="ts">
import type { ListboxFilterProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { Search } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import { injectListboxRootContext, ListboxFilter, useForwardProps } from "reka-ui"
import { nextTick, onMounted, ref, watch } from "vue"
import { cn } from "@/lib/utils"
import { useCommand } from "."
import {
  handleCommandInputKeydown,
  resetCommandKeyboardNavigation,
} from "./commandInputNavigation"

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<ListboxFilterProps & {
  class?: HTMLAttributes["class"]
  wrapperClass?: HTMLAttributes["class"]
  hideIcon?: boolean
}>()

const modelValue = defineModel<string>({ default: "" })

const delegatedProps = reactiveOmit(props, "class", "wrapperClass", "hideIcon")

const forwardedProps = useForwardProps(delegatedProps)

const { filterState } = useCommand()
const rootContext = injectListboxRootContext()
const wrapperRef = ref<HTMLElement | null>(null)

function getListRoot(): ParentNode {
  return wrapperRef.value?.closest('[data-slot="command"]') ?? document
}

onMounted(() => {
  if (modelValue.value) filterState.search = modelValue.value
  const listRoot = getListRoot()
  resetCommandKeyboardNavigation(listRoot)
  nextTick(() => {
    nextTick(() => rootContext.onLeave(new FocusEvent("focusout")))
  })
})

watch(
  () => filterState.search,
  (value) => {
    if (modelValue.value !== value) modelValue.value = value
  },
)

watch(modelValue, (value) => {
  if (filterState.search !== value) filterState.search = value
  resetCommandKeyboardNavigation(getListRoot())
})

async function onFilterKeydownCapture(event: KeyboardEvent): Promise<void> {
  const listRoot =
    event.target instanceof HTMLElement
      ? event.target.closest('[data-slot="command"]')
      : null
  await handleCommandInputKeydown(event, rootContext, listRoot ?? document)
}
</script>

<template>
  <div
    ref="wrapperRef"
    data-slot="command-input-wrapper"
    :class="
      cn('flex h-9 items-center gap-2 border-b px-3', props.wrapperClass)
    "
    @keydown.capture="onFilterKeydownCapture"
  >
    <Search v-if="!hideIcon" class="size-4 shrink-0 opacity-50" />
    <ListboxFilter
      v-bind="{ ...forwardedProps, ...$attrs }"
      v-model="filterState.search"
      data-slot="command-input"
      auto-focus
      :class="cn('placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50', props.class)"
    />
  </div>
</template>
