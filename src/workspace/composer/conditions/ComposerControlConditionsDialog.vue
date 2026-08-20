<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { writeComposerComponentControlMetadata } from "@/lib/composer"
import {
  cloneConditionSet,
  validateComponentControlMetadata,
  type ComponentControlMetadata,
  type ConditionSet,
} from "../../../../shared/conditions"
import type { PropField } from "../../../../shared/composer/types"
import { componentConditionSources } from "./conditionSources"
import ComposerConditionBuilder from "./ComposerConditionBuilder.vue"

const props = defineProps<{
  projectPath: string
  relativeFile: string
  fields: readonly PropField[]
  mtimeMs?: number | null
  metadataValid?: boolean
  metadataError?: string | null
}>()
const open = defineModel<boolean>("open", { default: false })
const emit = defineEmits<{
  saved: [payload: { metadata: ComponentControlMetadata; mtimeMs: number }]
}>()

const fieldName = ref("")
const visibleWhen = ref<ConditionSet | undefined>()
const enabledWhen = ref<ConditionSet | undefined>()
const saving = ref(false)
const error = ref("")
const metadataDraft = ref<ComponentControlMetadata>({ version: 1, fields: {} })

const selectedField = computed(() => props.fields.find((field) => field.name === fieldName.value) ?? null)
const sources = computed(() => componentConditionSources(props.fields.filter((field) => field.name !== fieldName.value)))

function loadField(name: string) {
  const current = metadataDraft.value.fields[name]
  visibleWhen.value = current?.visibleWhen ? cloneConditionSet(current.visibleWhen) : undefined
  enabledWhen.value = current?.enabledWhen ? cloneConditionSet(current.enabledWhen) : undefined
  error.value = ""
}

function storeField(name: string) {
  if (!name) return
  if (visibleWhen.value || enabledWhen.value) {
    metadataDraft.value.fields[name] = {
      visibleWhen: visibleWhen.value ? cloneConditionSet(visibleWhen.value) : undefined,
      enabledWhen: enabledWhen.value ? cloneConditionSet(enabledWhen.value) : undefined,
    }
  } else {
    delete metadataDraft.value.fields[name]
  }
}

watch(open, (value) => {
  if (!value) return
  metadataDraft.value = {
    version: 1,
    fields: Object.fromEntries(props.fields
      .filter((field) => field.visibleWhen || field.enabledWhen)
      .map((field) => [field.name, {
        visibleWhen: field.visibleWhen ? cloneConditionSet(field.visibleWhen) : undefined,
        enabledWhen: field.enabledWhen ? cloneConditionSet(field.enabledWhen) : undefined,
      }])),
  }
  const next = props.fields.some((field) => field.name === fieldName.value)
    ? fieldName.value
    : props.fields[0]?.name ?? ""
  visibleWhen.value = undefined
  enabledWhen.value = undefined
  if (fieldName.value === next) loadField(next)
  else fieldName.value = next
})
watch(fieldName, (name, previous) => {
  if (name === previous) return
  storeField(previous)
  if (name) loadField(name)
})

function metadataWithDraft(): ComponentControlMetadata {
  storeField(fieldName.value)
  return {
    version: 1,
    fields: Object.fromEntries(Object.entries(metadataDraft.value.fields).map(([name, rule]) => [name, {
      visibleWhen: rule.visibleWhen ? cloneConditionSet(rule.visibleWhen) : undefined,
      enabledWhen: rule.enabledWhen ? cloneConditionSet(rule.enabledWhen) : undefined,
    }])),
  }
}

async function save() {
  if (!fieldName.value || saving.value || props.metadataValid === false) return
  const metadata = metadataWithDraft()
  const issues = validateComponentControlMetadata(metadata)
  if (issues.length) {
    error.value = issues[0]!.message
    return
  }
  saving.value = true
  error.value = ""
  try {
    const result = await writeComposerComponentControlMetadata(
      props.projectPath,
      props.relativeFile,
      metadata,
      props.mtimeMs,
    )
    emit("saved", { metadata, mtimeMs: result.mtimeMs })
    open.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[88vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Configure component controls</DialogTitle>
        <DialogDescription>Choose when each Inspector control is shown or available.</DialogDescription>
      </DialogHeader>

      <div v-if="metadataValid === false" role="alert" class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        Unable to edit the existing control rules. {{ metadataError }}
      </div>

      <div class="space-y-1.5">
        <label for="condition-control-field" class="text-xs font-medium text-foreground">Control</label>
        <Select v-model="fieldName" :disabled="saving || metadataValid === false">
          <SelectTrigger id="condition-control-field" class="h-9 text-sm"><SelectValue placeholder="Choose a control" /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="field in fields" :key="field.name" :value="field.name">{{ field.name }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <section v-if="selectedField" class="space-y-2" aria-labelledby="control-visible-heading">
        <div>
          <h3 id="control-visible-heading" class="text-sm font-medium text-foreground">Show control when…</h3>
          <p class="text-xs text-muted-foreground">Unknown values keep the control visible.</p>
        </div>
        <ComposerConditionBuilder v-model="visibleWhen" :sources="sources" :disabled="saving || metadataValid === false" />
      </section>

      <section v-if="selectedField" class="space-y-2 border-t border-dashed border-border pt-4" aria-labelledby="control-enabled-heading">
        <div>
          <h3 id="control-enabled-heading" class="text-sm font-medium text-foreground">Enable control when…</h3>
          <p class="text-xs text-muted-foreground">The control stays visible when this does not match.</p>
        </div>
        <ComposerConditionBuilder v-model="enabledWhen" :sources="sources" :disabled="saving || metadataValid === false" />
      </section>

      <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>

      <DialogFooter>
        <Button type="button" variant="outline" :disabled="saving" @click="open = false">Cancel</Button>
        <Button type="button" :disabled="saving || !selectedField || metadataValid === false" @click="save">
          {{ saving ? "Saving…" : "Save control rules" }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
