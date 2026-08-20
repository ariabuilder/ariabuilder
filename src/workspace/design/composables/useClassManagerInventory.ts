import { computed, ref, type Ref } from "vue"
import {
  listStylesheets,
  readStylesheet,
  scanClassUsage,
  writeStylesheet,
} from "@/lib/design"
import type { StylesheetInfo } from "../../../../shared/design"
import {
  appendClassRule,
  buildClassRuleCss,
  createSequentialDuplicateName,
  extractClassRulesByName,
  isValidClassName,
  parseClassImportPayload,
  removeClassRules,
  renameClassRule,
  replaceClassRule,
  sanitizeClassName,
  type ClassImportItem,
} from "../lib/classManagerCss"
import {
  buildClassManagerRows,
  type ClassManagerRow,
} from "../lib/classManagerTable"

const STORAGE_PREFIX = "aria.design.classManager.stylesheet:"

export function useClassManagerInventory(projectRoot: Ref<string>) {
  const sheets = ref<StylesheetInfo[]>([])
  const selectedPath = ref("")
  const content = ref("")
  const diskContent = ref("")
  const mtimeMs = ref<number | null>(null)
  const usageCounts = ref<Record<string, number>>({})
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)

  const dirty = computed(() => content.value !== diskContent.value)

  const classEntries = computed(() => {
    const map = extractClassRulesByName(content.value)
    return [...map.values()]
      .map((rule) => ({ name: rule.name, css: rule.css }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const hasStylesheetContent = computed(() => content.value.trim().length > 0)

  const rows = computed<ClassManagerRow[]>(() =>
    buildClassManagerRows(classEntries.value, usageCounts.value),
  )

  function storageKey(root: string) {
    return `${STORAGE_PREFIX}${root}`
  }

  function rememberSelection(path: string) {
    try {
      localStorage.setItem(storageKey(projectRoot.value), path)
    } catch {
      /* ignore */
    }
  }

  function recallSelection(): string | null {
    try {
      return localStorage.getItem(storageKey(projectRoot.value))
    } catch {
      return null
    }
  }

  async function refreshUsage(names: string[]) {
    if (!projectRoot.value || names.length === 0) {
      usageCounts.value = {}
      return
    }
    try {
      usageCounts.value = await scanClassUsage(projectRoot.value, names)
    } catch {
      usageCounts.value = Object.fromEntries(names.map((n) => [n, 0]))
    }
  }

  async function refreshList() {
    sheets.value = await listStylesheets(projectRoot.value)
  }

  async function loadFile(relativePath: string) {
    if (!relativePath) {
      content.value = ""
      diskContent.value = ""
      mtimeMs.value = null
      selectedPath.value = ""
      usageCounts.value = {}
      return
    }
    loading.value = true
    error.value = null
    try {
      const result = await readStylesheet(projectRoot.value, relativePath)
      content.value = result.content
      diskContent.value = result.content
      mtimeMs.value = result.mtimeMs
      selectedPath.value = result.relativePath
      rememberSelection(result.relativePath)
      const names = [...extractClassRulesByName(result.content).keys()]
      await refreshUsage(names)
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Failed to load stylesheet"
    } finally {
      loading.value = false
    }
  }

  async function bootstrap() {
    loading.value = true
    error.value = null
    try {
      await refreshList()
      const remembered = recallSelection()
      const preferred =
        (remembered &&
          sheets.value.find((s) => s.relativePath === remembered)
            ?.relativePath) ||
        sheets.value.find((s) => s.isEntry)?.relativePath ||
        sheets.value[0]?.relativePath ||
        ""
      if (preferred) {
        await loadFile(preferred)
      } else {
        selectedPath.value = ""
        content.value = ""
        diskContent.value = ""
        usageCounts.value = {}
      }
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : "Failed to list stylesheets"
    } finally {
      loading.value = false
    }
  }

  async function save(): Promise<boolean> {
    if (!selectedPath.value) return false
    saving.value = true
    error.value = null
    try {
      const result = await writeStylesheet(
        projectRoot.value,
        selectedPath.value,
        content.value,
        mtimeMs.value,
      )
      diskContent.value = content.value
      mtimeMs.value = result.mtimeMs
      await refreshList()
      await refreshUsage([...extractClassRulesByName(content.value).keys()])
      return true
    } catch (err) {
      const maybe = err as { message?: string }
      error.value =
        maybe?.message ||
        (err instanceof Error ? err.message : "Failed to save stylesheet")
      return false
    } finally {
      saving.value = false
    }
  }

  async function refreshInventory() {
    if (!selectedPath.value) {
      await bootstrap()
      return
    }
    await loadFile(selectedPath.value)
  }

  function adoptSavedContent(nextContent: string, nextMtimeMs: number) {
    // Keep newer local input made while the disk transaction was in flight.
    if (content.value === diskContent.value) content.value = nextContent
    diskContent.value = nextContent
    mtimeMs.value = nextMtimeMs
    error.value = null
  }

  function createClass(nameRaw: string, cssText?: string): string | null {
    const name = sanitizeClassName(nameRaw)
    if (!name || !isValidClassName(name)) return null
    if (extractClassRulesByName(content.value).has(name)) return null
    content.value = appendClassRule(
      content.value,
      name,
      cssText?.trim() ? cssText : "  \n",
    )
    return name
  }

  function renameClass(oldName: string, newNameRaw: string): boolean {
    const newName = sanitizeClassName(newNameRaw)
    if (!newName || !isValidClassName(newName)) return false
    const map = extractClassRulesByName(content.value)
    if (!map.has(oldName)) return false
    if (newName !== oldName && map.has(newName)) return false
    if (newName === oldName) return true
    content.value = renameClassRule(content.value, oldName, newName)
    return true
  }

  function duplicateClass(sourceName: string, newNameRaw?: string): string | null {
    const map = extractClassRulesByName(content.value)
    const source = map.get(sourceName)
    if (!source) return null
    const existing = new Set(map.keys())
    const name = newNameRaw
      ? sanitizeClassName(newNameRaw)
      : createSequentialDuplicateName(sourceName, existing)
    if (!name || !isValidClassName(name) || existing.has(name)) return null
    content.value = appendClassRule(content.value, name, source.css)
    return name
  }

  function deleteClasses(names: readonly string[]): void {
    content.value = removeClassRules(content.value, names)
  }

  function updateClassCss(name: string, nextCss: string): boolean {
    if (!extractClassRulesByName(content.value).has(name)) return false
    content.value = replaceClassRule(content.value, name, nextCss)
    return true
  }

  function clearAllClasses(): void {
    const names = [...extractClassRulesByName(content.value).keys()]
    content.value = removeClassRules(content.value, names)
  }

  function importClasses(
    items: readonly ClassImportItem[],
    mode: "merge" | "replace",
  ): number {
    let next = mode === "replace" ? removeClassRules(
      content.value,
      [...extractClassRulesByName(content.value).keys()],
    ) : content.value

    let imported = 0
    for (const item of items) {
      const name = sanitizeClassName(item.name)
      if (!name || !isValidClassName(name)) continue
      const ruleCss = buildClassRuleCss(name, item.css)
      if (extractClassRulesByName(next).has(name)) {
        next = replaceClassRule(next, name, ruleCss)
      } else {
        next = appendClassRule(next, name, ruleCss)
      }
      imported += 1
    }
    content.value = next
    return imported
  }

  function exportClassesJson(): string {
    const classes = classEntries.value.map(({ name, css }) => ({ name, css }))
    return JSON.stringify({ classes }, null, 2)
  }

  function exportClassesCss(): string {
    return classEntries.value.map((c) => c.css).join("\n\n") + "\n"
  }

  return {
    sheets,
    selectedPath,
    content,
    diskContent,
    mtimeMs,
    rows,
    classEntries,
    hasStylesheetContent,
    dirty,
    loading,
    saving,
    error,
    bootstrap,
    loadFile,
    refreshList,
    refreshInventory,
    adoptSavedContent,
    save,
    createClass,
    renameClass,
    duplicateClass,
    deleteClasses,
    updateClassCss,
    clearAllClasses,
    importClasses,
    exportClassesJson,
    exportClassesCss,
    parseClassImportPayload,
  }
}
