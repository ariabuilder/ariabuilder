<script setup lang="ts">
import { computed, ref, watch } from "vue"

import { Button } from "@/components/ui/button"
import { ColorField } from "@/components/ui/color-picker"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  VariableAssignableInput,
  VariableReferenceAssignButton,
} from "@/components/ui/variable-reference-picker"
import { useVariableReferenceOptions } from "@/composables/useVariableReferenceOptions"
import { m } from "@/paraglide/messages.js"
import type { SpacingSides } from "../../../../shared/composer/styleAttr"
import type {
  DesignGlobalStyles,
  DesignSnapshot,
  GlobalStyleButtonVariant,
} from "../../../../shared/design"
import {
  cloneGlobalStyles,
  createEmptyGlobalStyles,
  mergeGlobalStyles,
} from "../../../../shared/design"
import DesignHeaderTeleport from "../components/DesignHeaderTeleport.vue"
import GlobalStylesLinkedSides from "../components/GlobalStylesLinkedSides.vue"
import {
  BUTTON_BASE_FIELDS,
  BUTTON_SECTION_TITLE,
  BUTTON_VARIANT_FIELDS,
  DEFAULT_SECTIONS,
  GLOBAL_STYLE_BUTTON_VARIANTS,
  type FieldDefinition,
  type SectionDefinition,
} from "../lib/globalStylesFields"
import {
  createVariableReferenceValue,
  extractVariableReferenceKey,
} from "../lib/variableReferences"
import { buildDesignFontOptions } from "../lib/fontOptions"

const EMPTY_SELECT_VALUE = "__empty__"
const CONTROL_CLASS =
  "h-9.5! px-3 text-sm text-muted-foreground placeholder:text-muted-foreground"
const FONT_SELECT_CONTROL_CLASS =
  "h-9.5! ps-3 pe-10 text-sm text-muted-foreground placeholder:text-muted-foreground [&>svg]:me-8"
const SPACING_INPUT_CLASS =
  "h-9.5! pl-9 pr-3 text-sm text-muted-foreground placeholder:text-muted-foreground"
const READONLY_CONTROL_CLASS =
  "flex h-9.5 min-w-0 items-center rounded-sm border border-border/50 border-solid bg-sidebar/40 px-3 text-sm text-foreground"

const props = defineProps<{
  snapshot: DesignSnapshot | null
  saving?: boolean
}>()

const emit = defineEmits<{
  save: [styles: DesignGlobalStyles]
}>()

const styles = ref<DesignGlobalStyles>(cloneGlobalStyles(createEmptyGlobalStyles()))
const lastDirectValues = new Map<string, string>()
const marginLinked = ref(true)
const paddingLinked = ref(true)

watch(
  () => props.snapshot,
  (snap) => {
    lastDirectValues.clear()
    styles.value = mergeGlobalStyles(
      createEmptyGlobalStyles(),
      snap?.globalStyles ?? createEmptyGlobalStyles(),
    )
    marginLinked.value = areSpacingAxesLinked(bodySpacingValues("margin"))
    paddingLinked.value = areSpacingAxesLinked(bodySpacingValues("padding"))
  },
  { immediate: true },
)

const { variableReferenceOptions } = useVariableReferenceOptions()

const sectionTabs = [
  ...DEFAULT_SECTIONS.map((section) => section.title),
  BUTTON_SECTION_TITLE,
]

const activeSectionTitle = ref(sectionTabs[0] ?? BUTTON_SECTION_TITLE)

const activeDefaultSection = computed(
  () =>
    DEFAULT_SECTIONS.find(
      (section) => section.title === activeSectionTitle.value,
    ) ?? null,
)

const availableFonts = computed(() => {
  return buildDesignFontOptions(props.snapshot?.fonts, [
    styles.value.body.fontFamily,
    styles.value.heading.fontFamily,
    styles.value.input.fontFamily,
    styles.value.button.base.fontFamily,
  ]).map((option) => option.family)
})

function getPath(target: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current == null || typeof current !== "object") return undefined
    return (current as Record<string, unknown>)[key]
  }, target)
}

function setPath(target: Record<string, unknown>, path: string, value: string) {
  const keys = path.split(".")
  let cursor: Record<string, unknown> = target
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index]!
    const next = cursor[key]
    if (next == null || typeof next !== "object") {
      cursor[key] = {}
    }
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[keys[keys.length - 1]!] = value
}

function getStringValue(path: string): string {
  const value = getPath(styles.value, path)
  return typeof value === "string" ? value : ""
}

function setStringValue(path: string, value: string) {
  setPath(styles.value as unknown as Record<string, unknown>, path, value)
}

function isVariableReferencePath(path: string): boolean {
  return extractVariableReferenceKey(getStringValue(path)) !== null
}

function handleVariableReferenceUpdate(
  path: string,
  nextValue: string | null,
): void {
  const currentValue = getStringValue(path)
  if (!nextValue) {
    const currentKey = extractVariableReferenceKey(currentValue)
    const resolvedValue = currentKey
      ? variableReferenceOptions.value.find((option) => option.value === currentKey)?.directValue ?? ""
      : ""
    setStringValue(path, lastDirectValues.get(path) ?? resolvedValue)
    return
  }
  if (extractVariableReferenceKey(currentValue) === null) {
    lastDirectValues.set(path, currentValue)
  }
  setStringValue(path, createVariableReferenceValue(nextValue))
}

function getSelectModelValue(path: string): string {
  const value = getStringValue(path).trim()
  return value || EMPTY_SELECT_VALUE
}

function handleSelectUpdate(path: string, nextValue: string): void {
  setStringValue(
    path,
    nextValue === EMPTY_SELECT_VALUE ? "" : nextValue,
  )
}

function isToggleOn(field: FieldDefinition): boolean {
  const onValue = field.onValue ?? "true"
  return getStringValue(field.path).trim() === onValue
}

function handleToggleUpdate(field: FieldDefinition, checked: boolean): void {
  setStringValue(field.path, checked ? (field.onValue ?? "true") : "")
}

function bodySpacingValues(property: "margin" | "padding"): SpacingSides {
  const body = styles.value.body
  if (property === "margin") {
    return {
      top: body.marginTop,
      right: body.marginRight,
      bottom: body.marginBottom,
      left: body.marginLeft,
    }
  }
  return {
    top: body.paddingTop,
    right: body.paddingRight,
    bottom: body.paddingBottom,
    left: body.paddingLeft,
  }
}

function areSpacingAxesLinked(sides: SpacingSides): boolean {
  return sides.top === sides.bottom && sides.left === sides.right
}

function setBodySpacingValues(
  property: "margin" | "padding",
  sides: SpacingSides,
): void {
  const body = styles.value.body
  if (property === "margin") {
    body.marginTop = sides.top
    body.marginRight = sides.right
    body.marginBottom = sides.bottom
    body.marginLeft = sides.left
    return
  }
  body.paddingTop = sides.top
  body.paddingRight = sides.right
  body.paddingBottom = sides.bottom
  body.paddingLeft = sides.left
}

function spacingLinkedModel(property: "margin" | "padding"): boolean {
  return property === "margin" ? marginLinked.value : paddingLinked.value
}

function setSpacingLinked(property: "margin" | "padding", linked: boolean): void {
  if (property === "margin") marginLinked.value = linked
  else paddingLinked.value = linked
}

function selectedOptionLabel(field: FieldDefinition): string {
  const value = getStringValue(field.path).trim()
  if (!value) return m.design_globals_no_override()
  const match = field.options?.find((option) => option.value === value)
  return match?.label ?? value
}

function sectionLabel(title: string): string {
  switch (title) {
    case "Body":
      return m.design_globals_body()
    case "Headings":
      return m.design_globals_heading()
    case "Links":
      return m.design_globals_link()
    case "Inputs":
      return m.design_globals_input()
    case "Sections":
      return m.design_globals_section()
    case "Containers":
      return m.design_globals_container()
    case "Root":
      return m.design_globals_root()
    case BUTTON_SECTION_TITLE:
      return m.design_globals_button()
    default:
      return title
  }
}

function sectionDescription(section: SectionDefinition): string {
  switch (section.title) {
    case "Body":
      return m.design_globals_desc_body()
    case "Headings":
      return m.design_globals_desc_heading()
    case "Links":
      return m.design_globals_desc_link()
    case "Inputs":
      return m.design_globals_desc_input()
    case "Sections":
      return m.design_globals_desc_section()
    case "Containers":
      return m.design_globals_desc_container()
    case "Root":
      return m.design_globals_desc_root()
    default:
      return section.description
  }
}

function fieldLabel(field: FieldDefinition): string {
  const keyMap: Record<string, () => string> = {
    Background: m.design_globals_field_background,
    Text: m.design_globals_field_text,
    Font: m.design_globals_field_font,
    Size: m.design_globals_field_size,
    "Line Height": m.design_globals_field_line_height,
    Weight: m.design_globals_field_weight,
    "Letter Spacing": m.design_globals_field_letter_spacing,
    "Max Width": m.design_globals_field_max_width,
    Margin: m.design_globals_field_margin,
    Padding: m.design_globals_field_padding,
    "Overflow X": m.design_globals_field_overflow_x,
    "Overflow Y": m.design_globals_field_overflow_y,
    "Font Smoothing": m.design_globals_field_font_smoothing,
    "Text Wrap": m.design_globals_field_text_wrap,
    Transform: m.design_globals_field_transform,
    Default: m.design_globals_field_default,
    Hover: m.design_globals_field_hover,
    Visited: m.design_globals_field_visited,
    Decoration: m.design_globals_field_decoration,
    "Underline Offset": m.design_globals_field_underline_offset,
    Placeholder: m.design_globals_field_placeholder,
    Border: m.design_globals_field_border,
    Radius: m.design_globals_field_radius,
    "Horizontal Padding": m.design_globals_field_padding_x,
    "Vertical Padding": m.design_globals_field_padding_y,
    "Focus Ring": m.design_globals_field_focus_ring,
    "Content Max Width": m.design_globals_field_content_max_width,
    "Section Gap": m.design_globals_field_section_gap,
    Width: m.design_globals_field_width,
    "Font Size": m.design_globals_field_font_size,
    Cursor: m.design_globals_field_cursor,
    "Caret Color": m.design_globals_field_caret_color,
    "Selection Color": m.design_globals_field_selection_color,
    "Selection Background": m.design_globals_field_selection_background,
    "Scroll Behavior": m.design_globals_field_scroll_behavior,
    "Outline Color": m.design_globals_field_outline_color,
    "Outline Width": m.design_globals_field_outline_width,
    "Outline Style": m.design_globals_field_outline_style,
    "Border Color": m.design_globals_field_border_color,
    "Border Radius": m.design_globals_field_border_radius,
    "Border Width": m.design_globals_field_border_width,
    "Hover Background": m.design_globals_field_hover_background,
    "Hover Text": m.design_globals_field_hover_text,
    "Hover Border": m.design_globals_field_hover_border,
  }

  return keyMap[field.label]?.() ?? field.label
}

function buttonVariantLabel(variant: GlobalStyleButtonVariant): string {
  switch (variant) {
    case "primary":
      return m.design_globals_variant_primary()
    case "secondary":
      return m.design_globals_variant_secondary()
    case "muted":
      return m.design_globals_variant_muted()
    case "destructive":
      return m.design_globals_variant_destructive()
    case "disabled":
      return m.design_globals_variant_disabled()
    default:
      return variant
  }
}

function getPreviewValue(path: string, fallback: string): string {
  const value = getStringValue(path).trim()
  return value || fallback
}

function getPreviewColor(path: string, fallback: string): string {
  return getPreviewValue(path, fallback)
}

function getPreviewSurfaceStyle(): Record<string, string> {
  return {
    backgroundColor: getPreviewColor("body.backgroundColor", "#ffffff"),
  }
}

function getBodyPreviewStyle(): Record<string, string> {
  const smoothing = getStringValue("body.fontSmoothing").trim()
  return {
    backgroundColor: getPreviewColor("body.backgroundColor", "#ffffff"),
    color: getPreviewColor("body.color", "#111111"),
    fontFamily: getPreviewValue("body.fontFamily", "inherit"),
    fontSize: getPreviewValue("body.fontSize", "16px"),
    lineHeight: getPreviewValue("body.lineHeight", "1.5"),
    fontWeight: getPreviewValue("body.fontWeight", "400"),
    letterSpacing: getPreviewValue("body.letterSpacing", "0"),
    overflowX: getPreviewValue("body.overflowX", "visible"),
    overflowY: getPreviewValue("body.overflowY", "visible"),
    ...(smoothing === "antialiased"
      ? {
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        }
      : {}),
  }
}

function getHeadingPreviewStyle(fontSize: string): Record<string, string> {
  return {
    color: getPreviewColor("heading.color", "#111111"),
    fontFamily: getPreviewValue("heading.fontFamily", "inherit"),
    fontWeight: getPreviewValue("heading.fontWeight", "700"),
    lineHeight: getPreviewValue("heading.lineHeight", "1.1"),
    letterSpacing: getPreviewValue("heading.letterSpacing", "0"),
    textTransform: getPreviewValue("heading.textTransform", "none"),
    fontSize,
  }
}

function getInputPreviewStyle(isFocused = false): Record<string, string> {
  return {
    backgroundColor: getPreviewColor("input.backgroundColor", "#ffffff"),
    color: getPreviewColor("input.color", "#111111"),
    borderColor: getPreviewColor("input.borderColor", "#d4d4d8"),
    borderRadius: getPreviewValue("input.borderRadius", "8px"),
    padding: `${getPreviewValue("input.paddingY", "8px")} ${getPreviewValue("input.paddingX", "12px")}`,
    fontFamily: getPreviewValue("input.fontFamily", "inherit"),
    fontSize: getPreviewValue("input.fontSize", "16px"),
    lineHeight: getPreviewValue("input.lineHeight", "1.4"),
    borderWidth: "1px",
    borderStyle: "solid",
    boxShadow: isFocused
      ? `0 0 0 3px ${getPreviewColor("input.focusRingColor", "#60a5fa")}`
      : "none",
  }
}

function getButtonPreviewStyle(
  variant: GlobalStyleButtonVariant,
  state: "default" | "hover" = "default",
): Record<string, string> {
  const backgroundFallbacks: Record<GlobalStyleButtonVariant, string> = {
    primary: "#111111",
    secondary: "#f3f4f6",
    muted: "#27272a",
    destructive: "#dc2626",
    disabled: "#27272a",
  }
  const textFallbacks: Record<GlobalStyleButtonVariant, string> = {
    primary: "#ffffff",
    secondary: "#111111",
    muted: "#ffffff",
    destructive: "#ffffff",
    disabled: "#a1a1aa",
  }

  const backgroundPath =
    state === "hover"
      ? `button.variants.${variant}.hoverBackgroundColor`
      : `button.variants.${variant}.backgroundColor`
  const textPath =
    state === "hover"
      ? `button.variants.${variant}.hoverColor`
      : `button.variants.${variant}.color`
  const borderPath =
    state === "hover"
      ? `button.variants.${variant}.hoverBorderColor`
      : `button.variants.${variant}.borderColor`

  const defaultBackground = getPreviewColor(
    `button.variants.${variant}.backgroundColor`,
    backgroundFallbacks[variant],
  )
  const defaultText = getPreviewColor(
    `button.variants.${variant}.color`,
    textFallbacks[variant],
  )
  const defaultBorder = getPreviewColor(
    `button.variants.${variant}.borderColor`,
    "transparent",
  )

  return {
    backgroundColor: getPreviewColor(backgroundPath, defaultBackground),
    color: getPreviewColor(textPath, defaultText),
    borderColor: getPreviewColor(borderPath, defaultBorder),
    borderWidth: getPreviewValue("button.base.borderWidth", "1px"),
    borderStyle: "solid",
    borderRadius: getPreviewValue("button.base.borderRadius", "8px"),
    padding: `${getPreviewValue("button.base.paddingY", "10px")} ${getPreviewValue("button.base.paddingX", "16px")}`,
    fontFamily: getPreviewValue("button.base.fontFamily", "inherit"),
    fontSize: getPreviewValue("button.base.fontSize", "14px"),
    fontWeight: getPreviewValue("button.base.fontWeight", "600"),
    lineHeight: getPreviewValue("button.base.lineHeight", "1.2"),
    letterSpacing: getPreviewValue("button.base.letterSpacing", "0"),
  }
}

function save() {
  emit("save", cloneGlobalStyles(styles.value))
}
</script>

<template>
  <DesignHeaderTeleport target="actions">
    <Button size="md" :disabled="saving" @click="save">
      {{ saving ? m.design_saving() : m.design_save() }}
    </Button>
  </DesignHeaderTeleport>

  <div class="min-w-0 space-y-0 bg-background">
    <div
      class="sticky top-0 z-10 flex h-12 shrink-0 items-stretch gap-1 overflow-x-auto border-y border-dashed border-border bg-background px-7"
    >
      <Button
        v-for="tab in sectionTabs"
        :key="tab"
        type="button"
        size="tab"
        :variant="activeSectionTitle === tab ? 'tab-active' : 'tab'"
        @click="activeSectionTitle = tab"
      >
        {{ sectionLabel(tab) }}
      </Button>
    </div>

    <div class="px-5 py-5">
      <div class="mx-auto max-w-5xl overscroll-none pb-6">
        <div
          class="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,42rem)_20rem]"
        >
          <div class="min-w-0">
            <section
              v-if="activeDefaultSection"
              :key="activeDefaultSection.title"
              class="min-w-0 p-7"
            >
              <div class="mb-8 space-y-0">
                <h2
                  class="text-2xl font-sans font-medium leading-none text-foreground"
                >
                  {{ sectionLabel(activeDefaultSection.title) }}
                </h2>
                <p class="text-sm text-muted-foreground/70">
                  {{ sectionDescription(activeDefaultSection) }}
                </p>
              </div>

              <div class="space-y-6">
                <div
                  v-for="field in activeDefaultSection.fields"
                  :key="field.path"
                  class="min-w-0"
                  :class="field.kind === 'spacing' ? '' : 'space-y-2'"
                >
                  <label
                    v-if="field.kind !== 'spacing'"
                    class="text-2xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
                  >
                    {{ fieldLabel(field) }}
                  </label>

                  <ColorField
                    v-if="field.kind === 'color'"
                    :model-value="getStringValue(field.path)"
                    layout="unified"
                    persist-mode="live"
                    show-variables
                    show-design-colors
                    :placeholder="field.placeholder"
                    content-side="left"
                    content-align="center"
                    class="min-w-0"
                    @update:model-value="
                      setStringValue(field.path, String($event))
                    "
                  />

                  <div
                    v-else-if="field.kind === 'font'"
                    class="min-w-0"
                  >
                    <div class="group/variable relative min-w-0">
                      <div
                        v-if="isVariableReferencePath(field.path)"
                        :class="READONLY_CONTROL_CLASS"
                      >
                        {{ getStringValue(field.path) }}
                      </div>
                      <Select
                        v-else-if="availableFonts.length > 0"
                        :model-value="getSelectModelValue(field.path)"
                        @update:model-value="
                          handleSelectUpdate(field.path, String($event))
                        "
                      >
                        <SelectTrigger :class="FONT_SELECT_CONTROL_CLASS">
                          <SelectValue>
                            {{
                              getStringValue(field.path).trim() ||
                              field.placeholder ||
                              m.design_globals_no_override()
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem :value="EMPTY_SELECT_VALUE">
                            {{ m.design_globals_no_override() }}
                          </SelectItem>
                          <SelectItem
                            v-for="family in availableFonts"
                            :key="family"
                            :value="family"
                          >
                            <span :style="{ fontFamily: family }">{{
                              family
                            }}</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <div v-else>
                        <Input
                          :model-value="getStringValue(field.path)"
                          :placeholder="field.placeholder"
                          :class="CONTROL_CLASS"
                          @update:model-value="
                            setStringValue(field.path, String($event ?? ''))
                          "
                        />
                      </div>
                      <VariableReferenceAssignButton
                        :model-value="getStringValue(field.path)"
                        :disabled="saving"
                        :options="variableReferenceOptions"
                        :picker-placeholder="m.design_globals_select_variable()"
                        button-class="absolute end-2 top-1/2 z-10 -translate-y-1/2"
                        @select="handleVariableReferenceUpdate(field.path, $event)"
                      />
                    </div>
                  </div>

                  <VariableAssignableInput
                    v-else-if="field.kind === 'measurement'"
                    :model-value="getStringValue(field.path)"
                    :placeholder="field.placeholder"
                    :options="variableReferenceOptions"
                    :picker-placeholder="m.design_globals_select_variable()"
                    class="min-w-0 w-full"
                    :input-class="CONTROL_CLASS"
                    @update:model-value="
                      setStringValue(field.path, String($event))
                    "
                  />

                  <div
                    v-else-if="field.kind === 'select' && field.options"
                    class="group/variable relative min-w-0"
                  >
                    <div
                      v-if="isVariableReferencePath(field.path)"
                      :class="READONLY_CONTROL_CLASS"
                    >
                      {{ getStringValue(field.path) }}
                    </div>
                    <Select
                      v-else
                      :model-value="getSelectModelValue(field.path)"
                      @update:model-value="
                        handleSelectUpdate(field.path, String($event))
                      "
                    >
                      <SelectTrigger hide-icon :class="CONTROL_CLASS">
                        <SelectValue>
                          {{ selectedOptionLabel(field) }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem :value="EMPTY_SELECT_VALUE">
                          {{ m.design_globals_no_override() }}
                        </SelectItem>
                        <SelectItem
                          v-for="option in field.options"
                          :key="option.value"
                          :value="option.value"
                        >
                          {{ option.label }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <VariableReferenceAssignButton
                      :model-value="getStringValue(field.path)"
                      :disabled="saving"
                      :options="variableReferenceOptions"
                      :picker-placeholder="m.design_globals_select_variable()"
                      button-class="absolute end-2 top-1/2 z-10 -translate-y-1/2"
                      @select="handleVariableReferenceUpdate(field.path, $event)"
                    />
                  </div>

                  <div
                    v-else-if="field.kind === 'toggle'"
                    class="flex h-9.5 items-center gap-3"
                  >
                    <Switch
                      :model-value="isToggleOn(field)"
                      :disabled="saving"
                      :aria-label="fieldLabel(field)"
                      @update:model-value="
                        handleToggleUpdate(field, Boolean($event))
                      "
                    />
                    <span class="text-sm text-muted-foreground">
                      {{
                        isToggleOn(field)
                          ? m.design_globals_font_smoothing_on()
                          : m.design_globals_no_override()
                      }}
                    </span>
                  </div>

                  <GlobalStylesLinkedSides
                    v-else-if="field.kind === 'spacing' && field.spacingProperty"
                    :label="fieldLabel(field)"
                    :linked="spacingLinkedModel(field.spacingProperty)"
                    :values="bodySpacingValues(field.spacingProperty)"
                    :disabled="saving"
                    :input-class="SPACING_INPUT_CLASS"
                    @update:linked="
                      setSpacingLinked(field.spacingProperty, Boolean($event))
                    "
                    @update:values="
                      setBodySpacingValues(field.spacingProperty, $event)
                    "
                  />
                </div>
              </div>
            </section>

            <section v-else class="min-w-0 p-7">
              <div class="mb-8 space-y-0">
                <h2
                  class="text-2xl font-sans font-medium leading-none text-foreground"
                >
                  {{ sectionLabel(BUTTON_SECTION_TITLE) }}
                </h2>
                <p class="text-sm text-muted-foreground/70">
                  {{ m.design_globals_desc_button() }}
                </p>
              </div>

              <div class="space-y-6">
                <div
                  v-for="field in BUTTON_BASE_FIELDS"
                  :key="field.path"
                  class="min-w-0 space-y-2"
                >
                  <label
                    class="text-2xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
                  >
                    {{ fieldLabel(field) }}
                  </label>

                  <div
                    v-if="field.kind === 'font'"
                    class="min-w-0"
                  >
                    <div class="group/variable relative min-w-0">
                      <div
                        v-if="isVariableReferencePath(field.path)"
                        :class="READONLY_CONTROL_CLASS"
                      >
                        {{ getStringValue(field.path) }}
                      </div>
                      <Select
                        v-else-if="availableFonts.length > 0"
                        :model-value="getSelectModelValue(field.path)"
                        @update:model-value="
                          handleSelectUpdate(field.path, String($event))
                        "
                      >
                        <SelectTrigger :class="FONT_SELECT_CONTROL_CLASS">
                          <SelectValue>
                            {{
                              getStringValue(field.path).trim() ||
                              field.placeholder ||
                              m.design_globals_no_override()
                            }}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem :value="EMPTY_SELECT_VALUE">
                            {{ m.design_globals_no_override() }}
                          </SelectItem>
                          <SelectItem
                            v-for="family in availableFonts"
                            :key="family"
                            :value="family"
                          >
                            <span :style="{ fontFamily: family }">{{
                              family
                            }}</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <div v-else>
                        <Input
                          :model-value="getStringValue(field.path)"
                          :placeholder="field.placeholder"
                          :class="CONTROL_CLASS"
                          @update:model-value="
                            setStringValue(field.path, String($event ?? ''))
                          "
                        />
                      </div>
                      <VariableReferenceAssignButton
                        :model-value="getStringValue(field.path)"
                        :disabled="saving"
                        :options="variableReferenceOptions"
                        :picker-placeholder="m.design_globals_select_variable()"
                        button-class="absolute end-2 top-1/2 z-10 -translate-y-1/2"
                        @select="handleVariableReferenceUpdate(field.path, $event)"
                      />
                    </div>
                  </div>

                  <VariableAssignableInput
                    v-else-if="field.kind === 'measurement'"
                    :model-value="getStringValue(field.path)"
                    :placeholder="field.placeholder"
                    :options="variableReferenceOptions"
                    :picker-placeholder="m.design_globals_select_variable()"
                    class="min-w-0 w-full"
                    :input-class="CONTROL_CLASS"
                    @update:model-value="
                      setStringValue(field.path, String($event))
                    "
                  />

                  <div
                    v-else-if="field.kind === 'select' && field.options"
                    class="group/variable relative min-w-0"
                  >
                    <div
                      v-if="isVariableReferencePath(field.path)"
                      :class="READONLY_CONTROL_CLASS"
                    >
                      {{ getStringValue(field.path) }}
                    </div>
                    <Select
                      v-else
                      :model-value="getSelectModelValue(field.path)"
                      @update:model-value="
                        handleSelectUpdate(field.path, String($event))
                      "
                    >
                      <SelectTrigger hide-icon :class="CONTROL_CLASS">
                        <SelectValue>
                          {{ selectedOptionLabel(field) }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem :value="EMPTY_SELECT_VALUE">
                          {{ m.design_globals_no_override() }}
                        </SelectItem>
                        <SelectItem
                          v-for="option in field.options"
                          :key="option.value"
                          :value="option.value"
                        >
                          {{ option.label }}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <VariableReferenceAssignButton
                      :model-value="getStringValue(field.path)"
                      :disabled="saving"
                      :options="variableReferenceOptions"
                      :picker-placeholder="m.design_globals_select_variable()"
                      button-class="absolute end-2 top-1/2 z-10 -translate-y-1/2"
                      @select="handleVariableReferenceUpdate(field.path, $event)"
                    />
                  </div>
                </div>
              </div>

              <div class="mt-8 space-y-6">
                <article
                  v-for="variant in GLOBAL_STYLE_BUTTON_VARIANTS"
                  :key="variant"
                  class="min-w-0 space-y-4 rounded-lg border border-dashed border-border/50 bg-card/30 p-4"
                >
                  <h5 class="text-sm font-medium text-foreground">
                    {{ buttonVariantLabel(variant) }}
                  </h5>
                  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div
                      v-for="field in BUTTON_VARIANT_FIELDS(variant)"
                      :key="field.path"
                      class="min-w-0 space-y-2"
                    >
                      <label
                        class="text-2xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
                      >
                        {{ fieldLabel(field) }}
                      </label>
                      <ColorField
                        :model-value="getStringValue(field.path)"
                        layout="unified"
                        persist-mode="live"
                        show-variables
                        show-design-colors
                        :placeholder="field.placeholder"
                        content-side="left"
                        content-align="start"
                        class="min-w-0"
                        @update:model-value="
                          setStringValue(field.path, String($event))
                        "
                      />
                    </div>
                  </div>
                </article>
              </div>
            </section>
          </div>

          <aside class="min-w-0 xl:sticky xl:top-5">
            <div
              class="overflow-hidden rounded-sm border border-dashed border-border bg-card/20"
            >
              <div
                class="flex h-12 items-center justify-between border-b border-dashed border-border px-4"
              >
                <h3 class="font-sans text-sm font-medium text-foreground">
                  {{ m.design_globals_preview() }}
                </h3>
                <span
                  class="rounded-sm border border-dashed border-border/50 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground"
                >
                  {{ sectionLabel(activeSectionTitle) }}
                </span>
              </div>

              <div class="min-h-80 p-4" :style="getPreviewSurfaceStyle()">
                <div
                  v-if="activeSectionTitle === 'Body'"
                  class="space-y-[0.65em] rounded-sm border border-dashed border-border/50 bg-background/45 p-4"
                  :style="getBodyPreviewStyle()"
                >
                  <div class="font-medium">{{ m.design_globals_preview_body() }}</div>
                  <p>
                    {{ m.design_globals_preview_body_copy() }}
                  </p>
                </div>

                <div
                  v-else-if="activeSectionTitle === 'Headings'"
                  class="space-y-3 rounded-sm border border-dashed border-border/50 bg-background/45 p-4"
                >
                  <div :style="getHeadingPreviewStyle('2.25rem')">
                    {{ m.design_globals_preview_heading() }}
                  </div>
                  <div :style="getHeadingPreviewStyle('1.5rem')">
                    {{ m.design_globals_preview_supporting_heading() }}
                  </div>
                </div>

                <div
                  v-else-if="activeSectionTitle === 'Links'"
                  class="space-y-2 rounded-sm border border-dashed border-border/50 bg-background/45 p-4 text-sm"
                >
                  <a
                    href="#"
                    :style="{
                      color: getPreviewColor('link.color', '#2563eb'),
                      textDecoration: getPreviewValue(
                        'link.textDecoration',
                        'underline',
                      ),
                      textUnderlineOffset: getPreviewValue(
                        'link.underlineOffset',
                        '2px',
                      ),
                      fontWeight: getPreviewValue('link.fontWeight', '500'),
                    }"
                    @click.prevent
                  >
                    {{ m.design_globals_preview_link() }}
                  </a>
                  <a
                    href="#"
                    :style="{
                      color: getPreviewColor('link.hoverColor', '#1d4ed8'),
                    }"
                    @click.prevent
                  >
                    {{ m.design_globals_preview_hover() }}
                  </a>
                  <a
                    href="#"
                    :style="{
                      color: getPreviewColor('link.visitedColor', '#7c3aed'),
                    }"
                    @click.prevent
                  >
                    {{ m.design_globals_preview_visited() }}
                  </a>
                </div>

                <div
                  v-else-if="activeSectionTitle === 'Inputs'"
                  class="space-y-3 rounded-sm border border-dashed border-border/50 bg-background/45 p-4"
                >
                  <div class="border" :style="getInputPreviewStyle(false)">
                    {{ m.design_globals_preview_input() }}
                  </div>
                  <div class="border" :style="getInputPreviewStyle(true)">
                    {{ m.design_globals_preview_focus() }}
                  </div>
                </div>

                <div
                  v-else-if="activeSectionTitle === 'Sections'"
                  class="rounded-sm border border-dashed border-border/50 bg-background/45 p-4"
                >
                  <div
                    class="grid rounded-sm border border-dashed border-border/50 p-3"
                    :style="{
                      maxWidth: getPreviewValue(
                        'section.contentMaxWidth',
                        '64rem',
                      ),
                      gap: getPreviewValue('section.sectionGap', '1rem'),
                      padding: `${getPreviewValue('section.verticalPadding', '1rem')} ${getPreviewValue('section.horizontalPadding', '1rem')}`,
                    }"
                  >
                    <span class="h-2 rounded-sm bg-foreground/30" />
                    <span class="h-2 w-2/3 rounded-sm bg-foreground/20" />
                  </div>
                </div>

                <div
                  v-else-if="activeSectionTitle === 'Containers'"
                  class="rounded-sm border border-dashed border-border/50 bg-background/45 p-4"
                >
                  <div
                    class="mx-auto rounded-sm border border-dashed border-border/50 p-3"
                    :style="{
                      maxWidth: getPreviewValue('container.maxWidth', '80rem'),
                      width: getPreviewValue('container.width', '100%'),
                    }"
                  >
                    <div class="h-2 w-full rounded-sm bg-foreground/25" />
                    <div class="mt-2 h-2 w-2/3 rounded-sm bg-foreground/15" />
                  </div>
                </div>

                <div
                  v-else-if="activeSectionTitle === 'Root'"
                  class="space-y-3 rounded-sm border border-dashed border-border/50 bg-background/45 p-4 text-sm"
                  :style="{
                    fontSize: getPreviewValue('root.fontSize', '16px'),
                    cursor: getPreviewValue('root.cursor', 'auto'),
                    caretColor: getPreviewColor('root.caretColor', 'currentColor'),
                    borderRadius: getPreviewValue('root.borderRadius', '8px'),
                    outline: `${getPreviewValue('root.outlineWidth', '2px')} ${getPreviewValue('root.outlineStyle', 'solid')} ${getPreviewColor('root.outlineColor', '#2563eb')}`,
                    outlineOffset: '2px',
                  }"
                >
                  <div class="h-2 w-full rounded-sm bg-foreground/25" />
                  <div class="h-2 w-2/3 rounded-sm bg-foreground/15" />
                  <div
                    class="h-8 rounded-sm border border-dashed"
                    :style="{
                      borderColor: getPreviewColor(
                        'root.borderColor',
                        'currentColor',
                      ),
                    }"
                  />
                </div>

                <div
                  v-else-if="activeSectionTitle === BUTTON_SECTION_TITLE"
                  class="space-y-3 rounded-sm border border-dashed border-border/50 bg-background/45 p-4"
                >
                  <button type="button" :style="getButtonPreviewStyle('primary')">
                    {{ m.design_globals_variant_primary() }}
                  </button>
                  <button
                    type="button"
                    :style="getButtonPreviewStyle('primary', 'hover')"
                  >
                    {{ m.design_globals_preview_hover() }}
                  </button>
                  <button
                    type="button"
                    :style="getButtonPreviewStyle('secondary')"
                  >
                    {{ m.design_globals_variant_secondary() }}
                  </button>
                </div>

                <div
                  v-else
                  class="space-y-3 rounded-sm border border-dashed border-border/50 bg-background/45 p-4 text-sm text-foreground"
                >
                  <div class="h-2 w-full rounded-sm bg-foreground/25" />
                  <div class="h-2 w-2/3 rounded-sm bg-foreground/15" />
                  <div
                    class="h-8 rounded-sm border border-dashed border-border"
                  />
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  </div>
</template>
