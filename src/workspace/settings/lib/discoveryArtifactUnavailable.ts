import { m } from "@/paraglide/messages.js"

export type DiscoveryArtifactKind = "robots" | "sitemap" | "llms"

export interface ArtifactUnavailableContext {
  kind: DiscoveryArtifactKind
  mode: "auto" | "custom" | "off"
  preview: string
  discourageSearchEngines: boolean
  hasSiteUrl: boolean
}

export function getArtifactUnavailableReason(
  context: ArtifactUnavailableContext,
): string | null {
  if (context.mode === "off" || context.preview.trim().length > 0) {
    return null
  }

  if (context.discourageSearchEngines && context.kind !== "robots") {
    return m.settings_discovery_artifact_unavailable_discouraged()
  }

  if (!context.hasSiteUrl && context.kind === "sitemap") {
    return m.settings_discovery_artifact_unavailable_sitemap_needs_url()
  }

  if (context.kind === "sitemap") {
    return m.settings_discovery_artifact_unavailable_no_indexable_pages()
  }

  if (context.kind === "llms") {
    return context.hasSiteUrl
      ? m.settings_discovery_artifact_unavailable_no_llms_content()
      : m.settings_discovery_artifact_unavailable_llms_needs_url()
  }

  return null
}
