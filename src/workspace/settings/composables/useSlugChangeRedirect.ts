import { ref } from "vue"
import { createRedirect } from "@/lib/workspace"
import { toast } from "vue-sonner"
import { m } from "@/paraglide/messages.js"

/** Bumped after slug-change redirect create so Redirects panel can refresh. */
export const redirectsRevision = ref(0)

export type OfferRedirectAfterSlugChangeInput = {
  fromPath: string
  toPath: string
  pageTitle?: string
  projectRoot: string
}

export type PendingSlugChangeRedirect = {
  open: boolean
  fromPath: string
  toPath: string
  pageTitle?: string
  projectRoot: string
}

const pending = ref<PendingSlugChangeRedirect>({
  open: false,
  fromPath: "",
  toPath: "",
  projectRoot: "",
})

const isCreating = ref(false)

/**
 * Offer a 301 after a page rename.
 * Callers must pass explicit old/new public paths (do not look them up in a
 * live pages map — that was the demo silent no-op bug).
 *
 * TODO(pages-rename): wire from page rename CRUD when it lands:
 *   offerRedirectAfterSlugChange({
 *     projectRoot,
 *     fromPath: oldRoute,
 *     toPath: newRoute,
 *     pageTitle,
 *   })
 */
export function offerRedirectAfterSlugChange(
  input: OfferRedirectAfterSlugChangeInput,
): void {
  const fromPath = input.fromPath.trim()
  const toPath = input.toPath.trim()
  const projectRoot = input.projectRoot.trim()
  if (!projectRoot || !fromPath || !toPath || fromPath === toPath) return
  pending.value = {
    open: true,
    fromPath,
    toPath,
    pageTitle: input.pageTitle,
    projectRoot,
  }
}

export function useSlugChangeRedirect() {
  function dismiss() {
    pending.value = { ...pending.value, open: false }
  }

  function bumpRevision() {
    redirectsRevision.value += 1
  }

  async function createSuggestedRedirect(): Promise<void> {
    if (!pending.value.open || isCreating.value) return
    isCreating.value = true
    const from = pending.value.fromPath
    const to = pending.value.toPath
    const projectRoot = pending.value.projectRoot
    const title = pending.value.pageTitle?.trim()
    try {
      const note = title
        ? `Auto-suggested after slug change for "${title}"`
        : "Auto-suggested after slug change"
      await createRedirect(projectRoot, {
        fromPath: from,
        toPath: to,
        statusCode: 301,
        enabled: true,
        note,
      })
      bumpRevision()
      dismiss()
      toast.success(
        m.settings_discovery_redirects_created({
          from,
          to,
        }),
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : m.settings_discovery_redirects_create_failed(),
      )
    } finally {
      isCreating.value = false
    }
  }

  return {
    pending,
    isCreating,
    redirectsRevision,
    offerRedirectAfterSlugChange,
    dismiss,
    bumpRevision,
    createSuggestedRedirect,
  }
}
