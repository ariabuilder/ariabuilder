<script setup lang="ts">
import { computed, ref } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { AppIconName } from "@/icons/registry"
import { m } from "@/paraglide/messages.js"
import HeaderActionDropdownTooltip from "@/workspace/studio/core/components/HeaderActionDropdownTooltip.vue"
import { labelForNode } from "../../../../shared/composer"
import ComposerPseudoSelector from "../design/ComposerPseudoSelector.vue"
import ComposerElementConditionsDialog from "../conditions/ComposerElementConditionsDialog.vue"
import {
  tryUseInspectorContext,
  type InspectorClassHeaderActions,
} from "../inspector/useInspectorContext"

const inspector = tryUseInspectorContext()
const node = computed(() => inspector?.selectedNode.value ?? null)
const displayName = computed(() => node.value ? labelForNode(node.value) : m.composer_inspector_no_selection())
const icon = computed<AppIconName>(() => {
  const selected = node.value
  if (!selected) return "cursor"
  if (selected.kind === "component") return "component"
  if (selected.kind === "text") return "text"
  if (selected.kind === "comment") return "code"
  if (selected.kind === "element") {
    if (selected.name === "img" || selected.name === "picture") return "image"
    if (selected.name === "video") return "video"
    if (/^h[1-6]$/.test(selected.name) || ["p", "span", "label"].includes(selected.name)) return "text"
  }
  return "code"
})
const activeClassName = computed(() => inspector?.activeClassName.value ?? null)
const classActions = computed(() => inspector?.classHeaderActions.value ?? null)
const canPasteStyles = computed(() => classActions.value?.canPasteStyles() ?? false)
const conditionsOpen = ref(false)
const canOpenConditions = computed(() => {
  const selected = node.value
  return Boolean(selected && !["doctype", "comment", "raw"].includes(selected.kind))
})

type ClassHeaderAction = Exclude<keyof InspectorClassHeaderActions, "canPasteStyles">

function invokeClassAction(action: ClassHeaderAction) {
  void classActions.value?.[action]()
}
</script>

<template>
  <div
    class="flex h-10 min-w-0 shrink-0 items-center gap-1 border-b border-dashed border-border bg-background/50 px-2 py-2 dark:bg-sidebar/50"
    data-aria-composer-inspector-context
  >
    <template v-if="activeClassName">
      <span class="min-w-0 flex-1 truncate select-none font-mono text-xs font-medium text-muted-foreground">.{{ activeClassName }}</span>
      <div class="flex shrink-0 items-center gap-0" data-aria-class-header-actions>
        <Tooltip v-if="canPasteStyles">
          <TooltipTrigger as-child>
            <Button type="button" variant="ghost" size="icon-sm" class="size-6 cursor-pointer rounded-sm" :aria-label="m.composer_inspector_classes_paste()" @click="invokeClassAction('pasteStyles')"><AppIcon name="clipboard" :size="13" /></Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" :side-offset="6">{{ m.composer_inspector_classes_paste() }}</TooltipContent>
        </Tooltip>
        <ComposerPseudoSelector
          compact
          :model-value="inspector?.selectedPseudo.value ?? 'default'"
          @update:model-value="inspector?.setSelectedPseudo($event)"
        />
        <Tooltip>
          <TooltipTrigger as-child>
            <Button type="button" variant="ghost" size="icon-sm" class="size-6 cursor-pointer rounded-sm" :aria-label="m.composer_inspector_classes_edit_css()" @click="invokeClassAction('editCss')"><AppIcon name="edit" :size="13" /></Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" :side-offset="6">{{ m.composer_inspector_classes_edit_css() }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button type="button" variant="ghost" size="icon-sm" class="size-6 cursor-pointer rounded-sm" :aria-label="m.composer_inspector_classes_done()" @click="invokeClassAction('done')"><AppIcon name="checkLinear" :size="14" /></Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" :side-offset="6">{{ m.composer_inspector_classes_done() }}</TooltipContent>
        </Tooltip>
        <HeaderActionDropdownTooltip :label="m.composer_inspector_classes_more()">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button type="button" variant="ghost" size="icon-sm" class="size-6 cursor-pointer rounded-sm" :aria-label="m.composer_inspector_classes_more()"><AppIcon name="moreHorizontal" :size="13" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-48">
              <DropdownMenuItem @select="invokeClassAction('copyStyles')"><AppIcon name="copy" :size="14" /><span>{{ m.composer_inspector_classes_copy() }}</span></DropdownMenuItem>
              <DropdownMenuItem v-if="canPasteStyles" @select="invokeClassAction('pasteStyles')"><AppIcon name="clipboard" :size="14" /><span>{{ m.composer_inspector_classes_paste() }}</span></DropdownMenuItem>
              <DropdownMenuItem @select="invokeClassAction('editCss')"><AppIcon name="edit" :size="14" /><span>{{ m.composer_inspector_classes_edit_css() }}</span></DropdownMenuItem>
              <DropdownMenuItem @select="invokeClassAction('rename')"><AppIcon name="rename" :size="14" /><span>{{ m.composer_inspector_classes_rename() }}</span></DropdownMenuItem>
              <DropdownMenuItem @select="invokeClassAction('duplicate')"><AppIcon name="duplicate" :size="14" /><span>{{ m.composer_inspector_classes_duplicate() }}</span></DropdownMenuItem>
              <DropdownMenuItem variant="destructive" @select="invokeClassAction('removeActive')"><AppIcon name="unlink02" :size="14" /><span>{{ m.composer_inspector_classes_remove() }}</span></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </HeaderActionDropdownTooltip>
      </div>
    </template>
    <template v-else>
      <div class="flex size-5 shrink-0 items-center justify-center">
        <AppIcon :name="icon" :size="16" class="text-muted-foreground" aria-hidden="true" />
      </div>
      <div class="flex min-w-0 flex-1 items-center">
        <span class="truncate select-none text-xs font-medium capitalize tracking-wide text-muted-foreground">{{ displayName }}</span>
      </div>
      <Tooltip v-if="canOpenConditions">
        <TooltipTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="size-7 cursor-pointer rounded-sm"
            aria-label="Conditions"
            @click="conditionsOpen = true"
          >
            <AppIcon name="branchingPaths" :size="14" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" :side-offset="6">Conditions</TooltipContent>
      </Tooltip>
    </template>
  </div>
  <ComposerElementConditionsDialog v-model:open="conditionsOpen" />
</template>
