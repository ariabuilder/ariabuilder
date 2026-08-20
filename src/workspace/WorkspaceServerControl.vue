<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  startSessionRuntime,
  stopSessionRuntime,
  type ProjectRuntimeSession,
} from "@/lib/sessions"
import { m } from "@/paraglide/messages.js"

const props = defineProps<{
  projectPath: string
  runtime: ProjectRuntimeSession | null
}>()

const runtimeBusy = ref(false)
const liveReveal = ref<"out" | "in" | "settled">("out")
const liveRevealEl = ref<HTMLElement | null>(null)

const status = computed(() => props.runtime?.status ?? "stopped")

const previewBusy = computed(
  () =>
    runtimeBusy.value ||
    status.value === "starting" ||
    status.value === "stopping" ||
    status.value === "installing",
)

const isLive = computed(() => status.value === "live")
const isExternal = computed(
  () => isLive.value && props.runtime?.previewOwnership === "external",
)

/** Outer swap: progress ring while busy, play/stop when idle. */
const busySwapState = computed(() => (previewBusy.value ? "a" : "b"))

/** Inner swap: play when offline, stop when live. */
const serverIconState = computed(() => (isLive.value ? "b" : "a"))

const serverActionLabel = computed(() =>
  isExternal.value
    ? m.workspace_disconnect_server()
    : isLive.value
      ? m.workspace_stop_server()
      : m.workspace_start_server(),
)

const serverActionDisabled = computed(
  () => previewBusy.value || status.value === "needs_install",
)

async function replayLiveReveal() {
  liveReveal.value = "out"
  await nextTick()
  void liveRevealEl.value?.offsetWidth
  liveReveal.value = "in"
}

watch(
  () => ({ live: isLive.value, busy: previewBusy.value }),
  (cur, prev) => {
    if (!cur.live) {
      liveReveal.value = "out"
      return
    }
    // Celebrate when spinner clears into a live server (not on cold already-live).
    const becameReady =
      !cur.busy && prev != null && (prev.busy || !prev.live)
    if (becameReady) void replayLiveReveal()
  },
)

onMounted(() => {
  if (isLive.value && !previewBusy.value) liveReveal.value = "settled"
})

async function toggleServer() {
  if (serverActionDisabled.value) return
  runtimeBusy.value = true
  try {
    if (isLive.value) {
      await stopSessionRuntime(props.projectPath)
    } else {
      await startSessionRuntime(props.projectPath)
    }
  } catch (error) {
    console.error("Failed to toggle preview server:", error)
  } finally {
    runtimeBusy.value = false
  }
}
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <span
        class="inline-flex shrink-0"
        :class="
          serverActionDisabled
            ? 'text-muted-foreground/70 cursor-pointer'
            : isLive
              ? 'text-primary'
              : 'text-muted-foreground'
        "
        tabindex="-1"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          class="cursor-pointer"
          :class="
            isLive && !serverActionDisabled
              ? 'text-primary hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20'
              : undefined
          "
          :disabled="serverActionDisabled"
          :aria-label="serverActionLabel"
          :aria-busy="previewBusy || undefined"
          @click="toggleServer"
        >
          <span
            class="t-icon-swap"
            :data-state="busySwapState"
            aria-hidden
          >
            <span class="t-icon" data-icon="a">
              <svg
                class="t-progress-ring"
                viewBox="0 0 18 18"
                aria-hidden="true"
              >
                <circle cx="9" cy="9" r="7" />
              </svg>
            </span>
            <span class="t-icon" data-icon="b">
              <span class="t-icon-swap" :data-state="serverIconState">
                <span class="t-icon" data-icon="a">
                  <AppIcon name="play" :size="18" />
                </span>
                <span class="t-icon" data-icon="b">
                  <span
                    ref="liveRevealEl"
                    class="t-success-check"
                    :data-state="liveReveal"
                  >
                    <AppIcon name="shutDown" :size="18" />
                  </span>
                </span>
              </span>
            </span>
          </span>
        </Button>
      </span>
    </TooltipTrigger>
    <TooltipContent side="right" :side-offset="8">
      {{ serverActionLabel }}
    </TooltipContent>
  </Tooltip>
</template>
