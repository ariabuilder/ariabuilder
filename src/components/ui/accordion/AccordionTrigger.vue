<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import type { AccordionTriggerProps } from "reka-ui"
import { reactiveOmit } from "@vueuse/core"
import { AccordionHeader, AccordionTrigger } from "reka-ui"
import { AppIcon } from "@/components/ui/app-icon"
import { cn } from "@/lib/utils"

const props = defineProps<
  AccordionTriggerProps & { class?: HTMLAttributes["class"] }
>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <AccordionHeader class="flex min-w-0 flex-1">
    <AccordionTrigger
      data-slot="accordion-trigger"
      v-bind="delegatedProps"
      :class="
        cn(
          'group/acc-trigger flex flex-1 items-center justify-between gap-3 py-3 text-left text-sm font-medium outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
          props.class,
        )
      "
    >
      <slot />
      <span
        data-slot="accordion-chevron"
        class="acc-chevron inline-flex shrink-0 text-muted-foreground"
        aria-hidden="true"
      >
        <AppIcon name="chevronDown" :size="16" />
      </span>
    </AccordionTrigger>
  </AccordionHeader>
</template>
