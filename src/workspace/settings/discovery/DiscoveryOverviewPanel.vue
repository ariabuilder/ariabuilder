<script setup lang="ts">
import { computed } from "vue"
import SettingsRow from "@/workspace/settings/SettingsRow.vue"
import { m } from "@/paraglide/messages.js"

export interface DiscoveryHealthCheckItem {
  id: string
  label: string
  status: "pass" | "warning" | "error"
  message?: string
}

/** Fixed slots so discourage ↔ llms swaps don't add/remove rows. */
const HEALTH_SLOT_IDS = [
  "site-url",
  "indexable-pages",
  "visibility-policy",
  "domain-alignment",
  "seo-audit",
] as const

const props = defineProps<{
  score: number
  checks: DiscoveryHealthCheckItem[]
  loading?: boolean
  disabled?: boolean
}>()

const discourageSearchEngines = defineModel<boolean>("discourageSearchEngines", {
  required: true,
})

const visibilityDescription = computed(() =>
  discourageSearchEngines.value
    ? m.settings_discovery_visibility_discouraged_description()
    : m.settings_discovery_visibility_discoverable_description(),
)

function resolveHealthSlot(
  slotId: (typeof HEALTH_SLOT_IDS)[number],
  checks: DiscoveryHealthCheckItem[],
): DiscoveryHealthCheckItem | null {
  switch (slotId) {
    case "site-url":
      return checks.find((check) => check.id === "site-url") ?? null
    case "indexable-pages":
      return checks.find((check) => check.id === "indexable-pages") ?? null
    case "visibility-policy":
      return (
        checks.find((check) => check.id === "discourage-search") ??
        checks.find((check) => check.id === "llms-visibility") ??
        null
      )
    case "domain-alignment":
      return checks.find((check) => check.id === "domain-alignment") ?? null
    case "seo-audit":
      return (
        checks.find((check) => check.id === "seo-errors") ??
        checks.find((check) => check.id === "seo-warnings") ??
        null
      )
  }
}

const stableChecks = computed(() =>
  HEALTH_SLOT_IDS.map((slotId) =>
    resolveHealthSlot(slotId, props.checks),
  ).filter((check): check is DiscoveryHealthCheckItem => check !== null),
)

const healthColumns = computed(
  (): [DiscoveryHealthCheckItem[], DiscoveryHealthCheckItem[]] => [
    stableChecks.value.slice(0, 2),
    stableChecks.value.slice(2),
  ],
)

const scoreDots = computed(() =>
  stableChecks.value.slice(0, 7).map((check) => check.status),
)

function dotColor(status: DiscoveryHealthCheckItem["status"] | undefined): string {
  switch (status) {
    case "pass":
      return "bg-emerald-400/80"
    case "warning":
      return "bg-amber-400/80"
    case "error":
      return "bg-red-400/80"
    default:
      return "bg-muted-foreground/25"
  }
}

function messageMinHeightClass(check: DiscoveryHealthCheckItem): string {
  if (check.id === "indexable-pages") {
    return "min-h-[3.25rem]"
  }
  if (check.message) {
    return "min-h-[1.125rem]"
  }
  return "min-h-0"
}

function visibilityTabClass(active: boolean): string {
  const base =
    "w-full min-h-9 touch-manipulation rounded-md px-2 py-2.5 text-xs tracking-normal transition-colors sm:px-2"
  return active
    ? `${base} bg-background text-foreground shadow-sm`
    : `${base} text-muted-foreground hover:text-foreground`
}

function selectVisibility(discouraged: boolean): void {
  if (props.disabled) return
  discourageSearchEngines.value = discouraged
}
</script>

<template>
  <section
    class="flex flex-col gap-8 sm:gap-10"
    :aria-busy="loading"
    :aria-label="m.settings_discovery_overview_label()"
  >
    <SettingsRow :label="m.settings_discovery_search_visibility()" full-width>
      <template #description>
        <span
          class="mt-1 block min-h-[2.75rem] text-balance text-xs leading-relaxed text-muted-foreground"
        >
          {{ visibilityDescription }}
        </span>
      </template>
      <div
        class="grid grid-cols-1 gap-1 rounded-md border border-solid border-border/50 bg-input p-1 sm:grid-cols-2"
        role="group"
        :aria-label="m.settings_discovery_search_visibility()"
      >
        <button
          type="button"
          :class="[
            visibilityTabClass(!discourageSearchEngines),
            'disabled:cursor-not-allowed disabled:opacity-40',
          ]"
          :disabled="disabled"
          :aria-pressed="!discourageSearchEngines"
          @click="selectVisibility(false)"
        >
          {{ m.settings_discovery_discoverable() }}
        </button>
        <button
          type="button"
          :class="[
            visibilityTabClass(discourageSearchEngines),
            'disabled:cursor-not-allowed disabled:opacity-40',
          ]"
          :disabled="disabled"
          :aria-pressed="discourageSearchEngines"
          @click="selectVisibility(true)"
        >
          {{ m.settings_discovery_discourage_crawlers() }}
        </button>
      </div>
    </SettingsRow>

    <div class="flex min-w-0 items-start gap-6 sm:gap-10">
      <div
        class="flex size-28 shrink-0 flex-col items-center justify-center rounded-full border border-border/50 bg-muted/10"
        role="img"
        :aria-label="
          m.settings_discovery_health_score_label({ score: String(score) })
        "
      >
        <template v-if="loading">
          <div class="size-10 animate-pulse rounded-full bg-muted/40" />
          <span class="sr-only">{{ m.settings_discovery_health_loading() }}</span>
        </template>
        <template v-else>
          <span class="text-3xl font-semibold tabular-nums text-foreground">
            {{ score }}
          </span>
          <div class="mt-2 flex items-center gap-1" aria-hidden="true">
            <span
              v-for="(status, index) in scoreDots"
              :key="`score-dot-${index}`"
              class="size-1.5 rounded-full"
              :class="dotColor(status)"
            />
            <span
              v-for="index in Math.max(0, 5 - scoreDots.length)"
              :key="`idle-dot-${index}`"
              class="size-1.5 rounded-full bg-muted-foreground/20"
            />
          </div>
        </template>
      </div>

      <div
        class="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden sm:flex-row sm:gap-8"
      >
        <template v-if="loading">
          <ul
            v-for="columnIndex in 2"
            :key="`health-skeleton-col-${columnIndex}`"
            class="flex min-w-0 flex-1 flex-col gap-4"
          >
            <li
              v-for="row in 2"
              :key="`health-skeleton-${columnIndex}-${row}`"
              class="space-y-1.5"
            >
              <div class="h-3.5 w-3/4 animate-pulse rounded-md bg-muted/25" />
              <div
                class="h-[3.25rem] w-full animate-pulse rounded-md bg-muted/15"
              />
            </li>
          </ul>
        </template>
        <template v-else>
          <ul
            v-for="(column, columnIndex) in healthColumns"
            :key="`health-col-${columnIndex}`"
            class="flex min-w-0 flex-1 flex-col gap-4"
          >
            <li
              v-for="check in column"
              :key="check.id"
              class="grid min-w-0 grid-cols-[0.375rem_1fr] items-start gap-x-3 gap-y-0.5"
            >
              <span
                class="mt-[0.45rem] size-1.5 shrink-0 rounded-full"
                :class="dotColor(check.status)"
              />
              <span
                class="min-w-0 text-balance text-sm leading-snug text-foreground"
              >
                {{ check.label }}
              </span>
              <p
                class="col-start-2 min-w-0 text-balance text-xs leading-relaxed text-muted-foreground/60"
                :class="messageMinHeightClass(check)"
              >
                {{ check.message ?? "" }}
              </p>
            </li>
          </ul>
        </template>
      </div>
    </div>
  </section>
</template>
