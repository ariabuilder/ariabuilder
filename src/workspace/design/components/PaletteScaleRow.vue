<script setup lang="ts">
import { computed, ref } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { ColorPicker } from "@/components/ui/color-picker"
import { CHECKERBOARD_STYLE } from "@/components/ui/color-picker/checkerboard"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ColorShadeKey, DesignColorPalette } from "../../../../shared/design"
import { COLOR_SHADE_KEYS } from "../../../../shared/design"
import { getTextColorForBackground } from "../lib/shades"
import { m } from "@/paraglide/messages.js"
import ColorCopyCheck from "./ColorCopyCheck.vue"

const props = defineProps<{
  palette: DesignColorPalette
  copiedSwatch: string | null
  /** Site palettes are discoverable but not edited here. */
  readonly?: boolean
}>()

const emit = defineEmits<{
  updateBaseColor: [color: string]
  rename: [name: string]
  renameVariable: [name: string]
  delete: []
  copy: [hex: string, id: string]
  adopt: []
}>()

const renamingLabel = ref(false)
const renameValue = ref("")
const renamingVar = ref(false)
const renameVarValue = ref("")

const baseColor = computed(
  () => props.palette.shades.DEFAULT || props.palette.shades["500"] || "#808080",
)

const shadeKeys = computed(() => {
  if (!props.readonly) return COLOR_SHADE_KEYS
  const keys = COLOR_SHADE_KEYS.filter((key) =>
    Boolean(props.palette.shades[key]),
  )
  if (keys.length) return keys
  if (props.palette.shades.DEFAULT) return ["500"] as ColorShadeKey[]
  return [] as ColorShadeKey[]
})

function shadeHex(shade: ColorShadeKey | number): string {
  const key = String(shade) as ColorShadeKey
  if (props.readonly) {
    return props.palette.shades[key] ?? props.palette.shades.DEFAULT ?? "#808080"
  }
  return props.palette.shades[key] ?? baseColor.value
}

function startRename() {
  renameValue.value = props.palette.name
  renamingLabel.value = true
}

function commitRename() {
  renamingLabel.value = false
  const next = renameValue.value.trim()
  if (next && next !== props.palette.name) emit("rename", next)
}

function startVarRename() {
  renameVarValue.value = props.palette.name
  renamingVar.value = true
}

function commitVarRename() {
  renamingVar.value = false
  const next = renameVarValue.value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
  if (next && next !== props.palette.name) emit("renameVariable", next)
}

function copyShade(shade: ColorShadeKey) {
  emit("copy", shadeHex(shade), `${props.palette.name}-${shade}`)
}
</script>

<template>
  <article class="palette-scale-row group/row">
    <div class="palette-scale-meta">
      <ColorPicker
        v-if="!readonly"
        :model-value="baseColor"
        layout="compact"
        persist-mode="live"
        :show-variables="false"
        :show-design-colors="false"
        content-side="bottom"
        content-align="start"
        @update:model-value="emit('updateBaseColor', $event)"
      >
        <template #default="{ previewColor }">
          <button
            type="button"
            class="relative h-8 w-12 shrink-0 overflow-hidden rounded-sm border border-border/50"
            :style="{ background: CHECKERBOARD_STYLE }"
            :aria-label="m.design_colors_pick_base({ name: palette.name })"
          >
            <span
              class="absolute inset-0"
              :style="{ backgroundColor: previewColor || baseColor }"
            />
          </button>
        </template>
      </ColorPicker>
      <div
        v-else
        class="relative h-8 w-12 shrink-0 overflow-hidden rounded-sm border border-border/50"
        :style="{ backgroundColor: baseColor }"
      />

      <div class="flex min-w-0 flex-1 items-center gap-3">
        <span
          v-if="!renamingLabel"
          class="max-w-[45%] truncate text-base font-medium text-foreground"
        >
          {{ palette.name }}
        </span>
        <input
          v-else
          v-model="renameValue"
          class="block h-6 w-36 max-w-[45%] border-0 border-b border-dashed border-primary bg-transparent p-0 text-base text-foreground outline-none"
          @blur="commitRename"
          @keydown.enter="commitRename"
          @keydown.escape="renamingLabel = false"
        />

        <span
          v-if="!renamingVar"
          class="mt-0.5 min-w-0 truncate font-mono text-2xs text-primary/80"
        >
          --{{ palette.name }}
        </span>
        <input
          v-else
          v-model="renameVarValue"
          class="block h-5 min-w-0 max-w-52 border-0 border-b border-dashed border-primary bg-transparent p-0 font-mono text-2xs text-foreground outline-none"
          @blur="commitVarRename"
          @keydown.enter="commitVarRename"
          @keydown.escape="renamingVar = false"
        />

        <span
          v-if="readonly"
          class="shrink-0 rounded-sm border border-border/60 px-1.5 py-0.5 text-2xs uppercase tracking-wide text-muted-foreground"
        >
          {{ m.design_source_site() }}
        </span>
      </div>

      <span
        class="ml-auto shrink-0 font-mono text-2xs uppercase text-muted-foreground"
      >
        {{ baseColor }}
      </span>

      <DropdownMenu v-if="!readonly">
        <DropdownMenuTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="-mr-1 text-muted-foreground opacity-70 hover:text-foreground group-hover/row:opacity-100"
          >
            <AppIcon name="moreHorizontal" class="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-48">
          <DropdownMenuItem @select="startRename">
            {{ m.design_colors_rename_palette() }}
          </DropdownMenuItem>
          <DropdownMenuItem @select="startVarRename">
            {{ m.design_colors_rename_variable() }}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" @select="emit('delete')">
            {{ m.design_colors_delete_palette() }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        v-else
        type="button"
        size="xs"
        variant="outline"
        class="shrink-0"
        @click="emit('adopt')"
      >
        {{ m.design_colors_adopt() }}
      </Button>
    </div>

    <div class="palette-shade-scroll">
      <div class="palette-shade-grid">
        <button
          v-for="shade in shadeKeys"
          :key="shade"
          type="button"
          class="palette-shade group/swatch"
          @click="copyShade(shade)"
        >
          <span
            class="relative block h-9 w-full"
            :style="{ backgroundColor: shadeHex(shade) }"
            aria-hidden="true"
          >
            <ColorCopyCheck
              v-if="copiedSwatch === `${palette.name}-${shade}`"
              :color="getTextColorForBackground(shadeHex(shade))"
            />
          </span>
          <span class="block px-1 py-1.5 text-left">
            <span class="block text-2xs font-medium leading-3 text-foreground">
              {{ shade }}
            </span>
            <span
              class="mt-0.5 block truncate font-mono text-[9px] uppercase leading-3 text-muted-foreground"
            >
              {{ shadeHex(shade) }}
            </span>
          </span>
        </button>
      </div>
    </div>
  </article>
</template>
