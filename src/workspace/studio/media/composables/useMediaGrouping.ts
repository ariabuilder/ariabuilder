import { ref, watch, type ComputedRef, type Ref } from "vue"
import { z } from "zod"
import {
  createStudioGroupingEngine,
  type StudioGroupingGroup,
  type StudioGroupingState,
} from "@/workspace/studio/core"
import {
  getMediaGrouping,
  updateMediaGrouping,
  type MediaAsset,
  type MediaGroupingState,
} from "@/lib/media"

export type MediaGroup = MediaGroupingState["groups"][number]

const MediaGroupSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
})

const MediaGroupingStateSchema = z.object({
  groups: z.array(MediaGroupSchema),
  assignments: z.record(z.string(), z.string()),
})

/** Stable id for rail groups derived from on-disk folders. */
const FOLDER_GROUP_PREFIX = "folder:"

type GroupingEngine = ReturnType<
  typeof createStudioGroupingEngine<
    MediaGroup,
    MediaGroupingState & StudioGroupingState<StudioGroupingGroup>
  >
>

const enginesByProject = new Map<string, GroupingEngine>()

function folderGroupId(folder: string): string {
  return `${FOLDER_GROUP_PREFIX}${folder}`
}

function isFolderDerivedGroup(group: MediaGroup): boolean {
  return group.id.startsWith(FOLDER_GROUP_PREFIX)
}

function normalizeLoadedState(raw: MediaGroupingState): MediaGroupingState {
  const groups = [...raw.groups].sort((a, b) => a.name.localeCompare(b.name))
  const valid = new Set(groups.map((g) => g.id))
  const assignments: Record<string, string> = {}
  for (const [id, groupId] of Object.entries(raw.assignments)) {
    if (valid.has(groupId)) assignments[id] = groupId
  }
  return { groups, assignments }
}

function getOrCreateEngine(projectPath: string): GroupingEngine {
  const existing = enginesByProject.get(projectPath)
  if (existing) return existing

  const engine = createStudioGroupingEngine<
    MediaGroup,
    MediaGroupingState & StudioGroupingState<StudioGroupingGroup>
  >({
    stateSchema: MediaGroupingStateSchema,
    loadState: async () => {
      try {
        return normalizeLoadedState(await getMediaGrouping(projectPath))
      } catch {
        return null
      }
    },
    persistState: async (state) => {
      await updateMediaGrouping(projectPath, {
        groups: state.groups,
        assignments: state.assignments,
      })
    },
    fallbackState: () => ({ groups: [], assignments: {} }),
    resetState: () => ({ groups: [], assignments: {} }),
  })

  enginesByProject.set(projectPath, engine)
  return engine
}

export function useMediaGrouping(
  items: Ref<readonly MediaAsset[]> | ComputedRef<readonly MediaAsset[]>,
  projectPath: string,
) {
  const engine = getOrCreateEngine(projectPath)
  const canUpdateGrouping = ref(true)
  const canReadGrouping = ref(true)

  const customGroups = engine.groups
  const mediaGroupAssignments = engine.assignments
  const hasHydratedFromServer = engine.hasHydratedFromServer

  void engine.ensureHydrated()

  function buildEffectiveAssignments(
    sourceItems: readonly MediaAsset[],
  ): Record<string, string> {
    const next: Record<string, string> = {}
    const valid = new Set(customGroups.value.map((g) => g.id))
    for (const item of sourceItems) {
      const groupId = mediaGroupAssignments.value[item.id]
      if (groupId && valid.has(groupId)) next[item.id] = groupId
    }
    return next
  }

  function getGroupMemberCount(
    groupId: string,
    sourceItems: readonly MediaAsset[],
  ): number {
    const assignments = buildEffectiveAssignments(sourceItems)
    return sourceItems.filter((item) => assignments[item.id] === groupId).length
  }

  function stripStaleAssignments(sourceItems: readonly MediaAsset[]): void {
    if (!hasHydratedFromServer.value) return
    const validIds = new Set(sourceItems.map((item) => item.id))
    const next: Record<string, string> = {}
    let changed = false
    for (const [id, groupId] of Object.entries(mediaGroupAssignments.value)) {
      if (validIds.has(id)) next[id] = groupId
      else changed = true
    }
    if (changed) mediaGroupAssignments.value = next
  }

  /**
   * Ensure the organizer rail has a group for every on-disk folder that
   * contains media, and assign unassigned assets in those folders.
   * Soft groups stay soft — disk is not moved; existing assignments win.
   */
  function syncFolderDerivedGroups(sourceItems: readonly MediaAsset[]): void {
    if (!hasHydratedFromServer.value) return

    const folders = new Set<string>()
    for (const item of sourceItems) {
      const folder = item.folder?.trim()
      if (folder) folders.add(folder)
    }

    const nextGroups = [...customGroups.value]
    const nextAssignments = { ...mediaGroupAssignments.value }
    let groupsChanged = false
    let assignmentsChanged = false

    const byId = new Map(nextGroups.map((group) => [group.id, group]))
    const byName = new Map(
      nextGroups.map((group) => [group.name.trim().toLowerCase(), group]),
    )

    for (const folder of folders) {
      const preferredId = folderGroupId(folder)
      const displayName = folder
      let group =
        byId.get(preferredId) ?? byName.get(displayName.toLowerCase())

      if (!group) {
        group = { id: preferredId, name: displayName }
        nextGroups.push(group)
        byId.set(group.id, group)
        byName.set(displayName.toLowerCase(), group)
        groupsChanged = true
      }

      for (const item of sourceItems) {
        if (item.folder?.trim() !== folder) continue
        if (nextAssignments[item.id]) continue
        nextAssignments[item.id] = group.id
        assignmentsChanged = true
      }
    }

    const assignedGroupIds = new Set(Object.values(nextAssignments))
    const pruned = nextGroups.filter((group) => {
      if (!isFolderDerivedGroup(group)) return true
      const folder = group.id.slice(FOLDER_GROUP_PREFIX.length)
      if (folders.has(folder)) return true
      return assignedGroupIds.has(group.id)
    })
    if (pruned.length !== nextGroups.length) {
      groupsChanged = true
    }

    if (groupsChanged) {
      customGroups.value = pruned.sort((a, b) => a.name.localeCompare(b.name))
    }
    if (assignmentsChanged) {
      mediaGroupAssignments.value = nextAssignments
    }
  }

  engine.watchPersistence(canUpdateGrouping)

  async function createCustomGroup(name: string): Promise<string | null> {
    return engine.createCustomGroup({
      name,
      canUpdateGrouping,
      describe: (groupName) => `Create media folder "${groupName}"`,
    })
  }

  async function renameCustomGroup(
    groupId: string,
    name: string,
  ): Promise<void> {
    await engine.renameCustomGroup({
      groupId,
      name,
      canUpdateGrouping,
      describe: (previousName, nextName) =>
        `Rename media folder "${previousName}" to "${nextName}"`,
    })
  }

  async function deleteCustomGroup(groupId: string): Promise<void> {
    await engine.deleteCustomGroup({
      groupId,
      canUpdateGrouping,
      describe: (groupName) => `Delete media folder "${groupName}"`,
    })
  }

  async function moveMediaToGroup(
    assetId: string,
    groupId?: string,
  ): Promise<void> {
    await engine.moveItemsToGroup({
      itemIds: [assetId],
      groupId,
      canUpdateGrouping,
      allItemsLabel: "All Media",
      describe: ([itemId], targetGroupLabel) => {
        const label =
          items.value.find((item) => item.id === itemId)?.name || itemId
        return `Move media "${label}" to "${targetGroupLabel}"`
      },
    })
  }

  async function moveMediaItemsToGroup(
    assetIds: string[],
    groupId?: string,
  ): Promise<void> {
    await engine.moveItemsToGroup({
      itemIds: assetIds,
      groupId,
      canUpdateGrouping,
      allItemsLabel: "All Media",
      describe: (ids, targetGroupLabel) =>
        `Move ${ids.length} media items to "${targetGroupLabel}"`,
    })
  }

  watch(
    () =>
      items.value
        .map((item) => `${item.id}\0${item.folder ?? ""}`)
        .join("\n"),
    () => {
      void engine.ensureHydrated().then(() => {
        stripStaleAssignments(items.value)
        syncFolderDerivedGroups(items.value)
      })
    },
    { flush: "post", immediate: true },
  )

  return {
    canReadGrouping,
    canUpdateGrouping,
    hasHydratedFromServer,
    customGroups,
    mediaGroupAssignments,
    buildEffectiveAssignments,
    getGroupMemberCount,
    createCustomGroup,
    renameCustomGroup,
    deleteCustomGroup,
    moveMediaToGroup,
    moveMediaItemsToGroup,
    stripStaleAssignments,
  }
}
