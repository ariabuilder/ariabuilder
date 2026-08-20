import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeCollections } from "../collections";
import { createEntry, deleteEntry, updateEntry } from "./services";
import { updateContentLocalization } from "../siteSettings";

function project(): string {
  const root = mkdtempSync(path.join(tmpdir(), "aria-localized-delivery-"));
  writeCollections(root, { collections: [{
    id: "posts", name: "posts", label: "Posts", kind: "content",
    urlPattern: "/posts/{slug}", listPageFile: null, templatePageFile: null,
    schema: { version: 1, fields: [{ key: "summary", label: "Summary", type: "string", required: true }] },
  }] });
  return root;
}

describe("localized Astro content materialization", () => {
  it("keeps a new translation draft until its locale lifecycle is published", () => {
    const root = project();
    let record = createEntry(root, {
      collectionId: "posts", title: "Hello", slug: "hello", locale: "en",
      frontmatter: { summary: "Source" }, body: "Source body", status: "published",
    });
    record = updateEntry(root, {
      collectionId: "posts", id: record.entry.id, version: record.entry.version,
      patch: { upsertLocale: { locale: "fr", title: "Bonjour", slug: "bonjour", frontmatter: { summary: "Traduction" }, body: "Corps" } },
    });

    const source = readFileSync(path.join(root, "src/content/posts/hello.md"), "utf8");
    const draftTranslation = readFileSync(path.join(root, "src/content/posts/fr/bonjour.md"), "utf8");
    expect(source).toContain("draft: false");
    expect(source).toContain("locale: en");
    expect(draftTranslation).toContain("draft: true");
    expect(draftTranslation).toContain(`translationKey: ${record.entry.id}`);

    record = updateEntry(root, {
      collectionId: "posts", id: record.entry.id, version: record.entry.version,
      patch: { upsertLocale: { locale: "fr", status: "published" } },
    });
    const publishedTranslation = readFileSync(path.join(root, "src/content/posts/fr/bonjour.md"), "utf8");
    expect(publishedTranslation).toContain("draft: false");
    expect(record.locales.find((locale) => locale.locale === "fr")?.publishedAt).toBeTruthy();

    record = updateEntry(root, {
      collectionId: "posts", id: record.entry.id, version: record.entry.version,
      patch: { locale: "fr", slug: "salut" },
    });
    expect(existsSync(path.join(root, "src/content/posts/fr/bonjour.md"))).toBe(false);
    expect(existsSync(path.join(root, "src/content/posts/fr/salut.md"))).toBe(true);

    deleteEntry(root, "posts", record.entry.id, record.entry.version);
    expect(existsSync(path.join(root, "src/content/posts/hello.md"))).toBe(false);
    expect(existsSync(path.join(root, "src/content/posts/fr/salut.md"))).toBe(false);
  });

  it("uses the configured default locale for new source entries", () => {
    const root = project();
    updateContentLocalization(root, {
      defaultLocale: "de",
      locales: [{ code: "de", label: "Deutsch", enabled: true, direction: "ltr", fallbacks: [] }],
    });
    const record = createEntry(root, {
      collectionId: "posts", title: "Hallo", frontmatter: { summary: "Quelle" },
    });
    expect(record.locales[0]).toMatchObject({ locale: "de", isSource: true });
  });

  it("validates a locale before publishing it even while the source entry is draft", () => {
    const root = project();
    let record = createEntry(root, {
      collectionId: "posts", title: "Draft", locale: "en", frontmatter: { summary: "Source" },
    });
    record = updateEntry(root, {
      collectionId: "posts", id: record.entry.id, version: record.entry.version,
      patch: { upsertLocale: { locale: "fr", title: "Brouillon", slug: "brouillon", frontmatter: {} } },
    });
    expect(() => updateEntry(root, {
      collectionId: "posts", id: record.entry.id, version: record.entry.version,
      patch: { upsertLocale: { locale: "fr", status: "published" } },
    })).toThrow(/summary.*Required/);
  });

  it("keeps a published locale private until its source entry is published", () => {
    const root = project();
    let record = createEntry(root, {
      collectionId: "posts", title: "Draft", slug: "draft", locale: "en",
      frontmatter: { summary: "Source" },
    });
    record = updateEntry(root, {
      collectionId: "posts", id: record.entry.id, version: record.entry.version,
      patch: { upsertLocale: {
        locale: "fr", title: "Prêt", slug: "pret", frontmatter: { summary: "Cible" }, status: "published",
      } },
    });
    const translatedFile = path.join(root, "src/content/posts/fr/pret.md");
    expect(readFileSync(translatedFile, "utf8")).toContain("draft: true");

    record = updateEntry(root, {
      collectionId: "posts", id: record.entry.id, version: record.entry.version,
      patch: { status: "published" },
    });
    expect(readFileSync(translatedFile, "utf8")).toContain("draft: false");
  });

  it("emits hreflang routes only for published locale variants", () => {
    const root = project();
    updateContentLocalization(root, {
      defaultLocale: "en",
      locales: [
        { code: "en", label: "English", enabled: true, direction: "ltr", fallbacks: [] },
        { code: "fr", label: "French", enabled: true, direction: "ltr", fallbacks: ["en"] },
      ],
    });
    let record = createEntry(root, {
      collectionId: "posts", title: "Hello", slug: "hello", locale: "en",
      frontmatter: { summary: "Source" }, status: "published",
    });
    record = updateEntry(root, {
      collectionId: "posts", id: record.entry.id, version: record.entry.version,
      patch: { upsertLocale: { locale: "fr", title: "Bonjour", slug: "bonjour", frontmatter: { summary: "Cible" } } },
    });
    let manifest = readFileSync(path.join(root, "src/aria/localization.generated.ts"), "utf8");
    expect(manifest).toContain('"/posts/hello"');
    expect(manifest).not.toContain('"/fr/posts/bonjour"');

    updateEntry(root, {
      collectionId: "posts", id: record.entry.id, version: record.entry.version,
      patch: { upsertLocale: { locale: "fr", status: "published" } },
    });
    manifest = readFileSync(path.join(root, "src/aria/localization.generated.ts"), "utf8");
    expect(manifest).toContain('"/fr/posts/bonjour"');
  });

  it("keeps query-parameter locale URLs through middleware and hreflang generation", () => {
    const root = project();
    updateContentLocalization(root, {
      defaultLocale: "en",
      resolver: { kind: "query-param", parameter: "lang" },
      locales: [
        { code: "en", label: "English", enabled: true, direction: "ltr", fallbacks: [] },
        { code: "fr", label: "French", enabled: true, direction: "ltr", fallbacks: ["en"] },
      ],
    });
    let record = createEntry(root, {
      collectionId: "posts", title: "Hello", slug: "hello", locale: "en",
      frontmatter: { summary: "Source" }, status: "published",
    });
    record = updateEntry(root, {
      collectionId: "posts", id: record.entry.id, version: record.entry.version,
      patch: { upsertLocale: { locale: "fr", title: "Bonjour", slug: "bonjour", frontmatter: { summary: "Cible" }, status: "published" } },
    });
    const manifest = readFileSync(path.join(root, "src/aria/localization.generated.ts"), "utf8");
    const middleware = readFileSync(path.join(root, "src/aria/snippets-middleware.ts"), "utf8");
    expect(manifest).toContain('"resolver": {\n    "kind": "query-param",\n    "parameter": "lang"');
    expect(manifest).toContain('"/posts/hello?lang=en"');
    expect(manifest).toContain('"/posts/bonjour?lang=fr"');
    expect(manifest).toContain('"/posts/bonjour": [');
    expect(manifest).not.toContain('"/fr/posts/bonjour"');
    expect(middleware).toContain("url.searchParams.get(ariaLocalization.resolver.parameter)");
    expect(middleware).toContain("key !== ariaLocalization.resolver.parameter");
    expect(middleware).toContain('headers.set("Content-Language", locale.code)');
  });
});
