/**
 * Built-in palette templates for Aria colors.
 * Each template defines four base colors (primary, secondary, muted, neutral).
 * Full 25–950 scales are generated on apply.
 */

import type { DesignSemanticColors } from "./design";
import {
  expandTemplateColorBases,
  generateNeutralPalette,
  mixColors,
  type ColorPaletteShades,
  type ThemePaletteRole,
} from "./designShades";

export type TemplateColorBases = {
  primary: string
  secondary: string
  muted: string
  neutral: string
}

export type PaletteTemplate = {
  id: string
  name: string
  description: string
  isBuiltIn: boolean
  colors: TemplateColorBases
  neutralWarmth?: number
  semantic: Required<DesignSemanticColors>
  preview?: string[]
}

const DEFAULT_SEMANTIC: Required<DesignSemanticColors> = {
  success: "#22c55e",
  warning: "#f59e0b",
  error: "#ef4444",
  info: "#3b82f6",
}

function buildThemeTemplate(opts: {
  id: string
  name: string
  description: string
  colors: TemplateColorBases
  neutralWarmth?: number
  semantic?: Partial<DesignSemanticColors>
}): PaletteTemplate {
  const { colors } = opts
  return {
    id: opts.id,
    name: opts.name,
    description: opts.description,
    isBuiltIn: true,
    colors,
    neutralWarmth: opts.neutralWarmth,
    semantic: { ...DEFAULT_SEMANTIC, ...opts.semantic },
    preview: [colors.primary, colors.secondary, colors.muted, colors.neutral],
  }
}

function buildGroundedTheme(opts: {
  id: string
  name: string
  description: string
  primary: string
  secondary: string
  muted: string
  neutralWarmth: number
  semantic?: Partial<DesignSemanticColors>
}): PaletteTemplate {
  const neutralMid =
    generateNeutralPalette(
      mixColors(opts.primary, "#808080", 0.65),
      opts.neutralWarmth,
    )["500"] ?? "#808080"

  return buildThemeTemplate({
    id: opts.id,
    name: opts.name,
    description: opts.description,
    neutralWarmth: opts.neutralWarmth,
    colors: {
      primary: opts.primary,
      secondary: opts.secondary,
      muted: opts.muted,
      neutral: neutralMid,
    },
    semantic: opts.semantic,
  })
}

const MINIMAL_GRAY = "#71717a"

const MINIMAL_TEMPLATE = buildThemeTemplate({
  id: "minimal",
  name: "Minimal",
  description:
    "Clean neutral grayscale — a blank slate for custom brand colors",
  colors: {
    primary: MINIMAL_GRAY,
    secondary: MINIMAL_GRAY,
    muted: "#a1a1aa",
    neutral: MINIMAL_GRAY,
  },
  neutralWarmth: 0,
  semantic: {
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",
    info: MINIMAL_GRAY,
  },
})

const MODERN_BLUE_TEMPLATE = buildGroundedTheme({
  id: "modern-blue",
  name: "Modern Blue",
  description:
    "Balanced product blue with cool neutrals — suited to SaaS and tech",
  primary: "#3d6fae",
  secondary: "#5a7a9e",
  muted: "#8b9cb0",
  neutralWarmth: -0.2,
})

const SAGE_TEMPLATE = buildGroundedTheme({
  id: "sage",
  name: "Sage",
  description:
    "Restrained green with warm stone neutrals — health, wellness, and eco",
  primary: "#4d7c6a",
  secondary: "#6b7c5c",
  muted: "#8a9a8f",
  neutralWarmth: 0.15,
  semantic: {
    success: "#4d7c6a",
  },
})

const CLAY_TEMPLATE = buildGroundedTheme({
  id: "clay",
  name: "Clay",
  description:
    "Warm terracotta and umber tones — editorial sites and human-centered brands",
  primary: "#b07a5f",
  secondary: "#7a5c4a",
  muted: "#a89488",
  neutralWarmth: 0.25,
  semantic: {
    warning: "#b07a5f",
  },
})

const INK_TEMPLATE = buildGroundedTheme({
  id: "ink",
  name: "Ink",
  description:
    "Blue-gray primary with a soft violet secondary — modern tech and studios",
  primary: "#4f5d7a",
  secondary: "#6b5f8a",
  muted: "#8b92a3",
  neutralWarmth: -0.15,
  semantic: {
    info: "#4f5d7a",
  },
})

const OCEAN_TEMPLATE = buildGroundedTheme({
  id: "ocean",
  name: "Ocean",
  description:
    "Clear teal with cool slate neutrals — fintech, travel, and clarity-forward brands",
  primary: "#0f766e",
  secondary: "#3d6b7a",
  muted: "#7a9399",
  neutralWarmth: -0.25,
  semantic: {
    info: "#0f766e",
    success: "#0d9488",
  },
})

const MIDNIGHT_TEMPLATE = buildGroundedTheme({
  id: "midnight",
  name: "Midnight",
  description:
    "Deep navy with cool charcoal neutrals — premium, dark-leaning product brands",
  primary: "#1e3a5f",
  secondary: "#3d4f6f",
  muted: "#6b7a8f",
  neutralWarmth: -0.3,
  semantic: {
    info: "#3b82f6",
  },
})

const CORAL_TEMPLATE = buildGroundedTheme({
  id: "coral",
  name: "Coral",
  description:
    "Soft coral with dusty rose muted tones — consumer, lifestyle, and beauty",
  primary: "#e07a5f",
  secondary: "#c47a7a",
  muted: "#b89a94",
  neutralWarmth: 0.2,
  semantic: {
    warning: "#e07a5f",
    error: "#c45c4a",
  },
})

const SLOP_PURPLE_TEMPLATE = buildThemeTemplate({
  id: "slop-purple",
  name: "Slop Purple",
  description:
    "The generic AI landing-page gradient. Purple, pink, and cyan. You know the one.",
  colors: {
    primary: "#8b5cf6",
    secondary: "#d946ef",
    muted: "#94a3b8",
    neutral: "#475569",
  },
  neutralWarmth: -0.15,
  semantic: {
    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",
    info: "#8b5cf6",
  },
})

export const PALETTE_TEMPLATES: Record<string, PaletteTemplate> = {
  minimal: MINIMAL_TEMPLATE,
  "modern-blue": MODERN_BLUE_TEMPLATE,
  sage: SAGE_TEMPLATE,
  clay: CLAY_TEMPLATE,
  ink: INK_TEMPLATE,
  ocean: OCEAN_TEMPLATE,
  midnight: MIDNIGHT_TEMPLATE,
  coral: CORAL_TEMPLATE,
  "slop-purple": SLOP_PURPLE_TEMPLATE,
}

export const TEMPLATE_IDS = Object.keys(PALETTE_TEMPLATES)

export const THEME_PALETTE_ROLES: ThemePaletteRole[] = [
  "primary",
  "secondary",
  "muted",
  "neutral",
]

export function getTemplate(id: string): PaletteTemplate | undefined {
  return PALETTE_TEMPLATES[id]
}

export function listPaletteTemplates(): PaletteTemplate[] {
  return TEMPLATE_IDS.map((id) => PALETTE_TEMPLATES[id])
}

export function expandTemplateToPalettes(
  template: PaletteTemplate,
): Record<ThemePaletteRole, ColorPaletteShades> {
  return expandTemplateColorBases(template.colors, {
    neutralWarmth: template.neutralWarmth,
  })
}

const PREVIEW_STOPS = ["50", "300", "500", "700", "950"] as const

/** Compact swatch grid for the template dropdown / confirm dialog. */
export function getTemplatePreviewRows(template: PaletteTemplate): string[][] {
  const expanded = expandTemplateToPalettes(template)
  return THEME_PALETTE_ROLES.map((role) =>
    PREVIEW_STOPS.map(
      (shade) =>
        expanded[role][shade] ??
        expanded[role].DEFAULT ??
        template.colors[role],
    ),
  )
}
