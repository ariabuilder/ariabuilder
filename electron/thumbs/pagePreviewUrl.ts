import { isNavigablePageRoute } from "../../shared/pages";
import { isAriaManagedRoute } from "../componentPreviewHarness";

export type PageThumbTarget = {
  route: string;
  previewRoute: string;
};

/** Keep the stored thumbnail identity separate from the concrete route rendered. */
export function resolvePageThumbTarget(input: {
  route: string;
  previewRoute?: string | null;
}): PageThumbTarget | null {
  const route = input.route.trim() || "/";
  const previewRoute = input.previewRoute?.trim() || route;
  if (!isNavigablePageRoute(previewRoute)) return null;
  if (isAriaManagedRoute(route) || isAriaManagedRoute(previewRoute))
    return null;
  return { route, previewRoute };
}

/** Hidden-window URL for a concrete project page. */
export function buildPagePreviewUrl(
  baseUrl: string,
  previewRoute: string,
): string | null {
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    ) {
      return null;
    }
    const pathname = previewRoute.trim() || "/";
    url.pathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
