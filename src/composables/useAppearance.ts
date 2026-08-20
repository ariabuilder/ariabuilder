/**
 * Theme palette, color mode, typography, and UI scale.
 * Persists app-level via Electron userData/appearance.json.
 */

import { ref, watch, computed, readonly, type DeepReadonly } from "vue";
import { toast } from "vue-sonner";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_APP_APPEARANCE_PREFS,
  FOUC_APPEARANCE_STORAGE_KEY,
  parseAppearanceSettings,
  parseAppAppearancePrefs,
  resolveStudioLocale,
  toAppAppearanceWritePayload,
  type AppearanceSettings,
  type AppAppearancePrefs,
  type ColorScheme,
  type FontFamily,
  type StudioLocalePreference,
  type ThemeId,
} from "../../shared/appearance";
import { getAppearance, setAppearance } from "@/lib/appearance";
import { setReactiveLocale } from "@/lib/locale";
import { THEME_REGISTRY } from "@/lib/appearance/themeRegistry";

export type {
  AppearanceSettings,
  AppAppearancePrefs,
  ColorScheme,
  FontFamily,
  StudioLocalePreference,
  ThemeId,
} from "../../shared/appearance";

const FONT_FAMILY_MAP: DeepReadonly<Record<FontFamily, string>> = {
  Outfit:
    '"Outfit Variable", "Outfit", "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
  Inter:
    '"Inter Variable", "Inter", "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
  System: "system-ui, -apple-system, sans-serif",
  Monospace:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
} as const;

const UI_ZOOM_TRANSITION_MS = 320;

const settings = ref<AppearanceSettings>({ ...DEFAULT_APPEARANCE_SETTINGS });
const studioLocale = ref<StudioLocalePreference>(
  DEFAULT_APP_APPEARANCE_PREFS.studioLocale,
);
const lastPersistedPrefs = ref<AppAppearancePrefs>({
  ...DEFAULT_APP_APPEARANCE_PREFS,
});
const isLoading = ref(false);

let isInitialized = false;
let isUiZoomWatchRegistered = false;
let isLoadingComplete = false;
let darkModeMediaQuery: MediaQueryList | null = null;
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let uiZoomTransitionTimer: ReturnType<typeof setTimeout> | null = null;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function endUiZoomTransition(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.remove("is-ui-zooming");
  if (uiZoomTransitionTimer) {
    clearTimeout(uiZoomTransitionTimer);
    uiZoomTransitionTimer = null;
  }
}

function beginUiZoomTransition(): void {
  if (typeof document === "undefined" || prefersReducedMotion()) return;

  const html = document.documentElement;
  endUiZoomTransition();
  html.classList.add("is-ui-zooming");

  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target !== html || event.propertyName !== "--ui-zoom") return;
    html.removeEventListener("transitionend", onTransitionEnd);
    endUiZoomTransition();
  };

  html.addEventListener("transitionend", onTransitionEnd);
  uiZoomTransitionTimer = setTimeout(() => {
    html.removeEventListener("transitionend", onTransitionEnd);
    endUiZoomTransition();
  }, UI_ZOOM_TRANSITION_MS);
}

function isSystemDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveIsDark(colorScheme: ColorScheme): boolean {
  if (colorScheme === "dark") return true;
  if (colorScheme === "light") return false;
  return isSystemDark();
}

function currentPrefs(): AppAppearancePrefs {
  return {
    ...settings.value,
    studioLocale: studioLocale.value,
  };
}

function writeFoucMirror(config: AppearanceSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FOUC_APPEARANCE_STORAGE_KEY,
      JSON.stringify(parseAppearanceSettings(config)),
    );
  } catch {
    // Best-effort mirror only.
  }
}

function applyTheme(themeId: ThemeId, colorScheme: ColorScheme): void {
  if (typeof window === "undefined") return;

  const html = document.documentElement;
  const isDark = resolveIsDark(colorScheme);

  for (const theme of Object.values(THEME_REGISTRY)) {
    if (theme.cssClass) html.classList.remove(theme.cssClass);
  }
  // Stale class from earlier builds that overlaid Aria tokens
  html.classList.remove("theme-aria");
  html.removeAttribute("data-theme");

  html.classList.toggle("dark", isDark);

  const theme = THEME_REGISTRY[themeId];
  if (theme.cssClass) html.classList.add(theme.cssClass);
  if (theme.dataTheme) html.setAttribute("data-theme", theme.dataTheme);

  html.dataset.ariaInitialTheme = themeId;
  html.dataset.ariaInitialDark = isDark ? "1" : "0";
}

function applyFontAndZoom(config: AppearanceSettings): void {
  if (typeof window === "undefined") return;

  const fontStack = FONT_FAMILY_MAP[config.fontFamily];
  document.documentElement.style.removeProperty("--primary");
  document.documentElement.style.removeProperty("--color-primary");
  document.documentElement.style.setProperty("--font-family-ui", fontStack);
  document.documentElement.style.setProperty("--font-sans", fontStack);
  document.documentElement.style.setProperty("font-family", fontStack);
  document.documentElement.style.setProperty(
    "--ui-zoom",
    String(config.uiZoom),
  );
}

function applyAllSettings(config: AppearanceSettings): void {
  applyTheme(config.themeId, config.colorScheme);
  applyFontAndZoom(config);
  writeFoucMirror(config);
}

function applyStudioLocale(preference: StudioLocalePreference): void {
  const next = resolveStudioLocale({
    preference,
    acceptedLanguages:
      typeof navigator === "undefined" ? [] : navigator.languages,
  });
  setReactiveLocale(next);
}

function scheduleSave(): void {
  if (!isLoadingComplete) return;

  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }

  saveDebounceTimer = setTimeout(() => {
    void flushSave();
  }, 500);
}

async function flushSave(): Promise<void> {
  if (!isLoadingComplete) return;

  const prefs = toAppAppearanceWritePayload(currentPrefs());

  try {
    const persisted = parseAppAppearancePrefs(await setAppearance(prefs));
    lastPersistedPrefs.value = persisted;
    settings.value = {
      themeId: persisted.themeId,
      colorScheme: persisted.colorScheme,
      fontFamily: persisted.fontFamily,
      uiZoom: persisted.uiZoom,
    };
    studioLocale.value = persisted.studioLocale;
    writeFoucMirror(settings.value);
  } catch (error) {
    console.error("[useAppearance] Failed to save settings:", error);
    settings.value = {
      themeId: lastPersistedPrefs.value.themeId,
      colorScheme: lastPersistedPrefs.value.colorScheme,
      fontFamily: lastPersistedPrefs.value.fontFamily,
      uiZoom: lastPersistedPrefs.value.uiZoom,
    };
    studioLocale.value = lastPersistedPrefs.value.studioLocale;
    applyAllSettings(settings.value);
    applyStudioLocale(studioLocale.value);
    toast.error("Could not save appearance settings");
  }
}

function setupSystemThemeListener(callback: () => void): void {
  if (typeof window === "undefined") return;
  darkModeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  darkModeMediaQuery.addEventListener("change", callback);
}

export function useAppearance() {
  const isDark = computed(() => resolveIsDark(settings.value.colorScheme));

  async function loadSettings(): Promise<void> {
    isLoading.value = true;

    try {
      const loaded = parseAppAppearancePrefs(await getAppearance());
      settings.value = {
        themeId: loaded.themeId,
        colorScheme: loaded.colorScheme,
        fontFamily: loaded.fontFamily,
        uiZoom: loaded.uiZoom,
      };
      studioLocale.value = loaded.studioLocale;
      lastPersistedPrefs.value = loaded;
      applyAllSettings(settings.value);
      applyStudioLocale(loaded.studioLocale);
      await new Promise((resolve) => setTimeout(resolve, 0));
    } catch (error) {
      console.error("[useAppearance] Failed to load settings:", error);
      settings.value = { ...DEFAULT_APPEARANCE_SETTINGS };
      studioLocale.value = DEFAULT_APP_APPEARANCE_PREFS.studioLocale;
      lastPersistedPrefs.value = { ...DEFAULT_APP_APPEARANCE_PREFS };
      applyAllSettings(settings.value);
      applyStudioLocale(studioLocale.value);
    } finally {
      isLoading.value = false;
      isLoadingComplete = true;
    }
  }

  async function updateAppearance(
    patch: Partial<AppearanceSettings>,
  ): Promise<void> {
    if (!isLoadingComplete) return;

    const previous = settings.value;
    const merged = parseAppearanceSettings({
      ...previous,
      ...patch,
    });

    settings.value = merged;
    applyTheme(merged.themeId, merged.colorScheme);
    applyFontAndZoom(merged);
    writeFoucMirror(merged);
    scheduleSave();
  }

  function updateStudioLocale(next: StudioLocalePreference): void {
    if (!isLoadingComplete) return;
    studioLocale.value = next;
    applyStudioLocale(next);
    scheduleSave();
  }

  if (!isInitialized && typeof window !== "undefined") {
    isInitialized = true;

    if (!isUiZoomWatchRegistered) {
      isUiZoomWatchRegistered = true;
      watch(
        () => settings.value.uiZoom,
        (newZoom, oldZoom) => {
          if (!isLoadingComplete) return;
          if (oldZoom === undefined || newZoom === oldZoom) return;
          beginUiZoomTransition();
        },
        { flush: "sync" },
      );
    }

    void loadSettings();

    setupSystemThemeListener(() => {
      if (settings.value.colorScheme !== "system") return;
      applyTheme(settings.value.themeId, settings.value.colorScheme);
    });
  }

  return {
    settings: readonly(settings),
    studioLocale: readonly(studioLocale),
    isDark,
    isLoading: readonly(isLoading),
    updateAppearance,
    updateStudioLocale,
    loadSettings,
    reapply: () => applyAllSettings(settings.value),
    reset: () => {
      void updateAppearance({ ...DEFAULT_APPEARANCE_SETTINGS });
    },
  };
}
