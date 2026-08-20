type ElectronShortcutHandler = (id: string) => void

const handlers = new Set<ElectronShortcutHandler>()
let stopBridgeListener: (() => void) | undefined

function ensureBridgeListener(): void {
  if (stopBridgeListener || handlers.size === 0) return
  stopBridgeListener = window.aria?.window.onShortcut?.((id) => {
    for (const handler of [...handlers]) handler(id)
  })
}

/**
 * Share one Electron IPC listener between every renderer shortcut consumer.
 * Individual controls still own their local subscription and remove it on
 * unmount, but never add another listener to Electron's EventEmitter.
 */
export function onElectronShortcut(handler: ElectronShortcutHandler): () => void {
  handlers.add(handler)
  ensureBridgeListener()
  return () => {
    handlers.delete(handler)
    if (handlers.size > 0) return
    stopBridgeListener?.()
    stopBridgeListener = undefined
  }
}
