import type { ProjectLocaleResolver } from "../composer/projectTranslations";

export type ProjectLocaleUrlOptions = {
  locale: string;
  defaultLocale: string;
  locales: readonly string[];
  resolver: ProjectLocaleResolver;
};

/**
 * Applies the project-owned locale strategy without losing unrelated query
 * parameters or a hash. The returned value is route-relative so it can be fed
 * directly to Composer's preview URL builder.
 */
export function applyProjectLocaleToRoute(
  route: string | null,
  options: ProjectLocaleUrlOptions,
): string | null {
  if (!route) return route;
  const target = new URL(route, "https://aria.local");
  if (options.resolver.kind === "query-param") {
    target.searchParams.set(options.resolver.parameter, options.locale);
  } else {
    const segments = target.pathname.split("/").filter(Boolean);
    if (segments[0] && options.locales.includes(segments[0])) segments.shift();
    if (options.locale !== options.defaultLocale) segments.unshift(options.locale);
    target.pathname = `/${segments.join("/")}${target.pathname.endsWith("/") && segments.length ? "/" : ""}`;
  }
  return `${target.pathname}${target.search}${target.hash}`;
}

