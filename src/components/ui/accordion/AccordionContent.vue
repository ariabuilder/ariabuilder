<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import type { AccordionContentProps } from "reka-ui"
import { reactiveOmit } from "@vueuse/core"
import { AccordionContent } from "reka-ui"
import { cn } from "@/lib/utils"

const props = defineProps<
  AccordionContentProps & { class?: HTMLAttributes["class"] }
>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <AccordionContent
    v-bind="delegatedProps"
    data-slot="accordion-content"
    force-mount
    :class="cn('acc-panel', props.class)"
  >
    <div data-slot="accordion-content-inner" class="acc-panel-inner min-h-0">
      <div class="pb-4 pt-0">
        <slot />
      </div>
    </div>
  </AccordionContent>
</template>
