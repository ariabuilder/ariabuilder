import {
  computed,
  inject,
  provide,
  ref,
  shallowRef,
  watch,
  type InjectionKey,
} from "vue"
import type { DesignClassRule } from "../../../../shared/design"
import { nodeAtMarkerPath } from "../../../../shared/composer"
import { tryUseComposerBeacon } from "../selection/useComposerBeacon"
import { tryUseComposerDesignClasses } from "../useComposerDesignContext"
import { tryUseComposerDocument } from "../useComposerDocumentSession"

export type InspectorClassHeaderActions = {
  canPasteStyles: () => boolean
  copyStyles: () => void | Promise<void>
  pasteStyles: () => void | Promise<void>
  editCss: () => void | Promise<void>
  done: () => void | Promise<void>
  rename: () => void | Promise<void>
  duplicate: () => void | Promise<void>
  removeActive: () => void | Promise<void>
}

export function createInspectorContext() {
  const document = tryUseComposerDocument()
  const selection = tryUseComposerBeacon()
  const design = tryUseComposerDesignClasses()
  if (!document || !selection) return null

  const selectedNode = computed(() => {
    const contextual = selection.contextSelection.value
    if (contextual) return contextual.node
    const path = selection.selectedPath.value
    return path && document.model.value
      ? nodeAtMarkerPath(document.model.value.nodes, path)
      : null
  })

  const activeClassName = ref<string | null>(null)
  const classHeaderActions = shallowRef<InspectorClassHeaderActions | null>(null)
  const targetBreakpoint = ref("base")
  const selectedPseudo = ref("default")
  const activeClass = computed<DesignClassRule | null>(() => {
    const name = activeClassName.value
    if (!name) return null
    return design?.snapshot.value?.classes.find((item) => item.name === name) ?? null
  })
  const styleTarget = computed<"element" | "class">(() =>
    activeClassName.value ? "class" : "element",
  )

  function setActiveClass(name: string | null) {
    activeClassName.value = name?.trim() || null
    selectedPseudo.value = "default"
  }

  function clearActiveClass() {
    setActiveClass(null)
  }

  function setSelectedPseudo(value: string) {
    selectedPseudo.value = activeClassName.value ? value : "default"
  }

  function registerClassHeaderActions(actions: InspectorClassHeaderActions) {
    classHeaderActions.value = actions
    return () => {
      if (classHeaderActions.value === actions) classHeaderActions.value = null
    }
  }

  watch(
    () => selection.contextSelection.value?.path ?? selection.selectedPath.value,
    () => {
      clearActiveClass()
      targetBreakpoint.value = "base"
    },
  )

  return {
    document,
    selection,
    selectedPath: computed(() =>
      selection.contextSelection.value?.path ?? selection.selectedPath.value,
    ),
    selectedNode,
    contextSelection: selection.contextSelection,
    isContextSelection: computed(() => Boolean(selection.contextSelection.value)),
    documentKind: document.documentKind,
    projectPath: document.projectPath,
    sourceFile: computed(() =>
      selection.contextSelection.value?.file ?? document.editFile.value,
    ),
    pages: document.pages,
    designSnapshot: design?.snapshot ?? ref(null),
    framework: design?.framework ?? ref(null),
    activeClassName,
    activeClass,
    classHeaderActions,
    targetBreakpoint,
    selectedPseudo,
    styleTarget,
    setActiveClass,
    clearActiveClass,
    registerClassHeaderActions,
    setSelectedPseudo,
    preview: {
      style: document.previewStyle,
      clearStyle: document.clearPreviewStyle,
      reload: document.reloadPreview,
    },
  }
}

export type InspectorContext = NonNullable<
  ReturnType<typeof createInspectorContext>
>

const INSPECTOR_CONTEXT_KEY: InjectionKey<InspectorContext> = Symbol(
  "aria.composer.inspector",
)

export function provideInspectorContext(): InspectorContext | null {
  const context = createInspectorContext()
  if (context) provide(INSPECTOR_CONTEXT_KEY, context)
  return context
}

export function tryUseInspectorContext(): InspectorContext | null {
  return inject(INSPECTOR_CONTEXT_KEY, null)
}
