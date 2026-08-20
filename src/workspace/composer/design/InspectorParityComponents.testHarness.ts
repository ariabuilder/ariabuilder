// @vitest-environment jsdom

import { computed, createApp, defineComponent, h, ref, type Component } from "vue"
import { afterEach, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import ComposerInspectorHeader from "../chrome/ComposerInspectorHeader.vue"
import type { AstroDocumentModel } from "../../../../shared/composer/types"
import { provideInspectorContext } from "../inspector/useInspectorContext"
import { provideComposerBeacon } from "../selection/useComposerBeacon"
import {
  provideComposerDocument,
  type ComposerDocumentSession,
} from "../useComposerDocumentSession"

export const mounted: Array<() => void> = []

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
})

export function mount(component: Component, props: Record<string, unknown> = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({ render: () => h(component, props) })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return host
}

export function mountWithTooltipProvider(
  component: Component,
  props: Record<string, unknown> = {},
) {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    render: () => h(TooltipProvider, null, {
      default: () => h(component, props),
    }),
  })
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return host
}

export function mountInspectorHeaderSelection(activeClassName: string | null = null) {
  const host = document.createElement("div")
  document.body.append(host)
  const model = ref<AstroDocumentModel | null>({
    imports: [],
    extraFrontmatter: "",
    nodes: [{ id: "hero", kind: "component", name: "Hero", props: {}, children: [] }],
    propSchema: [],
    slots: [],
    extendsTag: null,
  })
  const actions = {
    canPasteStyles: () => true,
    copyStyles: vi.fn(),
    pasteStyles: vi.fn(),
    editCss: vi.fn(),
    done: vi.fn(),
    rename: vi.fn(),
    duplicate: vi.fn(),
    removeActive: vi.fn(),
  }
  const InspectorProvider = defineComponent({
    setup() {
      const inspector = provideInspectorContext()
      if (activeClassName) {
        inspector?.setActiveClass(activeClassName)
        inspector?.registerClassHeaderActions(actions)
      }
      return () => h(TooltipProvider, null, {
        default: () => h(ComposerInspectorHeader),
      })
    },
  })
  const app = createApp(defineComponent({
    setup() {
      const beacon = provideComposerBeacon()
      provideComposerDocument({
        model,
        editable: ref(true),
        designActive: ref(true),
        projectPath: ref("/project"),
        editFile: ref("src/pages/index.astro"),
        availableLayouts: ref([]),
        pages: ref([]),
        documentKind: computed(() => "page" as const),
      } as unknown as ComposerDocumentSession)
      beacon.inspectContext({
        file: "src/pages/index.astro",
        path: "0",
        label: "Hero",
        node: model.value!.nodes[0]!,
      })
      return () => h(InspectorProvider)
    },
  }))
  app.mount(host)
  mounted.push(() => { app.unmount(); host.remove() })
  return { host, actions }
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount()
})
