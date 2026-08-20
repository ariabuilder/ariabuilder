<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { toast } from "vue-sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  importMarkdownToCmsEntry,
  previewCmsMarkdownImport,
  type CmsMarkdownImportPreview,
} from "@/lib/cms"

const props = defineProps<{
  open: boolean
  projectRoot: string
  collectionId: string
  collectionLabel?: string
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
  imported: []
}>()

const markdown = ref("")
const isPreviewing = ref(false)
const isImporting = ref(false)
const preview = ref<CmsMarkdownImportPreview | null>(null)
const selectedFieldKeys = ref<Set<string>>(new Set())

const placeholderMarkdown = [
  "---",
  "title: My post",
  "slug: my-post",
  "draft: false",
  "---",
  "",
  "Body text…",
].join("\n")

const busy = computed(() => isPreviewing.value || isImporting.value)
const hasBlockingDiagnostics = computed(() =>
  preview.value?.diagnostics.some((item) => item.severity === "error") ?? false,
)

const fieldRows = computed(() => {
  if (!preview.value) return []
  const suggested = new Map(
    preview.value.suggestedNewFields.map((field) => [field.key, field]),
  )
  return preview.value.frontmatterKeys.map((key) => {
    if (preview.value!.reservedMapped.includes(key)) {
      return { key, kind: "reserved" as const, typeLabel: "reserved" }
    }
    if (preview.value!.mappedFieldKeys.includes(key)) {
      return { key, kind: "mapped" as const, typeLabel: "schema" }
    }
    const suggestion = suggested.get(key)
    return {
      key,
      kind: "new" as const,
      typeLabel: suggestion?.type ?? "unknown",
      label: suggestion?.label,
    }
  })
})

watch(
  () => props.open,
  (open) => {
    if (!open) {
      markdown.value = ""
      isPreviewing.value = false
      isImporting.value = false
      preview.value = null
      selectedFieldKeys.value = new Set()
    }
  },
)

watch(markdown, () => {
  // Invalidate stale preview when the paste changes.
  preview.value = null
  selectedFieldKeys.value = new Set()
})

function handleClose(open: boolean) {
  if (busy.value && !open) return
  emit("update:open", open)
}

function toggleSuggestedField(key: string, checked: boolean) {
  const next = new Set(selectedFieldKeys.value)
  if (checked) next.add(key)
  else next.delete(key)
  selectedFieldKeys.value = next
}

async function handlePreview() {
  const content = markdown.value.trim()
  if (!content || busy.value || !props.collectionId) return

  isPreviewing.value = true
  try {
    const result = await previewCmsMarkdownImport(
      props.projectRoot,
      props.collectionId,
      content,
    )
    preview.value = result
    selectedFieldKeys.value = new Set(
      result.suggestedNewFields.map((field) => field.key),
    )
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to preview markdown")
  } finally {
    isPreviewing.value = false
  }
}

async function handleImport() {
  const content = markdown.value.trim()
  if (!content || busy.value || !props.collectionId) return
  if (!preview.value) {
    toast.error("Preview the markdown before importing")
    return
  }

  isImporting.value = true
  try {
    const record = await importMarkdownToCmsEntry(
      props.projectRoot,
      props.collectionId,
      content,
      {
        previewHash: preview.value.previewHash,
        addMissingFields: selectedFieldKeys.value.size > 0,
        selectedFieldKeys: [...selectedFieldKeys.value],
      },
    )
    const title = record.locales[0]?.title ?? "Entry"
    toast.success(`Imported “${title}”`)
    emit("imported")
    emit("update:open", false)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to import markdown")
  } finally {
    isImporting.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="handleClose">
    <DialogContent class="sm:max-w-[640px]">
      <DialogHeader>
        <DialogTitle>Import markdown</DialogTitle>
        <DialogDescription>
          Paste a Markdown document with optional YAML frontmatter into
          {{ collectionLabel ? ` “${collectionLabel}”` : " this collection" }}.
          Preview to review fields, then import.
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4 py-2">
        <div class="grid gap-2">
          <Label for="cms-import-markdown">Markdown</Label>
          <Textarea
            id="cms-import-markdown"
            v-model="markdown"
            class="min-h-[180px] font-mono text-xs"
            :placeholder="placeholderMarkdown"
            :disabled="busy"
          />
        </div>

        <div
          v-if="preview"
          class="grid gap-3 rounded-md border border-border/60 p-3"
        >
          <div class="grid gap-1 text-sm">
            <div>
              <span class="text-muted-foreground">Title:</span>
              {{ preview.title || "—" }}
            </div>
            <div>
              <span class="text-muted-foreground">Slug:</span>
              <span class="font-mono text-xs">{{ preview.slug || "—" }}</span>
            </div>
            <div v-if="preview.bodyPreview" class="text-muted-foreground">
              Body: {{ preview.bodyPreview }}
            </div>
          </div>

          <div
            v-if="preview.diagnostics.length > 0"
            class="grid gap-2"
            :role="hasBlockingDiagnostics ? 'alert' : 'status'"
          >
            <div class="text-sm font-medium">Import diagnostics</div>
            <ul class="grid gap-1 text-xs">
              <li
                v-for="item in preview.diagnostics"
                :key="`${item.code}:${item.message}`"
                :class="item.severity === 'error' ? 'text-destructive' : 'text-muted-foreground'"
              >
                {{ item.message }}
                <span v-if="item.remediation"> {{ item.remediation }}</span>
              </li>
            </ul>
          </div>

          <div v-if="fieldRows.length > 0" class="grid gap-2">
            <div class="text-sm font-medium">Frontmatter fields</div>
            <div class="overflow-hidden rounded-md border border-border/50">
              <table class="w-full text-left text-xs">
                <thead class="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th class="px-2 py-1.5 font-medium">Key</th>
                    <th class="px-2 py-1.5 font-medium">Mapping</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in fieldRows"
                    :key="row.key"
                    class="border-t border-border/40"
                  >
                    <td class="px-2 py-1.5 font-mono">{{ row.key }}</td>
                    <td class="px-2 py-1.5 capitalize text-muted-foreground">
                      {{ row.kind }}
                      <span v-if="row.typeLabel !== row.kind">
                        · {{ row.typeLabel }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div
            v-if="preview.suggestedNewFields.length > 0"
            class="grid gap-2"
          >
            <div class="text-sm font-medium">Suggested new fields</div>
            <p class="text-xs text-muted-foreground">
              Selected fields are added to the collection schema before import.
            </p>
            <div class="grid gap-2">
              <label
                v-for="field in preview.suggestedNewFields"
                :key="field.key"
                class="flex items-start gap-2 rounded-md border border-border/50 px-2.5 py-2 text-sm"
              >
                <Checkbox
                  class="mt-0.5"
                  :checked="selectedFieldKeys.has(field.key)"
                  :disabled="busy"
                  @update:checked="
                    toggleSuggestedField(field.key, $event === true)
                  "
                />
                <span class="grid gap-0.5">
                  <span class="font-medium">
                    {{ field.label }}
                    <span class="font-mono text-xs text-muted-foreground">
                      ({{ field.key }})
                    </span>
                  </span>
                  <span class="text-xs text-muted-foreground">
                    Type: {{ field.type }}
                  </span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter class="gap-2 sm:gap-2">
        <Button
          variant="outline"
          :disabled="busy"
          @click="handleClose(false)"
        >
          Cancel
        </Button>
        <Button
          variant="secondary"
          :disabled="busy || !markdown.trim()"
          @click="handlePreview"
        >
          {{ isPreviewing ? "Previewing…" : "Preview" }}
        </Button>
        <Button
          :disabled="busy || !markdown.trim() || !preview || hasBlockingDiagnostics"
          @click="handleImport"
        >
          {{ isImporting ? "Importing…" : "Import" }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
