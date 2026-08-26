// @vitest-environment jsdom
import { createApp, defineComponent, h } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageThumbReadyPayload } from "@/types/aria";
import PageGridCard from "./PageGridCard.vue";

const mocks = vi.hoisted(() => ({
  getPageThumb: vi.fn(),
  onPageThumbReady: vi.fn(),
  readyHandler: null as ((payload: PageThumbReadyPayload) => void) | null,
  stopReady: vi.fn(),
}));

vi.mock("@/lib/thumbs", () => ({
  getPageThumb: mocks.getPageThumb,
  onPageThumbReady: mocks.onPageThumbReady,
}));

vi.mock("@/lib/project", () => ({
  openExternalUrl: vi.fn(),
}));

const mounted: Array<() => void> = [];

afterEach(() => {
  mocks.getPageThumb.mockReset();
  mocks.onPageThumbReady.mockReset();
  mocks.readyHandler = null;
  mocks.stopReady.mockReset();
  for (const unmount of mounted.splice(0)) unmount();
});

describe("PageGridCard CMS entry thumbnails", () => {
  it("loads and refreshes a thumbnail stored under the template route", async () => {
    mocks.getPageThumb
      .mockResolvedValueOnce({ dataUrl: "data:image/png;base64,first" })
      .mockResolvedValueOnce({ dataUrl: "data:image/png;base64,second" });
    mocks.onPageThumbReady.mockImplementation(
      (handler: (payload: PageThumbReadyPayload) => void) => {
        mocks.readyHandler = handler;
        return mocks.stopReady;
      },
    );

    const host = document.createElement("div");
    document.body.append(host);
    const app = createApp(
      defineComponent({
        setup: () => () =>
          h(PageGridCard, {
            page: {
              route: "/blog/[slug]",
              file: "src/pages/blog/[slug].astro",
              mtimeMs: 1,
              role: "cms-entry",
              displayName: "[slug]",
            },
            projectPath: "/project",
            items: [],
            previewBaseUrl: "http://127.0.0.1:4321",
          }),
      }),
    );
    app.mount(host);
    mounted.push(() => {
      app.unmount();
      host.remove();
    });

    await vi.waitFor(() => {
      expect(mocks.getPageThumb).toHaveBeenCalledWith({
        projectPath: "/project",
        route: "/blog/[slug]",
        mtimeMs: 1,
      });
      expect(host.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/png;base64,first",
      );
    });

    mocks.readyHandler?.({ projectPath: "/project", route: "/blog/[slug]" });

    await vi.waitFor(() => {
      expect(mocks.getPageThumb).toHaveBeenCalledTimes(2);
      expect(host.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/png;base64,second",
      );
    });
  });
});
