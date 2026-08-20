import { colord, extend } from "colord"
import mixPlugin from "colord/plugins/mix"
import labPlugin from "colord/plugins/lab"
import lchPlugin from "colord/plugins/lch"
import a11yPlugin from "colord/plugins/a11y"
import type { ColorShadeKey } from "./design";
import { COLOR_SHADE_KEYS } from "./design";

extend([mixPlugin, labPlugin, lchPlugin, a11yPlugin])

export type ColorPaletteShades = Partial<Record<ColorShadeKey, string>>

export type ThemePaletteRole = "primary" | "secondary" | "muted" | "neutral"

const PERCEPTUAL_SHADE_STOPS = [
  { shade: 25, lightness: 98, chroma: 0.1 },
  { shade: 50, lightness: 96, chroma: 0.16 },
  { shade: 100, lightness: 92, chroma: 0.28 },
  { shade: 200, lightness: 84, chroma: 0.48 },
  { shade: 300, lightness: 74, chroma: 0.68 },
  { shade: 400, lightness: 64, chroma: 0.86 },
  { shade: 500, lightness: 54, chroma: 1 },
  { shade: 600, lightness: 46, chroma: 0.96 },
  { shade: 700, lightness: 38, chroma: 0.88 },
  { shade: 800, lightness: 30, chroma: 0.76 },
  { shade: 900, lightness: 22, chroma: 0.6 },
  { shade: 950, lightness: 14, chroma: 0.42 },
] as const

export function generatePerceptualShades(
  baseColor: string,
  options: { chromaStrength?: number } = {},
): ColorPaletteShades {
  const base = colord(baseColor)
  if (!base.isValid()) {
    return { DEFAULT: baseColor }
  }
  const lch = base.toLch()
  const chromaStrength = Math.max(0, options.chromaStrength ?? 1)
  const shades: ColorPaletteShades = {}

  for (const stop of PERCEPTUAL_SHADE_STOPS) {
    const key = String(stop.shade) as ColorShadeKey
    shades[key] = colord({
      l: stop.lightness,
      c: lch.c * stop.chroma * chromaStrength,
      h: lch.h,
      a: lch.a,
    }).toHex()
  }

  shades.DEFAULT = base.toHex()
  return shades
}

export function generateNaturalShades(baseColor: string): ColorPaletteShades {
  return generatePerceptualShades(baseColor)
}

/** Neutral scale with optional cool/warm bias (-1 … 1). */
export function generateNeutralPalette(
  baseColor: string,
  warmth: number = 0,
): ColorPaletteShades {
  const base = colord(baseColor)
  if (!base.isValid()) return { DEFAULT: baseColor }
  const lch = base.toLch()
  const normalizedWarmth = Math.max(-1, Math.min(1, warmth))
  const hue = lch.c < 1 ? (normalizedWarmth < 0 ? 255 : 65) : lch.h
  const neutralAnchor = colord({
    l: lch.l,
    c: Math.max(lch.c, Math.abs(normalizedWarmth) * 8),
    h: hue,
    a: lch.a,
  }).toHex()

  const scale = generatePerceptualShades(neutralAnchor, {
    chromaStrength: 0.12,
  })
  scale.DEFAULT = base.toHex()
  return scale
}

export function mixColors(
  color1: string,
  color2: string,
  ratio: number = 0.5,
): string {
  return colord(color1).mix(color2, ratio).toHex()
}

/** Expand four template base colors into full design-system palettes. */
export function expandTemplateColorBases(
  bases: {
    primary: string
    secondary: string
    muted: string
    neutral: string
  },
  options?: { neutralWarmth?: number },
): Record<ThemePaletteRole, ColorPaletteShades> {
  const neutral = generateNeutralPalette(
    bases.neutral,
    options?.neutralWarmth ?? 0,
  )
  return {
    neutral,
    primary: generatePerceptualShades(bases.primary, { chromaStrength: 1 }),
    secondary: generatePerceptualShades(bases.secondary, {
      chromaStrength: 0.8,
    }),
    muted: generatePerceptualShades(bases.muted, { chromaStrength: 0.35 }),
  }
}

export function getTextColorForBackground(color: string): string {
  const c = colord(color)
  if (!c.isValid()) return "#ffffff"
  return c.isLight() ? "#0a0a0a" : "#ffffff"
}

export function contrastRatio(foreground: string, background: string): number {
  try {
    return colord(foreground).contrast(background)
  } catch {
    return 1
  }
}

export { COLOR_SHADE_KEYS }
