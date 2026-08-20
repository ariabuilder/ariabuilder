import { computed, onUnmounted, ref, type Ref } from "vue"
import type { AstroCollectionBinding, ParseAstroResult } from "../../../shared/composer"
import type { ComposerStylesheetEdit } from "../../../shared/composer"
import {
  analyzeComposerSource,
  commitComposerEditTransaction,
} from "@/lib/composer"

type RecoveryRecord = {
  baseSource: string
  source: string
  baseMtimeMs: number | null
  updatedAt: number
  stylesheets?: Array<ComposerStylesheetEdit & { beforeContent: string }>
}

export type ComposerCodeAnalysisStatus =
  | "idle"
  | "checking"
  | "valid"
  | "invalid"
  | "unsupported"

/** Normalize line endings so CRLF/LF-only diffs do not look like edits. */
export function normalizeComposerSource(source: string): string {
  return source.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

export function composerSourcesEquivalent(a: string, b: string): boolean {
  return normalizeComposerSource(a) === normalizeComposerSource(b)
}

export function useComposerCodeSession(options: {
  projectPath: Ref<string>
  editFile: Ref<string | null>
  editedMtimeMs: Ref<number | null>
  collectionProps?: Ref<Record<string, AstroCollectionBinding> | undefined>
  onProjection: (result: ParseAstroResult) => void
  preview?: {
    setSource: (source: string) => void | Promise<void>
    clear: () => void | Promise<void>
    revision: Ref<number>
  }
}) {
  const preview = options.preview ?? {
    setSource: (_source: string) => undefined,
    clear: () => undefined,
    revision: ref(0),
  }
  const appliedSource = ref("")
  const workingSource = ref("")
  const analysis = ref<ParseAstroResult | null>(null)
  const analysisStatus = ref<ComposerCodeAnalysisStatus>("idle")
  const statusMessage = ref<string | null>(null)
  const recoveryConflict = ref(false)
  const applying = ref(false)
  const stagedStylesheets = ref<Record<
    string,
    ComposerStylesheetEdit & { beforeContent: string }
  >>({})
  let analysisTimer: ReturnType<typeof setTimeout> | null = null
  let analysisGeneration = 0

  const dirty = computed(
    () =>
      !composerSourcesEquivalent(workingSource.value, appliedSource.value) ||
      Object.keys(stagedStylesheets.value).length > 0,
  )
  const compilerValid = computed(() => analysis.value?.compilerValid === true)
  const canApply = computed(
    () => dirty.value && compilerValid.value && !recoveryConflict.value && !applying.value,
  )
  const hasStagedStylesheets = computed(
    () => Object.keys(stagedStylesheets.value).length > 0,
  )

  function recoveryKey(file = options.editFile.value): string | null {
    if (!file) return null
    return `aria.composer.code-draft:${options.projectPath.value}:${file}`
  }

  function readRecovery(file: string): RecoveryRecord | null {
    try {
      const value = JSON.parse(localStorage.getItem(recoveryKey(file)!) ?? "null") as unknown
      if (!value || typeof value !== "object") return null
      const record = value as Partial<RecoveryRecord>
      if (
        typeof record.baseSource !== "string" ||
        typeof record.source !== "string" ||
        typeof record.updatedAt !== "number"
      ) return null
      return {
        baseSource: record.baseSource,
        source: record.source,
        baseMtimeMs: typeof record.baseMtimeMs === "number" ? record.baseMtimeMs : null,
        updatedAt: record.updatedAt,
        stylesheets: Array.isArray(record.stylesheets)
          ? record.stylesheets.filter((item): item is ComposerStylesheetEdit & { beforeContent: string } =>
              Boolean(item) &&
              typeof item.relativeFile === "string" &&
              typeof item.content === "string" &&
              typeof item.beforeContent === "string",
            )
          : [],
      }
    } catch {
      return null
    }
  }

  function persistRecovery(): void {
    const key = recoveryKey()
    if (!key) return
    try {
      if (!dirty.value) {
        localStorage.removeItem(key)
        return
      }
      const record: RecoveryRecord = {
        baseSource: appliedSource.value,
        source: workingSource.value,
        baseMtimeMs: options.editedMtimeMs.value,
        updatedAt: Date.now(),
        stylesheets: Object.values(stagedStylesheets.value),
      }
      localStorage.setItem(key, JSON.stringify(record))
    } catch {
      // Recovery is best-effort; editing remains available when storage is full.
    }
  }

  function clearRecovery(): void {
    const key = recoveryKey()
    if (!key) return
    try {
      localStorage.removeItem(key)
    } catch {
      /* best effort */
    }
  }

  function describe(result: ParseAstroResult): void {
    if (result.editable) {
      analysisStatus.value = "valid"
      statusMessage.value = "Astro source is valid and synchronized."
      return
    }
    if (result.compilerValid) {
      analysisStatus.value = "unsupported"
      statusMessage.value = result.reason || "Valid Astro; visual projection is unavailable."
      return
    }
    analysisStatus.value = "invalid"
    statusMessage.value = result.reason || "Fix compiler errors before applying."
  }

  async function analyzeNow(
    source = workingSource.value,
    opts?: { persistDraft?: boolean; keepStatus?: boolean },
  ): Promise<ParseAstroResult | null> {
    const file = options.editFile.value
    if (!file) return null
    const generation = ++analysisGeneration
    // Visual inspector edits serialize a model that is already valid. Flipping
    // to "checking" here would disable the document (ComposerSurface isEditable)
    // and blur the focused property field after every keystroke.
    if (!opts?.keepStatus) {
      analysisStatus.value = "checking"
      statusMessage.value = "Checking Astro source…"
    }
    try {
      const result = await analyzeComposerSource(
        options.projectPath.value,
        file,
        source,
        options.collectionProps?.value,
      )
      if (generation !== analysisGeneration || source !== workingSource.value) return null
      analysis.value = result
      describe(result)
      if (result.compilerValid) {
        const persistDraft = opts?.persistDraft !== false
        if (
          persistDraft &&
          !composerSourcesEquivalent(source, appliedSource.value)
        ) {
          try {
            await preview.setSource(source)
          } catch (error) {
            statusMessage.value = error instanceof Error ? error.message : String(error)
          }
        }
        options.onProjection(result)
      }
      return result
    } catch (error) {
      if (generation !== analysisGeneration) return null
      analysisStatus.value = "invalid"
      statusMessage.value = error instanceof Error ? error.message : String(error)
      return null
    }
  }

  function scheduleAnalysis(opts?: { keepStatus?: boolean }): void {
    if (analysisTimer) clearTimeout(analysisTimer)
    const keepStatus = opts?.keepStatus === true
    analysisTimer = setTimeout(() => {
      analysisTimer = null
      void analyzeNow(workingSource.value, { keepStatus })
    }, 220)
  }

  async function loadDocument(result: ParseAstroResult, mtimeMs: number | null): Promise<void> {
    if (analysisTimer) {
      clearTimeout(analysisTimer)
      analysisTimer = null
    }
    analysisGeneration += 1
    void Promise.resolve(preview.clear()).catch(() => undefined)
    appliedSource.value = result.source
    workingSource.value = result.source
    stagedStylesheets.value = {}
    analysis.value = result
    recoveryConflict.value = false
    describe(result)

    const file = options.editFile.value
    const recovery = file ? readRecovery(file) : null
    if (!recovery) return
    const recoverySheets = recovery.stylesheets?.length
      ? recovery.stylesheets
      : []
    // Equivalent drafts (including CRLF/LF-only) are not real edits — drop them.
    if (
      composerSourcesEquivalent(recovery.source, result.source) &&
      recoverySheets.length === 0
    ) {
      clearRecovery()
      return
    }
    workingSource.value = recovery.source
    stagedStylesheets.value = Object.fromEntries(
      recoverySheets.map((item) => [item.relativeFile, item]),
    )
    recoveryConflict.value = !composerSourcesEquivalent(
      recovery.baseSource,
      result.source,
    )
    if (recoveryConflict.value) {
      statusMessage.value =
        "Recovered draft restored, but the file changed on disk. Discard it or merge the changes before Apply."
    }
    await analyzeNow(recovery.source)
    if (recoveryConflict.value) {
      statusMessage.value =
        "Recovered draft restored, but the file changed on disk. Discard it or merge the changes before Apply."
    }
    void mtimeMs
  }

  function updateSource(source: string): void {
    if (source === workingSource.value) return
    // CodeMirror normalizes to LF; align in-memory baseline when only endings differ.
    if (
      composerSourcesEquivalent(source, appliedSource.value) &&
      Object.keys(stagedStylesheets.value).length === 0
    ) {
      workingSource.value = source
      appliedSource.value = source
      clearRecovery()
      return
    }
    workingSource.value = source
    analysisStatus.value = "checking"
    statusMessage.value = "Checking Astro source…"
    persistRecovery()
    scheduleAnalysis()
  }

  function updateSourceFromVisualMutation(source: string): void {
    if (
      composerSourcesEquivalent(source, appliedSource.value) &&
      Object.keys(stagedStylesheets.value).length === 0
    ) {
      workingSource.value = source
      appliedSource.value = source
      clearRecovery()
      return
    }
    workingSource.value = source
    persistRecovery()
    scheduleAnalysis({ keepStatus: true })
  }

  function stageStylesheetEdit(
    edit: ComposerStylesheetEdit & { beforeContent: string },
  ): void {
    const current = stagedStylesheets.value[edit.relativeFile]
    stagedStylesheets.value = {
      ...stagedStylesheets.value,
      [edit.relativeFile]: {
        ...edit,
        beforeContent: current?.beforeContent ?? edit.beforeContent,
        expectedMtimeMs: current?.expectedMtimeMs ?? edit.expectedMtimeMs,
      },
    }
    persistRecovery()
  }

  async function apply(): Promise<boolean> {
    const file = options.editFile.value
    if (!file || !canApply.value) return false
    if (analysisTimer) {
      clearTimeout(analysisTimer)
      analysisTimer = null
    }
    const currentAnalysis = await analyzeNow(workingSource.value, {
      persistDraft: false,
    })
    if (!currentAnalysis?.compilerValid || recoveryConflict.value) return false
    applying.value = true
    statusMessage.value = "Applying Astro source…"
    try {
      const result = await commitComposerEditTransaction({
        projectPath: options.projectPath.value,
        previewRevision: preview.revision.value,
        sources: [{
          relativeFile: file,
          source: workingSource.value,
          expectedSource: appliedSource.value,
          expectedMtimeMs: options.editedMtimeMs.value,
        }],
        stylesheets: Object.values(stagedStylesheets.value).map((edit) => ({
          relativeFile: edit.relativeFile,
          content: edit.content,
          expectedMtimeMs: edit.expectedMtimeMs,
        })),
      })
      if (!result.ok) {
        recoveryConflict.value = true
        statusMessage.value = result.message
        return false
      }
      const revision = result.revisions.find((item) => item.relativeFile === file)
      if (revision) options.editedMtimeMs.value = revision.mtimeMs
      appliedSource.value = workingSource.value
      stagedStylesheets.value = {}
      recoveryConflict.value = false
      clearRecovery()
      await Promise.resolve(preview.clear()).catch(() => undefined)
      analysisStatus.value = currentAnalysis.editable ? "valid" : "unsupported"
      statusMessage.value = currentAnalysis.editable
        ? "Astro source applied."
        : "Astro source applied; visual projection is unavailable."
      options.onProjection(currentAnalysis)
      return true
    } catch (error) {
      statusMessage.value = error instanceof Error ? error.message : String(error)
      return false
    } finally {
      applying.value = false
    }
  }

  async function discard(): Promise<void> {
    if (analysisTimer) {
      clearTimeout(analysisTimer)
      analysisTimer = null
    }
    workingSource.value = appliedSource.value
    stagedStylesheets.value = {}
    recoveryConflict.value = false
    clearRecovery()
    await Promise.resolve(preview.clear()).catch(() => undefined)
    const result = await analyzeNow(appliedSource.value)
    // Dropping a draft must remount even when analysis is a no-op vs applied source.
    if (result) options.onProjection(result)
    statusMessage.value = "Code draft discarded."
  }

  function markRecoveryMerged(): void {
    if (!recoveryConflict.value) return
    recoveryConflict.value = false
    persistRecovery()
    statusMessage.value = "Recovered draft marked as merged. Review it, then apply the code."
  }

  onUnmounted(() => {
    if (analysisTimer) clearTimeout(analysisTimer)
    void Promise.resolve(preview.clear()).catch(() => undefined)
  })

  return {
    appliedSource,
    workingSource,
    analysis,
    analysisStatus,
    statusMessage,
    recoveryConflict,
    applying,
    dirty,
    compilerValid,
    canApply,
    hasStagedStylesheets,
    loadDocument,
    updateSource,
    updateSourceFromVisualMutation,
    stageStylesheetEdit,
    analyzeNow,
    apply,
    discard,
    markRecoveryMerged,
  }
}
