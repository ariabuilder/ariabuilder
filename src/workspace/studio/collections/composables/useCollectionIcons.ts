import type { CollectionKind } from "../../../../../shared/cms"
import { collectionKindIcon } from "../lib/collectionKindOptions"

/** Legacy / demo icon aliases → AppIconName or iconify id. */
const LEGACY_ICON_MAP: Record<string, string> = {
  FileText: "pages",
  Users: "users",
  Tag: "tag",
  Calendar: "calendar",
  Settings: "settings",
  Image: "image",
  Folder: "folder",
  Globe: "globe",
  Star: "sparkles",
  Database: "databaseLine",
}

export interface UseCollectionIconsReturn {
  /** Resolved icon string for preview (AppIconName, iconify id, or URL). */
  getCollectionIcon: (iconName?: string | null) => string
  getCollectionIconForKind: (kind: CollectionKind) => string
}

export function useCollectionIcons(): UseCollectionIconsReturn {
  function getCollectionIcon(iconName?: string | null): string {
    const trimmed = iconName?.trim()
    if (!trimmed) return "collections"

    if (trimmed.startsWith("i-")) {
      return trimmed.slice(2)
    }

    return LEGACY_ICON_MAP[trimmed] ?? trimmed
  }

  function getCollectionIconForKind(kind: CollectionKind): string {
    return collectionKindIcon(kind)
  }

  return {
    getCollectionIcon,
    getCollectionIconForKind,
  }
}
