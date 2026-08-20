import { describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import type { CollectionsState, PagesMetaState } from "@/types/aria";
import type { SiteSettings } from "@/workspace/settings/types";
import { setSiteSettings, updatePageConfig, updatePagesMeta } from "./workspace";

describe("page config IPC payloads", () => {
  it("serializes reactive localization settings before invoking Electron", async () => {
    const setSiteSettingsApi = vi.fn(async (_projectPath: string, settings: SiteSettings) => settings);
    vi.stubGlobal("window", {
      aria: { workspace: { setSiteSettings: setSiteSettingsApi } },
    });
    const settings = reactive<SiteSettings>({
      siteName: "Localized",
      siteDescription: "",
      siteUrl: "",
      timeZone: "UTC",
      favicon: "",
      localization: {
        content: {
          defaultLocale: "en",
          locales: [
            { code: "en", label: "English", enabled: true, direction: "ltr", fallbacks: [] },
          ],
        },
      },
    });

    await setSiteSettings("/project", settings);

    const payload = setSiteSettingsApi.mock.calls[0]?.[1];
    expect(payload).toEqual(settings);
    expect(() => structuredClone(payload)).not.toThrow();
    expect(payload).not.toBe(settings);
    expect(payload?.localization?.content).not.toBe(settings.localization?.content);
  });

  it("serializes reactive pages meta before invoking Electron", async () => {
    const updatePagesMetaApi = vi.fn(async (_projectPath: string, meta: unknown) => meta);
    vi.stubGlobal("window", {
      aria: {
        workspace: { updatePagesMeta: updatePagesMetaApi },
      },
    });

    const meta = reactive<PagesMetaState>({
      pages: {
        "src/pages/index.astro": {
          title: "Home",
          description: "Home test",
          role: "standard",
          seo: { title: "Home SEO" },
        },
      },
    });

    await updatePagesMeta("/project", meta);

    const payload = updatePagesMetaApi.mock.calls[0]?.[1] as
      | PagesMetaState
      | undefined;
    expect(payload).toEqual(meta);
    expect(() => structuredClone(payload)).not.toThrow();
    expect(payload).not.toBe(meta);
    expect(payload?.pages).not.toBe(meta.pages);
  });

  it("serializes reactive page config before invoking Electron", async () => {
    const updatePageConfigApi = vi.fn(
      async (_projectPath: string, input: unknown) => ({
        meta: (input as { pagesMeta: PagesMetaState }).pagesMeta,
        collections: (input as { collections: CollectionsState }).collections,
      }),
    );
    vi.stubGlobal("window", {
      aria: {
        workspace: { updatePageConfig: updatePageConfigApi },
      },
    });

    const input = reactive<{
      pagesMeta: PagesMetaState;
      collections: CollectionsState;
    }>({
      pagesMeta: {
        pages: {
          "src/pages/index.astro": {
            title: "Home",
            description: "Home test",
            role: "standard" as const,
          },
          "src/pages/about.astro": {
            title: "About",
            seo: { description: "About page" },
          },
        },
      },
      collections: {
        collections: [
          {
            id: "blog",
            name: "blog",
            label: "Blog",
            kind: "content" as const,
            urlPattern: "/blog/{slug}",
            listPageFile: null as string | null,
            templatePageFile: null as string | null,
            supports: ["body", "drafts", "revisions"],
            scope: "global",
            schema: {
              version: 1,
              fields: [{ key: "title", type: "string" as const, label: "Title" }],
            },
          },
        ],
      },
    });

    await updatePageConfig("/project", input);

    const payload = updatePageConfigApi.mock.calls[0]?.[1] as
      | { pagesMeta: PagesMetaState; collections: CollectionsState }
      | undefined;
    expect(payload).toEqual(input);
    expect(() => structuredClone(payload)).not.toThrow();
    expect(payload).not.toBe(input);
    expect(payload?.pagesMeta.pages).not.toBe(input.pagesMeta.pages);
    expect(payload?.collections.collections[0]).not.toBe(
      input.collections.collections[0],
    );
  });
});
