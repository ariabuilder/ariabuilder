import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanPage } from "@/workspace/types";
import {
  createCmsEntryTemplateLaunch,
  resolveCmsEntryTemplatePreviewRoute,
  resolveCmsEntryTemplatePreviewTarget,
} from "./cmsEntryTemplatePreview";

const mocks = vi.hoisted(() => ({
  getCollections: vi.fn(),
  listCmsEntries: vi.fn(),
  listExternalEntries: vi.fn(),
}));

vi.mock("@/lib/cms", () => ({
  listCmsEntries: mocks.listCmsEntries,
}));

vi.mock("@/lib/workspace", () => ({
  getCollections: mocks.getCollections,
  listExternalEntries: mocks.listExternalEntries,
}));

const page: ScanPage = {
  route: "/blog/[slug]",
  file: "src/pages/blog/[slug].astro",
  mtimeMs: 1,
  role: "cms-entry",
};

function collection(source?: { kind: string; readOnly?: boolean }) {
  return {
    id: "blog",
    name: "blog",
    label: "Blog",
    templatePageFile: page.file,
    urlPattern: "/blog/{slug}",
    source,
    schema: { fields: [] },
  };
}

function managedEntry(id: string, slug: string, status: string, updatedAt = "2026-08-25T00:00:00.000Z") {
  return {
    entry: { id, status, updatedAt },
    locales: [{ slug, title: slug, locale: "en", isSource: true }],
  };
}

beforeEach(() => {
  mocks.getCollections.mockReset();
  mocks.listCmsEntries.mockReset();
  mocks.listExternalEntries.mockReset();
});

describe("CMS entry template preview selection", () => {
  it("uses a published entry before an earlier draft", async () => {
    mocks.getCollections.mockResolvedValue({ collections: [collection()] });
    mocks.listCmsEntries.mockResolvedValue({
      items: [
        managedEntry("draft-id", "draft-post", "draft"),
        managedEntry("published-id", "published-post", "published"),
      ],
    });

    const launch = await createCmsEntryTemplateLaunch("/project", page);

    expect(launch.context.selectedEntryId).toBe("published-id");
    expect(launch.context.previewRoute).toBe("/blog/published-post");
    await expect(
      resolveCmsEntryTemplatePreviewRoute("/project", page),
    ).resolves.toBe("/blog/published-post");
  });

  it("uses a draft before the first statusless external entry", async () => {
    mocks.getCollections.mockResolvedValue({
      collections: [collection({ kind: "astro-local", readOnly: true })],
    });
    mocks.listExternalEntries.mockResolvedValue({
      items: [
        { id: "first", data: { title: "First", slug: "first" } },
        {
          id: "draft",
          data: { title: "Draft", slug: "draft", status: "draft" },
        },
      ],
    });

    const launch = await createCmsEntryTemplateLaunch("/project", page);

    expect(launch.context.selectedEntryId).toBe("draft");
    expect(launch.context.previewRoute).toBe("/blog/draft");
  });

  it("returns no concrete route when the collection has no entries", async () => {
    mocks.getCollections.mockResolvedValue({ collections: [collection()] });
    mocks.listCmsEntries.mockResolvedValue({ items: [] });

    await expect(
      resolveCmsEntryTemplatePreviewRoute("/project", page),
    ).resolves.toBeNull();
  });

  it("changes the thumbnail cache key when the selected entry changes", async () => {
    mocks.getCollections.mockResolvedValue({ collections: [collection()] });
    mocks.listCmsEntries
      .mockResolvedValueOnce({
        items: [managedEntry("published-id", "published-post", "published")],
      })
      .mockResolvedValueOnce({
        items: [managedEntry(
          "published-id",
          "published-post",
          "published",
          "2026-08-25T01:00:00.000Z",
        )],
      });

    const before = await resolveCmsEntryTemplatePreviewTarget("/project", page);
    const after = await resolveCmsEntryTemplatePreviewTarget("/project", page);

    expect(before?.previewRoute).toBe("/blog/published-post");
    expect(after?.previewRoute).toBe(before?.previewRoute);
    expect(after?.cacheKey).not.toBe(before?.cacheKey);
  });
});
