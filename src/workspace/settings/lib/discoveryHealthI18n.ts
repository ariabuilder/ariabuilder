import { m } from "@/paraglide/messages.js"
import type {
  DiscoveryReportRow,
  SiteHealthCheck,
  SiteSeoAudit,
} from "../../../../shared/crawl"

type MessageFn = (args: { count: string }) => string

const HEALTH_LABEL_KEYS: Readonly<Record<string, () => string>> = {
  "site-url": () => m.settings_discovery_health_site_url_configured(),
  "indexable-pages": () => m.settings_discovery_health_indexable_pages(),
  "discourage-search": () =>
    m.settings_discovery_health_search_engine_visibility(),
  "llms-visibility": () => m.settings_discovery_health_ai_discovery(),
  "domain-alignment": () => m.settings_discovery_health_domain_alignment(),
  "seo-errors": () => m.settings_discovery_health_seo_errors(),
  "seo-warnings": () => m.settings_discovery_health_seo_warnings(),
}

const HEALTH_MESSAGE_KEYS: Readonly<Record<string, () => string>> = {
  "Add a site URL in General settings.": () =>
    m.settings_discovery_health_add_site_url(),
  "Sitemap generation needs a site URL.": () =>
    m.settings_discovery_health_sitemap_needs_site_url(),
  "Search engine visibility is discouraged, so sitemap entries are suppressed.":
    () => m.settings_discovery_health_visibility_discouraged(),
  "sitemap.xml is turned off.": () => m.settings_discovery_health_sitemap_off(),
  "No pages are currently discoverable.": () =>
    m.settings_discovery_health_no_discoverable_pages(),
  "Discourage search engines is enabled.": () =>
    m.settings_discovery_health_discourage_enabled(),
  "llms.txt is turned off.": () => m.settings_discovery_health_llms_off(),
  "Custom domain may not match site URL.": () =>
    m.settings_discovery_health_domain_mismatch(),
  "Unable to validate custom domain alignment.": () =>
    m.settings_discovery_health_domain_validation_failed(),
}

export interface DiscoveryHealthTranslationContext {
  rows: readonly DiscoveryReportRow[]
  audits: readonly SiteSeoAudit[]
}

function countMessage(
  count: number,
  singular: MessageFn,
  plural: MessageFn,
): string {
  return count === 1
    ? singular({ count: String(count) })
    : plural({ count: String(count) })
}

function localizeHealthMessage(
  check: SiteHealthCheck,
  context: DiscoveryHealthTranslationContext,
): string | undefined {
  if (!check.message) return undefined

  if (
    check.id === "indexable-pages" &&
    /^\d+ page\(s\) in sitemap$/.test(check.message)
  ) {
    const count = context.rows.filter((row) => row.inSitemap).length
    return countMessage(
      count,
      m.settings_discovery_health_page_in_sitemap,
      m.settings_discovery_health_pages_in_sitemap,
    )
  }

  if (
    check.id === "seo-errors" &&
    /^\d+ critical issue\(s\) found\.$/.test(check.message)
  ) {
    const count = context.audits.filter(
      (audit) => audit.severity === "error",
    ).length
    return countMessage(
      count,
      m.settings_discovery_health_critical_issue_found,
      m.settings_discovery_health_critical_issues_found,
    )
  }

  if (
    check.id === "seo-warnings" &&
    /^\d+ warning\(s\) found\.$/.test(check.message)
  ) {
    const count = context.audits.filter(
      (audit) => audit.severity === "warning",
    ).length
    return countMessage(
      count,
      m.settings_discovery_health_warning_found,
      m.settings_discovery_health_warnings_found,
    )
  }

  const messageFn = HEALTH_MESSAGE_KEYS[check.message]
  return messageFn ? messageFn() : check.message
}

export function localizeDiscoveryHealthCheck(
  check: SiteHealthCheck,
  context: DiscoveryHealthTranslationContext,
): SiteHealthCheck {
  const labelFn = HEALTH_LABEL_KEYS[check.id]
  return {
    ...check,
    label: labelFn ? labelFn() : check.label,
    message: localizeHealthMessage(check, context),
  }
}
