<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ColorField } from "@/components/ui/color-picker"
import { ColorPicker } from "@/components/ui/color-picker"
import { CHECKERBOARD_STYLE } from "@/components/ui/color-picker/checkerboard"
import { Input } from "@/components/ui/input"
import type {
  ColorShadeKey,
  DesignColorPalette,
  DesignColorTokenReference,
  DesignSemanticColors,
  DesignSnapshot,
  DesignToken,
  DesignTokenPreference,
  DesignTokenSource,
} from "../../../../shared/design"
import { writeClipboardText } from "@/lib/clipboard"
import {
  applyDesignTokenMutation,
  selectDesignTokenSource,
} from "@/lib/design"
import { m } from "@/paraglide/messages.js"
import { toast } from "vue-sonner"
import DesignHeaderTeleport from "../components/DesignHeaderTeleport.vue"
import PaletteScaleRow from "../components/PaletteScaleRow.vue"
import PaletteTemplateSelector from "../components/PaletteTemplateSelector.vue"
import ApplyPaletteTemplateDialog from "../components/ApplyPaletteTemplateDialog.vue"
import { generateNaturalShades } from "../lib/shades"
import { isSitePaletteManagedByAria } from "../lib/sitePaletteManagement"
import {
  expandTemplateToPalettes,
  getTemplatePreviewRows,
  listPaletteTemplates,
  THEME_PALETTE_ROLES,
  type PaletteTemplate,
} from "../lib/paletteTemplates"

const COLORS_TABS = [
  { id: "aria" as const },
  { id: "site" as const },
]

const props = defineProps<{
  projectRoot: string
  snapshot: DesignSnapshot | null
  saving?: boolean
}>()

const emit = defineEmits<{
  save: [
    payload: {
      palettes: DesignColorPalette[]
      semantic: DesignSemanticColors
      adoptedFrom: Record<
        string,
        NonNullable<DesignTokenPreference["adoptedFrom"]>
      >
    },
  ]
  siteTokenUpdated: [snapshot: DesignSnapshot]
}>()

const activeTab = ref<"aria" | "site">("aria")
const ariaPalettes = ref<DesignColorPalette[]>([])
const sitePalettes = ref<DesignColorPalette[]>([])
const siteTokenRefs = ref<DesignColorTokenReference[]>([])
const semantic = ref<DesignSemanticColors>({})
const adoptedFrom = ref<
  Record<string, NonNullable<DesignTokenPreference["adoptedFrom"]>>
>({})
const mutatingSources = ref(new Set<string>())
const copiedSwatch = ref<string | null>(null)
const showAdd = ref(false)
const newName = ref("")
const newColor = ref("#0d9488")
const templates = listPaletteTemplates()
const isApplyingTemplate = ref(false)
const templatePendingApply = ref<{ id: string; name: string } | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | null = null

const pendingTemplatePreviewRows = computed(() => {
  if (!templatePendingApply.value) return []
  const template = templates.find(
    (entry) => entry.id === templatePendingApply.value?.id,
  )
  return template ? getTemplatePreviewRows(template) : []
})

watch(
  () => props.snapshot,
  (snap) => {
    const all = snap?.colors.palettes ?? []
    const discovered = new Map<string, DesignColorPalette>()
    for (const token of snap?.tokens ?? []) {
      const siteSources = token.sources.filter(
        (source) =>
          source.ownership === "site" &&
          source.mode.id === "default" &&
          Boolean(source.resolvedValue),
      )
      if (!siteSources.length) continue
      const source =
        siteSources.find((candidate) => candidate.id === token.activeSourceId) ??
        siteSources.at(-1)!
      const palette = discovered.get(token.family) ?? {
        id: `site:${token.family}`,
        name: token.family,
        shades: {},
        source: "site" as const,
      }
      palette.shades[token.shade] = source.resolvedValue!
      discovered.set(token.family, palette)
    }
    sitePalettes.value = discovered.size
      ? [...discovered.values()]
      : all
          .filter((p) => p.source === "site")
          .map((p) => ({ ...p, shades: { ...p.shades } }))
    ariaPalettes.value = all
      .filter((p) => p.source === "aria")
      .map((p) =>
        ensureShades({
          ...p,
          shades: { ...p.shades },
        }),
      )
    siteTokenRefs.value = [...(snap?.colors.siteTokenRefs ?? [])]
    semantic.value = { ...(snap?.colors.semantic ?? {}) }
    adoptedFrom.value = Object.fromEntries(
      Object.entries(snap?.meta.tokenPreferences ?? {}).flatMap(
        ([id, preference]) =>
          preference.adoptedFrom ? [[id, { ...preference.adoptedFrom }]] : [],
      ),
    )
  },
  { immediate: true },
)

function ensureShades(palette: DesignColorPalette): DesignColorPalette {
  const base = palette.shades.DEFAULT || palette.shades["500"]
  if (!base) return palette
  if (Object.keys(palette.shades).length > 2) return palette
  return {
    ...palette,
    shades: generateNaturalShades(base),
  }
}

function updateBaseColor(name: string, color: string) {
  const idx = ariaPalettes.value.findIndex((p) => p.name === name)
  if (idx < 0) return
  ariaPalettes.value[idx] = {
    ...ariaPalettes.value[idx],
    shades: generateNaturalShades(color),
    source: "aria",
  }
}

function renamePalette(oldName: string, nextName: string) {
  const cleaned = nextName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
  if (!cleaned) return
  const idx = ariaPalettes.value.findIndex((p) => p.name === oldName)
  if (idx < 0) return
  if (ariaPalettes.value.some((p, i) => i !== idx && p.name === cleaned)) return
  if (sitePalettes.value.some((p) => p.name === cleaned)) return
  ariaPalettes.value[idx] = {
    ...ariaPalettes.value[idx],
    id: cleaned,
    name: cleaned,
    source: "aria",
  }
}

function removePalette(name: string) {
  ariaPalettes.value = ariaPalettes.value.filter((p) => p.name !== name)
}

async function copySwatch(hex: string, id: string) {
  try {
    await writeClipboardText(hex)
    copiedSwatch.value = id
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copiedSwatch.value = null
    }, 1200)
  } catch {
    /* ignore */
  }
}

function addPalette() {
  const name = newName.value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
  if (!name) return
  if (ariaPalettes.value.some((p) => p.name === name)) return
  ariaPalettes.value.push({
    id: name,
    name,
    shades: generateNaturalShades(newColor.value || "#0d9488"),
    source: "aria",
  })
  newName.value = ""
  newColor.value = "#0d9488"
  showAdd.value = false
  activeTab.value = "aria"
}

/** Copy a site palette (or token family) into Aria for editing/writing. */
function adoptSitePalette(palette: DesignColorPalette, options?: { stay?: boolean }) {
  if (ariaPalettes.value.some((p) => p.name === palette.name)) {
    if (!options?.stay) activeTab.value = "aria"
    return
  }
  const base =
    palette.shades.DEFAULT ||
    palette.shades["500"] ||
    Object.values(palette.shades).find(Boolean)
  if (!base) return
  const hasScale = Object.keys(palette.shades).length > 2
  ariaPalettes.value.push({
    id: palette.name,
    name: palette.name,
    shades: hasScale
      ? { ...palette.shades }
      : generateNaturalShades(base),
    source: "aria",
  })
  for (const token of sitePaletteTokens(palette)) {
    const source = activeSiteSource(token)
    if (!source) continue
    adoptedFrom.value[token.id] = {
      provider: source.provider,
      relativeFile: source.relativeFile,
      pointer: source.pointer,
      sourceHash: source.sourceHash,
    }
  }
  if (!options?.stay) activeTab.value = "aria"
}

function adoptAllSitePalettes() {
  if (!sitePalettes.value.length) return
  for (const palette of sitePalettes.value) {
    adoptSitePalette(palette, { stay: true })
  }
  activeTab.value = "aria"
}

function adoptTokenRef(ref: DesignColorTokenReference) {
  if (!ref.preview.length) return
  if (ariaPalettes.value.some((p) => p.name === ref.family)) {
    activeTab.value = "aria"
    return
  }
  const base = ref.preview[0]
  if (!base) return
  ariaPalettes.value.push({
    id: ref.family,
    name: ref.family,
    shades: generateNaturalShades(base),
    source: "aria",
  })
  activeTab.value = "aria"
}

type SiteSwatch = {
  shade: ColorShadeKey
  color: string
  token: DesignToken | null
  source: DesignTokenSource | null
}

function activeSiteSource(token: DesignToken): DesignTokenSource | null {
  const siteSources = token.sources.filter(
    (source) => source.ownership === "site" && source.mode.id === "default",
  )
  return (
    siteSources.find((source) => source.id === token.activeSourceId) ??
    [...siteSources].reverse().find((source) => Boolean(source.resolvedValue)) ??
    siteSources.at(-1) ??
    null
  )
}

function sitePaletteTokens(palette: DesignColorPalette): DesignToken[] {
  return (props.snapshot?.tokens ?? []).filter(
    (token) =>
      token.family === palette.name &&
      token.sources.some((source) => source.ownership === "site"),
  )
}

function sitePaletteEntries(palette: DesignColorPalette): SiteSwatch[] {
  return Object.entries(palette.shades)
    .filter((entry): entry is [ColorShadeKey, string] => Boolean(entry[1]))
    .sort(([a], [b]) => {
      if (a === "DEFAULT") return -1
      if (b === "DEFAULT") return 1
      return Number(a) - Number(b)
    })
    .map(([shade, color]) => {
      const token =
        props.snapshot?.tokens.find(
          (candidate) =>
            candidate.family === palette.name && candidate.shade === shade,
        ) ?? null
      return {
        shade,
        color,
        token,
        source: token ? activeSiteSource(token) : null,
      }
    })
}

function sitePaletteSource(palette: DesignColorPalette): DesignTokenSource | null {
  return sitePaletteEntries(palette).find((entry) => entry.source)?.source ?? null
}

function providerLabel(provider: DesignTokenSource["provider"]): string {
  switch (provider) {
    case "tailwind-config":
      return "Tailwind config"
    case "tailwind-theme":
      return "Tailwind @theme"
    case "css":
      return "CSS"
    default:
      return "Aria"
  }
}

function sourceCapability(source: DesignTokenSource): string {
  return source.writable
    ? m.design_colors_source_editable()
    : m.design_colors_source_read_only()
}

function sitePaletteUsage(palette: DesignColorPalette): number {
  return Math.max(0, ...sitePaletteTokens(palette).map((token) => token.usageCount))
}

function sitePaletteIsManaged(palette: DesignColorPalette): boolean {
  return isSitePaletteManagedByAria({
    palette,
    ariaPalettes: ariaPalettes.value,
    tokens: props.snapshot?.tokens ?? [],
    adoptedFrom: adoptedFrom.value,
  })
}

function ambiguousSiteEntries(palette: DesignColorPalette): SiteSwatch[] {
  return sitePaletteEntries(palette).filter((entry) => entry.token?.ambiguous)
}

async function chooseSiteSource(entry: SiteSwatch, event: Event) {
  const token = entry.token
  const snapshot = props.snapshot
  const sourceId = (event.target as HTMLSelectElement).value
  if (!token || !snapshot || !sourceId || mutatingSources.value.has(sourceId)) return
  mutatingSources.value = new Set(mutatingSources.value).add(sourceId)
  try {
    const result = await selectDesignTokenSource(props.projectRoot, {
      tokenId: token.id,
      sourceId,
      expectedRevision: snapshot.revision,
    })
    emit("siteTokenUpdated", result.snapshot)
    toast.success(m.design_save_success())
  } catch (error) {
    toast.error(m.design_save_failed(), {
      description: error instanceof Error ? error.message : String(error),
    })
  } finally {
    const next = new Set(mutatingSources.value)
    next.delete(sourceId)
    mutatingSources.value = next
  }
}

async function commitSiteToken(entry: SiteSwatch, value: string) {
  const token = entry.token
  const source = entry.source
  const snapshot = props.snapshot
  if (
    !token ||
    !source ||
    !source.writable ||
    token.ambiguous ||
    !snapshot ||
    mutatingSources.value.has(source.id)
  ) {
    return
  }
  mutatingSources.value = new Set(mutatingSources.value).add(source.id)
  try {
    const result = await applyDesignTokenMutation(props.projectRoot, {
      tokenId: token.id,
      sourceId: source.id,
      value,
      expectedRevision: snapshot.revision,
      expectedSourceHash: source.sourceHash,
    })
    emit("siteTokenUpdated", result.snapshot)
    toast.success(m.design_save_success())
  } catch (error) {
    toast.error(m.design_save_failed(), {
      description: error instanceof Error ? error.message : String(error),
    })
  } finally {
    const next = new Set(mutatingSources.value)
    next.delete(source.id)
    mutatingSources.value = next
  }
}

function save() {
  emit("save", {
    palettes: ariaPalettes.value.map((p) => ({
      ...p,
      source: "aria" as const,
    })),
    semantic: { ...semantic.value },
    adoptedFrom: { ...adoptedFrom.value },
  })
}

function openApplyTemplateDialog(template: PaletteTemplate) {
  templatePendingApply.value = {
    id: template.id,
    name: template.name,
  }
}

function closeApplyTemplateDialog() {
  if (!isApplyingTemplate.value) {
    templatePendingApply.value = null
  }
}

function confirmApplyTemplate() {
  if (!templatePendingApply.value || isApplyingTemplate.value) return
  const template = templates.find(
    (entry) => entry.id === templatePendingApply.value?.id,
  )
  if (!template) {
    templatePendingApply.value = null
    return
  }

  isApplyingTemplate.value = true
  try {
    const expanded = expandTemplateToPalettes(template)
    const roleSet = new Set<string>(THEME_PALETTE_ROLES)
    const extras = ariaPalettes.value.filter((p) => !roleSet.has(p.name))
    ariaPalettes.value = [
      ...THEME_PALETTE_ROLES.map((role) => ({
        id: role,
        name: role,
        shades: { ...expanded[role] },
        source: "aria" as const,
      })),
      ...extras,
    ]
    semantic.value = { ...template.semantic }
    activeTab.value = "aria"
    templatePendingApply.value = null
    save()
  } finally {
    isApplyingTemplate.value = false
  }
}
</script>

<template>
  <DesignHeaderTeleport target="actions">
    <div v-if="activeTab === 'aria'" class="flex items-center gap-2">
      <PaletteTemplateSelector
        :templates="templates"
        :is-applying="isApplyingTemplate || Boolean(saving)"
        :get-preview-rows="getTemplatePreviewRows"
        @apply="openApplyTemplateDialog"
      />
      <Button size="md" :disabled="saving || isApplyingTemplate" @click="save">
        {{ saving ? m.design_saving() : m.design_save() }}
      </Button>
    </div>
  </DesignHeaderTeleport>

  <div
    class="sticky top-0 z-10 flex h-12 shrink-0 items-stretch gap-1 border-y border-dashed border-border bg-background px-7"
  >
    <Button
      v-for="tab in COLORS_TABS"
      :key="tab.id"
      type="button"
      size="tab"
      :variant="activeTab === tab.id ? 'tab-active' : 'tab'"
      @click="activeTab = tab.id"
    >
      {{
        tab.id === "aria"
          ? m.design_colors_tab_aria()
          : m.design_colors_tab_site()
      }}
    </Button>
  </div>

  <div
    v-if="activeTab === 'aria'"
    class="design-page-card min-w-0 bg-background px-7 pb-10 pt-8"
  >
    <div class="mx-auto max-w-[100rem]">
      <section class="min-w-0 space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 space-y-1">
            <h2 class="m-0 text-lg font-medium text-foreground">
              {{ m.design_colors_palettes() }}
            </h2>
            <p class="m-0 text-sm text-muted-foreground">
              {{ m.design_colors_aria_hint() }}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            @click="showAdd = true"
          >
            <AppIcon name="plus" class="size-3.5" />
            {{ m.design_colors_palette_button() }}
          </Button>
        </div>

        <p
          v-if="ariaPalettes.length === 0"
          class="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground"
        >
          {{ m.design_colors_aria_empty() }}
        </p>

        <div v-else class="space-y-3">
          <PaletteScaleRow
            v-for="palette in ariaPalettes"
            :key="palette.name"
            :palette="palette"
            :copied-swatch="copiedSwatch"
            @update-base-color="updateBaseColor(palette.name, $event)"
            @rename="renamePalette(palette.name, $event)"
            @rename-variable="renamePalette(palette.name, $event)"
            @delete="removePalette(palette.name)"
            @copy="copySwatch"
          />
        </div>
      </section>
    </div>
  </div>

  <div
    v-else
    class="design-page-card mx-auto max-w-4xl space-y-8 px-7 pt-7 pb-10"
  >
    <section class="min-w-0 space-y-4">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <h2 class="m-0 text-2xl font-medium tracking-tight">
            {{ m.design_colors_site_palettes() }}
          </h2>
          <p class="m-0 text-sm text-muted-foreground">
            {{ m.design_colors_site_hint() }}
          </p>
        </div>
        <Button
          v-if="sitePalettes.length"
          type="button"
          size="sm"
          variant="outline"
          class="shrink-0"
          @click="adoptAllSitePalettes"
        >
          {{ m.design_colors_adopt_all() }}
        </Button>
      </div>

      <p
        v-if="sitePalettes.length === 0"
        class="rounded-lg border border-dashed border-border/70 px-4 py-12 text-center text-sm text-muted-foreground"
      >
        {{ m.design_colors_site_empty() }}
      </p>

      <ul v-else class="m-0 list-none space-y-2 p-0">
        <li
          v-for="palette in sitePalettes"
          :key="palette.name"
          class="flex items-center justify-between gap-4 rounded-md border border-border/60 px-4 py-3"
        >
          <div class="flex min-w-0 flex-1 items-center gap-4">
            <div class="w-36 shrink-0">
              <p class="m-0 truncate text-base font-medium text-foreground">
                {{ palette.name }}
              </p>
              <p class="m-0 truncate font-mono text-2xs text-muted-foreground">
                <template v-if="sitePaletteSource(palette)">
                  {{ providerLabel(sitePaletteSource(palette)!.provider) }} ·
                  {{ sitePaletteSource(palette)!.relativeFile }} ·
                  {{ sitePaletteSource(palette)!.mode.label }} ·
                  {{ sourceCapability(sitePaletteSource(palette)!) }}
                </template>
                <template v-else>--{{ palette.name }}</template>
              </p>
            </div>
            <div
              class="flex h-7 w-28 shrink-0 overflow-hidden rounded-sm border border-border/50"
            >
              <template
                v-for="entry in sitePaletteEntries(palette)"
                :key="`${palette.name}-${entry.shade}`"
              >
                <ColorPicker
                  v-if="entry.source?.writable && !entry.token?.ambiguous"
                  :model-value="entry.color"
                  layout="compact"
                  persist-mode="commit"
                  :show-variables="false"
                  :show-design-colors="false"
                  content-side="bottom"
                  content-align="start"
                  @commit="commitSiteToken(entry, $event)"
                >
                  <template #default="{ previewColor }">
                    <button
                      type="button"
                      class="h-full min-w-0 flex-1 cursor-pointer disabled:cursor-wait"
                      :style="{ backgroundColor: previewColor || entry.color }"
                      :title="`${entry.shade}: ${entry.color} · ${entry.source.pointer}`"
                      :disabled="mutatingSources.has(entry.source.id)"
                    />
                  </template>
                </ColorPicker>
                <span
                  v-else
                  class="min-w-0 flex-1"
                  :style="{ backgroundColor: entry.color }"
                  :title="`${entry.shade}: ${entry.color}${entry.token?.ambiguous ? ' · Choose a source before editing' : ''}`"
                />
              </template>
            </div>
            <span class="text-2xs text-muted-foreground">
              {{ m.design_colors_site_refs_meta({ count: String(sitePaletteUsage(palette)) }) }}
            </span>
            <label
              v-for="entry in ambiguousSiteEntries(palette)"
              :key="`${entry.token!.id}-source`"
              class="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground"
            >
              <span class="shrink-0">{{ entry.shade }}</span>
              <select
                class="h-7 min-w-0 max-w-52 cursor-pointer rounded border border-border bg-background px-2 text-2xs text-foreground"
                value=""
                :aria-label="m.design_colors_choose_source({ token: entry.token!.id })"
                @change="chooseSiteSource(entry, $event)"
              >
                <option value="" disabled>
                  {{ m.design_colors_choose_source_short() }}
                </option>
                <option
                  v-for="source in entry.token!.sources.filter((item) => item.ownership === 'site')"
                  :key="source.id"
                  :value="source.id"
                >
                  {{ providerLabel(source.provider) }} · {{ source.relativeFile }} · {{ source.mode.label }}
                </option>
              </select>
            </label>
          </div>
          <span
            v-if="sitePaletteIsManaged(palette)"
            class="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-2xs font-medium text-primary"
            :title="m.design_colors_managed_by_aria_hint()"
          >
            {{ m.design_colors_managed_by_aria() }}
          </span>
          <Button
            v-else
            type="button"
            size="xs"
            variant="ghost"
            class="shrink-0"
            @click="adoptSitePalette(palette)"
          >
            {{ m.design_colors_adopt() }}
          </Button>
        </li>
      </ul>

      <div
        v-if="snapshot?.diagnostics.length"
        class="space-y-2 rounded-md border border-border/60 bg-card/30 p-3"
      >
        <p class="m-0 text-xs font-medium text-foreground">
          {{ m.design_colors_diagnostics() }}
        </p>
        <p
          v-for="diagnostic in snapshot.diagnostics"
          :key="`${diagnostic.code}-${diagnostic.relativeFile}-${diagnostic.pointer}`"
          class="m-0 text-xs text-muted-foreground"
        >
          <span v-if="diagnostic.relativeFile" class="font-mono text-2xs">
            {{ diagnostic.relativeFile }}<template v-if="diagnostic.pointer"> · {{ diagnostic.pointer }}</template>:
          </span>
          {{ diagnostic.message }}
        </p>
      </div>
    </section>

    <section v-if="siteTokenRefs.length" class="min-w-0 space-y-4">
      <div class="space-y-1">
        <h2 class="m-0 text-2xl font-medium tracking-tight">
          {{ m.design_colors_site_refs() }}
        </h2>
        <p class="m-0 text-sm text-muted-foreground">
          {{ m.design_colors_site_refs_hint() }}
        </p>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button
          v-for="ref in siteTokenRefs"
          :key="ref.family"
          type="button"
          class="group flex flex-col gap-2.5 rounded-md border border-border/60 p-3 text-left transition-colors hover:border-border hover:bg-card/40 disabled:cursor-not-allowed disabled:opacity-70"
          :disabled="!ref.preview.length"
          @click="adoptTokenRef(ref)"
        >
          <div
            class="flex h-8 w-full overflow-hidden rounded-sm border border-border/40"
            :style="!ref.preview.length ? { background: CHECKERBOARD_STYLE } : undefined"
          >
            <template v-if="ref.preview.length">
              <span
                v-for="(color, index) in ref.preview"
                :key="`${ref.family}-p-${index}`"
                class="min-w-0 flex-1"
                :style="{ backgroundColor: color }"
              />
            </template>
            <template v-else>
              <span
                v-for="shade in ref.shades.slice(0, 6)"
                :key="`${ref.family}-s-${shade}`"
                class="min-w-0 flex-1 border-r border-border/30 last:border-r-0"
                :title="shade"
              />
            </template>
          </div>
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="m-0 truncate text-sm font-medium text-foreground">
                {{ ref.family }}
              </p>
              <p class="m-0 text-2xs text-muted-foreground">
                {{
                  m.design_colors_site_refs_meta({
                    count: String(ref.count),
                  })
                }}
              </p>
            </div>
            <span
              class="shrink-0 text-2xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-disabled:opacity-100"
            >
              {{ ref.preview.length ? m.design_colors_adopt() : m.design_colors_unresolved() }}
            </span>
          </div>
        </button>
      </div>
    </section>
  </div>

  <Dialog :open="showAdd" @update:open="showAdd = $event">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ m.design_colors_add_dialog_title() }}</DialogTitle>
        <DialogDescription>
          {{ m.design_colors_add_dialog_description() }}
        </DialogDescription>
      </DialogHeader>
      <div class="grid gap-3 py-2">
        <label class="space-y-1 text-sm">
          <span class="text-muted-foreground">{{
            m.design_colors_new_palette()
          }}</span>
          <Input
            v-model="newName"
            placeholder="primary"
            @keydown.enter="addPalette"
          />
        </label>
        <label class="space-y-1 text-sm">
          <span class="text-muted-foreground">{{
            m.design_colors_base_color()
          }}</span>
          <ColorField
            :model-value="newColor"
            layout="compact"
            persist-mode="live"
            :show-variables="false"
            :show-design-colors="false"
            content-side="bottom"
            content-align="start"
            @update:model-value="newColor = $event"
          />
        </label>
      </div>
      <DialogFooter>
        <Button variant="ghost" @click="showAdd = false">
          {{ m.design_stylesheets_stay() }}
        </Button>
        <Button @click="addPalette">{{ m.design_colors_add_palette() }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <ApplyPaletteTemplateDialog
    :open="Boolean(templatePendingApply)"
    :template-name="templatePendingApply?.name"
    :preview-rows="pendingTemplatePreviewRows"
    :is-applying="isApplyingTemplate"
    @update:open="(open) => !open && closeApplyTemplateDialog()"
    @confirm="confirmApplyTemplate"
  />
</template>
