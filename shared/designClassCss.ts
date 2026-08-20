/**
 * Surgical CSS helpers for Class Manager.
 * Only touches top-level simple `.classname { … }` rules; everything else is preserved.
 */

const SIMPLE_CLASS_SELECTOR = /^\.([a-zA-Z_][\w-]*)$/

export type ExtractedClassRule = {
  name: string
  /** Full rule text including selector and braces. */
  css: string
  start: number
  end: number
}

function skipComment(css: string, i: number): number {
  if (css[i] === "/" && css[i + 1] === "*") {
    const end = css.indexOf("*/", i + 2)
    return end === -1 ? css.length : end + 2
  }
  return i
}

function skipString(css: string, i: number): number {
  const quote = css[i]
  if (quote !== '"' && quote !== "'") return i
  let j = i + 1
  while (j < css.length) {
    if (css[j] === "\\") {
      j += 2
      continue
    }
    if (css[j] === quote) return j + 1
    j += 1
  }
  return css.length
}

function findMatchingBrace(css: string, openIndex: number): number {
  let depth = 0
  let i = openIndex
  while (i < css.length) {
    const nextComment = skipComment(css, i)
    if (nextComment !== i) {
      i = nextComment
      continue
    }
    const nextString = skipString(css, i)
    if (nextString !== i) {
      i = nextString
      continue
    }
    const ch = css[i]
    if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) return i
    }
    i += 1
  }
  return -1
}

/**
 * Extract top-level simple class rules (not nested inside @media / @supports).
 */
export function extractSimpleClassRules(css: string): ExtractedClassRule[] {
  const out: ExtractedClassRule[] = []
  let i = 0

  while (i < css.length) {
    // Skip whitespace / comments between top-level constructs
    while (i < css.length) {
      if (/\s/.test(css[i]!)) {
        i += 1
        continue
      }
      const afterComment = skipComment(css, i)
      if (afterComment !== i) {
        i = afterComment
        continue
      }
      break
    }
    if (i >= css.length) break

    // At-rule: skip statement or entire block
    if (css[i] === "@") {
      let j = i + 1
      while (j < css.length) {
        const nc = skipComment(css, j)
        if (nc !== j) {
          j = nc
          continue
        }
        const ns = skipString(css, j)
        if (ns !== j) {
          j = ns
          continue
        }
        if (css[j] === ";") {
          i = j + 1
          break
        }
        if (css[j] === "{") {
          const close = findMatchingBrace(css, j)
          i = close === -1 ? css.length : close + 1
          break
        }
        j += 1
      }
      if (j >= css.length) break
      continue
    }

    // Qualified rule: read prelude until `{`
    const selectorStart = i
    let j = i
    while (j < css.length) {
      const nc = skipComment(css, j)
      if (nc !== j) {
        j = nc
        continue
      }
      const ns = skipString(css, j)
      if (ns !== j) {
        j = ns
        continue
      }
      if (css[j] === "{") break
      if (css[j] === "}" || css[j] === "@") break
      j += 1
    }

    if (j >= css.length || css[j] !== "{") {
      // Malformed — advance one char to avoid infinite loop
      i = Math.max(i + 1, j)
      continue
    }

    const close = findMatchingBrace(css, j)
    if (close === -1) break

    const selector = css.slice(selectorStart, j).trim()
    const match = selector.match(SIMPLE_CLASS_SELECTOR)
    if (match) {
      out.push({
        name: match[1]!,
        css: css.slice(selectorStart, close + 1).trim(),
        start: selectorStart,
        end: close + 1,
      })
    }

    i = close + 1
  }

  return out
}

/** Latest rule wins for duplicate names. */
export function extractClassRulesByName(
  css: string,
): Map<string, ExtractedClassRule> {
  const map = new Map<string, ExtractedClassRule>()
  for (const rule of extractSimpleClassRules(css)) {
    map.set(rule.name, rule)
  }
  return map
}

export function summarizeClassCss(css: string): string {
  const open = css.indexOf("{")
  const close = css.lastIndexOf("}")
  if (open === -1 || close <= open) return "No rules yet"
  const body = css
    .slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
  if (!body) return "No rules yet"
  const decls = body
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
  if (decls.length === 0) return "No rules yet"
  return decls.slice(0, 2).join("; ")
}

export function buildClassRuleCss(name: string, bodyOrFull: string): string {
  const trimmed = bodyOrFull.trim()
  if (trimmed.startsWith(".")) {
    // Normalize selector to the intended name
    const open = trimmed.indexOf("{")
    if (open !== -1) {
      const body = trimmed.slice(open)
      return `.${name} ${body.trimStart()}`.replace(
        /^\.[\w-]+\s*\{/,
        `.${name} {`,
      )
    }
    return `.${name} {\n  \n}`
  }
  const declarations = trimmed
    ? trimmed
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => (line.endsWith(";") ? line : `${line};`))
        .map((line) => `  ${line}`)
        .join("\n")
    : "  "
  return `.${name} {\n${declarations}\n}`
}

export function replaceClassRule(
  css: string,
  name: string,
  nextCss: string,
): string {
  const rule = extractClassRulesByName(css).get(name)
  if (!rule) {
    return appendClassRule(css, name, nextCss)
  }
  const replacement = buildClassRuleCss(name, nextCss)
  return css.slice(0, rule.start) + replacement + css.slice(rule.end)
}

export function renameClassRule(
  css: string,
  oldName: string,
  newName: string,
): string {
  const rule = extractClassRulesByName(css).get(oldName)
  if (!rule) return css
  const open = rule.css.indexOf("{")
  const body = open === -1 ? "{\n  \n}" : rule.css.slice(open)
  const replacement = `.${newName} ${body.trimStart()}`.replace(
    /^\.[\w-]+\s*\{/,
    `.${newName} {`,
  )
  return css.slice(0, rule.start) + replacement + css.slice(rule.end)
}

export function removeClassRule(css: string, name: string): string {
  const rule = extractClassRulesByName(css).get(name)
  if (!rule) return css
  let start = rule.start
  let end = rule.end
  if (css[end] === "\r" && css[end + 1] === "\n") end += 2
  else if (css[end] === "\n") end += 1
  if (css[end] === "\n") end += 1
  if (start > 0 && css[start - 1] === "\n") {
    const prev = start - 1
    if (prev > 0 && css[prev - 1] === "\n") start = prev
  }
  return css.slice(0, start) + css.slice(end)
}

export function removeClassRules(css: string, names: readonly string[]): string {
  let next = css
  for (const name of names) {
    next = removeClassRule(next, name)
  }
  return next
}

export function appendClassRule(
  css: string,
  name: string,
  bodyOrFull: string,
): string {
  const rule = buildClassRuleCss(name, bodyOrFull)
  const trimmed = css.replace(/\s+$/, "")
  if (!trimmed) return `${rule}\n`
  return `${trimmed}\n\n${rule}\n`
}

export function isValidClassName(name: string): boolean {
  return /^[a-zA-Z_][\w-]*$/.test(name) && name.length <= 64
}

export function sanitizeClassName(raw: string): string {
  return raw
    .trim()
    .replace(/^\./, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function createSequentialDuplicateName(
  base: string,
  existing: ReadonlySet<string>,
): string {
  const root = base.replace(/-copy(?:-\d+)?$/i, "")
  let candidate = `${root}-copy`
  let n = 2
  while (existing.has(candidate)) {
    candidate = `${root}-copy-${n}`
    n += 1
  }
  return candidate
}

export type ClassImportItem = { name: string; css: string }

export function parseClassImportPayload(raw: string): {
  items: ClassImportItem[]
  error?: string
} {
  const trimmed = raw.trim()
  if (!trimmed) return { items: [], error: "Empty import" }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      const list = Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as { classes?: unknown }).classes)
          ? (parsed as { classes: unknown[] }).classes
          : null
      if (!list) return { items: [], error: "JSON must be an array of classes" }
      const items: ClassImportItem[] = []
      for (const entry of list) {
        if (!entry || typeof entry !== "object") continue
        const name = sanitizeClassName(String((entry as { name?: unknown }).name ?? ""))
        if (!name || !isValidClassName(name)) continue
        const cssRaw = String(
          (entry as { css?: unknown }).css ??
            (entry as { cssText?: unknown }).cssText ??
            "",
        )
        items.push({ name, css: buildClassRuleCss(name, cssRaw || `  \n`) })
      }
      return { items }
    } catch {
      return { items: [], error: "Invalid JSON" }
    }
  }

  const rules = extractSimpleClassRules(trimmed)
  if (rules.length === 0) {
    return { items: [], error: "No simple .class rules found" }
  }
  const byName = new Map<string, ClassImportItem>()
  for (const rule of rules) {
    byName.set(rule.name, { name: rule.name, css: rule.css })
  }
  return { items: [...byName.values()] }
}
