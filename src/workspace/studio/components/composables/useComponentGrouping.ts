import { computed, watch, type ComputedRef, type Ref } from "vue"
import {
  createStudioGroupingEngine,
  type StudioGroupingGroup,
  type StudioGroupingState,
} from "@/workspace/studio/core"
import {
  getComponentGrouping,
  updateComponentGrouping,
  type ComponentFolderMutationResult,
  type ComponentGroupingState,
} from "@/lib/workspace"
import type { ComponentGroup } from "@/types/aria"
import type { ScanComponent } from "@/workspace/types"

export type { ComponentGroup }

export interface GroupableComponent {
  id: string
  name?: string
  category?: string
}

export interface GroupedComponentsSection<TItem extends GroupableComponent> {
  key: string
  name: string
  items: TItem[]
  isCustomGroup: boolean
  groupId?: string
}

/** Stable id prefix for groups derived from folders under src/components. */
export const COMPONENT_FOLDER_GROUP_PREFIX = "folder:" as const

export function isFolderDerivedGroupId(groupId: string): boolean {
  return groupId.startsWith(COMPONENT_FOLDER_GROUP_PREFIX)
}

export function folderGroupIdForPath(folderPath: string): string {
  return `${COMPONENT_FOLDER_GROUP_PREFIX}${folderPath}`
}

export function folderPathFromGroupId(groupId: string): string | null {
  if (!isFolderDerivedGroupId(groupId)) return null
  const path = groupId.slice(COMPONENT_FOLDER_GROUP_PREFIX.length).trim()
  return path.length > 0 ? path : null
}

function parseComponentGroupingState(
  value: unknown,
): ComponentGroupingState | null {
  if (!value || typeof value !== "object") return null
  const o = value as Record<string, unknown>
  if (!Array.isArray(o.groups)) return null
  if (
    !o.assignments ||
    typeof o.assignments !== "object" ||
    Array.isArray(o.assignments)
  ) {
    return null
  }

  const groups: ComponentGroup[] = []
  for (const item of o.groups) {
    if (!item || typeof item !== "object") return null
    const g = item as Record<string, unknown>
    if (typeof g.id !== "string" || typeof g.name !== "string") return null
    const id = g.id.trim()
    const name = g.name.trim()
    if (!id || !name) return null
    groups.push({ id, name })
  }

  const assignments: Record<string, string> = {}
  for (const [key, val] of Object.entries(
    o.assignments as Record<string, unknown>,
  )) {
    if (typeof val !== "string") return null
    assignments[key] = val
  }

  return { groups, assignments }
}

const ComponentGroupingStateSchema = {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: ComponentGroupingState }
    | { success: false } {
    const data = parseComponentGroupingState(value)
    return data ? { success: true, data } : { success: false }
  },
  parse(value: unknown): ComponentGroupingState {
    const data = parseComponentGroupingState(value)
    if (!data) throw new Error("Invalid component grouping state")
    return data
  },
}

function byDisplayName(a: GroupableComponent, b: GroupableComponent): number {
  return (a.name || a.id || "").localeCompare(b.name || b.id || "")
}

function normalizeGroupName(name: string): string {
  return name.trim()
}

/** Drop OSS-era auto presets (`preset-*`) so the rail starts empty of legacy junk. */
function isLegacyPresetGroup(group: ComponentGroup): boolean {
  return group.id.startsWith("preset-")
}

/** Soft-only groups — folder groups are derived live from the scan. */
function isPersistedSoftGroup(group: ComponentGroup): boolean {
  return !isLegacyPresetGroup(group) && !isFolderDerivedGroupId(group.id)
}

function folderPathForComponent(item: GroupableComponent): string | null {
  const folder = item.category?.trim()
  return folder && folder.length > 0 ? folder : null
}

function deriveFolderGroups(
  sourceItems: readonly GroupableComponent[],
): ComponentGroup[] {
  const byPath = new Map<string, ComponentGroup>()
  for (const item of sourceItems) {
    const folderPath = folderPathForComponent(item)
    if (!folderPath) continue
    const id = folderGroupIdForPath(folderPath)
    if (!byPath.has(id)) {
      byPath.set(id, { id, name: folderPath })
    }
  }
  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function sortGroups(groups: readonly ComponentGroup[]): ComponentGroup[] {
  return [...groups].sort((a, b) => a.name.localeCompare(b.name))
}

type GroupingEngine = ReturnType<
  typeof createStudioGroupingEngine<
    ComponentGroup,
    ComponentGroupingState & StudioGroupingState<StudioGroupingGroup>
  >
>

const enginesByProject = new Map<string, GroupingEngine>()

function normalizeLoadedState(
  raw: ComponentGroupingState,
): ComponentGroupingState {
  // Persist soft groups only; folder groups are derived from the filesystem scan.
  const normalizedGroups = [...raw.groups]
    .filter(isPersistedSoftGroup)
    .map((group) => ({ ...group, name: normalizeGroupName(group.name) }))
    .filter((group) => group.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  const validGroupIds = new Set(normalizedGroups.map((group) => group.id))
  const assignments: Record<string, string> = {}

  for (const [componentId, groupId] of Object.entries(raw.assignments)) {
    // Keep overrides that still point at soft groups, or at folder groups
    // (folder targets remain valid via live derivation even if not persisted).
    if (validGroupIds.has(groupId) || isFolderDerivedGroupId(groupId)) {
      assignments[componentId] = groupId
    }
  }

  return {
    groups: normalizedGroups,
    assignments,
  }
}

function emptyGroupingState(): ComponentGroupingState {
  return { groups: [], assignments: {} }
}

function getOrCreateEngine(projectPath: string): GroupingEngine {
  const existing = enginesByProject.get(projectPath)
  if (existing) {
    if (existing.groups.value.some((group) => !isPersistedSoftGroup(group))) {
      const kept = existing.groups.value.filter(isPersistedSoftGroup)
      const validIds = new Set(kept.map((group) => group.id))
      existing.groups.value = kept
      const nextAssignments: Record<string, string> = {}
      for (const [id, groupId] of Object.entries(existing.assignments.value)) {
        if (validIds.has(groupId) || isFolderDerivedGroupId(groupId)) {
          nextAssignments[id] = groupId
        }
      }
      existing.assignments.value = nextAssignments
    }
    return existing
  }

  const engine = createStudioGroupingEngine<
    ComponentGroup,
    ComponentGroupingState & StudioGroupingState<StudioGroupingGroup>
  >({
    stateSchema: ComponentGroupingStateSchema,
    loadState: async () => {
      try {
        const data = await getComponentGrouping(projectPath)
        return normalizeLoadedState(data)
      } catch {
        return null
      }
    },
    persistState: async (state) => {
      await updateComponentGrouping(projectPath, {
        groups: state.groups.filter(isPersistedSoftGroup),
        assignments: state.assignments,
      })
    },
    fallbackState: emptyGroupingState,
    resetState: emptyGroupingState,
  })

  enginesByProject.set(projectPath, engine)
  return engine
}

export interface UseComponentGroupingReturn<TItem extends GroupableComponent> {
  canReadGrouping: Ref<boolean>
  canUpdateGrouping: Ref<boolean>
  hasHydratedFromServer: Ref<boolean>
  customGroups: ComputedRef<ComponentGroup[]>
  componentGroupAssignments: Ref<Record<string, string>>
  buildEffectiveAssignments: (
    items: readonly TItem[],
  ) => Record<string, string>
  groupedComponents: ComputedRef<GroupedComponentsSection<TItem>[]>
  getGroupMemberCount: (groupId: string, items: readonly TItem[]) => number
  createCustomGroup: (name: string) => Promise<string | null>
  renameCustomGroup: (groupId: string, name: string) => Promise<void>
  deleteCustomGroup: (groupId: string) => Promise<void>
  moveComponentToGroup: (
    componentId: string,
    groupId?: string,
  ) => Promise<void>
  applyFolderPathMutation: (mutation: ComponentFolderMutationResult) => void
  stripStaleAssignments: (items: readonly TItem[]) => void
}

export function useComponentGrouping<TItem extends GroupableComponent>(
  items: ComputedRef<readonly TItem[]> | Ref<readonly TItem[]>,
  projectPath: string,
): UseComponentGroupingReturn<TItem> {
  const engine = getOrCreateEngine(projectPath)
  const componentGroupAssignments = engine.assignments
  const hasHydratedFromServer = engine.hasHydratedFromServer

  const canReadGrouping = computed(() => true)
  const canUpdateGrouping = computed(() => true)

  void engine.ensureHydrated()

  const customGroups = computed<ComponentGroup[]>(() => {
    const folderGroups = deriveFolderGroups(items.value)
    const softGroups = engine.groups.value.filter(isPersistedSoftGroup)
    return sortGroups([...folderGroups, ...softGroups])
  })

  /** Explicit overrides + folder defaults for components under src/components folders. */
  function buildEffectiveAssignments(
    sourceItems: readonly TItem[],
  ): Record<string, string> {
    const validGroupIds = new Set(customGroups.value.map((group) => group.id))
    const effective: Record<string, string> = {}

    for (const item of sourceItems) {
      const explicit = componentGroupAssignments.value[item.id]
      if (explicit && validGroupIds.has(explicit)) {
        effective[item.id] = explicit
        continue
      }

      const folderPath = folderPathForComponent(item)
      if (!folderPath) continue
      const folderGroupId = folderGroupIdForPath(folderPath)
      if (validGroupIds.has(folderGroupId)) {
        effective[item.id] = folderGroupId
      }
    }

    return effective
  }

  function stripStaleAssignments(sourceItems: readonly TItem[]): void {
    if (!hasHydratedFromServer.value) return

    const validIds = new Set(sourceItems.map((item) => item.id))
    const validGroupIds = new Set(customGroups.value.map((group) => group.id))
    const next: Record<string, string> = {}
    let changed = false

    for (const [id, groupId] of Object.entries(
      componentGroupAssignments.value,
    )) {
      if (validIds.has(id) && validGroupIds.has(groupId)) {
        next[id] = groupId
      } else {
        changed = true
      }
    }

    if (changed) {
      componentGroupAssignments.value = next
    }
  }

  engine.watchPersistence(canUpdateGrouping)

  const groupedComponents = computed<GroupedComponentsSection<TItem>[]>(() => {
    const sourceItems = items.value
    const effectiveAssignments = buildEffectiveAssignments(sourceItems)
    const sections: GroupedComponentsSection<TItem>[] = []
    const validGroupIds = new Set(customGroups.value.map((group) => group.id))

    for (const group of [...customGroups.value].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const groupItems = sourceItems
        .filter(
          (component) => effectiveAssignments[component.id] === group.id,
        )
        .sort(byDisplayName)

      if (groupItems.length) {
        sections.push({
          key: `group:${group.id}`,
          name: group.name,
          items: groupItems,
          isCustomGroup: true,
          groupId: group.id,
        })
      }
    }

    const unassigned = sourceItems
      .filter((component) => {
        const assignedGroupId = effectiveAssignments[component.id]
        return !(assignedGroupId && validGroupIds.has(assignedGroupId))
      })
      .sort(byDisplayName)

    if (unassigned.length) {
      sections.push({
        key: "unassigned",
        name: "",
        items: unassigned,
        isCustomGroup: false,
      })
    }

    return sections
  })

  function getGroupMemberCount(
    groupId: string,
    sourceItems: readonly TItem[],
  ): number {
    const effectiveAssignments = buildEffectiveAssignments(sourceItems)
    return sourceItems.filter(
      (item) => effectiveAssignments[item.id] === groupId,
    ).length
  }

  async function createCustomGroup(name: string): Promise<string | null> {
    await engine.ensureHydrated()
    return engine.createCustomGroup({
      name,
      canUpdateGrouping,
      describe: (groupName) => `Create component group "${groupName}"`,
    })
  }

  async function renameCustomGroup(
    groupId: string,
    name: string,
  ): Promise<void> {
    if (isFolderDerivedGroupId(groupId)) return
    await engine.ensureHydrated()
    await engine.renameCustomGroup({
      groupId,
      name,
      canUpdateGrouping,
      describe: (previousName, nextName) =>
        `Rename component group "${previousName}" to "${nextName}"`,
    })
  }

  async function deleteCustomGroup(groupId: string): Promise<void> {
    if (isFolderDerivedGroupId(groupId)) return
    await engine.ensureHydrated()
    await engine.deleteCustomGroup({
      groupId,
      canUpdateGrouping,
      describe: (groupName) => `Delete component group "${groupName}"`,
    })
  }

  async function moveComponentToGroup(
    componentId: string,
    groupId?: string,
  ): Promise<void> {
    await engine.ensureHydrated()
    await engine.moveItemsToGroup({
      itemIds: [componentId],
      groupId,
      canUpdateGrouping,
      allItemsLabel: "All Components",
      describe: ([itemId], targetGroupLabel) => {
        const componentLabel =
          items.value.find((item) => item.id === itemId)?.name || itemId
        return `Move component "${componentLabel}" to "${targetGroupLabel}"`
      },
    })
  }

  /** Remap soft assignments after a filesystem folder rename/dissolve. */
  function applyFolderPathMutation(
    mutation: ComponentFolderMutationResult,
  ): void {
    const nextAssignments: Record<string, string> = {}

    for (const [itemId, groupId] of Object.entries(
      componentGroupAssignments.value,
    )) {
      const nextItemId = mutation.movedFiles[itemId] ?? itemId

      let nextGroupId = groupId
      const assignedFolder = folderPathFromGroupId(groupId)
      if (assignedFolder) {
        if (assignedFolder === mutation.from) {
          nextGroupId = mutation.to
            ? folderGroupIdForPath(mutation.to)
            : ""
        } else if (assignedFolder.startsWith(`${mutation.from}/`)) {
          const rest = assignedFolder.slice(mutation.from.length + 1)
          const nextPath = mutation.to ? `${mutation.to}/${rest}` : rest
          nextGroupId = nextPath ? folderGroupIdForPath(nextPath) : ""
        }
      }

      if (!nextGroupId) continue
      nextAssignments[nextItemId] = nextGroupId
    }

    componentGroupAssignments.value = nextAssignments
  }

  watch(
    () => items.value.map((item) => `${item.id}\0${item.category ?? ""}`).join("\0"),
    () => {
      stripStaleAssignments(items.value)
    },
    { flush: "post" },
  )

  return {
    canReadGrouping,
    canUpdateGrouping,
    hasHydratedFromServer,
    customGroups,
    componentGroupAssignments,
    buildEffectiveAssignments,
    groupedComponents,
    getGroupMemberCount,
    createCustomGroup,
    renameCustomGroup,
    deleteCustomGroup,
    moveComponentToGroup,
    applyFolderPathMutation,
    stripStaleAssignments,
  }
}

/** Convenience alias when grouping ScanComponent lists. */
export type ScanComponentGrouping = UseComponentGroupingReturn<ScanComponent>
