<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { toast } from "vue-sonner"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  applyWordpressImport,
  analyzeWordpressImport,
  cancelWordpressImport,
  getWordpressImportBatch,
  getWordpressImportEvents,
  listWordpressImportBatches,
  uploadWordpressImport,
  type WordpressImportBatch,
  type WordpressImportEvent,
  type WordpressImportScope,
} from "@/lib/cms"
import { m } from "@/paraglide/messages.js"
import ShimmerText from "./ShimmerText.vue"
import WordPressImportJourney from "./WordPressImportJourney.vue"
import WordPressImportReport from "./WordPressImportReport.vue"

type ImportScopeKey = keyof Omit<WordpressImportScope, "comments">

const props = defineProps<{
  projectRoot: string
}>()

const defaultImportScope = (): WordpressImportScope => ({
  posts: true,
  pages: true,
  customPostTypes: true,
  attachments: true,
  authors: true,
  terms: true,
  menus: true,
  customFields: true,
  seoFields: true,
})

const guideSteps = [
  {
    id: "source" as const,
    label: () => m.import_wordpress_step_source(),
    icon: "upload" as const,
  },
  {
    id: "review" as const,
    label: () => m.import_wordpress_step_review(),
    icon: "task" as const,
  },
  {
    id: "import" as const,
    label: () => m.import_wordpress_step_import(),
    icon: "databaseLine" as const,
  },
  {
    id: "report" as const,
    label: () => m.import_wordpress_step_report(),
    icon: "checkCircle" as const,
  },
]

type GuideStepId = (typeof guideSteps)[number]["id"]

const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<File | null>(null)
const activeBatch = ref<WordpressImportBatch | null>(null)
const events = ref<WordpressImportEvent[]>([])
const activeGuideStep = ref<GuideStepId>("source")
const selectedImportScope = ref<WordpressImportScope>(defaultImportScope())
const isUploading = ref(false)
const isApplying = ref(false)
const isCancelling = ref(false)
const isRefreshing = ref(false)
let pollTimer: number | null = null

const activeStepIndex = computed(() => {
  if (isUploading.value) return 1
  if (!activeBatch.value) return 0
  if (activeBatch.value.status === "planned") return 2
  if (activeBatch.value.status === "applying") return 4
  if (
    activeBatch.value.status === "completed" ||
    activeBatch.value.status === "failed" ||
    activeBatch.value.status === "cancelled"
  ) {
    return 5
  }
  return 1
})

const isJourneyActive = computed(
  () =>
    isUploading.value ||
    isApplying.value ||
    activeBatch.value?.status === "applying",
)

const showJourney = computed(
  () =>
    isUploading.value ||
    isApplying.value ||
    activeBatch.value?.status === "applying" ||
    activeBatch.value?.status === "analyzing",
)

const canApply = computed(
  () =>
    activeBatch.value?.status === "planned" &&
    activeBatch.value.sourceType === "wxr" &&
    selectedImportItemCount.value > 0 &&
    !isApplying.value,
)

const currentGuideStepIndex = computed(() =>
  guideSteps.findIndex((step) => step.id === activeGuideStep.value),
)

const selectedFileLabel = computed(() => {
  if (!selectedFile.value) return null
  return `${selectedFile.value.name} · ${Math.max(
    1,
    Math.round(selectedFile.value.size / 1024),
  )} KB`
})

const importSectionControls = computed(() => {
  const counts = activeBatch.value?.counts ?? {}
  return [
    {
      key: "posts" as const,
      title: m.import_wordpress_scope_posts_title(),
      description: m.import_wordpress_scope_posts_description(),
      count: counts.posts ?? 0,
    },
    {
      key: "pages" as const,
      title: m.import_wordpress_scope_pages_title(),
      description: m.import_wordpress_scope_pages_description(),
      count: counts.pages ?? 0,
    },
    {
      key: "customPostTypes" as const,
      title: m.import_wordpress_scope_custom_post_types_title(),
      description: m.import_wordpress_scope_custom_post_types_description(),
      count: counts.customPostTypes ?? 0,
    },
    {
      key: "attachments" as const,
      title: m.import_wordpress_scope_media_title(),
      description: m.import_wordpress_scope_media_description(),
      count: counts.attachments ?? 0,
    },
    {
      key: "terms" as const,
      title: m.import_wordpress_scope_terms_title(),
      description: m.import_wordpress_scope_terms_description(),
      count: counts.terms ?? 0,
    },
    {
      key: "authors" as const,
      title: m.import_wordpress_scope_authors_title(),
      description: m.import_wordpress_scope_authors_description(),
      count: counts.authors ?? 0,
    },
    {
      key: "menus" as const,
      title: m.import_wordpress_scope_menus_title(),
      description: m.import_wordpress_scope_menus_description(),
      count: counts.menus ?? 0,
    },
    {
      key: "customFields" as const,
      title: m.import_wordpress_scope_custom_fields_title(),
      description: m.import_wordpress_scope_custom_fields_description(),
      count: counts.cleanCustomFields ?? counts.customFields ?? 0,
    },
    {
      key: "seoFields" as const,
      title: m.import_wordpress_scope_seo_fields_title(),
      description: m.import_wordpress_scope_seo_fields_description(),
      count: counts.seoFields ?? 0,
    },
  ]
})

const selectedImportItemCount = computed(() =>
  importSectionControls.value.reduce(
    (total, section) =>
      selectedImportScope.value[section.key] ? total + section.count : total,
    0,
  ),
)

const activeImportMessage = computed(
  () =>
    activeBatch.value?.currentMessage ||
    (isUploading.value
      ? m.import_wordpress_analyzing()
      : m.import_wordpress_importing()),
)

const deferredSourcePattern = new RegExp("\\bcom" + "ments?\\b", "i")

const visibleWarnings = computed(() =>
  (activeBatch.value?.summary?.warnings ?? []).filter(
    (warning) => !deferredSourcePattern.test(warning),
  ),
)

function guideStepState(index: number): "complete" | "current" | "upcoming" {
  if (index < currentGuideStepIndex.value) return "complete"
  if (index === currentGuideStepIndex.value) return "current"
  return "upcoming"
}

function chooseFile(): void {
  fileInput.value?.click()
}

function handleFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  selectedFile.value = input.files?.[0] ?? null
  if (selectedFile.value && !activeBatch.value) {
    activeGuideStep.value = "source"
  }
}

async function refreshBatch(): Promise<void> {
  if (!activeBatch.value || isRefreshing.value) return
  isRefreshing.value = true
  try {
    const [batch, eventData] = await Promise.all([
      getWordpressImportBatch(props.projectRoot, {
        batchId: activeBatch.value.id,
      }),
      getWordpressImportEvents(props.projectRoot, {
        batchId: activeBatch.value.id,
      }),
    ])
    activeBatch.value = batch
    events.value = eventData
    if (
      batch.status === "completed" ||
      batch.status === "failed" ||
      batch.status === "cancelled"
    ) {
      activeGuideStep.value = "report"
      stopPolling()
      isApplying.value = false
    }
  } finally {
    isRefreshing.value = false
  }
}

function startPolling(): void {
  if (pollTimer) return
  pollTimer = window.setInterval(() => void refreshBatch(), 1000)
}

function stopPolling(): void {
  if (!pollTimer) return
  window.clearInterval(pollTimer)
  pollTimer = null
}

async function resumeActiveImport(): Promise<void> {
  try {
    const batches = await listWordpressImportBatches(props.projectRoot, {
      limit: 10,
    })
    const resumable = batches.find((batch) =>
      ["uploaded", "uploading", "analyzing", "applying"].includes(batch.status),
    )
    if (!resumable) return
    activeBatch.value = resumable
    activeGuideStep.value =
      resumable.status === "applying" || resumable.status === "analyzing"
        ? "import"
        : "review"
    await refreshBatch()
    if (["analyzing", "applying"].includes(activeBatch.value?.status ?? "")) {
      if (activeBatch.value?.status === "applying") {
        isApplying.value = true
      }
      startPolling()
    }
  } catch {
    // Resume is a convenience; controls still work without it.
  }
}

async function uploadAndAnalyze(): Promise<void> {
  if (!selectedFile.value) {
    toast.error(m.import_wordpress_no_xml())
    return
  }

  isUploading.value = true
  startPolling()
  try {
    const bytes = await selectedFile.value.arrayBuffer()
    const { batch } = await uploadWordpressImport(props.projectRoot, {
      filename: selectedFile.value.name,
      bytes,
    })
    activeBatch.value = batch
    if (batch.status !== "planned") {
      activeBatch.value = await analyzeWordpressImport(props.projectRoot, {
        batchId: batch.id,
      })
    }
    await refreshBatch()
    selectedImportScope.value = defaultImportScope()
    activeGuideStep.value = "review"
    toast.success(m.import_wordpress_analyze_xml())
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : m.import_wordpress_analyzing(),
    )
  } finally {
    isUploading.value = false
    if (activeBatch.value?.status !== "applying") {
      stopPolling()
    }
  }
}

async function applyImport(): Promise<void> {
  if (!activeBatch.value) return
  isApplying.value = true
  activeGuideStep.value = "import"
  startPolling()
  try {
    const batch = await applyWordpressImport(props.projectRoot, {
      batchId: activeBatch.value.id,
      scope: selectedImportScope.value,
    })
    activeBatch.value = batch
    await refreshBatch()
    if (
      activeBatch.value.status === "completed" ||
      activeBatch.value.status === "failed" ||
      activeBatch.value.status === "cancelled"
    ) {
      activeGuideStep.value = "report"
      if (activeBatch.value.status === "completed") {
        toast.success(m.import_wordpress_step_report())
      } else if (activeBatch.value.status === "cancelled") {
        toast.warning(m.import_wordpress_cancel())
      } else {
        toast.warning(m.import_wordpress_report_failed())
      }
    }
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : m.import_wordpress_importing(),
    )
    activeGuideStep.value = "report"
  } finally {
    isApplying.value = false
    stopPolling()
  }
}

async function cancelImport(): Promise<void> {
  if (!activeBatch.value || isCancelling.value) return
  isCancelling.value = true
  try {
    const batch = await cancelWordpressImport(props.projectRoot, {
      batchId: activeBatch.value.id,
    })
    activeBatch.value = batch
    await refreshBatch()
    activeGuideStep.value = "report"
    toast.warning(m.import_wordpress_cancel())
  } catch (error) {
    toast.error(error instanceof Error ? error.message : m.import_wordpress_cancel())
  } finally {
    isCancelling.value = false
    isApplying.value = false
    stopPolling()
  }
}

function goToSourceStep(): void {
  activeGuideStep.value = "source"
}

function goToReviewStep(): void {
  if (!activeBatch.value) return
  activeGuideStep.value = "review"
}

function resetImportFlow(): void {
  selectedFile.value = null
  activeBatch.value = null
  events.value = []
  selectedImportScope.value = defaultImportScope()
  activeGuideStep.value = "source"
  if (fileInput.value) fileInput.value.value = ""
}

function toggleImportSection(key: ImportScopeKey): void {
  selectedImportScope.value = {
    ...selectedImportScope.value,
    [key]: !selectedImportScope.value[key],
  }
}

onMounted(() => {
  void resumeActiveImport()
})

onBeforeUnmount(() => stopPolling())
</script>

<template>
  <div
    class="relative min-h-136 space-y-8 px-10 py-7"
    role="region"
    :aria-label="m.import_wordpress_aria()"
  >
    <div class="max-w-3xl space-y-2">
      <h4 class="m-0 font-sans text-xl font-medium text-foreground">
        {{ m.import_wordpress_title() }}
      </h4>
      <p
        class="max-w-2xl text-balance text-sm leading-relaxed text-muted-foreground"
      >
        {{ m.import_wordpress_description() }}
      </p>
    </div>

    <ol
      class="flex max-w-3xl items-center gap-2 border-b border-border/70 pb-4"
      :aria-label="m.import_wordpress_progress()"
    >
      <li
        v-for="(step, index) in guideSteps"
        :key="step.id"
        class="flex min-w-0 items-center gap-2"
        :data-state="guideStepState(index)"
        :aria-current="index === currentGuideStepIndex ? 'step' : undefined"
      >
        <span
          class="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium tabular-nums transition-colors"
          :class="[
            guideStepState(index) === 'complete'
              ? 'bg-primary text-primary-foreground'
              : guideStepState(index) === 'current'
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground',
          ]"
        >
          {{ index + 1 }}
        </span>
        <span
          class="truncate text-xs font-medium transition-colors"
          :class="[
            guideStepState(index) === 'current'
              ? 'text-foreground'
              : guideStepState(index) === 'complete'
                ? 'text-foreground/80'
                : 'text-muted-foreground/70',
          ]"
        >
          {{ step.label() }}
        </span>
        <span
          v-if="index < guideSteps.length - 1"
          class="h-px w-8 bg-border/70"
          aria-hidden="true"
        />
      </li>
    </ol>

    <input
      ref="fileInput"
      class="hidden"
      :aria-label="m.import_wordpress_choose_aria()"
      type="file"
      accept=".xml,.wxr,application/xml,text/xml"
      @change="handleFileChange"
    />

    <div class="max-w-3xl">
      <div v-if="activeGuideStep === 'source'" class="space-y-5">
        <div
          class="flex flex-wrap items-center justify-between gap-4 border-b border-border/70 pb-5"
        >
          <div class="min-w-0 space-y-1">
            <p class="truncate text-sm font-medium text-foreground">
              {{ selectedFileLabel ?? m.import_wordpress_no_xml() }}
            </p>
            <p class="text-xs leading-relaxed text-muted-foreground">
              {{ m.import_wordpress_xml_hint() }}
            </p>
          </div>
          <div class="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              class="h-9"
              :disabled="isUploading"
              @click="chooseFile"
            >
              <AppIcon name="upload" :size="16" class="mr-2 size-4" />
              {{ m.import_wordpress_choose_xml() }}
            </Button>
            <Button
              variant="default"
              size="sm"
              class="h-9"
              :disabled="!selectedFile || isUploading"
              @click="uploadAndAnalyze"
            >
              <AppIcon
                :name="isUploading ? 'loading' : 'search'"
                :size="16"
                class="mr-2 size-4"
                :class="isUploading ? 'animate-spin' : ''"
              />
              {{
                isUploading
                  ? m.import_wordpress_analyzing()
                  : m.import_wordpress_analyze_xml()
              }}
            </Button>
          </div>
        </div>
      </div>

      <div
        v-else-if="activeGuideStep === 'review' && activeBatch"
        class="space-y-6"
      >
        <div class="space-y-1.5">
          <h4 class="m-0 font-sans text-xl font-medium text-foreground">
            {{ m.import_wordpress_review_title() }}
          </h4>
          <p class="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {{ m.import_wordpress_review_description() }}
          </p>
        </div>

        <div class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h5
              class="m-0 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
            >
              {{ m.import_wordpress_review_what_to_import() }}
            </h5>
            <span class="text-xs text-muted-foreground">
              {{ m.import_wordpress_review_unchecked_skipped() }}
            </span>
          </div>
          <div class="divide-y divide-border/70 border-y border-border/70">
            <button
              v-for="section in importSectionControls"
              :key="section.key"
              type="button"
              class="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 text-left transition-opacity hover:bg-muted/20"
              :class="[
                selectedImportScope[section.key] ? 'opacity-100' : 'opacity-45',
              ]"
              :aria-pressed="selectedImportScope[section.key]"
              @click="toggleImportSection(section.key)"
            >
              <Checkbox
                class="shrink-0"
                :model-value="selectedImportScope[section.key]"
                @click.stop
                @update:model-value="toggleImportSection(section.key)"
              />
              <span class="min-w-0 flex-1">
                <span class="text-sm font-medium text-foreground">
                  {{ section.title }}
                </span>
                <span
                  class="mt-0.5 block text-xs leading-relaxed text-muted-foreground"
                >
                  {{ section.description }}
                </span>
              </span>
              <span class="shrink-0 text-sm tabular-nums text-muted-foreground">
                {{ section.count }}
              </span>
            </button>
          </div>
        </div>

        <div
          v-if="visibleWarnings.length"
          class="border-l border-amber-500/50 py-1 pl-4"
        >
          <p
            class="text-xs font-medium uppercase tracking-[0.18em] text-amber-600"
          >
            {{ m.import_wordpress_review_needs_attention() }}
          </p>
          <ul class="mt-3 space-y-1 text-sm text-muted-foreground">
            <li v-for="warning in visibleWarnings" :key="warning">
              {{ warning }}
            </li>
          </ul>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            class="h-9"
            :disabled="isApplying"
            @click="goToSourceStep"
          >
            <AppIcon name="arrowLeft" :size="16" class="mr-2 size-4" />
            {{ m.import_wordpress_review_back() }}
          </Button>
          <Button
            variant="default"
            size="sm"
            class="h-9"
            :disabled="!canApply"
            @click="applyImport"
          >
            <AppIcon name="upload" :size="16" class="mr-2 size-4" />
            {{ m.import_wordpress_review_import_selected() }}
          </Button>
        </div>
      </div>

      <div
        v-else-if="activeGuideStep === 'import'"
        class="flex min-h-88 items-center justify-center"
      >
        <div class="max-w-md text-center">
          <AppIcon
            name="loading"
            :size="32"
            class="mx-auto block size-8 animate-spin text-primary"
          />
          <p
            class="mt-5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
          >
            {{ m.import_wordpress_step_import() }}
          </p>
          <h4 class="mt-3 font-sans text-2xl font-medium text-foreground">
            <ShimmerText :text="activeImportMessage" />
          </h4>
          <div class="mt-6 h-1 overflow-hidden rounded-full bg-muted">
            <div
              class="h-full rounded-full bg-primary transition-all duration-300"
              :style="{
                width: `${Math.max(
                  0,
                  Math.min(Math.round(activeBatch?.progressPercent ?? 0), 100),
                )}%`,
              }"
            />
          </div>
          <div class="mt-6">
            <Button
              variant="outline"
              size="sm"
              class="h-9"
              :disabled="isCancelling"
              @click="cancelImport"
            >
              <AppIcon
                :name="isCancelling ? 'loading' : 'close'"
                :size="16"
                class="mr-2 size-4"
                :class="isCancelling ? 'animate-spin' : ''"
              />
              {{ m.import_wordpress_cancel() }}
            </Button>
          </div>
        </div>
      </div>

      <div
        v-else-if="activeGuideStep === 'report' && activeBatch"
        class="space-y-6"
      >
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="space-y-2">
            <h4 class="m-0 font-sans text-xl font-medium text-foreground">
              {{ m.import_wordpress_step_report() }}
            </h4>
            <p class="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {{ m.import_wordpress_description() }}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="h-9"
            @click="resetImportFlow"
          >
            <AppIcon name="refresh" :size="16" class="mr-2 size-4" />
            {{ m.import_wordpress_new_import() }}
          </Button>
        </div>
        <WordPressImportReport
          :project-root="projectRoot"
          :batch="activeBatch"
        />
        <div class="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            class="h-9"
            @click="goToReviewStep"
          >
            <AppIcon name="arrowLeft" :size="16" class="mr-2 size-4" />
            {{ m.import_wordpress_review_plan() }}
          </Button>
          <Button
            variant="default"
            size="sm"
            class="h-9"
            @click="resetImportFlow"
          >
            <AppIcon name="upload" :size="16" class="mr-2 size-4" />
            {{ m.import_wordpress_import_another() }}
          </Button>
        </div>
      </div>
    </div>

    <WordPressImportJourney
      v-if="showJourney"
      :batch="activeBatch"
      :events="events"
      :is-active="isJourneyActive"
      :active-step-index="activeStepIndex"
    />
  </div>
</template>
