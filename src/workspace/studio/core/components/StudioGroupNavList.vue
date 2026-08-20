<script setup lang="ts">
import { computed, nextTick, ref } from "vue"
import type { ComponentPublicInstance } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { confirm } from "@/composables/useConfirm"
import { cn } from "@/lib/utils"
import FlickeringNavItem from "./FlickeringNavItem.vue"
import StudioInlineCreateNavRow from "./StudioInlineCreateNavRow.vue"

export interface StudioGroup {
  id: string
  name: string
}

export type StudioGroupNavVariant = "sidebar" | "rail"

function isValidGroupName(name: string): boolean {
  return name.trim().length > 0
}

const props = withDefaults(
  defineProps<{
    variant: StudioGroupNavVariant
    groups: readonly StudioGroup[]
    groupCounts: Readonly<Record<string, number>>
    allCount: number
    activeFilter: string
    canUpdateGrouping: boolean
    allLabel: string
    newGroupLabel: string
    deleteDialogTitle: string
    deleteStayAvailableMessage: string
    deleteFolderStayAvailableMessage?: string
    groupNamePlaceholder?: string
    createHint?: string
    enableDropTargets?: boolean
    isDropTarget?: (targetId: string | null) => boolean
    registerNavButton?: (
      key: string,
      el: Element | ComponentPublicInstance | null,
    ) => void
    onNavItemEnter?: (key: string) => void
  }>(),
  {
    groupNamePlaceholder: "Group name",
    createHint: "Press Enter to create",
    deleteFolderStayAvailableMessage:
      "Components will be moved into the parent folder.",
    enableDropTargets: false,
    isDropTarget: () => false,
    registerNavButton: undefined,
    onNavItemEnter: undefined,
  },
)

const emit = defineEmits<{
  selectAll: []
  selectGroup: [groupId: string]
  createGroup: [name: string]
  renameGroup: [groupId: string, name: string]
  deleteGroup: [groupId: string]
  dragOver: [targetId: string | null, event: DragEvent]
  dragLeave: [targetId: string | null]
  drop: [targetId: string | null, event: DragEvent]
}>()

const sortedGroups = computed(() =>
  [...props.groups].sort((a, b) => a.name.localeCompare(b.name)),
)

const activeGroupId = computed(() => {
  if (!props.activeFilter.startsWith("group:")) {
    return null
  }
  return props.activeFilter.slice("group:".length)
})

const isAllActive = computed(() => props.activeFilter === "all")

const renamingGroupId = ref<string | null>(null)
const renameInputValue = ref("")
const renameInputRef = ref<HTMLInputElement | null>(null)

function setRenameInputRef(
  el: Element | ComponentPublicInstance | null,
): void {
  renameInputRef.value = el instanceof HTMLInputElement ? el : null
}

function startRename(groupId: string, currentName: string): void {
  renamingGroupId.value = groupId
  renameInputValue.value = currentName
  void nextTick(() => {
    const input = renameInputRef.value
    if (!input) {
      return
    }
    input.focus()
    input.select()
  })
}

function cancelRename(): void {
  renamingGroupId.value = null
  renameInputValue.value = ""
}

function submitRename(): void {
  const groupId = renamingGroupId.value
  if (!groupId) {
    return
  }
  const trimmed = renameInputValue.value.trim()
  if (isValidGroupName(trimmed)) {
    emit("renameGroup", groupId, trimmed)
  }
  cancelRename()
}

async function requestDeleteGroup(groupId: string): Promise<void> {
  const group = props.groups.find((item) => item.id === groupId)
  if (!group) {
    return
  }

  const isFolderGroup = group.id.startsWith("folder:")
  const confirmed = await confirm({
    title: props.deleteDialogTitle,
    description: `Delete ${group.name}? ${
      isFolderGroup
        ? props.deleteFolderStayAvailableMessage
        : props.deleteStayAvailableMessage
    }`,
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
    destructive: true,
  })

  if (confirmed) {
    emit("deleteGroup", group.id)
  }
}

function rowClass(_targetId: string | null, isActive: boolean): string {
  return cn(
    "w-full !justify-start px-3 py-1.5 h-auto text-left transition-colors",
    isActive ? "!text-primary" : "",
  )
}

function isGroupFilterActive(groupId: string): boolean {
  return props.activeFilter === `group:${groupId}`
}

/** Soft and filesystem folder groups can both be renamed/deleted from the rail. */
function canEditGroup(_groupId: string): boolean {
  return props.canUpdateGrouping
}

const registeredNavEls = new Map<
  string,
  Element | ComponentPublicInstance | null
>()

function bindNavRef(key: string) {
  return (el: Element | ComponentPublicInstance | null) => {
    if (registeredNavEls.get(key) === el) {
      return
    }

    registeredNavEls.set(key, el)
    props.registerNavButton?.(key, el)
  }
}

function onNavEnter(key: string): void {
  props.onNavItemEnter?.(key)
}
</script>

<template>
  <div :class="variant === 'rail' ? 'flex flex-col' : 'flex flex-col gap-0'">
    <template v-if="variant === 'sidebar'">
      <Button
        variant="ghost"
        :class="rowClass(null, isAllActive)"
        @click="emit('selectAll')"
        @dragover.prevent="enableDropTargets && emit('dragOver', null, $event)"
        @dragleave="enableDropTargets && emit('dragLeave', null)"
        @drop.prevent="enableDropTargets && emit('drop', null, $event)"
      >
        {{ allLabel }}
      </Button>

      <Button
        v-for="group in sortedGroups"
        :key="group.id"
        variant="ghost"
        :class="rowClass(group.id, activeGroupId === group.id)"
        :title="group.name"
        @click="emit('selectGroup', group.id)"
      >
        <span class="truncate">{{ group.name }}</span>
      </Button>
    </template>

    <template v-else>
      <FlickeringNavItem
        :ref="bindNavRef('all')"
        :active="isAllActive"
        :drop-highlight="isDropTarget('__all__')"
        data-organizer-drop-target="__all__"
        class="py-4.5"
        @click="emit('selectAll')"
        @mouseenter="onNavEnter('all')"
        @dragover.prevent="enableDropTargets && emit('dragOver', null, $event)"
        @dragleave="enableDropTargets && emit('dragLeave', null)"
        @drop.stop.prevent="enableDropTargets && emit('drop', null, $event)"
      >
        <span class="min-w-0 truncate text-sm font-regular">{{ allLabel }}</span>
        <span class="shrink-0 text-2xs tabular-nums text-muted-foreground/70">
          {{ allCount }}
        </span>
      </FlickeringNavItem>

      <FlickeringNavItem
        v-for="group in sortedGroups"
        :key="group.id"
        :ref="bindNavRef(`group:${group.id}`)"
        row-as="div"
        :active="isGroupFilterActive(group.id)"
        :drop-highlight="isDropTarget(group.id)"
        :data-organizer-drop-target="group.id"
        class="group"
        @mouseenter="onNavEnter(`group:${group.id}`)"
        @dragover.prevent="
          enableDropTargets && emit('dragOver', group.id, $event)
        "
        @dragleave="enableDropTargets && emit('dragLeave', group.id)"
        @drop.stop.prevent="enableDropTargets && emit('drop', group.id, $event)"
        @click="renamingGroupId !== group.id && emit('selectGroup', group.id)"
      >
        <template v-if="renamingGroupId === group.id">
          <input
            :ref="setRenameInputRef"
            v-model="renameInputValue"
            type="text"
            class="min-w-0 flex-1 bg-transparent text-sm outline-none"
            @click.stop
            @keydown.enter.prevent="submitRename"
            @keydown.esc.prevent="cancelRename"
            @blur="submitRename"
          />
        </template>
        <template v-else>
          <span class="min-w-0 truncate text-sm font-regular" :title="group.name">
            {{ group.name }}
          </span>
          <div class="flex shrink-0 items-center gap-0">
            <template v-if="canEditGroup(group.id)">
              <Button
                variant="ghost"
                size="sm"
                class="pointer-events-none size-6 shrink-0 p-0! text-muted-foreground opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 hover:text-foreground"
                :aria-label="`Rename ${group.name}`"
                @click.stop="startRename(group.id, group.name)"
              >
                <AppIcon name="penLine" :size="12" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                class="pointer-events-none size-6 shrink-0 p-0! text-muted-foreground opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 hover:text-destructive"
                :aria-label="`Delete ${group.name}`"
                @click.stop="requestDeleteGroup(group.id)"
              >
                <AppIcon name="trash" :size="12" />
              </Button>
            </template>
            <span class="ml-2 text-2xs tabular-nums text-muted-foreground/40">
              {{ groupCounts[group.id] ?? 0 }}
            </span>
          </div>
        </template>
      </FlickeringNavItem>

      <StudioInlineCreateNavRow
        v-if="canUpdateGrouping"
        :label="newGroupLabel"
        :placeholder="groupNamePlaceholder"
        :hint="createHint"
        @create="emit('createGroup', $event)"
      />
    </template>
  </div>
</template>
