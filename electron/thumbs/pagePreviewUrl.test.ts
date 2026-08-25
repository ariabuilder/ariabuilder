import { describe, expect, it } from "vitest";
import { buildPagePreviewUrl, resolvePageThumbTarget } from "./pagePreviewUrl";

describe("resolvePageThumbTarget", () => {
  it("loads a concrete CMS entry while retaining the template route identity", () => {
    expect(
      resolvePageThumbTarget({
        route: "/blog/[slug]",
        previewRoute: "/blog/hello-world",
      }),
    ).toEqual({
      route: "/blog/[slug]",
      previewRoute: "/blog/hello-world",
    });
  });

  it("keeps static routes unchanged and skips unresolved dynamic routes", () => {
    expect(resolvePageThumbTarget({ route: "/about" })).toEqual({
      route: "/about",
      previewRoute: "/about",
    });
    expect(resolvePageThumbTarget({ route: "/blog/[slug]" })).toBeNull();
  });

  it("skips Aria-managed routes for both identities", () => {
    expect(
      resolvePageThumbTarget({
        route: "/__aria/component-thumbnail",
        previewRoute: "/blog/hello-world",
      }),
    ).toBeNull();
    expect(
      resolvePageThumbTarget({
        route: "/blog/[slug]",
        previewRoute: "/__aria/component-thumbnail",
      }),
    ).toBeNull();
  });
});

describe("buildPagePreviewUrl", () => {
  it("builds a local URL for the concrete preview route", () => {
    expect(
      buildPagePreviewUrl(
        "http://127.0.0.1:4321/old?query=1#hash",
        "/blog/hello-world",
      ),
    ).toBe("http://127.0.0.1:4321/blog/hello-world");
  });

  it("rejects non-local preview servers", () => {
    expect(
      buildPagePreviewUrl("https://example.com", "/blog/hello-world"),
    ).toBeNull();
  });
});
