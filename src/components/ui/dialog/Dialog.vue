<script setup lang="ts">
import type { DialogRootEmits, DialogRootProps } from "reka-ui"
import { nextTick, watch } from "vue"
import { DialogRoot, useForwardPropsEmits } from "reka-ui"

const props = defineProps<DialogRootProps>()
const emits = defineEmits<DialogRootEmits>()

const forwarded = useForwardPropsEmits(props, emits)

let focusBeforeOpen: HTMLElement | null = null

watch(
  () => props.open,
  (open) => {
    if (typeof document === "undefined") return
    if (open) {
      const active = document.activeElement
      if (active instanceof HTMLElement && active !== document.body) {
        focusBeforeOpen = active
        // Reka applies aria-hidden before its focus scope's next-tick
        // autofocus. Clear background focus first so assistive technology is
        // never asked to hide the currently focused control.
        active.blur()
      }
      return
    }

    const restoreTarget = focusBeforeOpen
    focusBeforeOpen = null
    if (!restoreTarget) return
    void nextTick(() => {
      window.setTimeout(() => {
        if (
          restoreTarget.isConnected &&
          (document.activeElement === null || document.activeElement === document.body)
        ) {
          restoreTarget.focus()
        }
      }, 0)
    })
  },
  { flush: "sync", immediate: true },
)
</script>

<template>
  <DialogRoot
    v-slot="slotProps"
    data-slot="dialog"
    v-bind="forwarded"
  >
    <slot v-bind="slotProps" />
  </DialogRoot>
</template>
