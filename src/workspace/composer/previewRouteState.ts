function normalizePathname(pathname: string): string {
  const value = pathname.trim() || "/"
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`
  return withLeadingSlash === "/" ? "/" : withLeadingSlash.replace(/\/+$/, "")
}

export type ComposerPreviewRouteMismatch = {
  selectedPath: string
  renderedPath: string
}

export function composerPreviewRouteMismatch(input: {
  selectedPath: string | null | undefined
  renderedPath: string | null | undefined
}): ComposerPreviewRouteMismatch | null {
  if (!input.selectedPath || !input.renderedPath) return null
  const selectedPath = normalizePathname(input.selectedPath)
  const renderedPath = normalizePathname(input.renderedPath)
  return selectedPath === renderedPath ? null : { selectedPath, renderedPath }
}
