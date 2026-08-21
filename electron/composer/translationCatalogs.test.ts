import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyProjectTranslationCutover,
  assessProjectTranslationAdoption,
  createProjectTranslationDrafts,
  editProjectTranslationValue,
  invalidateTranslationCatalogRegistry,
  listProjectTranslationCatalogs,
  translationCandidateFiles,
} from "./translationCatalogs";
import { updateContentLocalization } from "../siteSettings";
import { getEntry } from "../cms";

const roots: string[] = [];

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-translations-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "src", "i18n"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
  return root;
}

function write(root: string, relative: string, value: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    invalidateTranslationCatalogRegistry(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("project translation catalog discovery", () => {
  it("discovers the Panam-derived 162-key shape, query resolver, mismatches, consumers, edits, and conflicts", async () => {
    const root = fixture();
    const english = Object.fromEntries(Array.from({ length: 158 }, (_, index) => [`field${String(index + 1).padStart(3, "0")}`, `English ${index + 1}`]));
    const french = Object.fromEntries([
      ...Array.from({ length: 155 }, (_, index) => [`field${String(index + 1).padStart(3, "0")}`, `Français ${index + 1}`] as const),
      ...Array.from({ length: 4 }, (_, index) => [`field${String(index + 159).padStart(3, "0")}`, `Français ${index + 159}`] as const),
    ]);
    write(root, "src/i18n/translations.ts", `export const translations = ${JSON.stringify({ en: { hero2: english }, fr: { hero2: french } }, null, 2)} as const;\n`);
    write(root, "src/i18n/runtime.ts", `export const getLanguage = (url: URL) => url.searchParams.get("lang");\n`);
    write(root, "src/components/Hero2.astro", `---\nimport { translations } from "../i18n/translations";\nconst currentLanguage = Astro.url.searchParams.get("lang") === "fr" ? "fr" : "en";\nconst t = translations[currentLanguage].hero2;\n---\n<h1>{t.field001}</h1>\n`);

    const discovered = await listProjectTranslationCatalogs(root);
    expect(discovered.catalogs).toHaveLength(1);
    const catalog = discovered.catalogs[0]!;
    expect(catalog.locales).toEqual(["en", "fr"]);
    expect(catalog.resolver).toEqual({ kind: "query-param", parameter: "lang" });
    expect(catalog.namespaces[0]?.keys).toHaveLength(162);
    expect(catalog.diagnostics.filter((issue) => issue.locale === "en")).toHaveLength(4);
    expect(catalog.diagnostics.filter((issue) => issue.locale === "fr")).toHaveLength(3);
    expect(catalog.consumers[0]).toMatchObject({ namespace: "hero2", keyPath: ["field001"], contextVariable: "t", status: "safe" });

    const edited = await editProjectTranslationValue(root, {
      catalogId: catalog.id, namespace: "hero2", keyPath: ["field001"], locale: "fr",
      value: "Titre modifié", expectedSourceHash: catalog.sourceHash,
    });
    expect(edited.ok).toBe(true);
    expect((await listProjectTranslationCatalogs(root)).catalogs[0]?.namespaces[0]?.keys[0]?.values.fr).toBe("Titre modifié");
    await expect(editProjectTranslationValue(root, {
      catalogId: catalog.id, namespace: "hero2", keyPath: ["field001"], locale: "fr",
      value: "Stale", expectedSourceHash: catalog.sourceHash,
    })).rejects.toThrow("TRANSLATION_CATALOG_CONFLICT");
  });

  it("resolves statically imported JSON locale maps and reports computed catalogs", async () => {
    const root = fixture();
    write(root, "src/locales/en-ca.json", JSON.stringify({ hero: { title: "Hello" } }));
    write(root, "src/locales/fr-ca.json", JSON.stringify({ hero: { title: "Bonjour" } }));
    write(root, "src/locales/catalog.ts", `import en from "./en-ca.json";\nimport fr from "./fr-ca.json";\nexport const messages = { "en-ca": en, "fr-ca": fr };\nexport const runtimeMessages = makeMessages();\n`);
    const discovered = await listProjectTranslationCatalogs(root);
    expect(discovered.catalogs.find((catalog) => catalog.exportName === "messages")?.locales).toEqual(["en-CA", "fr-CA"]);
    expect(discovered.unsupported).toContainEqual(expect.objectContaining({ exportName: "runtimeMessages", reason: expect.stringContaining("Computed value") }));
  });

  it("skips generated Paraglide modules and declarations before parsing", async () => {
    const root = fixture();
    for (let index = 0; index < 2_100; index += 1) {
      write(root, `src/paraglide/messages/message-${index}.js`, `export const message${index} = () => "value";\n`);
      write(root, `src/paraglide/messages/message-${index}.d.ts`, `export declare const message${index}: () => string;\n`);
    }
    write(root, "src/i18n/messages.ts", "export const messages = { en: { home: { title: 'Hello' } }, fr: { home: { title: 'Bonjour' } } } as const;\n");

    const candidates = translationCandidateFiles(root).map((file) => path.relative(root, file).replace(/\\/g, "/"));
    expect(candidates).toEqual(["src/i18n/messages.ts"]);
    expect((await listProjectTranslationCatalogs(root, true)).catalogs).toHaveLength(1);
  }, 20_000);

  it("creates per-namespace locale drafts and applies a separately reviewed hash-matched cutover", async () => {
    const root = fixture();
    const catalogSource = `export const translations = {\n  en: { hero2: { title: "Hello", cta: { label: "Vote" } } },\n  fr: { hero2: { title: "Bonjour", cta: { label: "Voter" } } },\n} as const;\n`;
    write(root, "src/i18n/translations.ts", catalogSource);
    write(root, "src/i18n/runtime.ts", `export const locale = (url: URL) => url.searchParams.get("lang");\n`);
    write(root, "src/components/Hero2.astro", `---\nimport { translations } from "../i18n/translations";\nconst currentLanguage = Astro.url.searchParams.get("lang") === "fr" ? "fr" : "en";\nconst t = translations[currentLanguage].hero2;\n---\n<h1>{t.title}</h1>\n`);
    updateContentLocalization(root, {
      defaultLocale: "en",
      resolver: { kind: "query-param", parameter: "lang" },
      locales: [
        { code: "en", label: "English", enabled: true, direction: "ltr", fallbacks: [] },
        { code: "fr", label: "French", enabled: true, direction: "ltr", fallbacks: ["en"] },
      ],
    });
    const catalog = (await listProjectTranslationCatalogs(root, true)).catalogs[0]!;
    const review = await assessProjectTranslationAdoption(root, {
      catalogId: catalog.id, namespaces: ["hero2"], expectedCatalogHash: catalog.sourceHash,
    });
    expect(review).toMatchObject({ settingsCompatible: true, namespaces: [{ collectionName: "translations-hero2", locales: ["en", "fr"] }] });
    expect(review.namespaces[0]?.schema).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "title", type: "string" }),
      expect.objectContaining({ key: "cta", type: "object" }),
    ]));
    const drafts = await createProjectTranslationDrafts(root, {
      catalogId: catalog.id, namespaces: ["hero2"], expectedCatalogHash: catalog.sourceHash, expectedPreviewHash: review.previewHash,
    });
    expect(drafts.sourceChanged).toBe(false);
    const record = getEntry(root, drafts.targets[0]!.collectionId, drafts.targets[0]!.entryId);
    expect(record).not.toBeNull();
    if (!record) throw new Error("Expected translation draft entry");
    expect(record.entry.status).toBe("draft");
    expect(record.locales).toEqual(expect.arrayContaining([
      expect.objectContaining({ locale: "en", frontmatter: expect.objectContaining({ title: "Hello" }) }),
      expect.objectContaining({ locale: "fr", status: "draft", frontmatter: expect.objectContaining({ title: "Bonjour" }) }),
    ]));
    expect(fs.readFileSync(path.join(root, "src/i18n/translations.ts"), "utf8")).toBe(catalogSource);

    const cutoverReview = await assessProjectTranslationAdoption(root, {
      catalogId: catalog.id, namespaces: ["hero2"], expectedCatalogHash: catalog.sourceHash,
    });
    const cutover = await applyProjectTranslationCutover(root, {
      catalogId: catalog.id,
      namespaces: ["hero2"],
      expectedCatalogHash: catalog.sourceHash,
      expectedPreviewHash: cutoverReview.previewHash,
      consumerIds: catalog.consumers.map((consumer) => consumer.id),
      targets: drafts.targets,
    });
    expect(cutover).toMatchObject({ ok: true, retainedSourceFile: "src/i18n/translations.ts", changedFiles: ["src/components/Hero2.astro"] });
    const component = fs.readFileSync(path.join(root, "src/components/Hero2.astro"), "utf8");
    expect(component).toContain('getCollection("translations-hero2")');
    expect(component).toContain("@aria-translation-source-fallback");
    expect(component).toContain("(t.title)");
    expect(fs.readFileSync(path.join(root, "src/i18n/translations.ts"), "utf8")).toBe(catalogSource);
  });
});
