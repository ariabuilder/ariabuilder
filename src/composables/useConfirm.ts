import { ref, shallowRef } from "vue"

export type ConfirmOptions = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Styles the confirm action as destructive (default true for menu destructive items). */
  destructive?: boolean
}

type ConfirmRequest = ConfirmOptions & {
  resolve: (value: boolean) => void
}

const request = shallowRef<ConfirmRequest | null>(null)
const open = ref(false)

/**
 * Promise-based confirmation — drop-in replacement for `window.confirm`.
 * Requires `<ConfirmDialogHost />` mounted once at the app root.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // Resolve any prior pending confirm as cancelled (only one host dialog).
    if (request.value) {
      request.value.resolve(false)
    }
    request.value = { ...options, resolve }
    open.value = true
  })
}

export function useConfirmState() {
  function settle(value: boolean) {
    const current = request.value
    if (!current) return
    // Clear before closing so a subsequent update:open(false) is not treated
    // as cancel after the user already confirmed/cancelled via a button.
    request.value = null
    open.value = false
    current.resolve(value)
  }

  function onOpenChange(next: boolean) {
    if (next) {
      open.value = true
      return
    }
    // Dismiss (Escape / overlay) cancels only while a request is still pending.
    if (request.value) {
      settle(false)
      return
    }
    open.value = false
  }

  return {
    open,
    request,
    settle,
    onOpenChange,
  }
}
