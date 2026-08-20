<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { toast } from "vue-sonner"
import AppContextMenu from "@/components/menu/AppContextMenu.vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import ShortcutHint from "@/components/ui/ShortcutHint.vue"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useKeyboardShortcut } from "@/composables/useKeyboardShortcut"
import { listRecents, type RecentProject } from "@/lib/project"
import {
  AppShortcuts,
  ariaKeyShortcuts,
  formatShortcut,
} from "@/lib/keyboardShortcuts"
import {
  revokeProjectTrust,
  type ProjectRuntimeSession,
} from "@/lib/sessions"
import { cn } from "@/lib/utils"
import type { MenuItemDef } from "@/menu/types"
import { m } from "@/paraglide/messages.js"
import WorkspaceSwitcherDismissLayer from "@/workspace/WorkspaceSwitcherDismissLayer.vue"

const props = defineProps<{
  /** Display label for the current project (site name when set). */
  label: string
  currentPath: string
  /** Paths of keep-alive / open sessions in this window. */
  openPaths: string[]
  /** Runtime sessions — used for live/offline preview status dots. */
  sessions: ProjectRuntimeSession[]
  /** Only the foreground workspace should own the global shortcut. */
  active?: boolean
  onSelect: (projectPath: string) => void
  onOpenInNewWindow: (projectPath: string) => void
  /** Called just before this switcher opens — use to close sibling popovers. */
  onWillOpen?: () => void
}>()

const open = ref(false)
const query = ref("")
const recents = ref<RecentProject[]>([])
const loading = ref(false)
const searchInput = ref<{ focus: () => void } | null>(null)

const shortcutLabel = formatShortcut(AppShortcuts.projectSwitcher)
const shortcutAria = ariaKeyShortcuts(AppShortcuts.projectSwitcher)

function samePath(a: string, b: string) {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "")
  return norm(a) === norm(b)
}

function isOpenPath(projectPath: string) {
  return props.openPaths.some((p) => samePath(p, projectPath))
}

function isCurrent(projectPath: string) {
  return samePath(projectPath, props.currentPath)
}

function findSession(projectPath: string) {
  return props.sessions.find((s) => samePath(s.path, projectPath)) ?? null
}

/** Preview server status for the status dot — not merely keep-alive. */
function previewStatus(projectPath: string) {
  const runtime = findSession(projectPath)
  if (!runtime) return "offline" as const
  if (runtime.live || runtime.status === "live") return "live" as const
  if (runtime.status === "failed") return "failed" as const
  if (
    runtime.status === "starting" ||
    runtime.status === "installing" ||
    runtime.status === "stopping"
  ) {
    return "busy" as const
  }
  return "offline" as const
}

function statusDotClass(projectPath: string) {
  switch (previewStatus(projectPath)) {
                case "live":
      return "bg-live"
    case "failed":
      return "bg-destructive"
    case "busy":
      return "bg-live animate-pulse"
    default:
      return "bg-muted-foreground/50"
  }
}

function statusLabel(projectPath: string) {
  switch (previewStatus(projectPath)) {
    case "live":
      return m.control_room_preview_live()
    case "failed":
      return m.control_room_preview_failed()
    case "busy": {
      const runtime = findSession(projectPath)
      if (runtime?.status === "starting") return m.control_room_preview_starting()
      if (runtime?.status === "stopping") return m.control_room_preview_stopping()
      if (runtime?.status === "installing") return m.workspace_preview_installing()
      return m.control_room_preview_starting()
    }
    default:
      return m.control_room_preview_offline()
  }
}

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return recents.value.filter(
    (r) =>
      !q ||
      r.name.toLowerCase().includes(q) ||
      r.path.toLowerCase().includes(q),
  )
})

const openGroup = computed(() =>
  filtered.value
    .filter((r) => isOpenPath(r.path))
    .sort((a, b) => b.openedAt - a.openedAt),
)

const inactiveGroup = computed(() =>
  filtered.value
    .filter((r) => !isOpenPath(r.path))
    .sort((a, b) => b.openedAt - a.openedAt),
)

const hasResults = computed(
  () => openGroup.value.length > 0 || inactiveGroup.value.length > 0,
)

const shortcutEnabled = computed(() => props.active !== false)

async function refreshRecents() {
  loading.value = true
  try {
    recents.value = await listRecents()
  } catch (error) {
    console.error("Failed to list recent projects:", error)
    recents.value = []
  } finally {
    loading.value = false
  }
}

function setOpen(next: boolean) {
  if (next && !open.value) props.onWillOpen?.()
  open.value = next
  if (!next) {
    query.value = ""
    return
  }
  void refreshRecents()
}

function onOpenChange(next: boolean) {
  setOpen(next)
}

function selectProject(projectPath: string, event?: MouseEvent) {
  if (event?.altKey) {
    props.onOpenInNewWindow(projectPath)
    setOpen(false)
    return
  }
  if (isCurrent(projectPath)) {
    setOpen(false)
    return
  }
  props.onSelect(projectPath)
  setOpen(false)
}

function projectMenuItems(): MenuItemDef[] {
  return [
    {
      type: "item",
      id: "open",
      label: m.workspace_project_open(),
      icon: "folderOpen",
    },
    {
      type: "item",
      id: "open-new-window",
      label: m.workspace_project_open_new_window(),
      icon: "externalLink",
    },
    { type: "separator" },
    {
      type: "item",
      id: "reset-trust",
      label: "Reset project trust",
      icon: "shield",
    },
  ]
}

function onProjectMenuAction(id: string, projectPath: string) {
  if (id === "reset-trust") {
    void revokeProjectTrust(projectPath)
      .then((result) => {
        if (result.status === "in_use") {
          toast.error("Close this project in its other windows before resetting trust.")
          return
        }
        toast.success(
          result.status === "revoked"
            ? "Project trust reset. Aria will ask again next time."
            : "This project was not trusted.",
        )
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Could not reset project trust")
      })
    setOpen(false)
    return
  }
  if (id === "open-new-window") {
    props.onOpenInNewWindow(projectPath)
    setOpen(false)
    return
  }
  if (id === "open") {
    selectProject(projectPath)
  }
}

function toggleFromShortcut() {
  if (!shortcutEnabled.value) return
  setOpen(!open.value)
}

useKeyboardShortcut(AppShortcuts.projectSwitcher, toggleFromShortcut, {
  enabled: shortcutEnabled,
})

watch(open, async (isOpen) => {
  if (!isOpen) return
  await nextTick()
  searchInput.value?.focus()
})

defineExpose({
  open: () => {
    setOpen(true)
  },
  close: () => {
    setOpen(false)
  },
})
</script>

<template>
  <Teleport to="body">
    <WorkspaceSwitcherDismissLayer
      v-if="open"
      @dismiss="setOpen(false)"
    />
  </Teleport>

  <Popover :open="open" @update:open="onOpenChange">
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        :title="m.workspace_project_switcher()"
        :aria-keyshortcuts="shortcutAria"
        class="relative max-w-40 gap-1.5 px-1.5 text-xs font-regular rounded-sm! focus-visible:ring-[0.5px] focus-visible:ring-ring/70"
      >
        <span class="truncate">{{ label }}</span>
        <AppIcon
          name="chevronDown"
          :size="12"
          data-slot="shortcut-hint-alternate"
          class="shrink-0 opacity-60"
        />
        <ShortcutHint class="absolute -right-0.5 top-1/2 -translate-y-1/2">
          {{ shortcutLabel }}
        </ShortcutHint>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" class="flex w-80 flex-col gap-2 p-2">
      <Input
        ref="searchInput"
        v-model="query"
        :placeholder="m.workspace_project_search()"
        :spellcheck="false"
        class="text-muted-foreground! rounded-sm! text-xs! h-8!"
      />
      <div class="max-h-72 overflow-y-auto">
        <p
          v-if="!loading && !hasResults"
          class="px-2 py-4 text-center text-xs font-regular text-muted-foreground"
        >
          {{ m.workspace_project_empty() }}
        </p>
        <template v-else>
          <div v-if="openGroup.length > 0" class="flex flex-col gap-0.5">
            <p
              class="px-2 pb-1 pt-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/70"
            >
              {{ m.workspace_project_group_open() }}
            </p>
            <ul class="flex flex-col gap-0.5">
              <li v-for="project in openGroup" :key="project.path">
                <AppContextMenu
                  :items="projectMenuItems()"
                  @action="onProjectMenuAction($event, project.path)"
                >
                  <button
                    type="button"
                    :class="cn(
                      'flex w-full flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                      isCurrent(project.path) && 'bg-muted',
                    )"
                    @click="selectProject(project.path, $event)"
                  >
                    <span class="flex min-w-0 items-center gap-2">
                      <span
                        class="relative flex size-3.5 shrink-0 items-center justify-center"
                        :title="statusLabel(project.path)"
                        :aria-label="statusLabel(project.path)"
                      >
                        <span
                          v-if="previewStatus(project.path) === 'live'"
                          class="absolute size-1.5 rounded-full bg-live/60 live-ping"
                        />
                        <span
                          :class="cn(
                            'relative size-1.5 rounded-full',
                            statusDotClass(project.path),
                          )"
                        />
                      </span>
                      <span class="min-w-0 flex-1 truncate text-xs font-regular text-muted-foreground">
                        {{ project.name }}
                      </span>
                    </span>
                    <span
                      class="truncate pl-5.5 font-mono text-[10.5px] text-muted-foreground/70"
                      :title="project.path"
                    >
                      {{ project.path }}
                    </span>
                  </button>
                </AppContextMenu>
              </li>
            </ul>
          </div>
          <div
            v-if="inactiveGroup.length > 0"
            :class="cn('flex flex-col gap-0.5', openGroup.length > 0 && 'mt-1.5')"
          >
            <p
              class="px-2 pb-1 pt-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/70"
            >
              {{ m.workspace_project_group_inactive() }}
            </p>
            <ul class="flex flex-col gap-0.5">
              <li v-for="project in inactiveGroup" :key="project.path">
                <AppContextMenu
                  :items="projectMenuItems()"
                  @action="onProjectMenuAction($event, project.path)"
                >
                  <button
                    type="button"
                    class="flex w-full flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                    @click="selectProject(project.path, $event)"
                  >
                    <span class="flex min-w-0 items-center gap-2">
                      <span
                        class="relative flex size-3.5 shrink-0 items-center justify-center"
                        :title="statusLabel(project.path)"
                        :aria-label="statusLabel(project.path)"
                      >
                        <span
                          :class="cn(
                            'relative size-1.5 rounded-full',
                            statusDotClass(project.path),
                          )"
                        />
                      </span>
                      <span class="min-w-0 flex-1 truncate text-xs font-regular text-muted-foreground">
                        {{ project.name }}
                      </span>
                    </span>
                    <span
                      class="truncate pl-5.5 font-mono text-[10.5px] text-muted-foreground/70"
                      :title="project.path"
                    >
                      {{ project.path }}
                    </span>
                  </button>
                </AppContextMenu>
              </li>
            </ul>
          </div>
        </template>
      </div>
    </PopoverContent>
  </Popover>
</template>
