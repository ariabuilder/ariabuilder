import type { DesignSectionId } from "../../../shared/design"
import type { AppIconName } from "@/icons/registry"

export type { DesignSectionId }

export type DesignSectionGroup = "foundation" | "management"

export interface DesignSectionConfig {
  id: DesignSectionId
  group: DesignSectionGroup
  labelKey: string
  descriptionKey: string
  icon: AppIconName
}

export const DESIGN_SECTION_CONFIG: Record<
  DesignSectionId,
  DesignSectionConfig
> = {
  colors: {
    id: "colors",
    group: "foundation",
    labelKey: "design_section_colors",
    descriptionKey: "design_description_colors",
    icon: "colorPalette",
  },
  typography: {
    id: "typography",
    group: "foundation",
    labelKey: "design_section_fonts",
    descriptionKey: "design_description_fonts",
    icon: "typography",
  },
  "global-styles": {
    id: "global-styles",
    group: "foundation",
    labelKey: "design_section_global_styles",
    descriptionKey: "design_description_global_styles",
    icon: "globe",
  },
  icons: {
    id: "icons",
    group: "foundation",
    labelKey: "design_section_icons",
    descriptionKey: "design_description_icons",
    icon: "sparkles",
  },
  stylesheets: {
    id: "stylesheets",
    group: "management",
    labelKey: "design_section_stylesheets",
    descriptionKey: "design_description_stylesheets",
    icon: "code",
  },
  "class-manager": {
    id: "class-manager",
    group: "management",
    labelKey: "design_section_class_manager",
    descriptionKey: "design_description_class_manager",
    icon: "codeSquare",
  },
  "variable-manager": {
    id: "variable-manager",
    group: "management",
    labelKey: "design_section_variable_manager",
    descriptionKey: "design_description_variable_manager",
    icon: "variable",
  },
}

export const DESIGN_SECTION_ORDER: readonly DesignSectionId[] = [
  "colors",
  "typography",
  "icons",
  "global-styles",
  "class-manager",
  "variable-manager",
  "stylesheets",
] as const

export const DESIGN_SECTION_STORAGE_KEY = "aria-design-section"

export function isDesignSection(value: string | null): value is DesignSectionId {
  if (!value) return false
  return Object.prototype.hasOwnProperty.call(DESIGN_SECTION_CONFIG, value)
}
