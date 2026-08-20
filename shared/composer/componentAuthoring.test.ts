import { describe, expect, it } from "vitest";
import {
  deriveComposerComponentPreviewData,
  isAriaManagedRoute,
  mergeComposerComponentPreviewData,
  resolveCmsEntryPreviewRoute,
} from "./componentAuthoring";

describe("component authoring preview data", () => {
  it("derives literals and safe required fallbacks", () => {
    const result = deriveComposerComponentPreviewData(
      [
        { name: "titleText", type: "string", optional: false },
        { name: "count", type: "number", optional: false },
        { name: "active", type: "boolean", optional: false },
        { name: "tone", type: "enum", optional: false, options: ["calm", "loud"] },
        { name: "label", type: "string", optional: true, default: "Hello" },
        { name: "pubDate", type: "date", optional: false },
        { name: "config", type: "other", optional: false },
      ],
      ["default", "actions"],
    );

    expect(result.props).toEqual({
      titleText: "Title Text",
      count: 0,
      active: true,
      tone: "calm",
      label: "Hello",
      pubDate: "2026-01-15T12:00:00",
    });
    expect(result.slots).toEqual({
      default: "Component preview",
      actions: "Actions content",
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ field: "config", severity: "warning" }),
    ]);
  });

  it("treats Aria preview and authoring routes as managed", () => {
    expect(isAriaManagedRoute("/aria-preview")).toBe(true);
    expect(isAriaManagedRoute("/aria-preview/layout")).toBe(true);
    expect(isAriaManagedRoute("/__aria")).toBe(true);
    expect(isAriaManagedRoute("/__aria/component-authoring")).toBe(true);
    expect(isAriaManagedRoute("/__aria/component-thumbnail")).toBe(true);
    expect(isAriaManagedRoute("/blog")).toBe(false);
    expect(isAriaManagedRoute("/")).toBe(false);
  });

  it("merges editor-only overrides without losing diagnostics", () => {
    const generated = deriveComposerComponentPreviewData(
      [{ name: "title", type: "string", optional: false }],
      ["default"],
    );
    expect(
      mergeComposerComponentPreviewData(generated, {
        props: { title: "Local title" },
        slots: { default: "Local slot" },
      }),
    ).toEqual({
      props: { title: "Local title" },
      slots: { default: "Local slot" },
      diagnostics: [],
    });
  });

  it("resolves real entry routes without changing the dynamic template identity", () => {
    expect(resolveCmsEntryPreviewRoute({
      urlPattern: "/blog/{slug}",
      templateRoute: "/blog/[...id]",
      id: "posts/hello-world",
      slug: "hello-world",
    })).toBe("/blog/hello-world");
    expect(resolveCmsEntryPreviewRoute({
      templateRoute: "/docs/[...id]",
      id: "guides/getting-started",
    })).toBe("/docs/guides/getting-started");
  });
});
