<script setup lang="ts">
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { m } from "@/paraglide/messages.js"
import type { PaletteTemplate } from "../lib/paletteTemplates"

defineProps<{
  templates: PaletteTemplate[]
  isApplying: boolean
  getPreviewRows: (template: PaletteTemplate) => string[][]
}>()

const emit = defineEmits<{
  apply: [template: PaletteTemplate]
}>()
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="secondary"
        size="md"
        :disabled="isApplying"
        :aria-label="m.design_colors_apply_template()"
      >
        <AppIcon name="design" class="size-3.5 shrink-0" />
        <span>
          {{
            isApplying
              ? m.design_colors_applying()
              : m.design_colors_apply_template()
          }}
        </span>
        <AppIcon
          name="chevronDown"
          class="ml-1 size-3.5 shrink-0 text-muted-foreground"
        />
      </Button>
    </DropdownMenuTrigger>

    <DropdownMenuContent
      align="end"
      class="w-56 p-1"
      :aria-label="m.design_colors_templates()"
    >
      <DropdownMenuItem
        v-for="template in templates"
        :key="template.id"
        class="group min-h-10 gap-2 rounded-sm border-b-0 px-2 py-1.5"
        :disabled="isApplying"
        :aria-label="
          m.design_colors_apply_palette_aria({ name: template.name })
        "
        :title="template.description"
        @select="emit('apply', template)"
      >
        <span class="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {{ template.name }}
        </span>

        <span
          class="grid w-20 shrink-0 gap-px overflow-hidden rounded-[3px] border border-solid border-black/5 dark:border-white/8"
          aria-hidden="true"
        >
          <span
            v-for="(row, rowIndex) in getPreviewRows(template)"
            :key="rowIndex"
            class="flex h-1.5"
          >
            <span
              v-for="(color, colorIndex) in row"
              :key="colorIndex"
              class="min-w-0 flex-1"
              :style="{ backgroundColor: color }"
            />
          </span>
        </span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
