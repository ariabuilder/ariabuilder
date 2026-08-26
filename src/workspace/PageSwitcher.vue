<script setup lang="ts">
import { computed, onUnmounted, ref, toRef, watch } from "vue"
import { toast } from "vue-sonner"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import ShortcutHint from "@/components/ui/ShortcutHint.vue"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useKeyboardShortcut } from "@/composables/useKeyboardShortcut"
import { useAppearance } from "@/composables/useAppearance"
import { useWorkspaceGitPanel } from "@/composables/useWorkspaceGitPanel"
import { useWorkspaceTerminal } from "@/composables/useWorkspaceTerminal"
import { COLOR_SCHEME_OPTIONS } from "@/lib/appearance/colorSchemeOptions"
import { THEME_OPTIONS } from "@/lib/appearance/themeRegistry"
import {
  searchProject,
  type GlobalSearchResult,
} from "@/lib/globalSearch"
import {
  AppShortcuts,
  ariaKeyShortcuts,
  formatShortcut,
} from "@/lib/keyboardShortcuts"
import { redoProjectHistory, undoProjectHistory } from "@/lib/history"
import { startSessionRuntime } from "@/lib/sessions"
import {
  createLayoutPropDrafts,
  loadRequiredLayoutProps,
  pageNameLayoutFallback,
  serializeLayoutPropDrafts,
  type LayoutPropDraftValue,
} from "@/lib/layoutProps"
import { cn } from "@/lib/utils"
import {
  createWorkspaceComponent,
  createWorkspaceLayout,
  createWorkspacePage,
} from "@/lib/workspace"
import { m } from "@/paraglide/messages.js"
import { guardDirtyNavigation } from "@/workspace/dirtyState"
import { useAgentPanel } from "@/workspace/agent"
import {
  requestCmsNavigation,
  requestPageDetailNavigation,
} from "@/workspace/globalSearchNavigation"
import { pageDisplayName } from "@/workspace/studio/pages/pagesDisplay"
import { StudioNameCreateDialog } from "@/workspace/studio/core"
import { requestComposerDocumentLaunch } from "@/workspace/composer/composerDocumentLaunchRequest"
import { createCmsEntryTemplateLaunch } from "@/workspace/composer/cmsEntryTemplatePreview"
import WorkspaceSwitcherDismissLayer from "@/workspace/WorkspaceSwitcherDismissLayer.vue"
import type {
  ScanPage,
  ScanComponent,
  WorkspaceActiveDocument,
  WorkspaceComposerCanvasTarget,
  WorkspaceRailId,
} from "@/workspace/types"
import type { ColorScheme, ThemeId } from "../../shared/appearance"
import type { PropField } from "../../shared/composer/types"

type CreateResult = {
  kind: "create"
  id: "create:page" | "create:component" | "create:layout"
  label: string
  entity: "page" | "component" | "layout"
}

type AppearanceResult =
  | {
      kind: "appearance"
      id: string
      label: string
      detail: string
      appearance: "theme"
      value: ThemeId
    }
  | {
      kind: "appearance"
      id: string
      label: string
      detail: string
      appearance: "scheme"
      value: ColorScheme
    }

type WorkspaceCommandResult = {
  kind: "command"
  id:
    | "command:open-terminal"
    | "command:open-git"
    | "command:open-history"
    | "command:undo"
    | "command:redo"
    | "command:start-preview"
  label: string
  detail: string
  command:
    | "open-terminal"
    | "open-git"
    | "open-history"
    | "undo"
    | "redo"
    | "start-preview"
}

type ComposerCanvasResult = {
  kind: "canvas"
  id: string
  label: string
  detail: string
  targetId: string
  documentKind: "component" | "layout"
  current?: boolean
}

type SwitcherResult =
  | GlobalSearchResult
  | CreateResult
  | AppearanceResult
  | WorkspaceCommandResult
  | ComposerCanvasResult
type SwitcherKind = SwitcherResult["kind"]
type ActiveDocumentResult = Extract<
  GlobalSearchResult,
  { kind: "component" | "layout" }
>

const props = defineProps<{
  projectPath: string
  pages: ScanPage[]
  components?: ScanComponent[]
  layouts?: ScanComponent[]
  selectedRoute: string | null
  currentRail: WorkspaceRailId
  activeDocument?: WorkspaceActiveDocument | null
  composerEditTrail?: WorkspaceActiveDocument[]
  composerCanvasTargets?: WorkspaceComposerCanvasTarget[]
  onComposerBreadcrumbSelect?: (index: number) => Promise<void> | void
  onOpenComposerCanvasTarget?: (id: string) => Promise<boolean> | boolean
  onSelect: (route: string) => Promise<void> | void
  onSelectRail: (rail: WorkspaceRailId) => Promise<void> | void
  onRefresh: () => Promise<void> | void
  disabled?: boolean
  onWillOpen?: () => void
}>()

const open = ref(false)
const query = ref("")
const searchResults = ref<GlobalSearchResult[]>([])
const loading = ref(false)
const resultAnnouncement = ref("")
const createOpen = ref(false)
const createEntity = ref<"page" | "component" | "layout">("page")
const createBusy = ref(false)
const createError = ref<string | null>(null)
const createLayoutFile = ref("")
const createLayoutFields = ref<PropField[]>([])
const createLayoutFieldValues = ref<Record<string, LayoutPropDraftValue>>({})
const createLayoutFieldsBusy = ref(false)
const createLayoutFieldsError = ref<string | null>(null)
let layoutFieldsGeneration = 0
let requestGeneration = 0
let searchTimer: ReturnType<typeof setTimeout> | null = null

const { settings, isLoading: appearanceLoading, updateAppearance } =
  useAppearance()
const { requestSettingsTab } = useAgentPanel()
const { openTerminal } = useWorkspaceTerminal(toRef(props, "projectPath"))
const { openGitPanel } = useWorkspaceGitPanel(toRef(props, "projectPath"))

const shortcutLabel = formatShortcut(AppShortcuts.pageSwitcher)
const shortcutAria = ariaKeyShortcuts(AppShortcuts.pageSwitcher)
const current = computed(
  () => props.pages.find((page) => page.route === props.selectedRoute) ?? null,
)
const isComposer = computed(() => props.currentRail === "composer")
const composerEditTrail = computed(() => props.composerEditTrail ?? [])
const composerLeaf = computed(() => composerEditTrail.value.at(-1) ?? null)
const composerLibrary = computed(() => {
  const kind = composerEditTrail.value[0]?.kind ?? props.activeDocument?.kind ?? "page"
  if (kind === "component") {
    return { label: "Components", rail: "components" as const }
  }
  if (kind === "layout") {
    return { label: "Layouts", rail: "layouts" as const }
  }
  return { label: "Pages", rail: "pages" as const }
})
const composerAncestors = computed(() => composerEditTrail.value.slice(0, -1))
const hiddenComposerAncestors = computed(() =>
  composerAncestors.value.length > 3
    ? composerAncestors.value.slice(1, -1)
    : [],
)
const visibleComposerAncestors = computed(() => {
  const ancestors = composerAncestors.value
  return ancestors.length > 3
    ? [ancestors[0]!, ancestors.at(-1)!]
    : ancestors
})
const activeNonPageDocument = computed(() => {
  const document = props.activeDocument
  return document && document.kind !== "page" ? document : null
})
const triggerLabel = computed(() =>
  isComposer.value && props.activeDocument
    ? props.activeDocument.name
    : isComposer.value && current.value
      ? pageDisplayName(current.value.file)
    : m.global_search_trigger(),
)

const composerCanvasResults = computed<ComposerCanvasResult[]>(() =>
  (props.composerCanvasTargets ?? []).map((target) => ({
    kind: "canvas",
    id: `canvas:${target.id}`,
    label: target.label,
    detail: target.detail,
    targetId: target.id,
    documentKind: target.kind,
    current: target.current,
  })),
)

const activeDocumentResult = computed<ActiveDocumentResult | null>(() => {
  const document = activeNonPageDocument.value
  if (!document) return null
  return {
    kind: document.kind,
    id: `active-document:${document.file}`,
    label: document.name,
    detail: document.file,
    file: document.file,
  }
})

const createResults = computed<CreateResult[]>(() => [
  {
    kind: "create",
    id: "create:page",
    label: m.global_search_create_page(),
    entity: "page",
  },
  {
    kind: "create",
    id: "create:component",
    label: m.global_search_create_component(),
    entity: "component",
  },
  {
    kind: "create",
    id: "create:layout",
    label: m.global_search_create_layout(),
    entity: "layout",
  },
])

const documentResults = computed<GlobalSearchResult[]>(() => [
  ...props.pages
    .map((page) => ({
      kind: "page" as const,
      id: `page:${page.file}`,
      label: page.title?.trim() || page.route,
      detail: page.file,
      route: page.route,
      file: page.file,
    })),
  ...(props.components ?? []).map((component) => ({
    kind: "component" as const,
    id: `component:${component.file}`,
    label: component.name,
    detail: component.file,
    file: component.file,
  })),
  ...(props.layouts ?? []).map((layout) => ({
    kind: "layout" as const,
    id: `layout:${layout.file}`,
    label: layout.name,
    detail: layout.file,
    file: layout.file,
  })),
])

const workspaceCommands = computed<WorkspaceCommandResult[]>(() => [
  {
    kind: "command",
    id: "command:open-terminal",
    label: m.global_search_open_terminal(),
    detail: formatShortcut(AppShortcuts.terminal),
    command: "open-terminal",
  },
  {
    kind: "command",
    id: "command:open-git",
    label: m.global_search_open_git_panel(),
    detail: formatShortcut(AppShortcuts.git),
    command: "open-git",
  },
  {
    kind: "command",
    id: "command:open-history",
    label: m.global_search_open_history(),
    detail: m.history_description(),
    command: "open-history",
  },
])

const searchedCommands = computed<WorkspaceCommandResult[]>(() => [
  ...workspaceCommands.value,
  {
    kind: "command",
    id: "command:undo",
    label: m.global_search_undo_studio_change(),
    detail: m.global_search_undo_studio_change_detail(),
    command: "undo",
  },
  {
    kind: "command",
    id: "command:redo",
    label: m.global_search_redo_studio_change(),
    detail: m.global_search_redo_studio_change_detail(),
    command: "redo",
  },
  {
    kind: "command",
    id: "command:start-preview",
    label: m.global_search_start_preview(),
    detail: m.global_search_start_preview_detail(),
    command: "start-preview",
  },
])

const appearanceResults = computed<AppearanceResult[]>(() => [
  ...THEME_OPTIONS.map(
    (theme): AppearanceResult => ({
      kind: "appearance",
      id: `appearance:theme:${theme.id}`,
      label: m.global_search_use_theme({ theme: theme.label }),
      detail:
        settings.value.themeId === theme.id
          ? m.global_search_current()
          : m.settings_appearance_theme_description(),
      appearance: "theme",
      value: theme.id,
    }),
  ),
  ...COLOR_SCHEME_OPTIONS.map(
    (mode): AppearanceResult => ({
      kind: "appearance",
      id: `appearance:scheme:${mode.value}`,
      label: m.global_search_use_color_mode({ mode: mode.label }),
      detail:
        settings.value.colorScheme === mode.value
          ? m.global_search_current()
          : m.settings_appearance_color_mode_description(),
      appearance: "scheme",
      value: mode.value,
    }),
  ),
])
const createLayoutOptions = computed(() => [
  { value: "", label: m.pages_create_layout_none() },
  ...(props.layouts ?? []).map((layout) => ({
    value: layout.file,
    label: layout.name,
  })),
])

watch(createLayoutFile, async (file) => {
  const generation = ++layoutFieldsGeneration
  createLayoutFields.value = []
  createLayoutFieldValues.value = {}
  createLayoutFieldsError.value = null
  if (!file || createEntity.value !== "page") return
  createLayoutFieldsBusy.value = true
  try {
    const fields = await loadRequiredLayoutProps(props.projectPath, file)
    if (generation !== layoutFieldsGeneration) return
    createLayoutFields.value = fields
    createLayoutFieldValues.value = createLayoutPropDrafts(fields)
    createLayoutFieldsError.value = serializeLayoutPropDrafts(
      fields,
      createLayoutFieldValues.value,
      { allowEmptyStrings: true },
    ).error
  } catch (error) {
    if (generation === layoutFieldsGeneration) {
      createLayoutFieldsError.value = error instanceof Error ? error.message : String(error)
    }
  } finally {
    if (generation === layoutFieldsGeneration) createLayoutFieldsBusy.value = false
  }
})

function updateCreateLayoutField(name: string, value: string | boolean) {
  createLayoutFieldValues.value = {
    ...createLayoutFieldValues.value,
    [name]: value,
  }
  createLayoutFieldsError.value = serializeLayoutPropDrafts(
    createLayoutFields.value,
    createLayoutFieldValues.value,
    { allowEmptyStrings: true },
  ).error
}

const allResults = computed<SwitcherResult[]>(() => [
  ...(isComposer.value
    ? composerCanvasResults.value.filter((result) => {
        const normalizedQuery = query.value.trim().toLocaleLowerCase()
        return !normalizedQuery
          || result.label.toLocaleLowerCase().includes(normalizedQuery)
          || result.detail.toLocaleLowerCase().includes(normalizedQuery)
      })
    : []),
  ...searchedCommands.value,
  ...searchResults.value.filter(
    (result) => result.kind !== "command" && result.id !== "destination:history",
  ),
  ...appearanceResults.value,
])

const visibleResults = computed(() => {
  const normalizedQuery = query.value.trim().toLocaleLowerCase()
  const active = activeDocumentResult.value
  const base = normalizedQuery
    ? allResults.value
    : [
        ...(isComposer.value ? composerCanvasResults.value : []),
        ...documentResults.value,
        ...workspaceCommands.value,
      ]
  if (!active) return base

  const withoutActiveDuplicate = base.filter(
    (result) =>
      !(
        (result.kind === "component" || result.kind === "layout") &&
        result.file === active.file
      ),
  )
  const activeMatches =
    !normalizedQuery ||
    active.label.toLocaleLowerCase().includes(normalizedQuery) ||
    active.detail.toLocaleLowerCase().includes(normalizedQuery)
  return activeMatches
    ? [active, ...withoutActiveDuplicate]
    : withoutActiveDuplicate
})

function isCurrentResult(result: SwitcherResult): boolean {
  if (result.kind === "canvas") return Boolean(result.current)
  const active = activeDocumentResult.value
  if (active) return result.id === active.id
  if (props.activeDocument?.kind === "page" && result.kind === "page") {
    return result.file === props.activeDocument.file
  }
  return result.kind === "page" && result.route === props.selectedRoute
}

const GROUPS: Array<{ kind: SwitcherKind; label: () => string }> = [
  { kind: "canvas", label: () => "On this canvas" },
  { kind: "page", label: () => m.global_search_group_pages() },
  { kind: "component", label: () => m.global_search_group_components() },
  { kind: "layout", label: () => m.global_search_group_layouts() },
  { kind: "collection", label: () => m.global_search_group_collections() },
  { kind: "entry", label: () => m.global_search_group_entries() },
  { kind: "media", label: () => m.global_search_group_media() },
  { kind: "destination", label: () => m.global_search_group_destinations() },
  { kind: "appearance", label: () => m.global_search_group_appearance() },
  { kind: "command", label: () => m.global_search_group_commands() },
]

const groups = computed(() => {
  const grouped = GROUPS.map((group) => ({
    ...group,
    results: visibleResults.value.filter((result) => result.kind === group.kind),
  })).filter((group) => group.results.length > 0)
  const activeKind = activeDocumentResult.value?.kind
  return activeKind && !isComposer.value
    ? grouped.sort(
        (a, b) => Number(b.kind === activeKind) - Number(a.kind === activeKind),
      )
    : grouped
})

function iconFor(result: SwitcherResult) {
  switch (result.kind) {
    case "canvas":
      return result.documentKind === "layout"
        ? ("layouts" as const)
        : ("components" as const)
    case "create":
      return result.entity === "page"
        ? ("pages" as const)
        : result.entity === "component"
          ? ("components" as const)
          : ("layouts" as const)
    case "appearance":
      if (result.appearance === "theme") return "design" as const
      return result.value === "light"
        ? ("themeSun" as const)
        : result.value === "dark"
          ? ("themeMoon" as const)
          : ("monitor" as const)
    case "page":
      return "pages" as const
    case "component":
      return "components" as const
    case "layout":
      return "layouts" as const
    case "collection":
    case "entry":
      return "collections" as const
    case "media":
      return "media" as const
    case "destination":
      return result.settingsTab === "history" ? "history" : result.rail
    case "command":
      if (result.command === "open-terminal") return "terminal" as const
      if (result.command === "open-git") return "gitBranch" as const
      if (result.command === "open-history") return "history" as const
      if (result.command === "start-preview") return "play" as const
      return result.command === "redo" ? ("redo" as const) : ("undo" as const)
  }
}

async function loadResults(nextQuery = query.value) {
  const generation = ++requestGeneration
  loading.value = true
  try {
    const response = await searchProject(props.projectPath, {
      query: nextQuery,
      limit: 80,
    })
    if (generation !== requestGeneration) return
    searchResults.value = response.results
    resultAnnouncement.value = m.global_search_result_count({
      count: String(visibleResults.value.length),
    })
  } catch (error) {
    if (generation !== requestGeneration) return
    searchResults.value = []
    toast.error(m.global_search_failed(), {
      description: error instanceof Error ? error.message : String(error),
    })
  } finally {
    if (generation === requestGeneration) loading.value = false
  }
}

function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchTimer = null
    void loadResults()
  }, 100)
}

function setOpen(next: boolean) {
  if (next && !open.value) {
    props.onWillOpen?.()
    void loadResults("")
  }
  open.value = next
  if (!next) {
    query.value = ""
    requestGeneration += 1
  }
}

async function openComposerLibrary() {
  try {
    if (!(await guardDirtyNavigation(props.projectPath))) return
    await props.onSelectRail(composerLibrary.value.rail)
  } catch (error) {
    toast.error(m.global_search_command_failed(), {
      description: error instanceof Error ? error.message : String(error),
    })
  }
}

async function selectComposerAncestor(entry: WorkspaceActiveDocument) {
  const index = composerEditTrail.value.indexOf(entry)
  if (index < 0) return
  await props.onComposerBreadcrumbSelect?.(index)
}

async function openCreate(entity: "page" | "component" | "layout") {
  try {
    if (!(await guardDirtyNavigation(props.projectPath))) return
  } catch (error) {
    toast.error(m.global_search_command_failed(), {
      description: error instanceof Error ? error.message : String(error),
    })
    return
  }
  setOpen(false)
  createEntity.value = entity
  createLayoutFile.value =
    entity === "page" && props.layouts?.length === 1
      ? props.layouts[0]!.file
      : ""
  createError.value = null
  createOpen.value = true
}

async function submitCreate(name: string) {
  createBusy.value = true
  createError.value = null
  try {
    const selectedLayout = (props.layouts ?? []).find(
      (candidate) => candidate.file === createLayoutFile.value,
    )
    const layoutProps = serializeLayoutPropDrafts(
      createLayoutFields.value,
      createLayoutFieldValues.value,
      { emptyStringFallback: pageNameLayoutFallback(name) },
    )
    if (createEntity.value === "page" && selectedLayout && layoutProps.error) {
      createError.value = layoutProps.error
      return
    }
    const created = createEntity.value === "page"
      ? await createWorkspacePage(props.projectPath, name, {
          layout: selectedLayout
            ? {
                name: selectedLayout.name,
                file: selectedLayout.file,
                props: layoutProps.props,
              }
            : null,
        })
      : createEntity.value === "layout"
        ? await createWorkspaceLayout(props.projectPath, name)
        : await createWorkspaceComponent(props.projectPath, name)
    await props.onRefresh()
    createOpen.value = false
    if (createEntity.value === "page" && "route" in created) {
      await props.onSelect(created.route)
    } else if (
      createEntity.value === "layout" &&
      "file" in created &&
      "name" in created
    ) {
      requestComposerDocumentLaunch({
        mode: "standalone-component",
        kind: "layout",
        name: created.name,
        file: created.file,
      }, props.projectPath)
      await props.onSelectRail("composer")
    }
  } catch (error) {
    createError.value = error instanceof Error ? error.message : String(error)
  } finally {
    createBusy.value = false
  }
}

async function activate(result: SwitcherResult) {
  if (result.kind === "canvas") {
    const opened = await props.onOpenComposerCanvasTarget?.(result.targetId)
    if (opened) setOpen(false)
    return
  }
  if (activeDocumentResult.value?.id === result.id) {
    setOpen(false)
    return
  }
  if (result.kind === "create") {
    await openCreate(result.entity)
    return
  }
  if (result.kind === "appearance") {
    if (appearanceLoading.value) return
    setOpen(false)
    if (result.appearance === "theme") {
      await updateAppearance({ themeId: result.value })
    } else {
      await updateAppearance({ colorScheme: result.value })
    }
    return
  }

  const requiresCleanWorkspace =
    result.kind !== "command" || result.command !== "start-preview"
  if (requiresCleanWorkspace) {
    try {
      if (!(await guardDirtyNavigation(props.projectPath))) return
    } catch (error) {
      toast.error(m.global_search_command_failed(), {
        description: error instanceof Error ? error.message : String(error),
      })
      return
    }
  }

  setOpen(false)
  if (result.kind === "page") {
    if (isComposer.value) {
      const page = props.pages.find((candidate) => candidate.file === result.file)
      if (page?.role === "cms-entry") {
        try {
          requestComposerDocumentLaunch(
            await createCmsEntryTemplateLaunch(props.projectPath, page),
            props.projectPath,
          )
          await props.onSelectRail("composer")
        } catch (error) {
          toast.error("Could not open entry template", {
            description: error instanceof Error ? error.message : String(error),
          })
        }
      } else {
        await props.onSelect(result.route)
      }
    } else {
      requestPageDetailNavigation(result.file)
      await props.onSelectRail("pages")
    }
    return
  }
  if (result.kind === "component") {
    if (isComposer.value) {
      requestComposerDocumentLaunch({
        mode: "standalone-component",
        kind: "component",
        name: result.label,
        file: result.file,
      }, props.projectPath)
      await props.onSelectRail("composer")
      return
    }
    await props.onSelectRail("components")
    return
  }
  if (result.kind === "layout") {
    if (isComposer.value) {
      requestComposerDocumentLaunch({
        mode: "standalone-component",
        kind: "layout",
        name: result.label,
        file: result.file,
      }, props.projectPath)
      await props.onSelectRail("composer")
      return
    }
    await props.onSelectRail("layouts")
    return
  }
  if (result.kind === "collection") {
    requestCmsNavigation({
      view: "detail",
      collectionName: result.collectionName,
      tab: "entries",
    })
    await props.onSelectRail("collections")
    return
  }
  if (result.kind === "entry") {
    requestCmsNavigation({
      view: "entry",
      collectionName: result.collectionName,
      entryIdOrSlug: result.entryId,
      locale: result.locale,
    })
    await props.onSelectRail("collections")
    return
  }
  if (result.kind === "media") {
    await props.onSelectRail("media")
    return
  }
  if (result.kind === "destination") {
    if (result.settingsTab) requestSettingsTab(result.settingsTab)
    await props.onSelectRail(result.rail)
    return
  }
  if (result.kind !== "command") return
  try {
    if (result.command === "open-terminal") openTerminal()
    else if (result.command === "open-git") openGitPanel()
    else if (result.command === "open-history") {
      requestSettingsTab("history")
      await props.onSelectRail("settings")
    } else if (result.command === "undo") await undoProjectHistory(props.projectPath)
    else if (result.command === "redo") await redoProjectHistory(props.projectPath)
    else await startSessionRuntime(props.projectPath)
  } catch (error) {
    toast.error(m.global_search_command_failed(), {
      description: error instanceof Error ? error.message : String(error),
    })
  }
}

function toggleFromShortcut() {
  if (props.disabled) return
  setOpen(!open.value)
}

useKeyboardShortcut(AppShortcuts.pageSwitcher, toggleFromShortcut, {
  enabled: computed(() => !props.disabled),
})

watch(query, scheduleSearch)
watch(
  () => props.projectPath,
  () => {
    if (open.value) void loadResults(query.value)
  },
)
onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
  requestGeneration += 1
})

defineExpose({
  open: () => setOpen(true),
  close: () => setOpen(false),
})
</script>

<template>
  <Teleport to="body">
    <WorkspaceSwitcherDismissLayer
      v-if="open"
      @dismiss="setOpen(false)"
    />
  </Teleport>

  <Popover :open="open" @update:open="setOpen">
    <nav
      v-if="isComposer && composerLeaf"
      class="flex min-w-0 max-w-[min(42vw,34rem)] items-center gap-0.5 overflow-hidden text-xs"
      aria-label="Composer location"
      data-aria-composer-edit-stack
    >
      <button
        type="button"
        class="shrink-0 rounded-sm px-1.5 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-[0.5px] focus-visible:ring-ring/70"
        @click="openComposerLibrary"
      >
        {{ composerLibrary.label }}
      </button>
      <span class="shrink-0 text-muted-foreground/40" aria-hidden="true">/</span>

      <template v-for="entry in visibleComposerAncestors" :key="entry.file">
        <button
          type="button"
          class="min-w-0 max-w-36 truncate rounded-sm px-1.5 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-[0.5px] focus-visible:ring-ring/70"
          @click="selectComposerAncestor(entry)"
        >
          {{ entry.name }}
        </button>
        <span class="shrink-0 text-muted-foreground/40" aria-hidden="true">/</span>

        <DropdownMenu
          v-if="entry === visibleComposerAncestors[0] && hiddenComposerAncestors.length"
        >
          <DropdownMenuTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              class="size-6! shrink-0 text-muted-foreground"
              aria-label="Show hidden locations"
            >
              <AppIcon name="moreHorizontal" :size="13" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-48">
            <DropdownMenuItem
              v-for="hiddenEntry in hiddenComposerAncestors"
              :key="hiddenEntry.file"
              @select="selectComposerAncestor(hiddenEntry)"
            >
              <AppIcon
                :name="hiddenEntry.kind === 'layout' ? 'layouts' : hiddenEntry.kind === 'component' ? 'components' : 'pages'"
                :size="14"
                aria-hidden="true"
              />
              <span class="truncate">{{ hiddenEntry.name }}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
          <span class="shrink-0 text-muted-foreground/40" aria-hidden="true">/</span>
        </DropdownMenu>
      </template>

      <PopoverTrigger as-child>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          :disabled="disabled"
          :title="`Quick Open: ${composerLeaf.name}`"
          :aria-label="`Quick Open from ${composerLeaf.name}`"
          :aria-keyshortcuts="shortcutAria"
          :aria-expanded="open"
          aria-haspopup="dialog"
          aria-current="page"
          class="relative min-w-0 max-w-44 gap-1.5 rounded-sm! px-1.5 text-xs font-medium text-foreground! focus-visible:ring-[0.5px] focus-visible:ring-ring/70"
        >
          <span class="truncate">{{ composerLeaf.name }}</span>
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
    </nav>

    <PopoverTrigger v-else as-child>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        :disabled="disabled"
        :title="activeNonPageDocument ? `Switch document: ${triggerLabel}` : m.workspace_page_switcher()"
        :aria-keyshortcuts="shortcutAria"
        class="relative max-w-52 gap-1.5 rounded-sm! px-1.5 text-xs font-regular text-muted-foreground! focus-visible:ring-[0.5px] focus-visible:ring-ring/70"
      >
        <span class="truncate">{{ triggerLabel }}</span>
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

    <PopoverContent align="start" class="w-80 p-2">
      <Command class="gap-2 rounded-none bg-transparent">
        <CommandInput
          v-model="query"
          auto-focus
          hide-icon
          :placeholder="m.global_search_placeholder()"
          :spellcheck="false"
          wrapper-class="h-auto border-0 p-0"
          class="h-8! rounded-sm! border border-input bg-input px-3 text-xs! text-muted-foreground! shadow-xs"
        />
        <p class="sr-only" role="status" aria-live="polite">
          {{ resultAnnouncement }}
        </p>
        <CommandList class="max-h-72 scroll-py-1 scrollbar-none [&::-webkit-scrollbar]:hidden">
          <CommandEmpty class="px-2 py-4 text-center text-xs text-muted-foreground">
            {{ loading ? m.global_search_loading() : m.global_search_empty({ query }) }}
          </CommandEmpty>
          <CommandGroup
            v-for="group in groups"
            :key="group.kind"
            :heading="group.label()"
            class="flex flex-col gap-0.5 p-0 [&_[data-slot=command-group-heading]]:px-2 [&_[data-slot=command-group-heading]]:pb-1 [&_[data-slot=command-group-heading]]:pt-1 [&_[data-slot=command-group-heading]]:text-[10.5px] [&_[data-slot=command-group-heading]]:font-medium [&_[data-slot=command-group-heading]]:uppercase [&_[data-slot=command-group-heading]]:tracking-wide [&_[data-slot=command-group-heading]]:text-muted-foreground/70"
          >
            <CommandItem
              v-for="result in group.results"
              :key="result.id"
              :value="result.id"
              :disabled="result.kind === 'appearance' && appearanceLoading"
              :class="cn(
                'min-h-10 cursor-pointer gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground data-[highlighted]:bg-muted! data-[highlighted]:text-foreground!',
                isCurrentResult(result) && 'bg-muted',
              )"
              @select="activate(result)"
            >
              <AppIcon
                :name="iconFor(result)"
                :size="15"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-xs">{{ result.label }}</span>
                <span
                  v-if="result.kind !== 'create'"
                  class="block truncate font-mono text-[10.5px] text-muted-foreground/70"
                >
                  {{ result.detail }}
                </span>
              </span>
              <AppIcon
                v-if="isCurrentResult(result)"
                name="checkLinear"
                :size="14"
                class="text-primary"
              />
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
      <div
        role="group"
        :aria-label="m.global_search_group_create()"
        class="-mx-2 -mb-2 mt-2 flex shrink-0 items-center gap-1 border-t border-dashed border-border px-4 py-2"
      >
        <span class="mr-auto text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground/70">
          {{ m.global_search_group_create() }}
        </span>
        <TooltipProvider>
          <Tooltip v-for="result in createResults" :key="result.id">
            <TooltipTrigger as-child>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                :aria-label="result.label"
                class="text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/70"
                @click="openCreate(result.entity)"
              >
                <AppIcon
                  :name="iconFor(result)"
                  :size="16"
                  aria-hidden="true"
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{{ result.label }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </PopoverContent>
  </Popover>

  <StudioNameCreateDialog
    v-model:open="createOpen"
    v-model:choice-model-value="createLayoutFile"
    :busy="createBusy"
    :error="createError"
    :title="createEntity === 'page' ? m.pages_create_title() : createEntity === 'layout' ? m.layouts_create_title() : m.components_create_title()"
    :description="createEntity === 'page' ? m.pages_create_description() : createEntity === 'layout' ? m.layouts_create_description() : m.components_create_description()"
    :placeholder="createEntity === 'page' ? m.pages_create_placeholder() : createEntity === 'layout' ? m.layouts_create_placeholder() : m.components_create_placeholder()"
    :cancel-label="createEntity === 'page' ? m.pages_create_cancel() : m.components_create_cancel()"
    :submit-label="createEntity === 'page' ? m.pages_create_submit() : createEntity === 'layout' ? m.layouts_create_submit() : m.components_create_submit()"
    :creating-label="createEntity === 'page' ? m.pages_create_creating() : createEntity === 'layout' ? m.layouts_create_creating() : m.components_create_creating()"
    :choice-label="createEntity === 'page' ? m.pages_create_layout_label() : undefined"
    :choice-options="createEntity === 'page' ? createLayoutOptions : undefined"
    :choice-fields="createEntity === 'page' ? createLayoutFields : undefined"
    :choice-field-values="createLayoutFieldValues"
    :choice-fields-busy="createLayoutFieldsBusy"
    :choice-fields-error="createEntity === 'page' ? createLayoutFieldsError : null"
    @update:choice-field-value="updateCreateLayoutField"
    @submit="submitCreate"
  />
</template>
