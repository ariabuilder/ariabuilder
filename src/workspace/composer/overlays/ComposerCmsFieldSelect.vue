<script setup lang="ts">
import { computed, ref } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { CmsBindingFieldOption, CmsBindingFieldOptionGroup } from "../../../../shared/composer"

const props = defineProps<{
  modelValue: string
  groups: readonly CmsBindingFieldOptionGroup[]
  label: string
}>()

const emit = defineEmits<{
  "update:modelValue": [value: string]
}>()

const open = ref(false)
const options = computed(() => props.groups.flatMap((group) => group.options))
const selected = computed(() => options.value.find((option) => option.path === props.modelValue) ?? null)

function choose(value: string) {
  emit("update:modelValue", value)
  open.value = false
}

function chooseField(field: CmsBindingFieldOption) {
  choose(field.path)
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="outline"
        class="h-8 w-full min-w-0 justify-between rounded-md border-dashed bg-background px-2 text-left text-[11px] font-normal active:scale-[0.96] motion-reduce:transform-none"
        :aria-label="label"
      >
        <span class="min-w-0 truncate">{{ selected?.label ?? 'Static' }}</span>
        <AppIcon name="chevronDown" :size="12" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" side="right" :side-offset="6" class="w-64 p-0" @click.stop>
      <Command>
        <CommandInput placeholder="Find a field…" />
        <CommandList class="max-h-72">
          <CommandEmpty>No compatible fields found.</CommandEmpty>
          <CommandGroup>
            <CommandItem value="Static manual content" class="gap-2" @select="choose('')">
              <span class="min-w-0 flex-1">
                <span class="block truncate text-xs">Static</span>
                <span class="block truncate text-[10px] text-muted-foreground">Use the authored content</span>
              </span>
              <AppIcon v-if="!modelValue" name="checkLinear" :size="13" class="text-primary" aria-hidden="true" />
            </CommandItem>
          </CommandGroup>
          <CommandGroup v-for="group in groups" :key="group.label" :heading="group.label">
            <CommandItem
              v-for="field in group.options"
              :key="field.path"
              :value="`${field.label} ${field.path} ${field.type}`"
              class="gap-2"
              @select="chooseField(field)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-xs">{{ field.label }}</span>
                <span class="block truncate font-mono text-[9px] text-muted-foreground">{{ field.path }}</span>
              </span>
              <AppIcon v-if="field.path === modelValue" name="checkLinear" :size="13" class="text-primary" aria-hidden="true" />
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
