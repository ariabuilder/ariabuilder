import { GLOBAL_STYLE_BUTTON_VARIANTS } from "../../../../shared/design"

export { GLOBAL_STYLE_BUTTON_VARIANTS }

export type ControlKind = "color" | "font" | "measurement" | "select" | "toggle" | "spacing"

export type SelectOption = {
  value: string
  label: string
}

export type MeasurementUnitOption = {
  value: string
  label: string
}

export type FieldDefinition = {
  label: string
  path: string
  kind: ControlKind
  placeholder?: string
  options?: readonly SelectOption[]
  units?: readonly MeasurementUnitOption[]
  icon?: string
  /** Stored value when a toggle is on (empty string when off). */
  onValue?: string
  spacingProperty?: "margin" | "padding"
}

export type SectionDefinition = {
  title: string
  description: string
  fields: readonly FieldDefinition[]
}

export const SIZE_UNITS: readonly MeasurementUnitOption[] = [
  { value: "px", label: "px" },
  { value: "rem", label: "rem" },
  { value: "em", label: "em" },
  { value: "%", label: "%" },
  { value: "vw", label: "vw" },
  { value: "vh", label: "vh" },
  { value: "ch", label: "ch" },
  { value: "raw", label: "raw" },
] as const

export const SPACING_UNITS: readonly MeasurementUnitOption[] = [
  { value: "px", label: "px" },
  { value: "rem", label: "rem" },
  { value: "em", label: "em" },
  { value: "%", label: "%" },
  { value: "raw", label: "raw" },
] as const

export const LETTER_SPACING_UNITS: readonly MeasurementUnitOption[] = [
  { value: "em", label: "em" },
  { value: "rem", label: "rem" },
  { value: "px", label: "px" },
  { value: "%", label: "%" },
  { value: "raw", label: "raw" },
] as const

export const LINE_HEIGHT_UNITS: readonly MeasurementUnitOption[] = [
  { value: "px", label: "px" },
  { value: "rem", label: "rem" },
  { value: "em", label: "em" },
  { value: "%", label: "%" },
  { value: "raw", label: "raw" },
] as const

export const FONT_WEIGHT_OPTIONS: readonly SelectOption[] = [
  { value: "300", label: "300 Light" },
  { value: "400", label: "400 Regular" },
  { value: "500", label: "500 Medium" },
  { value: "600", label: "600 Semibold" },
  { value: "700", label: "700 Bold" },
  { value: "800", label: "800 Extra Bold" },
] as const

export const TEXT_TRANSFORM_OPTIONS: readonly SelectOption[] = [
  { value: "none", label: "None" },
  { value: "uppercase", label: "Uppercase" },
  { value: "lowercase", label: "Lowercase" },
  { value: "capitalize", label: "Capitalize" },
] as const

export const TEXT_DECORATION_OPTIONS: readonly SelectOption[] = [
  { value: "none", label: "None" },
  { value: "underline", label: "Underline" },
  { value: "overline", label: "Overline" },
  { value: "line-through", label: "Line Through" },
] as const

export const TEXT_WRAP_OPTIONS: readonly SelectOption[] = [
  { value: "wrap", label: "Wrap" },
  { value: "nowrap", label: "No Wrap" },
  { value: "balance", label: "Balance" },
  { value: "pretty", label: "Pretty" },
] as const

export const OVERFLOW_OPTIONS: readonly SelectOption[] = [
  { value: "visible", label: "Visible" },
  { value: "hidden", label: "Hidden" },
  { value: "clip", label: "Clip" },
  { value: "auto", label: "Auto" },
  { value: "scroll", label: "Scroll" },
] as const

export const SCROLL_BEHAVIOR_OPTIONS: readonly SelectOption[] = [
  { value: "auto", label: "Auto" },
  { value: "smooth", label: "Smooth" },
] as const

export const CURSOR_OPTIONS: readonly SelectOption[] = [
  { value: "auto", label: "Auto" },
  { value: "default", label: "Default" },
  { value: "pointer", label: "Pointer" },
  { value: "text", label: "Text" },
  { value: "crosshair", label: "Crosshair" },
  { value: "grab", label: "Grab" },
  { value: "grabbing", label: "Grabbing" },
  { value: "not-allowed", label: "Not Allowed" },
  { value: "wait", label: "Wait" },
  { value: "help", label: "Help" },
  { value: "zoom-in", label: "Zoom In" },
  { value: "zoom-out", label: "Zoom Out" },
] as const

export const OUTLINE_STYLE_OPTIONS: readonly SelectOption[] = [
  { value: "none", label: "None" },
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
  { value: "double", label: "Double" },
] as const

export const DEFAULT_SECTIONS: readonly SectionDefinition[] = [
  {
    title: "Body",
    description: "Applies to the page body.",
    fields: [
      {
        label: "Background",
        path: "body.backgroundColor",
        kind: "color",
        placeholder: "Background color",
      },
      {
        label: "Text",
        path: "body.color",
        kind: "color",
        placeholder: "Text color",
      },
      {
        label: "Font",
        path: "body.fontFamily",
        kind: "font",
        placeholder: "Select body font",
      },
      {
        label: "Size",
        path: "body.fontSize",
        kind: "measurement",
        units: SIZE_UNITS,
        placeholder: "16",
      },
      {
        label: "Line Height",
        path: "body.lineHeight",
        kind: "measurement",
        units: LINE_HEIGHT_UNITS,
        placeholder: "1.5",
      },
      {
        label: "Weight",
        path: "body.fontWeight",
        kind: "select",
        options: FONT_WEIGHT_OPTIONS,
      },
      {
        label: "Letter Spacing",
        path: "body.letterSpacing",
        kind: "measurement",
        units: LETTER_SPACING_UNITS,
        placeholder: "0",
      },
      {
        label: "Font Smoothing",
        path: "body.fontSmoothing",
        kind: "toggle",
        onValue: "antialiased",
      },
      {
        label: "Text Wrap",
        path: "body.textWrap",
        kind: "select",
        options: TEXT_WRAP_OPTIONS,
      },
      {
        label: "Max Width",
        path: "body.maxWidth",
        kind: "measurement",
        units: SIZE_UNITS,
        placeholder: "",
      },
      {
        label: "Margin",
        path: "body.margin",
        kind: "spacing",
        spacingProperty: "margin",
      },
      {
        label: "Padding",
        path: "body.padding",
        kind: "spacing",
        spacingProperty: "padding",
      },
      {
        label: "Overflow X",
        path: "body.overflowX",
        kind: "select",
        options: OVERFLOW_OPTIONS,
      },
      {
        label: "Overflow Y",
        path: "body.overflowY",
        kind: "select",
        options: OVERFLOW_OPTIONS,
      },
    ],
  },
  {
    title: "Headings",
    description: "Applies to h1 through h6.",
    fields: [
      {
        label: "Text",
        path: "heading.color",
        kind: "color",
        placeholder: "Heading color",
      },
      {
        label: "Font",
        path: "heading.fontFamily",
        kind: "font",
        placeholder: "Select heading font",
      },
      {
        label: "Weight",
        path: "heading.fontWeight",
        kind: "select",
        options: FONT_WEIGHT_OPTIONS,
      },
      {
        label: "Line Height",
        path: "heading.lineHeight",
        kind: "measurement",
        units: LINE_HEIGHT_UNITS,
        placeholder: "1.1",
      },
      {
        label: "Letter Spacing",
        path: "heading.letterSpacing",
        kind: "measurement",
        units: LETTER_SPACING_UNITS,
        placeholder: "0",
      },
      {
        label: "Transform",
        path: "heading.textTransform",
        kind: "select",
        options: TEXT_TRANSFORM_OPTIONS,
      },
    ],
  },
  {
    title: "Links",
    description: "Applies to default and interactive link states.",
    fields: [
      {
        label: "Default",
        path: "link.color",
        kind: "color",
        placeholder: "Default color",
      },
      {
        label: "Hover",
        path: "link.hoverColor",
        kind: "color",
        placeholder: "Hover color",
      },
      {
        label: "Visited",
        path: "link.visitedColor",
        kind: "color",
        placeholder: "Visited color",
      },
      {
        label: "Decoration",
        path: "link.textDecoration",
        kind: "select",
        options: TEXT_DECORATION_OPTIONS,
      },
      {
        label: "Underline Offset",
        path: "link.underlineOffset",
        kind: "measurement",
        units: SIZE_UNITS,
        placeholder: "2",
      },
      {
        label: "Weight",
        path: "link.fontWeight",
        kind: "select",
        options: FONT_WEIGHT_OPTIONS,
      },
    ],
  },
  {
    title: "Inputs",
    description:
      "Applies to text inputs, textareas, selects, and `.input` helpers.",
    fields: [
      {
        label: "Background",
        path: "input.backgroundColor",
        kind: "color",
        placeholder: "Background color",
      },
      {
        label: "Text",
        path: "input.color",
        kind: "color",
        placeholder: "Text color",
      },
      {
        label: "Placeholder",
        path: "input.placeholderColor",
        kind: "color",
        placeholder: "Placeholder color",
      },
      {
        label: "Border",
        path: "input.borderColor",
        kind: "color",
        placeholder: "Border color",
      },
      {
        label: "Radius",
        path: "input.borderRadius",
        kind: "measurement",
        units: SPACING_UNITS,
        placeholder: "8",
      },
      {
        label: "Font",
        path: "input.fontFamily",
        kind: "font",
        placeholder: "Select input font",
      },
      {
        label: "Size",
        path: "input.fontSize",
        kind: "measurement",
        units: SIZE_UNITS,
        placeholder: "16",
      },
      {
        label: "Line Height",
        path: "input.lineHeight",
        kind: "measurement",
        units: LINE_HEIGHT_UNITS,
        placeholder: "1.4",
      },
      {
        label: "Horizontal Padding",
        path: "input.paddingX",
        kind: "measurement",
        units: SPACING_UNITS,
        placeholder: "12",
      },
      {
        label: "Vertical Padding",
        path: "input.paddingY",
        kind: "measurement",
        units: SPACING_UNITS,
        placeholder: "8",
      },
      {
        label: "Focus Ring",
        path: "input.focusRingColor",
        kind: "color",
        placeholder: "Focus ring color",
      },
    ],
  },
  {
    title: "Sections",
    description: "Applies spacing defaults to semantic section containers.",
    fields: [
      {
        label: "Content Max Width",
        path: "section.contentMaxWidth",
        kind: "measurement",
        units: SIZE_UNITS,
        placeholder: "72",
      },
      {
        label: "Horizontal Padding",
        path: "section.horizontalPadding",
        kind: "measurement",
        units: SPACING_UNITS,
        placeholder: "24",
      },
      {
        label: "Vertical Padding",
        path: "section.verticalPadding",
        kind: "measurement",
        units: SPACING_UNITS,
        placeholder: "48",
      },
      {
        label: "Section Gap",
        path: "section.sectionGap",
        kind: "measurement",
        units: SPACING_UNITS,
        placeholder: "32",
      },
    ],
  },
  {
    title: "Containers",
    description: "Applies to page-level container wrappers.",
    fields: [
      {
        label: "Max Width",
        path: "container.maxWidth",
        kind: "measurement",
        units: SIZE_UNITS,
        placeholder: "1280",
      },
      {
        label: "Width",
        path: "container.width",
        kind: "measurement",
        units: SIZE_UNITS,
        placeholder: "100",
      },
    ],
  },
  {
    title: "Root",
    description: "Applies to the HTML root element.",
    fields: [
      {
        label: "Font Size",
        path: "root.fontSize",
        kind: "measurement",
        units: SIZE_UNITS,
        placeholder: "16",
      },
      {
        label: "Margin",
        path: "root.margin",
        kind: "measurement",
        units: SPACING_UNITS,
        placeholder: "0",
      },
      {
        label: "Padding",
        path: "root.padding",
        kind: "measurement",
        units: SPACING_UNITS,
        placeholder: "0",
      },
      {
        label: "Cursor",
        path: "root.cursor",
        kind: "select",
        options: CURSOR_OPTIONS,
      },
      {
        label: "Caret Color",
        path: "root.caretColor",
        kind: "color",
        placeholder: "Caret color",
      },
      {
        label: "Selection Color",
        path: "root.selectionColor",
        kind: "color",
        placeholder: "Text selection color",
      },
      {
        label: "Selection Background",
        path: "root.selectionBackgroundColor",
        kind: "color",
        placeholder: "Selection background",
      },
      {
        label: "Scroll Behavior",
        path: "root.scrollBehavior",
        kind: "select",
        options: SCROLL_BEHAVIOR_OPTIONS,
      },
      {
        label: "Outline Color",
        path: "root.outlineColor",
        kind: "color",
        placeholder: "Focus outline color",
      },
      {
        label: "Outline Width",
        path: "root.outlineWidth",
        kind: "measurement",
        units: SIZE_UNITS,
        placeholder: "2",
      },
      {
        label: "Outline Style",
        path: "root.outlineStyle",
        kind: "select",
        options: OUTLINE_STYLE_OPTIONS,
      },
      {
        label: "Border Color",
        path: "root.borderColor",
        kind: "color",
        placeholder: "Default border color",
      },
      {
        label: "Border Radius",
        path: "root.borderRadius",
        kind: "measurement",
        units: SPACING_UNITS,
        placeholder: "8",
      },
    ],
  },
] as const

export const BUTTON_BASE_FIELDS: readonly FieldDefinition[] = [
  {
    label: "Font",
    path: "button.base.fontFamily",
    kind: "font",
    placeholder: "Select button font",
  },
  {
    label: "Size",
    path: "button.base.fontSize",
    kind: "measurement",
    units: SIZE_UNITS,
    placeholder: "14",
  },
  {
    label: "Weight",
    path: "button.base.fontWeight",
    kind: "select",
    options: FONT_WEIGHT_OPTIONS,
  },
  {
    label: "Line Height",
    path: "button.base.lineHeight",
    kind: "measurement",
    units: LINE_HEIGHT_UNITS,
    placeholder: "1.2",
  },
  {
    label: "Letter Spacing",
    path: "button.base.letterSpacing",
    kind: "measurement",
    units: LETTER_SPACING_UNITS,
    placeholder: "0",
  },
  {
    label: "Radius",
    path: "button.base.borderRadius",
    kind: "measurement",
    units: SPACING_UNITS,
    placeholder: "8",
  },
  {
    label: "Horizontal Padding",
    path: "button.base.paddingX",
    kind: "measurement",
    units: SPACING_UNITS,
    placeholder: "16",
  },
  {
    label: "Vertical Padding",
    path: "button.base.paddingY",
    kind: "measurement",
    units: SPACING_UNITS,
    placeholder: "10",
  },
  {
    label: "Border Width",
    path: "button.base.borderWidth",
    kind: "measurement",
    units: SPACING_UNITS,
    placeholder: "1",
  },
] as const

export function BUTTON_VARIANT_FIELDS(
  variant: string,
): readonly FieldDefinition[] {
  return [
    {
      label: "Background",
      path: `button.variants.${variant}.backgroundColor`,
      kind: "color",
      placeholder: "Background color",
    },
    {
      label: "Text",
      path: `button.variants.${variant}.color`,
      kind: "color",
      placeholder: "Text color",
    },
    {
      label: "Border",
      path: `button.variants.${variant}.borderColor`,
      kind: "color",
      placeholder: "Border color",
    },
    {
      label: "Hover Background",
      path: `button.variants.${variant}.hoverBackgroundColor`,
      kind: "color",
      placeholder: "Hover background",
    },
    {
      label: "Hover Text",
      path: `button.variants.${variant}.hoverColor`,
      kind: "color",
      placeholder: "Hover text color",
    },
    {
      label: "Hover Border",
      path: `button.variants.${variant}.hoverBorderColor`,
      kind: "color",
      placeholder: "Hover border color",
    },
  ] as const
}

export const BUTTON_SECTION_TITLE = "Buttons"
