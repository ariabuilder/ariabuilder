<script setup lang="ts">
import { computed, ref } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { PropValue } from "../../../../shared/composer/types"
import ComposerCmsSection from "./ComposerCmsSection.vue"

const props = defineProps<{
  propName: string
  value?: PropValue
  disabled?: boolean
}>()
const open = ref(false)
const dynamic = computed(() => props.value?.type === "expr" && (
  props.value.value.includes("@aria-cms-fallback") ||
  /(?:\.data(?:\?|\.)?|getEntry|getCollection)/.test(props.value.value)
))
</script>

<template>
  <div class="flex items-center justify-between gap-2 pl-[76px]">
    <span class="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Source</span>
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="h-6 min-w-20 cursor-pointer justify-between gap-1 border-dashed px-2 text-[10px]"
          :class="dynamic ? 'border-primary/45 bg-primary/5 text-primary' : ''"
          :disabled="disabled"
          :aria-label="`${propName} source: ${dynamic ? 'Dynamic' : 'Static'}`"
        >
          <span>{{ dynamic ? "Dynamic" : "Static" }}</span>
          <AppIcon name="chevronDown" :size="10" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" :side-offset="8" class="w-80 p-0">
        <ComposerCmsSection
          embedded
          :active="open"
          :initial-target-prop="propName"
        />
      </PopoverContent>
    </Popover>
  </div>
</template>
