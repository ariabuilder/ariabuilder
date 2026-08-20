import { getLocale } from "@/paraglide/runtime.js"

type Unit = "year" | "month" | "week" | "day" | "hour" | "minute" | "second"

const DIVISIONS: { unit: Unit; seconds: number }[] = [
  { unit: "year", seconds: 60 * 60 * 24 * 365 },
  { unit: "month", seconds: 60 * 60 * 24 * 30 },
  { unit: "week", seconds: 60 * 60 * 24 * 7 },
  { unit: "day", seconds: 60 * 60 * 24 },
  { unit: "hour", seconds: 60 * 60 },
  { unit: "minute", seconds: 60 },
  { unit: "second", seconds: 1 },
]

/** Compact relative time for timestamps (e.g. "18 minutes ago"). */
export function formatRelativeTime(
  timestampMs: number,
  nowMs: number = Date.now(),
): string {
  if (!Number.isFinite(timestampMs)) return ""

  const deltaSeconds = Math.round((timestampMs - nowMs) / 1000)
  const abs = Math.abs(deltaSeconds)
  const locale = getLocale()

  try {
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
    for (const { unit, seconds } of DIVISIONS) {
      if (abs >= seconds || unit === "second") {
        return formatter.format(Math.round(deltaSeconds / seconds), unit)
      }
    }
  } catch {
    // fall through
  }

  return ""
}
