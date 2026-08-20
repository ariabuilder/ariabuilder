/** Common public-content locales offered when adding a site language. */
export const SUGGESTED_CONTENT_LOCALE_CODES = [
  "ar",
  "bg",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "en-AU",
  "en-CA",
  "en-GB",
  "es",
  "es-MX",
  "et",
  "fa",
  "fi",
  "fr",
  "fr-CA",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "lt",
  "lv",
  "ms",
  "nb",
  "nl",
  "pl",
  "pt",
  "pt-BR",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh-Hans",
  "zh-Hant",
] as const

export type SuggestedContentLocaleCode =
  (typeof SUGGESTED_CONTENT_LOCALE_CODES)[number]

export function contentLocaleDisplayName(
  code: string,
  uiLocale: string,
): string {
  try {
    const name = new Intl.DisplayNames([uiLocale], { type: "language" }).of(
      code,
    )
    if (name?.trim()) return name
  } catch {
    // Intl.DisplayNames rejects some tags; fall through to the code.
  }
  return code
}
