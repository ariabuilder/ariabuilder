import { ref } from "vue"
import {
  getLocale as paraglideGetLocale,
  overwriteGetLocale,
  setLocale as paraglideSetLocale,
  type Locale,
} from "@/paraglide/runtime.js"

/** Reactive locale — message functions read this via overwriteGetLocale. */
const localeRef = ref<Locale>(
  typeof window === "undefined" ? "en" : paraglideGetLocale(),
)

let installed = false

/** Call once before mounting the app. */
export function installReactiveLocale(): void {
  if (installed) return
  installed = true
  localeRef.value = paraglideGetLocale()
  overwriteGetLocale(() => localeRef.value)
}

export function getReactiveLocale(): Locale {
  return localeRef.value
}

/**
 * Persist locale (localStorage) and update the reactive ref so Vue re-renders
 * paraglide message calls without a full page reload.
 */
export function setReactiveLocale(next: Locale): void {
  if (localeRef.value === next) {
    paraglideSetLocale(next, { reload: false })
    return
  }
  localeRef.value = next
  paraglideSetLocale(next, { reload: false })
  if (typeof document !== "undefined") {
    document.documentElement.lang = next
  }
}
