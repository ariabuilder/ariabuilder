<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import JSZip from "jszip"
import { toast } from "vue-sonner"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  importMarkdownImportBatch,
  previewMarkdownImportBatch,
  type MarkdownImportFieldType,
  type MarkdownImportPreview,
  type MarkdownImportSourceFile,
  type MarkdownImportSuggestedField,
} from "@/lib/cms"
import { getCollections } from "@/lib/workspace"
import type { AriaCollectionDef } from "@/types/aria"
import { m } from "@/paraglide/messages.js"

type SelectedSuggestedField = Pick<MarkdownImportSuggestedField, "key" | "type">

const props = defineProps<{
  projectRoot: string
}>()

const suggestedFieldTypeLabels: Record<string, string> = {
  string: "Short text",
  text: "Long text",
  slug: "Slug",
  number: "Number",
  integer: "Integer",
  boolean: "Boolean",
  select: "Choice",
  multiSelect: "Multiple choice",
}

const fileInput = ref<HTMLInputElement | null>(null)
const collections = ref<AriaCollectionDef[]>([])
const selectedCollectionId = ref("")
const selectedFile = ref<File | null>(null)
const parsedFiles = ref<MarkdownImportSourceFile[]>([])
const updateExisting = ref(false)
const selectedSuggestedFields = ref<SelectedSuggestedField[]>([])
const preview = ref<MarkdownImportPreview | null>(null)
const isLoadingCollections = ref(false)
const isPreviewing = ref(false)
const isApplying = ref(false)

const selectedFileLabel = computed(() => {
  if (!selectedFile.value) return m.import_markdown_no_file()
  return `${selectedFile.value.name} · ${Math.max(1, Math.round(selectedFile.value.size / 1024))} KB`
})

function chooseFile(): void {
  fileInput.value?.click()
}

function invalidatePreview(): void {
  preview.value = null
  selectedSuggestedFields.value = []
}

function isSuggestedFieldSelected(key: string): boolean {
  return selectedSuggestedFields.value.some((field) => field.key === key)
}

function selectedSuggestedFieldType(
  field: MarkdownImportSuggestedField,
): MarkdownImportFieldType {
  return (
    selectedSuggestedFields.value.find((item) => item.key === field.key)
      ?.type ?? field.type
  )
}

function toggleSuggestedField(field: MarkdownImportSuggestedField): void {
  selectedSuggestedFields.value = isSuggestedFieldSelected(field.key)
    ? selectedSuggestedFields.value.filter((item) => item.key !== field.key)
    : [...selectedSuggestedFields.value, { key: field.key, type: field.type }]
}

function updateSuggestedFieldType(
  field: MarkdownImportSuggestedField,
  value: unknown,
): void {
  if (typeof value !== "string") return
  const type = field.allowedTypes.find((candidate) => candidate === value)
  if (!type) return
  selectedSuggestedFields.value = selectedSuggestedFields.value.map((item) =>
    item.key === field.key ? { ...item, type } : item,
  )
}

function suggestedFieldTypeLabel(type: MarkdownImportFieldType): string {
  return suggestedFieldTypeLabels[type] ?? String(type)
}

async function readMarkdownSources(file: File): Promise<MarkdownImportSourceFile[]> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const entries: MarkdownImportSourceFile[] = []
    const tasks: Array<Promise<void>> = []
    zip.forEach((relativePath, entry) => {
      if (entry.dir) return
      if (!/\.(md|mdx)$/i.test(relativePath)) return
      if (relativePath.split("/").some((part) => part.startsWith("."))) return
      tasks.push(
        entry.async("string").then((content) => {
          entries.push({ path: relativePath, content })
        }),
      )
    })
    await Promise.all(tasks)
    return entries.sort((a, b) => a.path.localeCompare(b.path))
  }

  const content = await file.text()
  return [{ path: file.name, content }]
}

async function handleFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  selectedFile.value = input.files?.[0] ?? null
  parsedFiles.value = []
  invalidatePreview()
  if (!selectedFile.value) return
  try {
    parsedFiles.value = await readMarkdownSources(selectedFile.value)
    if (parsedFiles.value.length === 0) {
      toast.error(m.import_markdown_file_hint())
      selectedFile.value = null
    }
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : m.import_markdown_file_hint(),
    )
    selectedFile.value = null
  }
}

async function loadCollections(): Promise<void> {
  isLoadingCollections.value = true
  try {
    const state = await getCollections(props.projectRoot)
    collections.value = state.collections
    if (!selectedCollectionId.value && collections.value[0]) {
      selectedCollectionId.value = collections.value[0].id
    }
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : m.import_markdown_no_collections(),
    )
  } finally {
    isLoadingCollections.value = false
  }
}

async function createPreview(): Promise<void> {
  if (!selectedCollectionId.value || parsedFiles.value.length === 0) {
    toast.error(m.import_markdown_choose_files())
    return
  }
  isPreviewing.value = true
  try {
    preview.value = await previewMarkdownImportBatch(props.projectRoot, {
      collectionId: selectedCollectionId.value,
      files: parsedFiles.value,
      mode: updateExisting.value ? "update" : "create",
    })
    selectedSuggestedFields.value = []
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : m.import_markdown_checking(),
    )
  } finally {
    isPreviewing.value = false
  }
}

async function applyImport(): Promise<void> {
  if (!preview.value?.canApply || !selectedCollectionId.value) return
  isApplying.value = true
  try {
    const report = await importMarkdownImportBatch(props.projectRoot, {
      collectionId: selectedCollectionId.value,
      files: parsedFiles.value,
      mode: updateExisting.value ? "update" : "create",
      addFields: selectedSuggestedFields.value,
    })
    preview.value = report
    selectedSuggestedFields.value = []
    if (report.applied) {
      const added = report.addedFieldKeys?.length ?? 0
      toast.success(
        added > 0
          ? `${m.import_markdown_apply()} · ${added}`
          : m.import_markdown_apply(),
      )
    } else {
      toast.error(m.import_markdown_resolve_errors())
    }
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : m.import_markdown_importing(),
    )
  } finally {
    isApplying.value = false
  }
}

onMounted(() => void loadCollections())
</script>

<template>
  <section
    class="min-w-0 space-y-6 px-7 py-7"
    :aria-label="m.import_markdown_aria()"
  >
    <div class="space-y-2">
      <h3 class="m-0 font-sans text-xl font-medium text-foreground">
        {{ m.import_markdown_title() }}
      </h3>
      <p class="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {{ m.import_markdown_description() }}
      </p>
    </div>

    <div class="grid max-w-3xl gap-4 sm:grid-cols-2">
      <label class="grid gap-2 text-sm font-medium text-foreground">
        {{ m.import_markdown_collection() }}
        <Select
          :model-value="selectedCollectionId"
          :disabled="isLoadingCollections"
          @update:model-value="
            (value) => {
              if (typeof value === 'string') {
                selectedCollectionId = value
                invalidatePreview()
              }
            }
          "
        >
          <SelectTrigger class="w-full">
            <SelectValue :placeholder="m.import_markdown_no_collections()" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="collection in collections"
              :key="collection.id"
              :value="collection.id"
            >
              {{ collection.label }} ({{ collection.name }})
            </SelectItem>
          </SelectContent>
        </Select>
      </label>
      <div class="grid gap-2 text-sm font-medium text-foreground">
        {{ m.import_markdown_source() }}
        <input
          ref="fileInput"
          type="file"
          accept=".md,.mdx,.zip,text/markdown,application/zip"
          class="sr-only"
          @change="handleFileChange"
        />
        <Button
          type="button"
          variant="outline"
          class="justify-start"
          @click="chooseFile"
        >
          <AppIcon name="upload" :size="16" class="mr-2 size-4" />
          {{ selectedFileLabel }}
        </Button>
        <p class="text-xs font-normal text-muted-foreground">
          {{ m.import_markdown_file_hint() }}
        </p>
      </div>
    </div>

    <label
      class="flex max-w-3xl items-start gap-3 border-y border-border/70 py-4 text-sm text-foreground"
    >
      <Checkbox
        :model-value="updateExisting"
        class="mt-0.5"
        @update:model-value="
          (checked) => {
            updateExisting = checked === true
            invalidatePreview()
          }
        "
      />
      <span>
        <span class="block font-medium">{{
          m.import_markdown_update_existing()
        }}</span>
        <span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {{ m.import_markdown_update_existing_description() }}
        </span>
      </span>
    </label>

    <div class="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="default"
        size="sm"
        class="h-9"
        :disabled="isPreviewing || isApplying"
        @click="createPreview"
      >
        <AppIcon name="task" :size="16" class="mr-2 size-4" />
        {{
          isPreviewing
            ? m.import_markdown_checking()
            : m.import_markdown_preview()
        }}
      </Button>
      <Button
        v-if="preview"
        type="button"
        variant="outline"
        size="sm"
        class="h-9"
        :disabled="!preview.canApply || isPreviewing || isApplying"
        @click="applyImport"
      >
        <AppIcon name="databaseLine" :size="16" class="mr-2 size-4" />
        {{
          isApplying
            ? m.import_markdown_importing()
            : m.import_markdown_apply()
        }}
      </Button>
    </div>

    <div v-if="preview" class="space-y-4 border-t border-border pt-6">
      <div class="grid gap-3 sm:grid-cols-5">
        <div
          v-for="item in [
            [m.import_markdown_summary_create(), preview.summary.creates],
            [m.import_markdown_summary_update(), preview.summary.updates],
            [m.import_markdown_summary_skip(), preview.summary.skips],
            [m.import_markdown_summary_errors(), preview.summary.errors],
            [m.import_markdown_summary_warnings(), preview.summary.warnings],
          ]"
          :key="String(item[0])"
          class="border border-border p-3"
        >
          <p class="text-2xs uppercase tracking-[0.18em] text-muted-foreground">
            {{ item[0] }}
          </p>
          <p class="mt-2 font-sans text-xl text-foreground">{{ item[1] }}</p>
        </div>
      </div>

      <p
        v-if="!preview.canApply"
        class="border-l border-red-500/60 py-1 pl-4 text-sm text-muted-foreground"
      >
        {{ m.import_markdown_resolve_errors() }}
      </p>

      <section
        v-if="preview.fieldSuggestions.length"
        class="border-y border-border/70 py-4"
        :aria-label="m.import_markdown_suggested_fields_aria()"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h4 class="m-0 text-sm font-medium text-foreground">
              {{ m.import_markdown_add_suggested_fields() }}
            </h4>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ m.import_markdown_add_suggested_fields_description() }}
            </p>
          </div>
          <span class="text-xs tabular-nums text-muted-foreground">
            {{ selectedSuggestedFields.length }} selected
          </span>
        </div>
        <div class="mt-3 divide-y divide-border/70 border-y border-border/70">
          <div
            v-for="field in preview.fieldSuggestions"
            :key="field.key"
            class="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 text-left"
          >
            <Checkbox
              :model-value="isSuggestedFieldSelected(field.key)"
              :aria-label="field.label"
              @update:model-value="toggleSuggestedField(field)"
            />
            <button
              type="button"
              class="min-w-0 text-left"
              @click="toggleSuggestedField(field)"
            >
              <span class="block text-sm font-medium text-foreground">
                {{ field.label }}
              </span>
              <span class="mt-0.5 block truncate text-xs text-muted-foreground">
                {{ field.key }} · {{ field.sourcePaths.length }}
              </span>
            </button>
            <Select
              :model-value="String(selectedSuggestedFieldType(field))"
              :disabled="!isSuggestedFieldSelected(field.key)"
              @update:model-value="updateSuggestedFieldType(field, $event)"
            >
              <SelectTrigger class="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="type in field.allowedTypes"
                  :key="type"
                  :value="String(type)"
                >
                  {{ suggestedFieldTypeLabel(type) }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>
