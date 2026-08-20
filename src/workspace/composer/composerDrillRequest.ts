/**
 * Cross-rail request to open a component/layout in Composer with page-context
 * drill-in. Layouts rail (and similar) set this before switching to Composer.
 */

import {
  peekComposerDocumentLaunchRequest,
  requestComposerDocumentLaunch,
  takeComposerDocumentLaunchRequest,
} from "./composerDocumentLaunchRequest"
import type { ComposerEditKind } from "./useComposerEditStack"

export type ComposerDrillRequest = {
  kind: Exclude<ComposerEditKind, "page">
  name: string
  /** Project-relative posix path. */
  file: string
  /** Optional page-namespace focus path when the instance is known. */
  focusPath?: string | null
}

export function requestComposerDrill(projectPath: string, req: ComposerDrillRequest) {
  requestComposerDocumentLaunch({
    mode: "standalone-component",
    kind: req.kind,
    name: req.name,
    file: req.file,
  }, projectPath)
}

/** Consume and clear the pending drill request (ComposerSurface on mount/watch). */
export function takeComposerDrillRequest(projectPath?: string): ComposerDrillRequest | null {
  const req = takeComposerDocumentLaunchRequest(projectPath)
  if (!req || req.mode === "page" || req.mode === "cms-entry-template") return null
  return {
    kind: req.kind,
    name: req.name,
    file: req.file,
    focusPath: req.mode === "inline-component" ? req.hostPath : null,
  }
}

export function peekComposerDrillRequest(projectPath?: string): ComposerDrillRequest | null {
  const req = peekComposerDocumentLaunchRequest(projectPath)
  if (!req || req.mode === "page" || req.mode === "cms-entry-template") return null
  return {
    kind: req.kind,
    name: req.name,
    file: req.file,
    focusPath: req.mode === "inline-component" ? req.hostPath : null,
  }
}
