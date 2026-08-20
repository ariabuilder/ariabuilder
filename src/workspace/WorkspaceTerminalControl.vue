<script setup lang="ts">
import { computed, nextTick, ref, toRef, watch } from "vue"
import TerminalPane from "@/components/terminal/TerminalPane.vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import ShortcutHint from "@/components/ui/ShortcutHint.vue"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useWorkspaceTerminal } from "@/composables/useWorkspaceTerminal"
import { useKeyboardShortcut } from "@/composables/useKeyboardShortcut"
import {
  AppShortcuts,
  ariaKeyShortcuts,
  formatShortcut,
} from "@/lib/keyboardShortcuts"
import { m } from "@/paraglide/messages.js"

const props = defineProps<{
  projectPath: string
  shortcutActive?: boolean
}>()

type TerminalHelper = {
  id: string
  label: () => string
  command: string
}

const helpers: TerminalHelper[] = [
  {
    id: "update-astro",
    label: () => m.rail_terminal_helper_update_astro(),
    command: "npx @astrojs/upgrade",
  },
  {
    id: "check",
    label: () => m.rail_terminal_helper_check(),
    command: "npx astro check",
  },
  {
    id: "deploy",
    label: () => m.rail_terminal_helper_deploy(),
    command: "npm run deploy",
  },
  {
    id: "build",
    label: () => m.rail_terminal_helper_build(),
    command: "npm run build",
  },
  {
    id: "install",
    label: () => m.rail_terminal_helper_install(),
    command: "npm install",
  },
]

const { open, takePendingCommand } = useWorkspaceTerminal(
  toRef(props, "projectPath"),
)
const cwdLabel = ref("")
const paneRef = ref<{
  restart: () => Promise<void>
  fit: () => Promise<void>
  focus: () => void
  runCommand: (command: string) => Promise<void>
} | null>(null)

const folderName = computed(() => {
  if (cwdLabel.value) return cwdLabel.value
  const parts = props.projectPath.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || m.rail_terminal()
})

async function prepareAndRunPending() {
  await nextTick()
  await paneRef.value?.fit()
  paneRef.value?.focus()
  const command = takePendingCommand()
  if (command) {
    await paneRef.value?.runCommand(command)
  }
}

function onOpenChange(next: boolean) {
  open.value = next
}

function onEscapeKeyDown() {
  onOpenChange(false)
}

useKeyboardShortcut(
  AppShortcuts.terminal,
  () => onOpenChange(!open.value),
  { enabled: computed(() => props.shortcutActive !== false) },
)

async function onRestart() {
  await paneRef.value?.restart()
}

async function onHelper(command: string) {
  await paneRef.value?.runCommand(command)
}

function onReady(cwd: string) {
  const parts = cwd.split(/[/\\]/).filter(Boolean)
  cwdLabel.value = parts[parts.length - 1] || cwd
}

watch(
  () => props.projectPath,
  () => {
    cwdLabel.value = ""
  },
)

watch(open, (isOpen) => {
  if (!isOpen) return
  void prepareAndRunPending()
})
</script>

<template>
  <Tooltip :disabled="open">
    <TooltipTrigger as-child>
      <span class="flex w-full shrink-0 justify-center" tabindex="-1">
        <Popover :open="open" @update:open="onOpenChange">
          <PopoverTrigger as-child>
            <Button
              type="button"
              :variant="open ? 'nav-active' : 'nav'"
              size="icon-lg"
              class="relative w-full overflow-visible cursor-pointer"
              :aria-label="m.rail_terminal()"
              :aria-keyshortcuts="ariaKeyShortcuts(AppShortcuts.terminal)"
              :aria-expanded="open"
            >
              <AppIcon name="terminal" :size="16" class="shrink-0" />
              <ShortcutHint
                class="pointer-events-none absolute left-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap border-border bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground shadow-md"
              >
                {{ formatShortcut(AppShortcuts.terminal) }}
              </ShortcutHint>
            </Button>
          </PopoverTrigger>

          <PopoverContent
            force-mount
            side="right"
            align="start"
            :side-offset="14"
            :collision-padding="12"
            class="w-115 max-w-115 overflow-hidden data-[state=closed]:hidden"
            @escape-key-down="onEscapeKeyDown"
          >
            <div class="flex h-90 flex-col gap-3 overflow-hidden p-2">
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2 px-1.5">
                  <AppIcon
                    name="terminal"
                    :size="15"
                    class="shrink-0 text-foreground"
                  />
                  <span
                    class="min-w-0 truncate font-mono text-xs font-medium"
                    :title="projectPath"
                  >
                    {{ folderName }}
                  </span>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="m.rail_terminal_restart()"
                    @click="onRestart"
                  >
                    <AppIcon name="refresh" :size="12" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="m.rail_terminal_close()"
                    @click="onOpenChange(false)"
                  >
                    <AppIcon name="close" :size="12" />
                  </Button>
                </div>
              </div>

              <div
                class="min-h-0 flex-1 overflow-hidden rounded-sm border border-dashed p-2"
                style="border-color: var(--cr-frame, var(--border))"
              >
                <TerminalPane
                  ref="paneRef"
                  :project-path="projectPath"
                  :active="open"
                  @ready="onReady"
                />
              </div>

              <div
                class="flex shrink-0 flex-wrap items-center justify-center gap-1.5 px-0.5 pb-1"
                role="group"
                :aria-label="m.rail_terminal_helpers()"
              >
                <Tooltip v-for="helper in helpers" :key="helper.id">
                  <TooltipTrigger as-child>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      class="font-mono text-2xs border-dashed rounded-sm bg-transparent hover:bg-sidebar/80 shadow-none! cursor-pointer"
                      @click="onHelper(helper.command)"
                    >
                      {{ helper.label() }}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" :side-offset="6">
                    <span class="font-mono text-[11px]">{{ helper.command }}</span>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </span>
    </TooltipTrigger>
    <TooltipContent side="right" :side-offset="8">
      {{ m.rail_terminal() }}
    </TooltipContent>
  </Tooltip>
</template>
