const ASTRO_TEXT_ENTITY_RE = /&(amp|lt|gt|quot|apos|#(?:x[0-9a-f]+|\d+));/gi;

/** Decode the entities Composer emits so the model stores visible text. */
export function decodeAstroText(value: string): string {
  return value.replace(ASTRO_TEXT_ENTITY_RE, (entity, name: string) => {
    const normalized = name.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    const numeric = normalized.startsWith("#x")
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    try {
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
    } catch {
      return entity;
    }
  });
}

/** Keep contenteditable text literal when it is written into Astro markup. */
export function encodeAstroText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}
