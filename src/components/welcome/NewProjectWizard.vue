<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  cancelAstroProject,
  createAstroProject,
  onProjectCreationJob,
} from "@/lib/project"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import type { ProjectCreationJob } from "../../../shared/types"

const props = defineProps<{ dir: string }>()
const emit = defineEmits<{
  close: []
  done: [dir: string]
  chooseAnother: []
}>()

const ARIA_TEMPLATE = {
  value: "aria",
  label: () => m.wizard_template_aria_label(),
  hint: () => m.wizard_template_aria_hint(),
} as const

const ASTRO_TEMPLATES = [
  {
    value: "basics",
    label: () => m.wizard_template_basics_label(),
    hint: () => m.wizard_template_basics_hint(),
  },
  {
    value: "blog",
    label: () => m.wizard_template_blog_label(),
    hint: () => m.wizard_template_blog_hint(),
  },
  {
    value: "starlight",
    label: () => m.wizard_template_starlight_label(),
    hint: () => m.wizard_template_starlight_hint(),
  },
  {
    value: "minimal",
    label: () => m.wizard_template_minimal_label(),
    hint: () => m.wizard_template_minimal_hint(),
  },
] as const

type TemplateValue =
  | typeof ARIA_TEMPLATE.value
  | (typeof ASTRO_TEMPLATES)[number]["value"]

const template = ref<TemplateValue>("aria")
const install = ref(true)
const git = ref(true)
const ai = ref(false)
const running = ref(false)
const failed = ref<string | null>(null)
const currentJob = ref<ProjectCreationJob | null>(null)
const retryJobId = ref<string | undefined>()
const logEl = ref<HTMLPreElement | null>(null)
const jobId = ref("")
let unlisten: (() => void) | undefined

const log = computed(() => currentJob.value?.logs ?? "")
const progress = computed(() => Math.round((currentJob.value?.progress ?? 0) * 100))

onMounted(() => {
  void onProjectCreationJob((job) => {
    if (job.id !== jobId.value) return
    currentJob.value = job
    if (job.status === "failed" || job.status === "canceled") {
      running.value = false
      failed.value = job.error ?? m.wizard_creation_failed()
      retryJobId.value = job.id
    }
  }).then((stop) => {
    unlisten = stop
  })
})

onUnmounted(() => unlisten?.())

watch(log, async () => {
  await nextTick()
  if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
})

async function run() {
  running.value = true
  failed.value = null
  const nextJobId = crypto.randomUUID()
  jobId.value = nextJobId
  currentJob.value = {
    id: nextJobId,
    destination: props.dir,
    step: m.wizard_starting(),
    progress: 0,
    logs: "",
    status: "running",
  }
  try {
    await createAstroProject({
      jobId: nextJobId,
      retryJobId: retryJobId.value,
      dir: props.dir,
      template: template.value,
      install: install.value,
      git: git.value,
      ai: ai.value,
    })
    emit("done", props.dir)
  } catch (error) {
    running.value = false
    failed.value =
      currentJob.value?.error ??
      (error instanceof Error ? error.message : String(error))
  }
}

async function cancel() {
  if (!running.value) {
    emit("close")
    return
  }
  try {
    await cancelAstroProject(jobId.value)
  } catch (error) {
    failed.value = error instanceof Error ? error.message : String(error)
  }
}

async function copyLog() {
  if (!window.aria || !log.value) return
  await window.aria.clipboard.writeText(log.value)
}

function chooseAnother() {
  if (running.value) return
  emit("chooseAnother")
}

function openPartial() {
  if (running.value) return
  emit("done", props.dir)
}
</script>

<template>
  <Dialog :open="true" @update:open="(open) => { if (!open && !running) emit('close') }">
    <DialogContent
      class="flex max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[min(52rem,calc(100dvh-2rem))] sm:max-w-2xl"
      :show-close-button="false"
      @escape-key-down="(event) => { if (running) event.preventDefault() }"
      @interact-outside="(event) => event.preventDefault()"
    >
      <DialogHeader class="border-b border-border px-4 py-3 text-left sm:px-5 sm:py-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <DialogTitle class="text-sm font-medium">{{ m.wizard_title() }}</DialogTitle>
            <DialogDescription class="mt-1 truncate font-mono text-xs" :title="dir">
              {{ dir }}
            </DialogDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            :aria-label="m.wizard_close()"
            @click="cancel"
          >
            <AppIcon name="close" :size="16" />
          </Button>
        </div>
      </DialogHeader>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
        <template v-if="!running && !failed">
          <fieldset>
            <legend class="text-base font-medium">{{ m.wizard_prompt() }}</legend>

            <section class="mt-5" aria-labelledby="aria-template-heading">
              <h3
                id="aria-template-heading"
                class="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
              >
                {{ m.wizard_group_aria() }}
              </h3>

              <label
                :class="cn(
                  'relative flex min-h-20 cursor-pointer flex-col justify-center rounded-md border px-4 py-3 transition-colors focus-within:ring-2 focus-within:ring-ring/50',
                  template === ARIA_TEMPLATE.value
                    ? 'border-primary/60 bg-primary/15'
                    : 'border-border bg-foreground/3 hover:bg-muted/50',
                )"
              >
                <input
                  v-model="template"
                  type="radio"
                  name="project-template"
                  :value="ARIA_TEMPLATE.value"
                  class="sr-only"
                >
                <span class="flex min-w-0 flex-wrap items-center gap-2 pe-7">
                  <span class="text-sm font-medium">{{ ARIA_TEMPLATE.label() }}</span>
                  <span class="rounded-sm bg-primary/12 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {{ m.wizard_recommended() }}
                  </span>
                </span>
                <span class="mt-0.5 pe-7 text-xs leading-relaxed text-muted-foreground">
                  {{ ARIA_TEMPLATE.hint() }}
                </span>
                <span
                  :class="cn(
                    'pointer-events-none absolute top-3 end-3 flex size-4 items-center justify-center rounded-full border',
                    template === ARIA_TEMPLATE.value
                      ? 'border-primary'
                      : 'border-muted-foreground/50',
                  )"
                  aria-hidden="true"
                >
                  <span
                    v-if="template === ARIA_TEMPLATE.value"
                    class="size-2 rounded-full bg-primary"
                  />
                </span>
              </label>
            </section>

            <section class="mt-6" aria-labelledby="astro-template-heading">
              <h3
                id="astro-template-heading"
                class="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
              >
                {{ m.wizard_group_astro() }}
              </h3>

              <div class="grid grid-cols-1 gap-2 min-[30rem]:grid-cols-2">
                <label
                  v-for="item in ASTRO_TEMPLATES"
                  :key="item.value"
                  :class="cn(
                    'relative flex min-h-18 cursor-pointer flex-col justify-center rounded-md border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-ring/50',
                    template === item.value
                      ? 'border-primary/60 bg-primary/15'
                      : 'border-border bg-foreground/3 hover:bg-muted/50',
                  )"
                >
                  <input
                    v-model="template"
                    type="radio"
                    name="project-template"
                    :value="item.value"
                    class="sr-only"
                  >
                  <span class="pe-7 text-sm font-medium">{{ item.label() }}</span>
                  <span class="mt-0.5 pe-7 text-xs leading-relaxed text-muted-foreground">
                    {{ item.hint() }}
                  </span>
                  <span
                    :class="cn(
                      'pointer-events-none absolute top-3 end-3 flex size-4 items-center justify-center rounded-full border',
                      template === item.value
                        ? 'border-primary'
                        : 'border-muted-foreground/50',
                    )"
                    aria-hidden="true"
                  >
                    <span
                      v-if="template === item.value"
                      class="size-2 rounded-full bg-primary"
                    />
                  </span>
                </label>
              </div>
            </section>
          </fieldset>

          <fieldset class="mt-6">
            <legend class="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {{ m.wizard_group_setup() }}
            </legend>
            <div class="mt-2 rounded-md border border-border/70 bg-foreground/3 px-4 py-2">
              <label class="flex min-h-8 cursor-pointer items-center gap-3 text-sm text-muted-foreground">
                <input v-model="install" type="checkbox" class="size-4 accent-primary">
                {{ m.wizard_install_deps() }}
              </label>
              <label class="flex min-h-8 cursor-pointer items-center gap-3 text-sm text-muted-foreground">
                <input v-model="git" type="checkbox" class="size-4 accent-primary">
                {{ m.wizard_init_git() }}
              </label>
              <label class="flex min-h-8 cursor-pointer items-center gap-3 text-sm text-muted-foreground">
                <input v-model="ai" type="checkbox" class="size-4 accent-primary">
                {{ m.wizard_add_ai() }}
              </label>
            </div>
          </fieldset>
        </template>

        <template v-else>
          <div role="status" aria-live="polite" class="space-y-2">
            <div class="flex items-center justify-between gap-4 text-sm">
              <span>{{ currentJob?.step ?? m.wizard_starting() }}</span>
              <span class="font-mono text-xs text-muted-foreground">{{ progress }}%</span>
            </div>
            <div
              class="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              :aria-valuenow="progress"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div
                class="h-full rounded-full bg-primary transition-[width] duration-150 motion-reduce:transition-none"
                :style="{ width: `${progress}%` }"
              />
            </div>
          </div>
          <pre
            ref="logEl"
            class="mt-4 max-h-64 overflow-auto rounded-md bg-background/60 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
          >{{ log || m.wizard_starting() }}</pre>
          <p v-if="failed" role="alert" class="mt-3 text-sm text-destructive">
            {{ failed }}
          </p>
          <div v-if="failed" class="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" :disabled="!log" @click="copyLog">
              {{ m.wizard_copy_log() }}
            </Button>
            <Button type="button" variant="outline" size="sm" @click="openPartial">
              {{ m.wizard_open_partial() }}
            </Button>
            <Button type="button" variant="outline" size="sm" @click="chooseAnother">
              {{ m.wizard_choose_another() }}
            </Button>
          </div>
        </template>
      </div>

      <div class="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
        <Button type="button" variant="ghost" @click="cancel">
          {{ failed ? m.wizard_close() : m.wizard_cancel() }}
        </Button>
        <Button
          type="button"
          class="bg-foreground text-background hover:bg-foreground/90"
          :disabled="running"
          @click="run"
        >
          {{ running ? m.wizard_creating() : failed ? m.wizard_try_again() : m.wizard_create() }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
