/** Canonical theme IDs — extend this tuple when adding themes */
export const THEME_IDS = ["aria", "orbital", "signal"] as const;

export type ThemeId = (typeof THEME_IDS)[number];
export type ColorScheme = "light" | "dark" | "system";
export type FontFamily = "Outfit" | "Inter" | "System" | "Monospace";
export type StudioLocale = "en" | "fr";
export type StudioLocalePreference = "system" | StudioLocale;

export type AppearanceSettings = {
  themeId: ThemeId;
  colorScheme: ColorScheme;
  fontFamily: FontFamily;
  uiZoom: number;
};

/** App-level prefs file shape (userData/appearance.json) */
export type AppAppearancePrefs = AppearanceSettings & {
  studioLocale: StudioLocalePreference;
};

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  themeId: "aria",
  colorScheme: "system",
  fontFamily: "Outfit",
  uiZoom: 1,
};

export const DEFAULT_APP_APPEARANCE_PREFS: AppAppearancePrefs = {
  ...DEFAULT_APPEARANCE_SETTINGS,
  studioLocale: "system",
};

const THEME_ID_SET = new Set<string>(THEME_IDS);
const COLOR_SCHEME_SET = new Set<string>(["light", "dark", "system"]);
const FONT_FAMILY_SET = new Set<string>([
  "Outfit",
  "Inter",
  "System",
  "Monospace",
]);
const STUDIO_LOCALE_PREF_SET = new Set<string>(["system", "en", "fr"]);

function parseUiZoom(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0.75 && value <= 1.5) return value;
    if (value > 1.5 && value <= 150) {
      const normalized = value / 100;
      if (normalized >= 0.75 && normalized <= 1.5) return normalized;
    }
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parseUiZoom(parsed);
  }
  return DEFAULT_APPEARANCE_SETTINGS.uiZoom;
}

function parseThemeId(value: unknown): ThemeId {
  if (typeof value === "string" && THEME_ID_SET.has(value)) {
    return value as ThemeId;
  }
  return DEFAULT_APPEARANCE_SETTINGS.themeId;
}

function parseColorScheme(value: unknown): ColorScheme {
  if (typeof value === "string" && COLOR_SCHEME_SET.has(value)) {
    return value as ColorScheme;
  }
  return DEFAULT_APPEARANCE_SETTINGS.colorScheme;
}

function parseFontFamily(value: unknown): FontFamily {
  if (value === "Satoshi") return "Outfit";
  if (typeof value === "string" && FONT_FAMILY_SET.has(value)) {
    return value as FontFamily;
  }
  return DEFAULT_APPEARANCE_SETTINGS.fontFamily;
}

function parseStudioLocale(value: unknown): StudioLocalePreference {
  if (typeof value === "string" && STUDIO_LOCALE_PREF_SET.has(value)) {
    return value as StudioLocalePreference;
  }
  return DEFAULT_APP_APPEARANCE_PREFS.studioLocale;
}

export function parseAppearanceSettings(input: unknown): AppearanceSettings {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};

  return {
    themeId: parseThemeId(raw.themeId),
    colorScheme: parseColorScheme(raw.colorScheme),
    fontFamily: parseFontFamily(raw.fontFamily),
    uiZoom: parseUiZoom(raw.uiZoom),
  };
}

export function parseAppAppearancePrefs(input: unknown): AppAppearancePrefs {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const appearance = parseAppearanceSettings(raw);
  return {
    ...appearance,
    studioLocale: parseStudioLocale(raw.studioLocale),
  };
}

export function toAppearanceWritePayload(
  settings: AppearanceSettings,
): AppearanceSettings {
  return parseAppearanceSettings(settings);
}

export function toAppAppearanceWritePayload(
  prefs: AppAppearancePrefs,
): AppAppearancePrefs {
  return parseAppAppearancePrefs(prefs);
}

export const FOUC_APPEARANCE_STORAGE_KEY = "aria-appearance";

export function resolveStudioLocale(input: {
  preference?: StudioLocalePreference | null;
  acceptedLanguages?: readonly string[] | null;
}): StudioLocale {
  if (input.preference && input.preference !== "system") {
    return input.preference;
  }

  for (const language of input.acceptedLanguages ?? []) {
    const normalized = language.trim().toLowerCase().split("-")[0];
    if (normalized === "fr") return "fr";
    if (normalized === "en") return "en";
  }
  return "en";
}
