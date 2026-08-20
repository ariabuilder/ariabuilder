import type { SiteSettings } from "@/workspace/settings/types"
import type { ScanResult } from "../../shared/types"

export type {
  ScanComponent,
  LayoutPreviewManifest,
  LayoutPreviewConsumer,
  LayoutPreviewSlot,
  ScanPage,
  ScanResult,
  PageRole,
  PageMetaRecord,
  PageSeoMeta,
  PagesMetaState,
} from "../../shared/types"

export type DevicePreview = "desktop" | "tablet" | "mobile"

/** Left-rail destinations (Stage, inventory panels). */
export type WorkspaceRailId =
  | "composer"
  | "pages"
  | "components"
  | "layouts"
  | "collections"
  | "media"
  | "design"
  | "settings"

/** Document currently owned by Composer, which may differ from the preview page. */
export type WorkspaceActiveDocument =
  | { kind: "page"; name: string; file: string }
  | { kind: "component"; name: string; file: string }
  | { kind: "layout"; name: string; file: string }

export type ProjectSession = {
  root: string
  name: string
  /** Active left-rail destination. */
  rail: WorkspaceRailId
  selectedRoute: string | null
  device: DevicePreview
  scan: ScanResult | null
  scanError: string | null
  scanLoading: boolean
  settingsError: string | null
  /** Site identity / SEO defaults from `.aria/site-settings.json`. */
  siteSettings: SiteSettings
}
