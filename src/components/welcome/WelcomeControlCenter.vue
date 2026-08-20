<script setup lang="ts">
import { computed, ref, watch } from "vue"
import AriaBadgeMark from "@/components/brand/AriaBadgeMark.vue"
import AppContextMenu from "@/components/menu/AppContextMenu.vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import type { RecentProject } from "@/lib/project"
import { formatRelativeTime } from "@/lib/relativeTime"
import type { ProjectRuntimeSession } from "@/lib/sessions"
import { getProjectThumb } from "@/lib/thumbs"
import { recentProjectMenuItems } from "@/menu/recent-project"
import { m } from "@/paraglide/messages.js"

const props = defineProps<{
  continueProject: RecentProject | null
  otherRecents: RecentProject[]
  sessions: ProjectRuntimeSession[]
  error?: string | null
}>()

const emit = defineEmits<{
  open: [projectPath: string]
  createNew: []
  openExisting: []
  recentAction: [id: string, recent: RecentProject]
}>()

const thumbByPath = ref<Record<string, string | null>>({})

function samePath(a: string, b: string) {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "")
  return norm(a) === norm(b)
}

function findSession(projectPath: string) {
  return props.sessions.find((s) => samePath(s.path, projectPath))
}

function onContinueAction(id: string) {
  if (!props.continueProject) return
  emit("recentAction", id, props.continueProject)
}

function recentStatus(recent: RecentProject) {
  const runtime = findSession(recent.path)
  if (!runtime) return null
  // Badge tracks preview server state — not merely that the workspace is kept alive.
  if (runtime.live || runtime.status === "live") return "live" as const
  if (
    runtime.status === "starting" ||
    runtime.status === "installing" ||
    runtime.status === "stopping"
  ) {
    return "active" as const
  }
  return null
}

function recentSubtitle(recent: RecentProject): string {
  const runtime = findSession(recent.path)
  if (runtime?.live && runtime.previewUrl) return runtime.previewUrl
  return recent.path
}

function openedLabel(recent: RecentProject): string {
  return formatRelativeTime(recent.openedAt)
}

function thumbFor(path: string): string | null {
  return thumbByPath.value[path] ?? null
}

async function loadThumbs(paths: string[]) {
  const unique = [...new Set(paths.filter(Boolean))]
  await Promise.all(
    unique.map(async (projectPath) => {
      try {
        const result = await getProjectThumb(projectPath)
        if (!result?.dataUrl) return
        thumbByPath.value = {
          ...thumbByPath.value,
          [projectPath]: result.dataUrl,
        }
      } catch {
        /* keep previous thumb if any */
      }
    }),
  )
}

const continueStatus = computed(() =>
  props.continueProject ? recentStatus(props.continueProject) : null,
)
const displayedRecents = computed(() => props.otherRecents.slice(0, 3))

watch(
  () =>
    [
      ...(props.continueProject ? [props.continueProject.path] : []),
      ...displayedRecents.value.map((r) => r.path),
    ] as const,
  (paths) => {
    void loadThumbs([...paths])
  },
  { immediate: true },
)
</script>

<template>
  <main class="relative z-10 flex min-h-0 flex-1 overflow-hidden">
    <div
      :class="[
        'grid w-full grid-cols-1 sm:min-h-full sm:grid-cols-2',
        continueProject ? '' : 'min-h-full',
      ]"
    >
      <section class="flex min-w-0 flex-col px-7 pt-12 pb-10 sm:px-7 sm:pt-14 sm:pb-12 lg:min-h-0 lg:px-7 lg:pt-14 lg:pb-0">
        <AriaBadgeMark class="h-10 w-auto shrink-0 self-start select-none sm:h-10" />

        <div class="flex flex-1 items-center py-10 sm:py-14 lg:py-12 lg:ps-[12%] xl:ps-[20%] select-none">
          <div class="w-full max-w-xl">
            <h1 class="m-0 text-3xl leading-[1.08] font-regular tracking-tight text-balance sm:text-4xl xl:text-5xl">
              {{ continueProject ? m.welcome_returning_heading() : m.welcome_first_heading() }} 
              {{ m.brand_name() }}
            </h1>
            <p class="mt-3 max-w-lg text-sm leading-relaxed text-balance text-muted-foreground sm:text-base xl:text-md">
              {{
                continueProject
                  ? m.welcome_returning_description()
                  : m.welcome_first_description()
              }}
            </p>

            <div class="mt-10 grid w-full gap-3 sm:mt-10 sm:flex sm:flex-wrap sm:items-center">
              <Button
                type="button"
                size="sm"
                class="h-11 w-full sm:h-9 sm:w-auto cursor-pointer"
                @click="emit('createNew')"
              >
                <AppIcon name="plus" :size="14" :stroke-width="1.5" aria-hidden="true" />
                {{ m.welcome_new_project() }}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                class="h-11 w-full sm:h-9 sm:w-auto cursor-pointer"
                @click="emit('openExisting')"
              >
                <AppIcon name="folderOpen" :size="14" :stroke-width="1.5" aria-hidden="true" />
                {{ m.welcome_open_existing() }}
              </Button>
            </div>

            <p v-if="error" role="alert" class="mt-4 max-w-lg text-sm text-destructive">
              {{ error }}
            </p>
          </div>
        </div>
      </section>

      <section
        v-if="continueProject"
        class="flex min-w-0 items-start overflow-hidden px-4 pt-2 pb-8 sm:items-center sm:px-4 sm:py-4 lg:px-8 lg:pe-[12%] xl:pe-[20%] min-[120rem]:py-10 select-none"
        :aria-label="m.welcome_recents_title()"
      >
        <div class="mx-auto flex max-h-full w-full max-w-3xl flex-col gap-10 min-[120rem]:gap-12">
          <section class="min-w-0">
            <h2 class="mb-3 ml-1 text-xs font-normal tracking-wide text-muted-foreground uppercase">
              {{ m.welcome_continue_working() }}
            </h2>
            <AppContextMenu
              :items="recentProjectMenuItems(continueProject, {
                sessionOpen: Boolean(findSession(continueProject.path)),
              })"
              @action="onContinueAction"
            >
              <button
                type="button"
                :title="continueProject.path"
                class="group grid min-h-56 w-full cursor-pointer grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.2fr)] overflow-hidden rounded-md border-dashed border border-border bg-background text-left transition-[background-color,transform] duration-100 hover:bg-background/90 lg:grid-cols-[minmax(9rem,0.8fr)_minmax(0,1.2fr)] min-[120rem]:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.2fr)] hover:border-primary p-2"
                @click="emit('open', continueProject.path)"
              >
                <span class="flex min-w-0 flex-col justify-between gap-4 p-2 sm:gap-4 sm:p-2 md:gap-6 lg:gap-2 xl:gap-6">
                  <span class="min-w-0 space-y-3">
                    <span class="block truncate text-xl font-regular sm:text-2xl">
                      {{ continueProject.name }}
                    </span>
                    <span
                      v-if="continueStatus"
                      class="inline-flex w-fit items-center gap-1.5 rounded-sm bg-primary/60 dark:bg-primary/80 px-1.5 py-0.5 text-3xs font-medium tracking-wide text-primary-foreground uppercase border border-primary-foreground/20 shadow-xs backdrop-blur-xs"
                    >

                    <span class="size-1.5 rounded-full bg-live" aria-hidden="true" />
                      {{ 
                        continueStatus === "live"
                          ? m.welcome_session_live()
                          : m.welcome_session_active()
                      }}
                    </span>
                  </span>
                  <span class="min-w-0 space-y-2">
                    <span
                      v-if="openedLabel(continueProject)"
                      class="block truncate text-xs text-muted-foreground"
                    >
                      {{ openedLabel(continueProject) }}
                    </span>
                    <span class="block truncate font-mono text-3xs text-muted-foreground/75 line-clamp-1">
                      {{ recentSubtitle(continueProject) }}
                    </span>
                  </span>
                </span>

                <span class="relative flex min-h-full items-center justify-center overflow-hidden border-s bg-sidebar/70 group-hover:bg-sidebar/80 rounded-md border border-border">
                  <img
                    v-if="thumbFor(continueProject.path)"
                    :src="thumbFor(continueProject.path)!"
                    alt=""
                    class="absolute inset-0 size-full object-cover object-top"
                  />
                  <AppIcon
                    v-else
                    name="folder"
                    :size="36"
                    class="text-muted-foreground/45"
                    :stroke-width="1.25"
                    aria-hidden="true"
                  />
                </span>
              </button>
            </AppContextMenu>
          </section>

          <section v-if="displayedRecents.length > 0" class="hidden min-w-0 sm:block">
            <h2 class="mb-3 ml-1 text-xs font-normal tracking-wide text-muted-foreground uppercase">
              {{ m.welcome_recents_title() }}
            </h2>
            <div class="grid grid-cols-3 gap-2 lg:gap-3">
              <AppContextMenu
                v-for="r in displayedRecents"
                :key="r.path"
                class="min-w-0"
                :items="recentProjectMenuItems(r, {
                  sessionOpen: Boolean(findSession(r.path)),
                })"
                @action="(id) => emit('recentAction', id, r)"
              >
                <button
                  type="button"
                  :title="r.path"
                  class="group relative block h-full w-full cursor-pointer rounded-md border-dashed border border-border/70 bg-background p-1 text-left transition-[background-color,transform] duration-100 hover:bg-background/90 hover:border-primary"
                  @click="emit('open', r.path)"
                >
                  <span
                    v-if="recentStatus(r)"
                    class="absolute top-2 inset-e-2 z-10 inline-flex items-center gap-1 rounded-sm bg-primary/60 dark:bg-primary/80 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-primary-foreground uppercase border border-primary-foreground/20 shadow-xs backdrop-blur-xs"
                  >
                    <span class="size-1.5 rounded-full bg-live" aria-hidden="true" />
                    {{
                      recentStatus(r) === "live"
                        ? m.welcome_session_live()
                        : m.welcome_session_active()
                    }}
                  </span>
                  <span class="relative mb-2 flex aspect-video w-full items-center justify-center overflow-hidden rounded-sm bg-foreground/4">
                    <img
                      v-if="thumbFor(r.path)"
                      :src="thumbFor(r.path)!"
                      alt=""
                      class="absolute inset-0 size-full object-cover object-top"
                    />
                    <AppIcon
                      v-else
                      name="folder"
                      :size="24"
                      class="text-muted-foreground/50"
                      :stroke-width="1.25"
                      aria-hidden="true"
                    />
                  </span>
                  <span class="block min-w-0">
                    <span class="mx-1.5 block truncate text-sm">
                      {{ r.name }}
                    </span>
                    <span
                      v-if="openedLabel(r)"
                      class="mx-1.5 mt-1 pb-2 block truncate text-3xs text-muted-foreground/80"
                    >
                      {{ openedLabel(r) }}
                    </span>
                  </span>
                </button>
              </AppContextMenu>
            </div>
          </section>
        </div>
      </section>
    </div>
  </main>
</template>
