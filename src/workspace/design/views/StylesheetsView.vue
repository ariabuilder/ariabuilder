<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import { toast } from "vue-sonner"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { confirm } from "@/composables/useConfirm"
import { isMacPlatform } from "@/lib/keyboardShortcuts"
import {
  createStylesheet,
  deleteStylesheet,
  listStylesheets,
  readStylesheet,
  revealStylesheet,
  writeStylesheet,
} from "@/lib/design"
import { HeaderActionDropdownTooltip } from "@/workspace/studio/core"
import type { StylesheetInfo } from "../../../../shared/design"
import { m } from "@/paraglide/messages.js"
import CssEditor from "../components/CssEditor.vue"
import DesignHeaderTeleport from "../components/DesignHeaderTeleport.vue"
import type { VariableReferenceOption } from "../lib/variableReferences"

const props = defineProps<{
  projectRoot: string
  variableReferences?: readonly VariableReferenceOption[]
}>()

const emit = defineEmits<{
  saved: []
}>()

const STORAGE_PREFIX = "aria.design.stylesheet:"

const sheets = ref<StylesheetInfo[]>([])
const selectedPath = ref("")
const content = ref("")
const diskContent = ref("")
const mtimeMs = ref<number | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const creating = ref(false)
const newName = ref("")

const dirty = computed(() => content.value !== diskContent.value)

const selectedSheet = computed(() =>
  sheets.value.find((s) => s.relativePath === selectedPath.value),
)

const canDeleteSelected = computed(
  () => Boolean(selectedPath.value) && !selectedSheet.value?.isEntry,
)

const revealLabel = computed(() =>
  isMacPlatform() ? m.menu_reveal_in_finder() : m.menu_reveal_in_folder(),
)

function storageKey(root: string) {
  return `${STORAGE_PREFIX}${root}`
}

function rememberSelection(path: string) {
  try {
    localStorage.setItem(storageKey(props.projectRoot), path)
  } catch {
    /* ignore */
  }
}

function recallSelection(): string | null {
  try {
    return localStorage.getItem(storageKey(props.projectRoot))
  } catch {
    return null
  }
}

async function refreshList() {
  sheets.value = await listStylesheets(props.projectRoot)
}

async function loadFile(relativePath: string) {
  if (!relativePath) {
    content.value = ""
    diskContent.value = ""
    mtimeMs.value = null
    return
  }
  loading.value = true
  error.value = null
  try {
    const result = await readStylesheet(props.projectRoot, relativePath)
    content.value = result.content
    diskContent.value = result.content
    mtimeMs.value = result.mtimeMs
    selectedPath.value = result.relativePath
    rememberSelection(result.relativePath)
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "Failed to load stylesheet"
  } finally {
    loading.value = false
  }
}

async function bootstrap() {
  loading.value = true
  error.value = null
  try {
    await refreshList()
    const remembered = recallSelection()
    const preferred =
      (remembered &&
        sheets.value.find((s) => s.relativePath === remembered)
          ?.relativePath) ||
      sheets.value.find((s) => s.isEntry)?.relativePath ||
      sheets.value[0]?.relativePath ||
      ""
    if (preferred) {
      await loadFile(preferred)
    } else {
      selectedPath.value = ""
      content.value = ""
      diskContent.value = ""
    }
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "Failed to list stylesheets"
  } finally {
    loading.value = false
  }
}

async function onSelectPath(path: unknown) {
  if (typeof path !== "string" || !path || path === selectedPath.value) return
  if (dirty.value) {
    const ok = await confirm({
      title: m.design_stylesheets_unsaved_title(),
      description: m.design_stylesheets_unsaved_description(),
      confirmLabel: m.design_stylesheets_discard(),
      cancelLabel: m.design_stylesheets_stay(),
      destructive: true,
    })
    if (!ok) return
  }
  await loadFile(path)
}

async function save() {
  if (!selectedPath.value) return
  saving.value = true
  error.value = null
  try {
    const result = await writeStylesheet(
      props.projectRoot,
      selectedPath.value,
      content.value,
      mtimeMs.value,
    )
    diskContent.value = content.value
    mtimeMs.value = result.mtimeMs
    await refreshList()
    emit("saved")
    toast.success(m.design_stylesheets_save_success())
  } catch (err) {
    const maybe = err as { code?: string; message?: string }
    error.value =
      maybe?.message ||
      (err instanceof Error ? err.message : "Failed to save stylesheet")
    toast.error(m.design_stylesheets_save_failed(), {
      description: error.value,
    })
  } finally {
    saving.value = false
  }
}

async function reloadFromDisk() {
  if (!selectedPath.value) return
  if (dirty.value) {
    const ok = await confirm({
      title: m.design_stylesheets_unsaved_title(),
      description: m.design_stylesheets_reload_description(),
      confirmLabel: m.design_stylesheets_reload(),
      cancelLabel: m.design_stylesheets_stay(),
      destructive: true,
    })
    if (!ok) return
  }
  await loadFile(selectedPath.value)
}

async function onCreate() {
  const name = newName.value.trim()
  if (!name) return
  creating.value = false
  try {
    const created = await createStylesheet(props.projectRoot, name)
    newName.value = ""
    await refreshList()
    await loadFile(created.relativePath)
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "Failed to create stylesheet"
  }
}

async function onDelete() {
  if (!canDeleteSelected.value || !selectedPath.value) return
  const ok = await confirm({
    title: m.design_stylesheets_delete_title(),
    description: m.design_stylesheets_delete_description(),
    confirmLabel: m.design_stylesheets_delete(),
    cancelLabel: m.design_stylesheets_stay(),
    destructive: true,
  })
  if (!ok) return
  try {
    await deleteStylesheet(props.projectRoot, selectedPath.value)
    await bootstrap()
    emit("saved")
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "Failed to delete stylesheet"
  }
}

async function onReveal() {
  if (!selectedPath.value) return
  await revealStylesheet(props.projectRoot, selectedPath.value)
}

function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault()
    void save()
  }
}

watch(
  () => props.projectRoot,
  () => {
    void bootstrap()
  },
)

onMounted(() => {
  window.addEventListener("keydown", onKeydown)
  void bootstrap()
})

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown)
})
</script>

<template>
  <DesignHeaderTeleport target="importExport">
    <HeaderActionDropdownTooltip :label="revealLabel">
      <Button
        variant="headerAction"
        size="icon-header"
        :disabled="!selectedPath"
        :aria-label="revealLabel"
        @click="onReveal"
      >
        <AppIcon name="folderOpen" class="size-3.5" />
      </Button>
    </HeaderActionDropdownTooltip>
    <HeaderActionDropdownTooltip :label="m.design_stylesheets_delete()">
      <Button
        variant="headerAction"
        size="icon-header"
        :disabled="!canDeleteSelected"
        :aria-label="m.design_stylesheets_delete()"
        @click="onDelete"
      >
        <AppIcon name="trash" class="size-3.5" />
      </Button>
    </HeaderActionDropdownTooltip>
  </DesignHeaderTeleport>

  <DesignHeaderTeleport target="actions">
    <Button
      variant="default"
      size="md"
      @click="creating = !creating"
    >
      <AppIcon name="add" class="mr-1.5 size-3.5" />
      {{ m.design_stylesheets_new() }}
    </Button>
  </DesignHeaderTeleport>

  <div class="flex min-h-0 flex-1 flex-col gap-4">
    <div
      class="sticky top-0 z-10 -mx-7 shrink-0 space-y-3 bg-background px-7 pb-3"
    >
      <div class="flex flex-wrap items-center gap-2">
        <Select
          :model-value="selectedPath || undefined"
          :disabled="loading || sheets.length === 0"
          @update:model-value="onSelectPath"
        >
          <SelectTrigger class="min-w-[220px] max-w-md flex-1">
            <SelectValue :placeholder="m.design_stylesheets_select_placeholder()" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="sheet in sheets"
              :key="sheet.relativePath"
              :value="sheet.relativePath"
            >
              {{ sheet.relativePath
              }}{{ sheet.isEntry ? ` · ${m.design_stylesheets_entry_badge()}` : "" }}
            </SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          :disabled="saving || !selectedPath || !dirty"
          @click="save"
        >
          {{ saving ? m.design_saving() : m.design_stylesheets_save() }}
        </Button>
        <HeaderActionDropdownTooltip :label="m.design_stylesheets_reload()">
          <Button
            variant="ghost"
            size="icon-sm"
            :disabled="!selectedPath"
            :aria-label="m.design_stylesheets_reload()"
            @click="reloadFromDisk"
          >
            <AppIcon name="refresh" class="size-3.5" />
          </Button>
        </HeaderActionDropdownTooltip>
        <span
          v-if="dirty"
          class="text-xs text-muted-foreground"
        >{{ m.design_stylesheets_dirty() }}</span>
      </div>

      <div v-if="creating" class="flex items-center gap-2">
        <Input
          v-model="newName"
          class="max-w-xs"
          :placeholder="m.design_stylesheets_new_placeholder()"
          @keydown.enter="onCreate"
        />
        <Button size="sm" @click="onCreate">{{ m.design_stylesheets_create() }}</Button>
        <Button size="sm" variant="ghost" @click="creating = false">
          {{ m.design_stylesheets_stay() }}
        </Button>
      </div>

      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
    </div>

    <div class="min-h-0 flex-1 overflow-hidden">
      <div
        v-if="!selectedPath && !loading"
        class="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        {{ m.design_stylesheets_empty() }}
      </div>
      <CssEditor
        v-else
        v-model="content"
        class="h-full min-h-0"
        :placeholder="m.design_stylesheets_editor_placeholder()"
        :variable-references="variableReferences"
      />
    </div>
  </div>
</template>
