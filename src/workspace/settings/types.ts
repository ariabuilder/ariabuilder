export type {
  SiteSettings,
  CodeSnippet,
  CodeSnippetPlacement,
  AnalyticsSettings,
  AnalyticsProviderId,
} from "../../../shared/types"

export type SettingsTabId =
  | "general"
  | "localization"
  | "appearance"
  | "snippets"
  | "analytics"
  | "seo"
  | "discovery"
  | "agent"
  | "import-export"
  | "history"

export const SETTINGS_TAB_ORDER: readonly SettingsTabId[] = [
  "general",
  "localization",
  "snippets",
  "analytics",
  "seo",
  "discovery",
  "import-export",
]

export const SETTINGS_WORKSPACE_TAB_ORDER: readonly SettingsTabId[] = [
  "appearance",
  "agent",
  "history",
]

export type SettingsNavItem = {
  id: SettingsTabId
  label: () => string
}
