import { createApp } from "vue"
import { getLocale } from "./paraglide/runtime.js"
import App from "./App.vue"
import "./index.css"
import { useAppearance } from "./composables/useAppearance"
import { installReactiveLocale } from "./lib/locale"
import { installShortcutHintReveal } from "./lib/shortcutHints"

installReactiveLocale()
installShortcutHintReveal()
document.documentElement.lang = getLocale()

async function mountApp() {
  // Handshake first — in dev, IPC (including appearance:get) requires it.
  // FOUC is already handled by public/appearance-fouc.js from localStorage.
  try {
    await window.aria?.markReady(__ARIA_RENDERER_TOKEN__)
  } catch (error) {
    console.error("Aria renderer handshake failed:", error)
  }

  // Boot appearance after trust is established, then mount.
  useAppearance()
  createApp(App).mount("#root")
}

void mountApp()
