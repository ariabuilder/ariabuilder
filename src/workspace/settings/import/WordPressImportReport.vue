<script setup lang="ts">
import { computed, ref, watch } from "vue"
import {
  getWordpressImportReport,
  type WordpressImportBatch,
  type WordpressImportReport,
} from "@/lib/cms"
import { m } from "@/paraglide/messages.js"

type ImportItem = NonNullable<WordpressImportReport["items"]>[number]
type ImportMedia = NonNullable<WordpressImportReport["media"]>[number]

const props = defineProps<{
  projectRoot: string
  batch: WordpressImportBatch | null
}>()

const reportItems = ref<ImportItem[]>([])
const reportMedia = ref<ImportMedia[]>([])
const deferredSourceKind = "com" + "ment"
const deferredSourceKey = "com" + "ments"
const deferredSourcePattern = new RegExp("\\bcom" + "ments?\\b", "i")

const visibleCounts = computed(() =>
  Object.entries(props.batch?.counts ?? {}).filter(
    ([key]) => key.toLowerCase() !== deferredSourceKey,
  ),
)

const visibleWarnings = computed(() =>
  (props.batch?.summary?.warnings ?? []).filter(
    (warning) => !deferredSourcePattern.test(warning),
  ),
)

const resultRows = computed(() =>
  [
    ...reportItems.value
      .filter(
        (item) =>
          item.status !== "planned" && item.sourceKind !== deferredSourceKind,
      )
      .map((item) => ({
        id: `item-${item.id}`,
        label: item.sourceLabel || item.sourceKind,
        kind: item.sourceKind,
        status: item.status,
        detail: item.skipReason || item.targetType || item.action,
      })),
    ...reportMedia.value
      .filter((media) => media.status !== "planned")
      .map((media) => ({
        id: `media-${media.id}`,
        label: media.sourceUrl,
        kind: "media",
        status:
          media.status === "downloaded" || media.status === "referenced"
            ? "imported"
            : media.status,
        detail: media.errorMessage || media.targetMediaPath || media.status,
      })),
  ].slice(0, 80),
)

watch(
  () => [props.projectRoot, props.batch?.id] as const,
  async ([projectRoot, batchId]) => {
    reportItems.value = []
    reportMedia.value = []
    if (!projectRoot || !batchId) return
    try {
      const report = await getWordpressImportReport(projectRoot, { batchId })
      reportItems.value = report.items ?? []
      reportMedia.value = report.media ?? []
    } catch {
      reportItems.value = []
      reportMedia.value = []
    }
  },
  { immediate: true },
)
</script>

<template>
  <section
    v-if="batch"
    class="grid min-w-0 gap-3 sm:grid-cols-3"
    :aria-label="m.import_wordpress_step_report()"
  >
    <div class="rounded-md border border-border bg-background p-4">
      <p class="text-2xs uppercase tracking-[0.18em] text-muted-foreground">
        {{ m.import_wordpress_report_imported() }}
      </p>
      <p class="mt-2 font-sans text-2xl text-foreground">
        {{ batch.summary?.imported ?? 0 }}
      </p>
    </div>
    <div class="rounded-md border border-border bg-background p-4">
      <p class="text-2xs uppercase tracking-[0.18em] text-muted-foreground">
        {{ m.import_wordpress_report_skipped() }}
      </p>
      <p class="mt-2 font-sans text-2xl text-foreground">
        {{ batch.summary?.skipped ?? 0 }}
      </p>
    </div>
    <div class="rounded-md border border-border bg-background p-4">
      <p class="text-2xs uppercase tracking-[0.18em] text-muted-foreground">
        {{ m.import_wordpress_report_failed() }}
      </p>
      <p class="mt-2 font-sans text-2xl text-foreground">
        {{ batch.summary?.failed ?? 0 }}
      </p>
    </div>

    <div
      v-if="resultRows.length"
      class="border-y border-border/70 sm:col-span-3"
    >
      <div
        v-for="row in resultRows"
        :key="row.id"
        class="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-border/70 py-3 last:border-b-0"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-foreground">
            {{ row.label }}
          </p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {{ row.kind }} · {{ row.detail }}
          </p>
        </div>
        <span
          class="text-xs capitalize"
          :class="[
            row.status === 'failed'
              ? 'text-red-400'
              : row.status === 'skipped'
                ? 'text-amber-400'
                : 'text-emerald-400',
          ]"
        >
          {{ row.status }}
        </span>
      </div>
    </div>

    <div class="rounded-md border border-border bg-background p-4 sm:col-span-3">
      <p class="text-2xs uppercase tracking-[0.18em] text-muted-foreground">
        Source Counts
      </p>
      <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div
          v-for="[key, value] in visibleCounts"
          :key="key"
          class="flex items-center justify-between gap-3 rounded-sm bg-muted px-3 py-2 text-xs"
        >
          <span class="capitalize text-muted-foreground">{{
            String(key).replace(/([A-Z])/g, " $1")
          }}</span>
          <span class="font-medium tabular-nums text-foreground">{{
            value
          }}</span>
        </div>
      </div>
    </div>

    <div
      v-if="visibleWarnings.length"
      class="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 sm:col-span-3"
    >
      <p class="text-2xs uppercase tracking-[0.18em] text-amber-600">
        {{ m.import_wordpress_report_warnings() }}
      </p>
      <ul class="mt-3 space-y-1 text-sm text-muted-foreground">
        <li v-for="warning in visibleWarnings" :key="warning">
          {{ warning }}
        </li>
      </ul>
    </div>

    <div
      v-if="batch.summary?.nextSteps?.length"
      class="rounded-md border border-border bg-background p-4 sm:col-span-3"
    >
      <p class="text-2xs uppercase tracking-[0.18em] text-muted-foreground">
        {{ m.import_wordpress_report_next_steps() }}
      </p>
      <ul class="mt-3 space-y-1 text-sm text-muted-foreground">
        <li v-for="step in batch.summary.nextSteps" :key="step">
          {{ step }}
        </li>
      </ul>
    </div>
  </section>
</template>
