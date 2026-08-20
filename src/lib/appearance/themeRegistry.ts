import { THEME_IDS, type ThemeId } from "../../../shared/appearance";

export interface ThemeDefinition {
  readonly id: ThemeId;
  readonly label: string;
  /** Slightly muted primary color shown in the appearance theme picker. */
  readonly primaryColor: string;
  readonly cssClass?: string;
  readonly dataTheme?: string;
}

export const THEME_REGISTRY = {
  aria: {
    id: "aria",
    label: "Aria",
    primaryColor: "color-mix(in oklch, var(--aria-brand-primary) 82%, black)",
    // Aria uses the built-in :root / .dark tokens in index.css — no overlay class.
    cssClass: undefined,
    dataTheme: "aria",
  },
  orbital: {
    id: "orbital",
    label: "Orbital",
    primaryColor: "color-mix(in oklch, var(--orbital-purple) 82%, black)",
    cssClass: "theme-orbital",
    dataTheme: "orbital",
  },
  signal: {
    id: "signal",
    label: "Signal",
    primaryColor: "color-mix(in oklch, var(--signal-brand) 82%, black)",
    cssClass: "theme-signal",
    dataTheme: "signal",
  },
} as const satisfies Record<ThemeId, ThemeDefinition>;

export const THEME_OPTIONS = THEME_IDS.map(
  (id) => THEME_REGISTRY[id],
) satisfies readonly ThemeDefinition[];
