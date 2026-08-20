<script setup lang="ts">
import type { SelectValueProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { SelectValue } from "reka-ui"
import { cn } from "@/lib/utils"

const props = defineProps<SelectValueProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <span :class="cn('inline-flex flex-1 items-center', props.class)">
    <SelectValue v-bind="delegatedProps">
      <slot />
    </SelectValue>
  </span>
</template>
