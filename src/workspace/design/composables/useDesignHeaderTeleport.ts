import { inject, type InjectionKey, type Ref, type ShallowRef } from "vue"

export type DesignHeaderTeleportTarget =
  | "search"
  | "toolbar"
  | "importExport"
  | "stylesheet"
  | "maintenance"
  | "actions"

export const DESIGN_HEADER_TELEPORT_TARGETS = {
  search: "design-header-search",
  toolbar: "design-header-toolbar",
  importExport: "design-header-import-export",
  stylesheet: "design-header-stylesheet",
  maintenance: "design-header-maintenance",
  actions: "design-header-actions",
} as const satisfies Record<DesignHeaderTeleportTarget, string>

export type DesignHeaderTeleportRefs = Record<
  DesignHeaderTeleportTarget,
  Ref<HTMLElement | null> | ShallowRef<HTMLElement | null>
>

export const DESIGN_HEADER_TELEPORT_KEY: InjectionKey<DesignHeaderTeleportRefs> =
  Symbol("design-header-teleport")

export function useDesignHeaderTeleport(): DesignHeaderTeleportRefs {
  const targets = inject(DESIGN_HEADER_TELEPORT_KEY, null)
  if (targets === null) {
    throw new Error(
      "useDesignHeaderTeleport must be used within DesignSurface",
    )
  }
  return targets
}
