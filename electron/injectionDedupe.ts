import type { InjectionScanResult } from "../shared/injections";
import type { AnalyticsSettings, CodeSnippet } from "../shared/types";
import { extractHttpUrls, normalizeInjectionHtml } from "./injectionSourceScan";

/**
 * Drop Aria-managed snippets/providers that already exist in source so
 * middleware cannot double-fire them.
 */
export function omitSourceBackedInjections(
  snippets: CodeSnippet[] | null | undefined,
  analytics: AnalyticsSettings | null | undefined,
  scan: InjectionScanResult,
): { snippets: CodeSnippet[]; analytics: AnalyticsSettings | undefined } {
  const sourceProviderIds = new Set(
    scan.analytics.flatMap((item) => (item.providerId ? [item.providerId] : [])),
  );
  const sourceHtml = new Set<string>();
  const sourceUrls = new Set<string>();
  for (const finding of [...scan.analytics, ...scan.snippets]) {
    const html = normalizeInjectionHtml(finding.rawHtml);
    if (html) sourceHtml.add(html);
    for (const url of extractHttpUrls(finding.rawHtml)) {
      sourceUrls.add(url);
    }
  }

  const nextSnippets = (snippets ?? []).filter((snippet) => {
    const html = normalizeInjectionHtml(snippet.code);
    if (html && sourceHtml.has(html)) return false;
    return !extractHttpUrls(snippet.code).some((url) => sourceUrls.has(url));
  });

  if (!analytics) {
    return { snippets: nextSnippets, analytics: undefined };
  }

  return {
    snippets: nextSnippets,
    analytics: {
      ...analytics,
      activeProviders: analytics.activeProviders.filter(
        (id) => !sourceProviderIds.has(id),
      ),
    },
  };
}
