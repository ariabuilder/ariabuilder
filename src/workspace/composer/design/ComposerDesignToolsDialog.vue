<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  provide,
  ref,
  shallowRef,
  watch,
  type ComponentPublicInstance,
} from "vue"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages.js"
import { useVariableReferenceOptions } from "@/composables/useVariableReferenceOptions"
import {
  DESIGN_HEADER_TELEPORT_KEY,
  DESIGN_HEADER_TELEPORT_TARGETS,
  type DesignHeaderTeleportRefs,
  type DesignHeaderTeleportTarget,
} from "@/workspace/design/composables/useDesignHeaderTeleport"
import { useDesignSnapshot } from "@/workspace/design/composables/useDesignSnapshot"
import ClassManagerView from "@/workspace/design/views/ClassManagerView.vue"
import VariableManagerView from "@/workspace/design/views/VariableManagerView.vue"
import { tryUseInspectorContext } from "../inspector/useInspectorContext"

type ManagerView = "classes" | "variables"

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  "update:open": [value: boolean]
}>()

const inspector = tryUseInspectorContext()
const projectRoot = computed(() => inspector?.projectPath.value ?? "")
const activeView = ref<ManagerView>("classes")
const tabButtons = ref<Partial<Record<ManagerView, HTMLButtonElement>>>({})
const { variableReferenceOptions } = useVariableReferenceOptions()
const { snapshot, saving, error, refresh, patch } = useDesignSnapshot(projectRoot)

const headerTeleportRefs: DesignHeaderTeleportRefs = {
  search: shallowRef<HTMLElement | null>(null),
  toolbar: shallowRef<HTMLElement | null>(null),
  importExport: shallowRef<HTMLElement | null>(null),
  stylesheet: shallowRef<HTMLElement | null>(null),
  maintenance: shallowRef<HTMLElement | null>(null),
  actions: shallowRef<HTMLElement | null>(null),
}

provide(DESIGN_HEADER_TELEPORT_KEY, headerTeleportRefs)

const views = computed(() => [
  {
    id: "classes" as const,
    title: m.design_section_class_manager(),
    description: m.composer_design_tools_classes(),
  },
  {
    id: "variables" as const,
    title: m.design_section_variable_manager(),
    description: m.composer_design_tools_variables(),
  },
])

watch(
  snapshot,
  (value) => {
    if (inspector && value) inspector.designSnapshot.value = value
  },
  { immediate: true },
)

watch(
  () => props.open,
  (open) => {
    if (open) void refresh()
  },
)

function bindHeaderTeleportTarget(
  target: DesignHeaderTeleportTarget,
  element: Element | ComponentPublicInstance | null,
) {
  headerTeleportRefs[target].value = element instanceof HTMLElement ? element : null
}

function setTabButton(id: ManagerView, element: unknown) {
  if (element instanceof HTMLButtonElement) tabButtons.value[id] = element
}

async function selectView(view: ManagerView, focus = false) {
  activeView.value = view
  if (focus) {
    await nextTick()
    tabButtons.value[view]?.focus()
  }
}

function onTabKeydown(event: KeyboardEvent, index: number) {
  let next = index
  if (event.key === "ArrowRight") next = (index + 1) % views.value.length
  else if (event.key === "ArrowLeft") next = (index - 1 + views.value.length) % views.value.length
  else if (event.key === "Home") next = 0
  else if (event.key === "End") next = views.value.length - 1
  else return
  event.preventDefault()
  void selectView(views.value[next]!.id, true)
}

onBeforeUnmount(() => {
  for (const target of Object.keys(headerTeleportRefs) as DesignHeaderTeleportTarget[]) {
    headerTeleportRefs[target].value = null
  }
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      class="h-[min(80dvh,820px)]! w-[min(80dvw,1180px)]! max-w-[calc(100vw-1.5rem)]! grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden bg-background p-0! font-sans dark:bg-sidebar"
    >
      <DialogTitle class="sr-only">{{ m.composer_design_tools_title() }}</DialogTitle>
      <DialogDescription class="sr-only">
        {{ m.composer_design_tools_description() }}
      </DialogDescription>

      <header class="border-b border-dashed border-border bg-background px-5 py-3 pr-14 dark:bg-sidebar">
        <div class="flex min-w-0 items-center gap-3">
          <div
            class="flex shrink-0 items-stretch gap-1.5"
            role="tablist"
            :aria-label="m.composer_design_tools_title()"
          >
            <button
              v-for="(view, index) in views"
              :id="`composer-design-tools-tab-${view.id}`"
              :key="view.id"
              :ref="(element) => setTabButton(view.id, element)"
              type="button"
              role="tab"
              :aria-selected="activeView === view.id"
              :aria-controls="`composer-design-tools-panel-${view.id}`"
              :tabindex="activeView === view.id ? 0 : -1"
              :class="cn(
                'w-40 rounded-md border px-2.5 py-1.5 text-left transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                activeView === view.id
                  ? 'border-primary/60 bg-primary/8 text-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted/45 hover:text-foreground dark:bg-sidebar',
              )"
              @click="selectView(view.id)"
              @keydown="onTabKeydown($event, index)"
            >
              <span class="block truncate text-sm font-medium">{{ view.title }}</span>
              <span class="mt-0.5 block truncate text-xs">{{ view.description }}</span>
            </button>
          </div>

          <div class="ml-auto flex min-w-0 shrink-0 items-center gap-2">
            <div
              :id="DESIGN_HEADER_TELEPORT_TARGETS.search"
              :ref="(element) => bindHeaderTeleportTarget('search', element)"
              class="contents"
            />
            <div
              :id="DESIGN_HEADER_TELEPORT_TARGETS.toolbar"
              :ref="(element) => bindHeaderTeleportTarget('toolbar', element)"
              class="contents"
            />
            <div
              :id="DESIGN_HEADER_TELEPORT_TARGETS.importExport"
              :ref="(element) => bindHeaderTeleportTarget('importExport', element)"
              class="contents"
            />
            <div
              :id="DESIGN_HEADER_TELEPORT_TARGETS.maintenance"
              :ref="(element) => bindHeaderTeleportTarget('maintenance', element)"
              class="contents"
            />
            <div
              :id="DESIGN_HEADER_TELEPORT_TARGETS.actions"
              :ref="(element) => bindHeaderTeleportTarget('actions', element)"
              class="contents"
            />
          </div>
        </div>

        <div
          v-show="activeView === 'classes'"
          class="mt-3 flex min-w-0 items-center"
        >
          <div
            :id="DESIGN_HEADER_TELEPORT_TARGETS.stylesheet"
            :ref="(element) => bindHeaderTeleportTarget('stylesheet', element)"
            class="min-w-0 flex-1"
          />
        </div>
      </header>

      <div class="min-h-0 overflow-auto bg-background dark:bg-sidebar">
        <p v-if="error" class="px-7 py-3 text-sm text-destructive">{{ error }}</p>
        <section
          v-if="activeView === 'classes'"
          id="composer-design-tools-panel-classes"
          role="tabpanel"
          aria-labelledby="composer-design-tools-tab-classes"
          class="min-h-full"
        >
          <ClassManagerView
            v-if="open && projectRoot"
            :project-root="projectRoot"
            :variable-references="variableReferenceOptions"
            :class-references="snapshot?.classes.map((item) => item.name) ?? []"
            @saved="refresh"
          />
        </section>
        <section
          v-else
          id="composer-design-tools-panel-variables"
          role="tabpanel"
          aria-labelledby="composer-design-tools-tab-variables"
          class="min-h-full"
        >
          <VariableManagerView
            v-if="open"
            :snapshot="snapshot"
            :saving="saving"
            :variable-references="variableReferenceOptions"
            @save="(variables, options) => patch({ variables }, options)"
          />
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>
