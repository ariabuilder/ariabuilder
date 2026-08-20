import { localeCodesEqual } from "../../../../../shared/cms"

export function matchEntryLocale<T extends { locale: string }>(
  locales: readonly T[],
  localeCode?: string | null,
): T | undefined {
  const requested = localeCode?.trim()
  if (!requested) return undefined
  return locales.find((item) => localeCodesEqual(item.locale, requested))
}

export function findEntryLocale<T extends { locale: string; isSource?: boolean }>(
  locales: readonly T[],
  localeCode?: string | null,
): T | undefined {
  return matchEntryLocale(locales, localeCode)
    ?? locales.find((item) => item.isSource)
    ?? locales[0]
}

export function entryHasLocale(
  locales: readonly { locale: string }[],
  localeCode: string,
  activeLocale?: string | null,
): boolean {
  const code = localeCode.trim()
  if (!code) return false
  if (activeLocale && localeCodesEqual(code, activeLocale)) return true
  return matchEntryLocale(locales, code) != null
}
