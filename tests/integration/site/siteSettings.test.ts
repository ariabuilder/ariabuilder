import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DISCOVERY_SETTINGS } from "@shared/crawl";
import {
  readSiteSettings,
  writeAgentSettings,
  writeSiteSettings,
  updateContentLocalization,
} from "@electron/siteSettings";

describe("site settings partial surface saves", () => {
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-site-settings-"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "settings-test", dependencies: { astro: "latest" } }),
    );
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("preserves SEO and discovery when General saves only identity fields", () => {
    writeSiteSettings(root, {
      siteName: "Before",
      siteDescription: "Description",
      siteUrl: "https://example.com",
      timeZone: "UTC",
      favicon: "",
      seoTitle: "Keep this title",
      seoDescription: "Keep this description",
      discovery: {
        ...DEFAULT_DISCOVERY_SETTINGS,
        discourageSearchEngines: true,
      },
    });

    writeSiteSettings(root, {
      siteName: "After",
      siteDescription: "Description",
      siteUrl: "https://example.com",
      timeZone: "UTC",
      favicon: "",
    });

    expect(readSiteSettings(root)).toMatchObject({
      siteName: "After",
      seoTitle: "Keep this title",
      seoDescription: "Keep this description",
      discovery: { discourageSearchEngines: true },
    });
  });

  it("persists agent settings without regenerating site output artifacts", () => {
    writeSiteSettings(root, {
      siteName: "Agent test",
      siteDescription: "",
      siteUrl: "https://example.com",
      timeZone: "UTC",
      favicon: "",
    });

    const generatedFiles = [
      path.join(root, "src", "aria", "snippets.generated.ts"),
      path.join(root, "src", "aria", "redirects.generated.ts"),
      path.join(root, "src", "middleware.ts"),
    ].filter((file) => fs.existsSync(file));
    const before = new Map(
      generatedFiles.map((file) => [file, fs.readFileSync(file, "utf8")]),
    );

    const agent = writeAgentSettings(root, {
      enabled: true,
      siteInstructions: "Stay focused.",
      skills: [],
      inference: {
        providerInstances: {},
      },
    });

    expect(agent.siteInstructions).toBe("Stay focused.");
    expect(readSiteSettings(root).agent?.siteInstructions).toBe("Stay focused.");
    expect(
      generatedFiles.map((file) => fs.readFileSync(file, "utf8")),
    ).toEqual(generatedFiles.map((file) => before.get(file)));
  });

  it("retains a valid agent provider across reload and an unrelated settings save", () => {
    const instanceId = "00000000-0000-4000-8000-000000000123";
    const file = path.join(root, ".aria", "site-settings.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      siteName: "Before",
      agent: {
        enabled: true,
        inference: {
          default: { instanceId, modelId: "gpt-4.1-mini" },
          providerInstances: {
            [instanceId]: {
              id: instanceId,
              backend: "openai",
              label: "OpenAI",
              enabled: true,
              defaultModelId: "gpt-4.1-mini",
              enabledModelIds: ["gpt-4.1-mini"],
              legacyCatalogState: true,
            },
          },
        },
        legacyUiState: "expanded",
      },
    }));

    const loaded = readSiteSettings(root);
    expect(loaded.agent?.inference.providerInstances[instanceId]).toBeDefined();

    writeSiteSettings(root, { ...loaded, siteName: "After" });
    expect(
      readSiteSettings(root).agent?.inference.providerInstances[instanceId],
    ).toMatchObject({ id: instanceId, backend: "openai" });
  });

  it("bakes locale metadata into managed runtime middleware", () => {
    writeSiteSettings(root, {
      siteName: "Localized site",
      siteDescription: "",
      siteUrl: "https://example.com",
      timeZone: "UTC",
      favicon: "",
      localization: {
        content: {
          defaultLocale: "en",
          locales: [
            { code: "en", label: "English", enabled: true, direction: "ltr", fallbacks: [] },
            { code: "ar", label: "Arabic", enabled: true, direction: "rtl", fallbacks: ["en"], pathPrefix: "ar" },
          ],
        },
      },
    });

    const generated = fs.readFileSync(path.join(root, "src", "aria", "localization.generated.ts"), "utf8");
    const middleware = fs.readFileSync(path.join(root, "src", "aria", "snippets-middleware.ts"), "utf8");
    expect(generated).toContain('"direction": "rtl"');
    expect(generated).toContain('"siteUrl": "https://example.com"');
    expect(middleware).toContain("Content-Language");
    expect(middleware).toContain('hreflang="${variant.code}"');
    expect(middleware).toContain('normalized.startsWith("/__aria/")');
  });

  it("preserves an invalid stored locale policy during unrelated settings saves", () => {
    const file = path.join(root, ".aria", "site-settings.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const invalidLocalization = {
      content: {
        defaultLocale: "en",
        locales: [{ code: "en", label: "English", enabled: false, direction: "ltr", fallbacks: [] }],
      },
    };
    fs.writeFileSync(file, JSON.stringify({
      siteName: "Before", siteDescription: "", siteUrl: "", timeZone: "UTC", favicon: "",
      localization: invalidLocalization,
    }));

    const normalized = readSiteSettings(root);
    writeSiteSettings(root, { ...normalized, siteName: "After" });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).localization).toEqual(invalidLocalization);

    updateContentLocalization(root, {
      defaultLocale: "fr",
      locales: [{ code: "fr", label: "French", enabled: true, direction: "ltr", fallbacks: [] }],
    });
    expect(readSiteSettings(root).localization?.content.defaultLocale).toBe("fr");
  });

  it("rejects invalid fallback cycles instead of silently storing defaults", () => {
    expect(() => writeSiteSettings(root, {
      siteName: "Invalid",
      siteDescription: "",
      siteUrl: "",
      timeZone: "UTC",
      favicon: "",
      localization: { content: {
        defaultLocale: "en",
        locales: [
          { code: "en", label: "English", enabled: true, direction: "ltr", fallbacks: ["fr"] },
          { code: "fr", label: "French", enabled: true, direction: "ltr", fallbacks: ["en"] },
        ],
      } },
    })).toThrow(/Fallback cycle/);
  });
});
