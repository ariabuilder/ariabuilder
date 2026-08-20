export function normalizeIconValue(value: string | null | undefined): string {
  return value?.trim().replace(/^i-/, "") ?? ""
}

export function iconPackFromValue(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeIconValue(value)
  const separator = normalized.indexOf(":")
  return separator > 0 ? normalized.slice(0, separator).toLowerCase() : null
}

export function resolveIconPickerPack(
  enabledInstalledPacks: readonly string[],
  value?: string | null,
): string {
  const packs = enabledInstalledPacks.map((pack) => pack.trim().toLowerCase())
  const inferred = iconPackFromValue(value)
  if (inferred && packs.includes(inferred)) return inferred
  return packs[0] ?? ""
}

export function toStoredIconValue(id: string): string {
  const normalized = normalizeIconValue(id)
  return normalized ? `i-${normalized}` : ""
}
