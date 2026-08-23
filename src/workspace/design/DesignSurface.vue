<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  provide,
  shallowRef,
  toRef,
  watch,
  type ComponentPublicInstance,
} from "vue"
import {
  clearAgentSurfaceContext,
  updateAgentSurfaceContext,
} from "@/workspace/agent/surfaceContext"
import {
  PageHeader,
  StudioLeftRailReveal,
  StudioPanelShell,
} from "@/workspace/studio/core"
import { m } from "@/paraglide/messages.js"
import { DESIGN_VARIABLE_REFERENCES_KEY } from "@/composables/useVariableReferenceOptions"
import {
  DESIGN_COLOR_PICKER_KEY,
  type DesignColorPickerContext,
} from "./composables/useDesignColorPickerContext"
import DesignOrganizerRail from "./DesignOrganizerRail.vue"
import {
  DESIGN_HEADER_TELEPORT_KEY,
  DESIGN_HEADER_TELEPORT_TARGETS,
  type DesignHeaderTeleportRefs,
  type DesignHeaderTeleportTarget,
} from "./composables/useDesignHeaderTeleport"
import { useDesignSection } from "./composables/useDesignSection"
import { useDesignSnapshot } from "./composables/useDesignSnapshot"
import type { DesignSectionId } from "./types"
import {
  resolveVariableReferenceDirectValue,
  type VariableReferenceOption,
} from "./lib/variableReferences"
import { EMPTY_DESIGN_VARIABLES } from "../../../shared/design"
import ClassManagerView from "./views/ClassManagerView.vue"
import ColorsView from "./views/ColorsView.vue"
import FontsView from "./views/FontsView.vue"
import GlobalStylesView from "./views/GlobalStylesView.vue"
import IconsView from "./views/IconsView.vue"
import StylesheetsView from "./views/StylesheetsView.vue"
import VariableManagerView from "./views/VariableManagerView.vue"

const props = defineProps<{
  projectRoot: string
}>()

const projectRootRef = toRef(props, "projectRoot")
const { currentSection, setSection } = useDesignSection(projectRootRef)
const { snapshot, loading, saving, error, refresh, patch, adoptSnapshot } =
  useDesignSnapshot(projectRootRef)

watch(
  snapshot,
  (design) => {
    if (!design) {
      clearAgentSurfaceContext(props.projectRoot, "designContext")
      return
    }
    updateAgentSurfaceContext(props.projectRoot, {
      designContext: {
        revision: design.revision,
        classCount: design.classes.length,
        paletteCount: design.colors.palettes.length,
        fontFamilyCount:
          (design.fonts?.google?.length ?? 0) +
          (design.fonts?.custom?.length ?? 0),
      },
    })
  },
  { immediate: true, deep: true },
)

onBeforeUnmount(() => {
  clearAgentSurfaceContext(props.projectRoot, "designContext")
})

const STYLESHEET_STORAGE_PREFIX = "aria.design.stylesheet:"

function openStylesheetInStylesheetsView(relativePath: string) {
  try {
    localStorage.setItem(
      `${STYLESHEET_STORAGE_PREFIX}${props.projectRoot}`,
      relativePath,
    )
  } catch {
    /* ignore */
  }
  setSection("stylesheets")
}

const headerTeleportRefs: DesignHeaderTeleportRefs = {
  search: shallowRef<HTMLElement | null>(null),
  toolbar: shallowRef<HTMLElement | null>(null),
  importExport: shallowRef<HTMLElement | null>(null),
  stylesheet: shallowRef<HTMLElement | null>(null),
  maintenance: shallowRef<HTMLElement | null>(null),
  actions: shallowRef<HTMLElement | null>(null),
}

provide(DESIGN_HEADER_TELEPORT_KEY, headerTeleportRefs)

const colorPickerContext = computed<DesignColorPickerContext>(() => {
  const snap = snapshot.value
  if (!snap) {
    return {
      palettes: [],
      semantic: {},
      variables: EMPTY_DESIGN_VARIABLES,
    }
  }
  return {
    palettes: snap.colors.palettes,
    semantic: snap.colors.semantic,
    variables: snap.variables,
  }
})

provide(DESIGN_COLOR_PICKER_KEY, colorPickerContext)

function bindHeaderTeleportTarget(
  target: DesignHeaderTeleportTarget,
  element: Element | ComponentPublicInstance | null,
): void {
  headerTeleportRefs[target].value =
    element instanceof HTMLElement ? element : null
}

onBeforeUnmount(() => {
  for (const key of Object.keys(
    headerTeleportRefs,
  ) as DesignHeaderTeleportTarget[]) {
    headerTeleportRefs[key].value = null
  }
})

const headerTitle = computed(() => {
  switch (currentSection.value) {
    case "colors":
      return m.design_section_colors()
    case "typography":
      return m.design_section_fonts()
    case "global-styles":
      return m.design_section_global_styles()
    case "icons":
      return m.design_section_icons()
    case "stylesheets":
      return m.design_section_stylesheets()
    case "class-manager":
      return m.design_section_class_manager()
    case "variable-manager":
      return m.design_section_variable_manager()
  }
})

const headerDescription = computed(() => {
  switch (currentSection.value) {
    case "colors":
      return m.design_description_colors()
    case "typography":
      return m.design_description_fonts()
    case "global-styles":
      return m.design_description_global_styles()
    case "icons":
      return m.design_description_icons()
    case "stylesheets":
      return m.design_description_stylesheets()
    case "class-manager":
      return m.design_description_class_manager()
    case "variable-manager":
      return m.design_description_variable_manager()
  }
})

const variableReferences = computed<VariableReferenceOption[]>(() => {
  const snap = snapshot.value
  if (!snap) return []
  const refs: VariableReferenceOption[] = []
  for (const palette of snap.colors.palettes) {
    const base = palette.shades.DEFAULT || palette.shades["500"]
    if (base) {
      refs.push({
        value: palette.name,
        label: `--${palette.name}`,
        meta: base,
        group: "Palette Tokens",
        directValue: base,
      })
    }
    for (const [shade, value] of Object.entries(palette.shades)) {
      if (shade === "DEFAULT" || !value) continue
      refs.push({
        value: `${palette.name}-${shade}`,
        label: `--${palette.name}-${shade}`,
        meta: value,
        group: "Palette Tokens",
        directValue: value,
      })
    }
  }
  for (const [name, variable] of Object.entries(snap.variables.custom)) {
    refs.push({
      value: name,
      label: variable.label.trim() || `--${name}`,
      meta: variable.value,
      group: "Custom Variables",
      directValue: variable.value,
    })
  }
  for (const [name, alias] of Object.entries(snap.variables.aliases)) {
    const meta =
      alias.sourceType === "custom" && alias.sourceKey
        ? `var(--${alias.sourceKey})`
        : alias.sourceKey || alias.fallback || ""
    refs.push({
      value: name,
      label: alias.label.trim() || `--${name}`,
      meta,
      group: "Aliases",
      directValue: resolveVariableReferenceDirectValue(name, snap.variables),
    })
  }
  return refs
})

provide(DESIGN_VARIABLE_REFERENCES_KEY, variableReferences)

function onSelectSection(section: DesignSectionId) {
  setSection(section)
}
</script>

<template>
  <StudioPanelShell variant="rail" content-class="bg-background font-sans">
    <template #rail>
      <StudioLeftRailReveal>
        <DesignOrganizerRail
          :active-section="currentSection"
          @select-section="onSelectSection"
        />
      </StudioLeftRailReveal>
    </template>

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden font-sans">
      <PageHeader
        :title="headerTitle"
        :description="headerDescription"
        hide-search
        hide-create
        class="min-h-22 px-5 py-3 font-sans [&_h1]:font-sans"
      >
        <template #search>
          <div
            :id="DESIGN_HEADER_TELEPORT_TARGETS.search"
            :ref="(el) => bindHeaderTeleportTarget('search', el)"
            class="contents"
          />
        </template>
        <template #toolbar>
          <div
            :id="DESIGN_HEADER_TELEPORT_TARGETS.toolbar"
            :ref="(el) => bindHeaderTeleportTarget('toolbar', el)"
            class="contents"
          />
          <div
            :id="DESIGN_HEADER_TELEPORT_TARGETS.importExport"
            :ref="(el) => bindHeaderTeleportTarget('importExport', el)"
            class="contents"
          />
          <div
            :id="DESIGN_HEADER_TELEPORT_TARGETS.stylesheet"
            :ref="(el) => bindHeaderTeleportTarget('stylesheet', el)"
            class="contents"
          />
        </template>
        <template #actions>
          <div
            :id="DESIGN_HEADER_TELEPORT_TARGETS.maintenance"
            :ref="(el) => bindHeaderTeleportTarget('maintenance', el)"
            class="contents"
          />
          <div
            :id="DESIGN_HEADER_TELEPORT_TARGETS.actions"
            :ref="(el) => bindHeaderTeleportTarget('actions', el)"
            class="contents"
          />
        </template>
      </PageHeader>

      <p v-if="error" class="px-5 text-sm text-destructive">{{ error }}</p>
      <p
        v-else-if="loading && !snapshot"
        class="px-5 text-sm text-muted-foreground"
      >
        {{ m.design_loading() }}
      </p>

      <div
        class="min-h-0 flex-1"
        :class="
          currentSection === 'stylesheets' ? 'overflow-hidden' : 'overflow-auto'
        "
      >
        <ColorsView
          v-if="currentSection === 'colors'"
          :project-root="projectRoot"
          :snapshot="snapshot"
          :saving="saving"
          @site-token-updated="adoptSnapshot"
          @save="
            (payload) =>
              patch({
                colors: {
                  palettes: payload.palettes,
                  semantic: payload.semantic,
                  adoptedFrom: payload.adoptedFrom,
                },
              })
          "
        />
        <FontsView
          v-else-if="currentSection === 'typography'"
          :project-root="projectRoot"
          :snapshot="snapshot"
          :saving="saving"
          @save="(fonts) => patch({ fonts }, { silent: true })"
        />
        <GlobalStylesView
          v-else-if="currentSection === 'global-styles'"
          :snapshot="snapshot"
          :saving="saving"
          @save="(globalStyles) => patch({ globalStyles })"
        />
        <div v-else-if="currentSection === 'icons'" class="px-7 pb-7">
          <IconsView
            :project-root="projectRoot"
            :snapshot="snapshot"
            :saving="saving"
            @save="
              (enabledPacks) =>
                patch({ icons: { enabledPacks } }, { silent: true })
            "
          />
        </div>
        <div
          v-else-if="currentSection === 'stylesheets'"
          class="flex h-full min-h-0 flex-col overflow-hidden px-7 pb-7"
        >
          <StylesheetsView
            :project-root="projectRoot"
            :variable-references="variableReferences"
            @saved="refresh"
          />
        </div>
        <ClassManagerView
          v-else-if="currentSection === 'class-manager'"
          :project-root="projectRoot"
          :variable-references="variableReferences"
          :class-references="snapshot?.classes.map((item) => item.name) ?? []"
          @saved="refresh"
          @open-stylesheet="openStylesheetInStylesheetsView"
        />
        <VariableManagerView
          v-else-if="currentSection === 'variable-manager'"
          :snapshot="snapshot"
          :saving="saving"
          :variable-references="variableReferences"
          @save="(variables, options) => patch({ variables }, options)"
        />
      </div>
    </div>
  </StudioPanelShell>
</template>
