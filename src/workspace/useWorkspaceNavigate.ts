/**
 * Navigate from Composer → Design surface section (Class Manager, Variables…).
 * Provided by WorkspaceShell so inspectors can deep-link without prop drilling.
 */

import { inject, provide, type InjectionKey } from "vue"
import {
  DESIGN_SECTION_STORAGE_KEY,
  type DesignSectionId,
} from "@/workspace/design/types"
import type { WorkspaceRailId } from "@/workspace/types"

export type WorkspaceNavigateApi = {
  openDesignSection: (section: DesignSectionId) => void
  selectRail: (rail: WorkspaceRailId) => void
}

const WORKSPACE_NAVIGATE_KEY: InjectionKey<WorkspaceNavigateApi> = Symbol(
  "aria.workspace.navigate",
)

export function provideWorkspaceNavigate(
  api: WorkspaceNavigateApi,
): WorkspaceNavigateApi {
  provide(WORKSPACE_NAVIGATE_KEY, api)
  return api
}

export function tryUseWorkspaceNavigate(): WorkspaceNavigateApi | null {
  return inject(WORKSPACE_NAVIGATE_KEY, null)
}

/** Persist preferred Design section then switch rail (DesignSurface remounts). */
export function openDesignSectionViaStorage(
  section: DesignSectionId,
  selectRail: (rail: WorkspaceRailId) => void,
) {
  try {
    localStorage.setItem(DESIGN_SECTION_STORAGE_KEY, section)
  } catch {
    /* ignore */
  }
  selectRail("design")
}
