/**
 * BEM contract for Aria display/form primitives.
 *
 * `data-aria-type` is Composer identity. These classes are the styling API.
 * Block classes stay shared (CMS loops). Divergence is a named modifier
 * (`aria-card--products`), never a generated id.
 */

export const ARIA_BEM_BLOCKS = [
  "card",
  "alert",
  "badge",
  "field",
  "avatar",
] as const;

export type AriaBemBlock = (typeof ARIA_BEM_BLOCKS)[number];

export const ARIA_BEM_ELEMENTS: Record<AriaBemBlock, readonly string[]> = {
  card: ["media", "header", "body", "actions"],
  alert: ["icon", "title", "body"],
  badge: [],
  field: ["label", "hint"],
  avatar: ["image", "fallback"],
};

export const ARIA_BEM_PRESET_MODIFIERS: Record<AriaBemBlock, readonly string[]> = {
  card: [],
  alert: ["info", "success", "warning", "danger"],
  badge: ["muted", "primary"],
  field: ["check"],
  avatar: [],
};

const BLOCK_SET = new Set<string>(ARIA_BEM_BLOCKS);
const BEM_TOKEN_RE = /^aria-([a-z]+)(?:__(.+)|--(.+))?$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AriaBemToken =
  | { kind: "block"; block: AriaBemBlock; className: string }
  | { kind: "element"; block: AriaBemBlock; element: string; className: string }
  | { kind: "modifier"; block: AriaBemBlock; modifier: string; preset: boolean; className: string };

export function ariaBemBlockClass(block: AriaBemBlock): string {
  return `aria-${block}`;
}

export function ariaBemElementClass(block: AriaBemBlock, element: string): string {
  return `aria-${block}__${element}`;
}

export function ariaBemModifierClass(block: AriaBemBlock, modifier: string): string {
  return `aria-${block}--${modifier}`;
}

export function isAriaBemSlug(value: string): boolean {
  return SLUG_RE.test(value.trim()) && value.trim().length <= 40;
}

export function parseAriaBemToken(className: string): AriaBemToken | null {
  const match = BEM_TOKEN_RE.exec(className.trim());
  if (!match) return null;
  const block = match[1];
  if (!BLOCK_SET.has(block)) return null;
  const typed = block as AriaBemBlock;
  if (match[2]) {
    if (!ARIA_BEM_ELEMENTS[typed].includes(match[2])) return null;
    return { kind: "element", block: typed, element: match[2], className };
  }
  if (match[3]) {
    return {
      kind: "modifier",
      block: typed,
      modifier: match[3],
      preset: ARIA_BEM_PRESET_MODIFIERS[typed].includes(match[3]),
      className,
    };
  }
  return { kind: "block", block: typed, className };
}

export function isAriaBemBlockClass(className: string): boolean {
  return parseAriaBemToken(className)?.kind === "block";
}

export function isAriaBemElementClass(className: string): boolean {
  return parseAriaBemToken(className)?.kind === "element";
}

export function isAriaBemSystemClass(className: string): boolean {
  const token = parseAriaBemToken(className);
  if (!token) return false;
  if (token.kind === "block" || token.kind === "element") return true;
  return token.preset;
}

export function isAriaBemUserModifierClass(className: string): boolean {
  const token = parseAriaBemToken(className);
  return token?.kind === "modifier" && !token.preset;
}

const BEM_SOURCE_RE =
  /(?:^|[\s"'`])aria-(?:card|alert|badge|field|avatar)(?:__|--|[\s"'`]|$)/;

export function sourceUsesAriaBemPrimitives(source: string): boolean {
  return BEM_SOURCE_RE.test(source);
}

export function ariaBemVisualPresets(
  block: AriaBemBlock,
): readonly string[] | null {
  if (block === "alert" || block === "badge") return ARIA_BEM_PRESET_MODIFIERS[block];
  return null;
}

export function ariaBemPresetOnNode(
  names: readonly string[],
  block: AriaBemBlock,
): string | null {
  for (const name of names) {
    const token = parseAriaBemToken(name);
    if (token?.kind === "modifier" && token.block === block && token.preset) {
      return token.modifier;
    }
  }
  return null;
}

/** Replace the built-in visual preset. User modifiers stay put. */
export function setAriaBemPresetModifier(
  names: readonly string[],
  block: AriaBemBlock,
  modifier: string | null,
): { ok: true; names: string[] } | { ok: false; reason: string } {
  const presets = ariaBemVisualPresets(block);
  if (!presets) {
    return { ok: false, reason: "This element has no built-in variants" };
  }
  if (modifier && !presets.includes(modifier)) {
    return { ok: false, reason: "Unknown built-in variant" };
  }
  const blockClass = ariaBemBlockClass(block);
  if (!names.includes(blockClass)) {
    return { ok: false, reason: "Keep the block class on this element" };
  }
  const next = names.filter((name) => {
    const token = parseAriaBemToken(name);
    return !(token?.kind === "modifier" && token.block === block && token.preset);
  });
  if (!modifier) return { ok: true, names: next };
  const className = ariaBemModifierClass(block, modifier);
  if (next.includes(className)) return { ok: true, names: next };
  const index = next.indexOf(blockClass);
  return {
    ok: true,
    names: [...next.slice(0, index + 1), className, ...next.slice(index + 1)],
  };
}

export function forkAriaBemModifier(
  names: readonly string[],
  blockClass: string,
  slugRaw: string,
): { ok: true; names: string[]; modifier: string } | { ok: false; reason: string } {
  const token = parseAriaBemToken(blockClass);
  if (token?.kind !== "block") {
    return { ok: false, reason: "Not an Aria BEM block class" };
  }
  let slug = slugRaw.trim().toLowerCase().replace(/^\./, "");
  const prefix = `${token.className}--`;
  if (slug.startsWith(prefix)) slug = slug.slice(prefix.length);
  const asToken = parseAriaBemToken(slug);
  if (asToken?.kind === "modifier" && asToken.block === token.block) {
    slug = asToken.modifier;
  }
  if (!isAriaBemSlug(slug)) {
    return { ok: false, reason: "Use a lowercase slug like products or testimonial" };
  }
  if (ARIA_BEM_PRESET_MODIFIERS[token.block].includes(slug)) {
    return { ok: false, reason: "That name is reserved for a built-in variant" };
  }
  const modifier = ariaBemModifierClass(token.block, slug);
  if (names.includes(modifier)) {
    return { ok: false, reason: "This element already has that variant" };
  }
  if (!names.includes(token.className)) {
    return { ok: false, reason: "Keep the block class on this element" };
  }
  return { ok: true, names: [...names, modifier], modifier };
}

export function renameAriaBemModifierOnNode(
  names: readonly string[],
  fromClass: string,
  slugRaw: string,
): { ok: true; names: string[]; from: string; to: string } | { ok: false; reason: string } {
  const token = parseAriaBemToken(fromClass);
  if (token?.kind !== "modifier" || token.preset) {
    return { ok: false, reason: "Only user variants can be renamed" };
  }
  const slug = slugRaw.trim().toLowerCase();
  if (!isAriaBemSlug(slug)) {
    return { ok: false, reason: "Use a lowercase slug like products or testimonial" };
  }
  if (ARIA_BEM_PRESET_MODIFIERS[token.block].includes(slug)) {
    return { ok: false, reason: "That name is reserved for a built-in variant" };
  }
  const next = ariaBemModifierClass(token.block, slug);
  if (next === fromClass) {
    return { ok: true, names: [...names], from: fromClass, to: next };
  }
  if (names.includes(next)) {
    return { ok: false, reason: "This element already has that variant" };
  }
  return {
    ok: true,
    names: names.map((name) => (name === fromClass ? next : name)),
    from: fromClass,
    to: next,
  };
}
