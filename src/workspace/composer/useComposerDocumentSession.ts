/**
 * Composer document session — provide/inject so inspector + structure + palette
 * can mutate the page model without prop-drilling through chrome.
 */

import { inject, provide, type ComputedRef, type InjectionKey, type Ref } from "vue"
import type { InsertTarget } from "../../../shared/composer/mutate"
import type { AriaPrimitiveId } from "../../../shared/composer/ariaPrimitives"
import type {
  AstroDocumentModel,
  PropValue,
} from "../../../shared/composer/types"
import type { ScanPage } from "../../../shared/types"
import type {
  ComposerDocumentApi,
  ComposerInsertComponent,
} from "./useComposerDocument"
import type { ProjectDataInstanceSegment } from "../../../shared/composer/projectData"
import type { ComposerCmsEntryTemplatePreviewContext } from "../../../shared/composer/componentAuthoring"

export type ComposerDocumentSession = {
  model: Ref<AstroDocumentModel | null>
  /** Exact source baseline used by formatting-preserving document mutations. */
  exactSource: Ref<string | null>
  editable: Ref<boolean>
  mutationPending: ComposerDocumentApi["mutationPending"]
  designActive: Ref<boolean>
  saveError: ComposerDocumentApi["saveError"]
  projectPath: Ref<string>
  editFile: Ref<string | null>
  availableLayouts: Ref<ComposerInsertComponent[]>
  pages: Ref<readonly ScanPage[]>
  documentKind: ComputedRef<"page" | "component" | "layout">
  instanceChain: ComputedRef<readonly ProjectDataInstanceSegment[]>
  cmsEntryTemplatePreview?: Ref<ComposerCmsEntryTemplatePreviewContext | null>
  mutateModel: ComposerDocumentApi["mutateModel"]
  commitModelMutation: ComposerDocumentApi["commitModelMutation"]
  withMutationLock: ComposerDocumentApi["withMutationLock"]
  commitInspectorMutation: ComposerDocumentApi["commitInspectorMutation"]
  flushSave: ComposerDocumentApi["flushSave"]
  registerBeforeFlush: ComposerDocumentApi["registerBeforeFlush"]
  previewStyle: (path: string, cssText: string, relativePath?: string) => void
  clearPreviewStyle: (path?: string, relativePath?: string) => void
  computedStyle: (payload: {
    path: string
    relativePath?: string
    properties: string[]
  }) => Promise<Record<string, string>>
  popoverPreviewTargetId: Ref<string | null>
  previewPopover: (targetId: string | null, open?: boolean) => void
  reloadPreview: () => void
  reloadDocument: () => Promise<void>
  setSelectedProp: ComposerDocumentApi["setSelectedProp"]
  renameSelectedProp: ComposerDocumentApi["renameSelectedProp"]
  setSelectedText: ComposerDocumentApi["setSelectedText"]
  beginCanvasTextEdit: ComposerDocumentApi["beginCanvasTextEdit"]
  updateCanvasTextEdit: ComposerDocumentApi["updateCanvasTextEdit"]
  finishCanvasTextEdit: ComposerDocumentApi["finishCanvasTextEdit"]
  setSelectedTag: ComposerDocumentApi["setSelectedTag"]
  commitStylesheetEdit: ComposerDocumentApi["commitStylesheetEdit"]
  commitModelWithStylesheet: ComposerDocumentApi["commitModelWithStylesheet"]
  setSelectedPropWithStylesheet: ComposerDocumentApi["setSelectedPropWithStylesheet"]
  insertElement: (tag: string, target?: InsertTarget | null) => boolean
  insertAriaPrimitive: (
    id: AriaPrimitiveId | string,
    target?: InsertTarget | null,
  ) => boolean
  insertComponent: (
    component: ComposerInsertComponent,
    target?: InsertTarget | null,
  ) => boolean
  insertLayoutSlot: ComposerDocumentApi["insertLayoutSlot"]
  renameLayoutSlot: ComposerDocumentApi["renameLayoutSlot"]
  deleteLayoutSlot: ComposerDocumentApi["deleteLayoutSlot"]
  inspectLayoutSlotUsage: ComposerDocumentApi["inspectLayoutSlotUsage"]
  assignPageLayout: ComposerDocumentApi["assignPageLayout"]
  removePageLayout: ComposerDocumentApi["removePageLayout"]
  activatePageSlot: ComposerDocumentApi["activatePageSlot"]
  assignNodesToPageSlot: ComposerDocumentApi["assignNodesToPageSlot"]
  moveNodeTo: (path: string, target: InsertTarget) => boolean
  moveNodesTo: (paths: readonly string[], target: InsertTarget) => boolean
  deleteSelected: ComposerDocumentApi["deleteSelected"]
  duplicateSelected: ComposerDocumentApi["duplicateSelected"]
  copySelected: ComposerDocumentApi["copySelected"]
  cutSelected: ComposerDocumentApi["cutSelected"]
  pasteClipboard: ComposerDocumentApi["pasteClipboard"]
}

const COMPOSER_DOCUMENT_KEY: InjectionKey<ComposerDocumentSession> = Symbol(
  "aria.composer.document",
)

export function provideComposerDocument(
  session: ComposerDocumentSession,
): ComposerDocumentSession {
  provide(COMPOSER_DOCUMENT_KEY, session)
  return session
}

export function tryUseComposerDocument(): ComposerDocumentSession | null {
  return inject(COMPOSER_DOCUMENT_KEY, null)
}

export type { PropValue, InsertTarget, ComposerInsertComponent }
