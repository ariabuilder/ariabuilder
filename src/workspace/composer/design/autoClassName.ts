const AUTO_CLASS_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
const AUTO_CLASS_KEY_LENGTH = 5
const UNBIASED_BYTE_LIMIT = 252

type FillRandomValues = (values: Uint8Array) => Uint8Array

function randomKey(fillRandomValues: FillRandomValues): string {
  let key = ""
  while (key.length < AUTO_CLASS_KEY_LENGTH) {
    const bytes = fillRandomValues(new Uint8Array(AUTO_CLASS_KEY_LENGTH - key.length))
    for (const byte of bytes) {
      // Rejection sampling avoids bias because 252 divides evenly by 36.
      if (byte >= UNBIASED_BYTE_LIMIT) continue
      key += AUTO_CLASS_ALPHABET[byte % AUTO_CLASS_ALPHABET.length]
      if (key.length === AUTO_CLASS_KEY_LENGTH) break
    }
  }
  return key
}

/** Create an opaque five-character class name for the first Inspector style edit. */
export function createAutomaticAriaClassName(
  existing: ReadonlySet<string>,
  fillRandomValues: FillRandomValues = (values) => crypto.getRandomValues(values),
): string {
  while (true) {
    const candidate = `aria-${randomKey(fillRandomValues)}`
    if (!existing.has(candidate)) return candidate
  }
}
