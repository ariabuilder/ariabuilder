import { onUnmounted, ref, type Ref } from "vue"
import {
  classifyComposerPreviewDiff,
  serializeAstro,
  type AstroDocumentModel,
  type ComposerDomPatch,
  type ComposerPreviewDiff,
} from "../../../shared/composer"
import {
  clearComposerPreviewDraft,
  setComposerPreviewDraft,
} from "@/lib/composer"
import type {
  AriaPatchResultMessage,
  AriaReloadReason,
  AriaReconcileResultMessage,
} from "../../../shared/composer/protocol"

const DRAFT_IDLE_MS = 120
const PATCH_ACK_TIMEOUT_MS = 500

export function useComposerPreviewCoordinator(options: {
  projectPath: Ref<string>
  editFile: Ref<string | null>
  patchNodes: (payload: {
    revision: number
    patches: ComposerDomPatch[]
    inlineTextOrigin?: import("../../../shared/composer/canvasText").CanvasTextPatchOrigin
  }) => void
  reconcile: (payload: { revision: number; paths: string[]; reloadReason?: AriaReloadReason }) => void
}) {
  const revision = ref(0)
  const optimisticDesynced = ref(false)
  const leaseId = globalThis.crypto.randomUUID()
  let timer: ReturnType<typeof setTimeout> | null = null
  let generation = 0
  const pendingPatches = new Map<number, ReturnType<typeof setTimeout>>()
  const serverReconcileRevisions = new Set<number>()
  let latestMutation: {
    revision: number
    file: string
    source: string
    paths: string[]
    writeDraft: boolean
  } | null = null
  let recoveryRevision = 0
  let authoritativeRevision = 0
  let persistedTarget: { revision: number; callback?: () => void } | null = null

  function reserveRevision(): number {
    revision.value += 1
    return revision.value
  }

  const writeDraft = async (file: string, source: string, targetRevision: number) => {
    const currentGeneration = ++generation
    try {
      await setComposerPreviewDraft(
        options.projectPath.value,
        file,
        source,
        leaseId,
        targetRevision,
      )
    } catch {
      // Persistence and existing conflict controls remain authoritative. A
      // preview draft failure must never convert into an iframe reload loop.
      return
    }
    if (currentGeneration !== generation) return
  }

  const scheduleDraft = (
    file: string,
    source: string,
    targetRevision: number,
    immediate: boolean,
  ) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void writeDraft(file, source, targetRevision)
    }, immediate ? 0 : DRAFT_IDLE_MS)
  }

  const clearPendingPatch = (targetRevision: number) => {
    const pending = pendingPatches.get(targetRevision)
    if (pending) clearTimeout(pending)
    pendingPatches.delete(targetRevision)
  }

  const recoverLatestPatch = (targetRevision: number) => {
    const latest = latestMutation
    if (!latest || targetRevision > latest.revision) return
    optimisticDesynced.value = true
    recoveryRevision = latest.revision
    for (const revisionKey of [...pendingPatches.keys()]) {
      if (revisionKey <= latest.revision) clearPendingPatch(revisionKey)
    }
    if (latest.writeDraft) {
      serverReconcileRevisions.add(latest.revision)
      options.reconcile({ revision: latest.revision, paths: latest.paths })
      scheduleDraft(latest.file, latest.source, latest.revision, true)
    }
  }

  function applyModelMutation(
    before: AstroDocumentModel,
    after: AstroDocumentModel,
    mutationOptions?: {
      writeDraft?: boolean
      revision?: number
      source?: string
      inlineTextOrigin?: import("../../../shared/composer/canvasText").CanvasTextPatchOrigin
    },
  ): ComposerPreviewDiff {
    const file = options.editFile.value
    const diff = classifyComposerPreviewDiff(before, after)
    const nextRevision = mutationOptions?.revision ?? reserveRevision()
    revision.value = Math.max(revision.value, nextRevision)
    const source = mutationOptions?.source ?? serializeAstro(after)
    if (file) {
      latestMutation = {
        revision: nextRevision,
        file,
        source,
        paths: diff.paths.length ? diff.paths : ["$document"],
        writeDraft: mutationOptions?.writeDraft !== false,
      }
    }
    if (diff.kind === "dom-patch") {
      if (diff.patches.length && !optimisticDesynced.value) {
        options.patchNodes({
          revision: nextRevision,
          patches: diff.patches,
          ...(mutationOptions?.inlineTextOrigin
            ? { inlineTextOrigin: mutationOptions.inlineTextOrigin }
            : {}),
        })
        pendingPatches.set(nextRevision, setTimeout(() => {
          recoverLatestPatch(nextRevision)
        }, PATCH_ACK_TIMEOUT_MS))
      } else if (optimisticDesynced.value && file) {
        recoverLatestPatch(nextRevision)
      }
    } else {
      // The authoritative Astro revision includes every earlier optimistic
      // mutation. Do not let an older 500 ms timer desynchronize that newer
      // reconciliation while it waits for the draft-ready handshake.
      for (const revisionKey of [...pendingPatches.keys()]) {
        if (revisionKey <= nextRevision) clearPendingPatch(revisionKey)
      }
      serverReconcileRevisions.add(nextRevision)
      options.reconcile({
        revision: nextRevision,
        paths: diff.paths,
        ...(diff.kind === "hard-reload"
          ? { reloadReason: diff.reason as AriaReloadReason }
          : {}),
      })
    }
    if (file && mutationOptions?.writeDraft !== false) {
      if (diff.kind !== "dom-patch" || optimisticDesynced.value) {
        scheduleDraft(file, source, nextRevision, true)
      } else if (!diff.patches.length) {
        scheduleDraft(file, source, nextRevision, false)
      }
    }
    return diff
  }

  function applySource(source: string, paths: string[] = ["0"]): number {
    const file = options.editFile.value
    const nextRevision = ++revision.value
    options.reconcile({ revision: nextRevision, paths })
    if (file) scheduleDraft(file, source, nextRevision, true)
    return nextRevision
  }

  async function clear(): Promise<void> {
    generation += 1
    if (timer) clearTimeout(timer)
    timer = null
    for (const revisionKey of [...pendingPatches.keys()]) clearPendingPatch(revisionKey)
    serverReconcileRevisions.clear()
    optimisticDesynced.value = false
    recoveryRevision = 0
    latestMutation = null
    persistedTarget = null
    await clearComposerPreviewDraft(options.projectPath.value, leaseId).catch(() => undefined)
  }

  function reset(): void {
    revision.value = 0
    authoritativeRevision = 0
    void clear()
  }

  function onPatchResult(result: AriaPatchResultMessage): void {
    clearPendingPatch(result.revision)
    if (result.status === "rejected") {
      recoverLatestPatch(result.revision)
      return
    }
    const latest = latestMutation
    if (
      latest
      && latest.revision === result.revision
      && latest.writeDraft
      && !optimisticDesynced.value
    ) {
      scheduleDraft(latest.file, latest.source, latest.revision, false)
    }
  }

  function onReconcileResult(result: AriaReconcileResultMessage): void {
    const requiresServerReconcile = [...serverReconcileRevisions].some((revision) => revision <= result.revision)
    const authoritativeResult = result.ok && !(result.status === "patched" && requiresServerReconcile)
    if (authoritativeResult) {
      authoritativeRevision = Math.max(authoritativeRevision, result.revision)
      for (const revision of [...serverReconcileRevisions]) {
        if (revision <= result.revision) serverReconcileRevisions.delete(revision)
      }
      settlePersisted()
    }
    if (authoritativeResult && optimisticDesynced.value && result.revision >= recoveryRevision) {
      optimisticDesynced.value = false
      recoveryRevision = 0
      settlePersisted()
    }
  }

  function settlePersisted(): void {
    const pending = persistedTarget
    if (!pending || authoritativeRevision < pending.revision) return
    if (revision.value !== pending.revision || pendingPatches.size || optimisticDesynced.value) return
    persistedTarget = null
    pending.callback?.()
    void clear()
  }

  function markPersisted(targetRevision: number | null | undefined | (() => void), onAuthoritative?: () => void): void {
    const callback = typeof targetRevision === "function" ? targetRevision : onAuthoritative
    const persistedRevision = typeof targetRevision === "number" ? targetRevision : revision.value
    if (persistedRevision <= 0) {
      callback?.()
      return
    }
    persistedTarget = { revision: persistedRevision, callback }
    settlePersisted()
  }

  onUnmounted(() => {
    void clear()
  })
  return {
    revision,
    reserveRevision,
    leaseId,
    optimisticDesynced,
    applyModelMutation,
    applySource,
    onPatchResult,
    onReconcileResult,
    clear,
    reset,
    markPersisted,
  }
}
