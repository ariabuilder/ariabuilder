import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue"
import {
  checkoutGitBranch,
  commitGit,
  createGitBranch,
  diffGitFile,
  getGitStatus,
  initGitRepo,
  listGitBranches,
  pushGit,
  type GitFileChange,
  type GitStatus,
} from "@/lib/git"
import { onProjectChange } from "@/lib/sessions"

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "")
}

export function useGitWorkspace(projectPath: MaybeRefOrGetter<string>) {
  const status = ref<GitStatus | null>(null)
  const branches = ref<string[]>([])
  const loading = ref(true)
  const message = ref("")
  const committing = ref(false)
  const pushing = ref(false)
  const switching = ref(false)
  const creating = ref(false)
  const initializing = ref(false)
  const actionError = ref<string | null>(null)
  const newBranchName = ref("")

  const diffPath = ref<string | null>(null)
  const diffText = ref("")
  const diffBinary = ref(false)
  const diffTruncated = ref(false)
  const diffLoading = ref(false)
  const diffError = ref<string | null>(null)
  const changesOpen = ref(false)

  const busy = computed(
    () =>
      committing.value ||
      pushing.value ||
      switching.value ||
      creating.value ||
      initializing.value,
  )

  const dirtyFiles = computed((): GitFileChange[] => {
    if (!status.value) return []
    const seen = new Set<string>()
    const files = [
      ...status.value.staged,
      ...status.value.unstaged,
      ...status.value.untracked,
    ]
    return files.filter((f) => {
      if (seen.has(f.path)) return false
      seen.add(f.path)
      return true
    })
  })

  const canPush = computed(() => {
    if (!status.value?.isRepo || !status.value.upstream) return false
    if (busy.value || loading.value) return false
    return status.value.ahead > 0
  })

  /** 1 overview · 2 change list · 3 file diff */
  const page = computed(() => {
    if (diffPath.value) return "3"
    if (changesOpen.value) return "2"
    return "1"
  })

  async function loadBranches(root: string) {
    try {
      branches.value = await listGitBranches(root)
    } catch {
      branches.value = []
    }
  }

  async function refreshDiffIfNeeded() {
    const path = diffPath.value
    if (!path) return
    const stillDirty = dirtyFiles.value.some((f) => f.path === path)
    if (!stillDirty) {
      closeDiff()
      return
    }
    await openDiff(path, { silent: true })
  }

  async function refresh() {
    const root = toValue(projectPath)
    loading.value = true
    actionError.value = null
    try {
      status.value = await getGitStatus(root)
      if (status.value.error) actionError.value = status.value.error
      if (status.value.isRepo) {
        await loadBranches(root)
      } else {
        branches.value = []
      }
      await refreshDiffIfNeeded()
    } catch (error) {
      status.value = null
      branches.value = []
      actionError.value =
        error instanceof Error ? error.message : String(error)
    } finally {
      loading.value = false
    }
  }

  async function onCommit() {
    if (!status.value?.dirty || !message.value.trim() || busy.value) return
    const root = toValue(projectPath)
    committing.value = true
    actionError.value = null
    try {
      status.value = await commitGit(root, message.value)
      message.value = ""
      if (status.value.error) actionError.value = status.value.error
      await loadBranches(root)
      await refreshDiffIfNeeded()
    } catch (error) {
      actionError.value =
        error instanceof Error ? error.message : String(error)
    } finally {
      committing.value = false
    }
  }

  async function onPush() {
    if (!canPush.value) return
    const root = toValue(projectPath)
    pushing.value = true
    actionError.value = null
    try {
      status.value = await pushGit(root)
      if (status.value.error) actionError.value = status.value.error
    } catch (error) {
      actionError.value =
        error instanceof Error ? error.message : String(error)
    } finally {
      pushing.value = false
    }
  }

  async function onInit() {
    if (busy.value) return
    const root = toValue(projectPath)
    initializing.value = true
    actionError.value = null
    try {
      status.value = await initGitRepo(root)
      if (status.value.error) actionError.value = status.value.error
      await loadBranches(root)
    } catch (error) {
      actionError.value =
        error instanceof Error ? error.message : String(error)
    } finally {
      initializing.value = false
    }
  }

  async function onCheckout(branch: string) {
    const name = branch.trim()
    if (!name || busy.value) return
    if (status.value?.branch === name) return
    const root = toValue(projectPath)
    switching.value = true
    actionError.value = null
    try {
      status.value = await checkoutGitBranch(root, name)
      if (status.value.error) actionError.value = status.value.error
      await loadBranches(root)
      closeChanges()
    } catch (error) {
      actionError.value =
        error instanceof Error ? error.message : String(error)
    } finally {
      switching.value = false
    }
  }

  async function onCreateBranch() {
    const name = newBranchName.value.trim()
    if (!name || busy.value) return
    const root = toValue(projectPath)
    creating.value = true
    actionError.value = null
    try {
      status.value = await createGitBranch(root, name)
      newBranchName.value = ""
      if (status.value.error) actionError.value = status.value.error
      await loadBranches(root)
      closeChanges()
    } catch (error) {
      actionError.value =
        error instanceof Error ? error.message : String(error)
    } finally {
      creating.value = false
    }
  }

  function openChanges() {
    changesOpen.value = true
  }

  function closeChanges() {
    closeDiff()
    changesOpen.value = false
  }

  async function openDiff(
    filePath: string,
    opts?: { silent?: boolean },
  ) {
    const root = toValue(projectPath)
    changesOpen.value = true
    diffPath.value = filePath
    diffError.value = null
    if (!opts?.silent) {
      diffText.value = ""
      diffBinary.value = false
      diffTruncated.value = false
    }
    diffLoading.value = true
    try {
      const result = await diffGitFile(root, filePath)
      if (diffPath.value !== filePath) return
      diffText.value = result.text
      diffBinary.value = result.binary
      diffTruncated.value = result.truncated
    } catch (error) {
      if (diffPath.value !== filePath) return
      diffError.value =
        error instanceof Error ? error.message : String(error)
      diffText.value = ""
      diffBinary.value = false
      diffTruncated.value = false
    } finally {
      if (diffPath.value === filePath) diffLoading.value = false
    }
  }

  function closeDiff() {
    diffPath.value = null
    diffText.value = ""
    diffBinary.value = false
    diffTruncated.value = false
    diffLoading.value = false
    diffError.value = null
  }

  function resetDiffOnClose() {
    closeChanges()
  }

  let stopWatch: (() => void) | undefined
  let refreshTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void refresh()
    }, 300)
  }

  onMounted(() => {
    void refresh()
    stopWatch = onProjectChange((changedPath) => {
      const a = normalizePath(changedPath)
      const b = normalizePath(toValue(projectPath))
      if (a === b) scheduleRefresh()
    })
  })

  watch(
    () => toValue(projectPath),
    () => {
      closeChanges()
      void refresh()
    },
  )

  onUnmounted(() => {
    stopWatch?.()
    if (refreshTimer) clearTimeout(refreshTimer)
  })

  return {
    status,
    branches,
    loading,
    message,
    committing,
    pushing,
    switching,
    creating,
    initializing,
    busy,
    actionError,
    newBranchName,
    dirtyFiles,
    canPush,
    page,
    changesOpen,
    diffPath,
    diffText,
    diffBinary,
    diffTruncated,
    diffLoading,
    diffError,
    refresh,
    onCommit,
    onPush,
    onInit,
    onCheckout,
    onCreateBranch,
    openChanges,
    closeChanges,
    openDiff,
    closeDiff,
    resetDiffOnClose,
  }
}
