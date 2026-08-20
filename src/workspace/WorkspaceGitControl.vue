<script setup lang="ts">
import { computed, nextTick, ref, toRef, watch } from "vue"
import GitCommitForm from "@/components/git/GitCommitForm.vue"
import GitStatsRow from "@/components/git/GitStatsRow.vue"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import ShortcutHint from "@/components/ui/ShortcutHint.vue"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useGitWorkspace } from "@/composables/useGitWorkspace"
import { useWorkspaceGitPanel } from "@/composables/useWorkspaceGitPanel"
import { useKeyboardShortcut } from "@/composables/useKeyboardShortcut"
import {
  AppShortcuts,
  ariaKeyShortcuts,
  formatShortcut,
} from "@/lib/keyboardShortcuts"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"

const props = defineProps<{
  projectPath: string
  shortcutActive?: boolean
}>()

const { open } = useWorkspaceGitPanel(toRef(props, "projectPath"))
const branchMenuOpen = ref(false)
const showCreateBranch = ref(false)
const createInput = ref<{ focus: () => void } | null>(null)

const {
  status,
  branches,
  loading,
  message,
  committing,
  pushing,
  switching,
  creating,
  initializing,
  busy,
  actionError,
  newBranchName,
  dirtyFiles,
  canPush,
  page,
  diffPath,
  diffText,
  diffBinary,
  diffTruncated,
  diffLoading,
  diffError,
  refresh,
  onCommit,
  onPush,
  onInit,
  onCheckout,
  onCreateBranch,
  openChanges,
  closeChanges,
  openDiff,
  closeDiff,
  resetDiffOnClose,
} = useGitWorkspace(toRef(props, "projectPath"))

const tooltipLabel = computed(() => {
  if (status.value?.isRepo && status.value.branch) return status.value.branch
  return m.rail_git()
})

const branchLabel = computed(() => {
  if (!status.value?.isRepo) return m.rail_git()
  return status.value.branch ?? "HEAD"
})

const statusDotClass = computed(() => {
  if (!status.value?.isRepo) return "bg-muted-foreground/40"
  return status.value.dirty ? "bg-amber-500" : "bg-emerald-500"
})

const canCreateBranch = computed(
  () => newBranchName.value.trim().length > 0 && !busy.value,
)

const slidePage = computed(() => {
  if (page.value === "3") return "3"
  if (page.value === "2") return "2"
  return "1"
})

const changeCount = computed(() => dirtyFiles.value.length)

const canSwitchBranch = computed(
  () =>
    Boolean(status.value?.isRepo) &&
    !busy.value &&
    !switching.value &&
    !loading.value,
)

function onOpenChange(next: boolean) {
  open.value = next
  if (next) {
    void refresh()
    return
  }
  branchMenuOpen.value = false
  cancelCreateBranch()
  resetDiffOnClose()
}

useKeyboardShortcut(
  AppShortcuts.git,
  () => onOpenChange(!open.value),
  { enabled: computed(() => props.shortcutActive !== false) },
)

function onBranchMenuOpenChange(next: boolean) {
  branchMenuOpen.value = next
  if (!next) cancelCreateBranch()
}

watch(page, (p) => {
  if (p !== "1") {
    branchMenuOpen.value = false
    cancelCreateBranch()
  }
})

function cancelCreateBranch() {
  showCreateBranch.value = false
  newBranchName.value = ""
}

async function startCreateBranch() {
  showCreateBranch.value = true
  newBranchName.value = ""
  await nextTick()
  createInput.value?.focus()
}

async function selectBranch(branch: string) {
  if (!canSwitchBranch.value) return
  if (branch === status.value?.branch) {
    branchMenuOpen.value = false
    return
  }
  branchMenuOpen.value = false
  await onCheckout(branch)
}

async function confirmCreateBranch() {
  if (!canCreateBranch.value) return
  await onCreateBranch()
  if (!actionError.value) {
    cancelCreateBranch()
    branchMenuOpen.value = false
  }
}
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
              :aria-label="tooltipLabel"
              :aria-keyshortcuts="ariaKeyShortcuts(AppShortcuts.git)"
              :aria-busy="busy || undefined"
              :aria-expanded="open"
            >
              <Spinner v-if="busy" class="size-4 pr-1" />
              <AppIcon v-else name="gitBranch" :size="16" class="shrink-0 mt-0.5" />
              <span
                v-if="!busy"
                class="pointer-events-none absolute right-[7.5px] top-[8.5px] size-1.25 rounded-full"
                :class="statusDotClass"
                aria-hidden
              />
              <ShortcutHint
                class="pointer-events-none absolute left-[calc(100%+0.5rem)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap border-border bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground shadow-md"
              >
                {{ formatShortcut(AppShortcuts.git) }}
              </ShortcutHint>
            </Button>
          </PopoverTrigger>

          <PopoverContent
            side="right"
            align="start"
            :side-offset="14"
            :collision-padding="12"
            class="w-80 max-w-80 overflow-hidden"
          >
            <div class="t-page-slide relative h-80" :data-page="slidePage">
              <!-- 1 · Overview -->
              <section
                class="t-page flex h-full flex-col gap-3 overflow-hidden p-2"
                data-page-id="1"
                :data-active="slidePage === '1' ? '' : undefined"
              >
                <div class="flex items-center justify-between gap-2">
                  <Popover
                    v-if="status?.isRepo"
                    :open="branchMenuOpen"
                    @update:open="onBranchMenuOpenChange"
                  >
                    <PopoverTrigger as-child>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        class="max-w-55 gap-1.5 px-1 text-xs! font-regular text-foreground! rounded-sm! hover:bg-muted"
                        :disabled="!canSwitchBranch"
                        :aria-busy="switching || undefined"
                        :aria-label="m.rail_git_branches()"
                      >
                        <span class="relative inline-flex shrink-0">
                          <AppIcon name="gitBranch" :size="15" />
                          <span
                            class="pointer-events-none absolute right-0 top-0 size-1.25 rounded-full"
                            :class="statusDotClass"
                            aria-hidden
                          />
                        </span>
                        <span class="min-w-0 truncate font-mono">
                          {{ branchLabel }}
                        </span>
                        <AppIcon
                          name="chevronDown"
                          :size="12"
                          class="shrink-0 opacity-60"
                        />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      :side-offset="6"
                      class="z-60 flex w-60 flex-col gap-2 p-2"
                    >
                      <div
                        v-if="showCreateBranch"
                        class="flex items-center gap-1.5"
                      >
                        <Input
                          ref="createInput"
                          v-model="newBranchName"
                          :placeholder="m.rail_git_create_branch_placeholder()"
                          class="h-8 font-mono text-xs"
                          :disabled="busy"
                          @keydown.enter.prevent="confirmCreateBranch"
                          @keydown.escape.prevent="cancelCreateBranch"
                        />
                        <Button
                          type="button"
                          size="icon-sm"
                          :disabled="!canCreateBranch"
                          :aria-label="m.rail_git_create_confirm()"
                          :aria-busy="creating || undefined"
                          @click="confirmCreateBranch"
                        >
                          <Spinner v-if="creating" />
                          <AppIcon v-else name="checkLinear" :size="14" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          :disabled="creating"
                          :aria-label="m.rail_git_back()"
                          @click="cancelCreateBranch"
                        >
                          <AppIcon name="close" :size="14" />
                        </Button>
                      </div>
                      <template v-else>
                        <div class="max-h-48 overflow-y-auto">
                          <ul class="flex flex-col gap-0.5">
                            <li v-for="branch in branches" :key="branch">
                              <button
                                type="button"
                                :class="
                                  cn(
                                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                                    branch === status.branch && 'bg-muted',
                                  )
                                "
                                :disabled="switching"
                                @click="selectBranch(branch)"
                              >
                                <AppIcon
                                  name="gitBranch"
                                  :size="12"
                                  class="shrink-0 opacity-60"
                                />
                                <span class="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                                  {{ branch }}
                                </span>
                                <AppIcon
                                  v-if="branch === status.branch"
                                  name="checkLinear"
                                  :size="12"
                                  class="shrink-0 text-primary"
                                />
                              </button>
                            </li>
                          </ul>
                        </div>
                        <Separator class="opacity-60" />
                        <button
                          type="button"
                          class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                          :disabled="busy"
                          @click="startCreateBranch"
                        >
                          <AppIcon name="plus" :size="12" class="opacity-60" />
                          <span class="text-muted-foreground">
                            {{ m.rail_git_create_branch() }}
                          </span>
                        </button>
                      </template>
                    </PopoverContent>
                  </Popover>

                  <div
                    v-else
                    class="flex min-w-0 items-center gap-2 px-1.5"
                  >
                    <span class="relative inline-flex shrink-0 text-foreground">
                      <AppIcon name="gitBranch" :size="15" />
                      <span
                        class="pointer-events-none absolute -right-0.5 -top-0.5 size-1.5 rounded-full"
                        :class="statusDotClass"
                        aria-hidden
                      />
                    </span>
                    <span class="truncate font-mono text-xs font-medium">
                      {{ branchLabel }}
                    </span>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    class="shrink-0"
                    :disabled="loading || busy"
                    :aria-label="m.control_room_git_refresh()"
                    @click="refresh"
                  >
                    <Spinner v-if="loading" />
                    <AppIcon v-else name="refresh" :size="12" />
                  </Button>
                </div>

                <div
                  v-if="loading && !status"
                  class="flex flex-1 items-center justify-center text-xs text-muted-foreground"
                >
                  <Spinner class="size-4" />
                </div>

                <template v-else-if="status && !status.isRepo">
                  <div
                    class="flex flex-1 flex-col items-center justify-center gap-3 text-center"
                  >
                    <p class="text-xs text-muted-foreground">
                      {{ m.rail_git_not_repo() }}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      class="gap-1.5 cursor-pointer"
                      :disabled="busy"
                      :aria-label="m.rail_git_init_aria()"
                      :aria-busy="initializing || undefined"
                      @click="onInit"
                    >
                      <Spinner v-if="initializing" />
                      <AppIcon v-else name="plus" :size="14" />
                      {{ m.rail_git_init() }}
                    </Button>
                  </div>
                </template>

                <template v-else-if="status">
                  <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden select-none">
                    <GitStatsRow
                      :staged="status.staged.length"
                      :unstaged="status.unstaged.length"
                      :untracked="status.untracked.length"
                      :staged-label="m.control_room_git_staged()"
                      :unstaged-label="m.control_room_git_unstaged()"
                      :untracked-label="m.control_room_git_untracked()"
                    />

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      class="w-full justify-between gap-2 cursor-pointer"
                      :disabled="changeCount === 0"
                      @click="openChanges"
                    >
                      <span>{{ m.rail_git_view_changes() }}</span>
                      <span class="flex items-center gap-1.5 text-muted-foreground">
                        <span
                          v-if="changeCount > 0"
                          class="tabular-nums text-xs"
                        >
                          {{ changeCount }}
                        </span>
                        <AppIcon name="chevronRight" :size="14" />
                      </span>
                    </Button>

                    <div class="mt-auto flex flex-col gap-3">
                      <GitCommitForm
                        v-model="message"
                        compact
                        :label="m.control_room_git_message()"
                        :placeholder="m.control_room_git_message_placeholder()"
                        :commit-label="m.control_room_git_commit()"
                        :committing-label="m.control_room_git_committing()"
                        :disabled="
                          !status.dirty ||
                          loading ||
                          pushing ||
                          switching ||
                          creating ||
                          initializing
                        "
                        :busy="committing"
                        @commit="onCommit"
                      >
                        <Button
                          type="button"
                          size="sm"
                          :disabled="!canPush"
                          :aria-busy="pushing || undefined"
                          @click="onPush"
                        >
                          <Spinner v-if="pushing" />
                          {{
                            pushing
                              ? m.control_room_git_pushing()
                              : m.control_room_git_push()
                          }}
                        </Button>
                      </GitCommitForm>
                    </div>
                  </div>
                </template>

                <Alert
                  v-if="actionError"
                  variant="destructive"
                  class="shrink-0 py-2"
                >
                  <AlertDescription
                    class="font-mono text-[11px] whitespace-pre-wrap"
                  >
                    {{ actionError }}
                  </AlertDescription>
                </Alert>
              </section>

              <!-- 2 · Change list -->
              <section
                class="t-page flex h-full flex-col gap-2 overflow-hidden p-3"
                data-page-id="2"
                :data-active="slidePage === '2' ? '' : undefined"
              >
                <div class="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="m.rail_git_back()"
                    @click="closeChanges"
                  >
                    <AppIcon name="arrowLeft" :size="14" />
                  </Button>
                  <span class="min-w-0 truncate text-xs font-medium">
                    {{ m.rail_git_view_changes() }}
                  </span>
                  <span
                    v-if="changeCount > 0"
                    class="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground"
                  >
                    {{ changeCount }}
                  </span>
                </div>

                <p
                  v-if="dirtyFiles.length === 0"
                  class="px-1 text-xs text-muted-foreground"
                >
                  {{ m.control_room_git_no_changes() }}
                </p>
                <ul
                  v-else
                  class="min-h-0 flex-1 overflow-auto border border-dashed border-border"
                >
                  <li
                    v-for="(file, index) in dirtyFiles"
                    :key="`${file.code}:${file.path}`"
                    class="flex flex-col"
                  >
                    <button
                      type="button"
                      class="flex w-full items-baseline gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                      @click="openDiff(file.path)"
                    >
                      <span
                        class="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums"
                      >
                        {{ file.code }}
                      </span>
                      <span class="min-w-0 truncate font-mono text-xs">
                        {{ file.path }}
                      </span>
                      <AppIcon
                        name="chevronRight"
                        :size="12"
                        class="ml-auto shrink-0 text-muted-foreground"
                      />
                    </button>
                    <Separator
                      v-if="index < dirtyFiles.length - 1"
                      class="opacity-50"
                    />
                  </li>
                </ul>
              </section>

              <!-- 3 · File diff -->
              <section
                class="t-page flex h-full flex-col gap-2 overflow-hidden p-3"
                data-page-id="3"
                :data-active="slidePage === '3' ? '' : undefined"
              >
                <div class="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="m.rail_git_back()"
                    @click="closeDiff"
                  >
                    <AppIcon name="arrowLeft" :size="14" />
                  </Button>
                  <span class="min-w-0 truncate font-mono text-xs">
                    {{ diffPath }}
                  </span>
                </div>

                <div
                  class="min-h-0 flex-1 overflow-auto rounded-sm border border-dashed border-border bg-muted/30 p-2"
                >
                  <p
                    v-if="diffLoading"
                    class="text-xs text-muted-foreground"
                  >
                    {{ m.rail_git_diff_loading() }}
                  </p>
                  <p
                    v-else-if="diffError"
                    class="text-xs text-destructive"
                  >
                    {{ diffError || m.rail_git_diff_error() }}
                  </p>
                  <p
                    v-else-if="diffBinary"
                    class="text-xs text-muted-foreground"
                  >
                    {{ m.rail_git_binary_file() }}
                  </p>
                  <template v-else>
                    <p
                      v-if="diffTruncated"
                      class="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground"
                    >
                      {{ m.rail_git_diff_truncated() }}
                    </p>
                    <pre
                      v-if="diffText"
                      class="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground/90"
                    >{{ diffText }}</pre>
                    <p
                      v-else
                      class="text-xs text-muted-foreground"
                    >
                      {{ m.rail_git_diff_empty() }}
                    </p>
                  </template>
                </div>
              </section>
            </div>
          </PopoverContent>
        </Popover>
      </span>
    </TooltipTrigger>
    <TooltipContent side="right" :side-offset="8">
      {{ tooltipLabel }}
    </TooltipContent>
  </Tooltip>
</template>
