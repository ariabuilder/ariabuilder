import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyProjectDataCutover,
  assessProjectDataAdoption,
  createProjectDataDraft,
  editComposerProjectData,
  inspectComposerProjectData,
} from "./projectData";
import { configureMutationCoordinator, runProjectMutation } from "../mutations";
import { readCollections } from "../collections";
import { getEntry } from "../cms";
import { parseAstro } from "../../shared/composer/parseAstro";

const roots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-project-data-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "src", "config"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { baseUrl: ".", paths: { "@config/*": ["src/config/*"] }, moduleResolution: "bundler" },
  }));
  const data = `const portfolioData = {
  profile: {
    heading: "The Full-Stack Dev",
    bio: ["First paragraph", "Second paragraph"],
    skills: [{ label: "Frontend", pct: 95 }],
  },
  stats: { profile: ["Class: Dev", "Lvl: 8+"] },
  enabled: true,
} as const;
export default portfolioData;
`;
  fs.writeFileSync(path.join(root, "src", "config", "portfolioData.json.ts"), data);
  const source = `---
import portfolioData from "@config/portfolioData.json";
const { heading, bio } = portfolioData.profile;
---
<h1>{heading}</h1>
<div>{bio.map((para) => <p>{para}</p>)}</div>
`;
  fs.writeFileSync(path.join(root, "src", "components", "Hero.astro"), source);
  return { root, source, data };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Composer project data", () => {
  it.skipIf(!process.env.ARIA_PROJECT_DATA_PROJECT)("resolves the configured real Astro project", async () => {
    const root = process.env.ARIA_PROJECT_DATA_PROJECT!;
    const relativeFile = "src/components/Sections/About/Hero.astro";
    const source = fs.readFileSync(path.join(root, relativeFile), "utf8");
    const binding = inspectComposerProjectData(root, {
      relativeFile,
      source,
      expression: "bio.map((para) => (",
    }).binding;
    expect(binding).toMatchObject({
      ownership: "project",
      sourceFile: "src/config/portfolioData.json.ts",
      valuePath: ["profile", "bio"],
      itemCount: 2,
    });
    const assessment = await assessProjectDataAdoption(root, { relativeFile, source, expression: "bio.map((para) => (" });
    expect(assessment.collectionName).toBe("portfolio-data");
    expect(assessment.fields.map((item) => item.field.key)).toEqual(expect.arrayContaining(["profile", "stats", "home", "contact"]));
  });

  it("resolves an aliased import and destructured array without running project code", () => {
    const { root, source } = fixture();
    const result = inspectComposerProjectData(root, {
      relativeFile: "src/components/Hero.astro",
      source,
      expression: "bio.map((para) => (",
    });
    expect(result.binding).toMatchObject({
      ownership: "project",
      sourceFile: "src/config/portfolioData.json.ts",
      rootExport: "portfolioData",
      valuePath: ["profile", "bio"],
      shape: "array",
      itemCount: 2,
      value: ["First paragraph", "Second paragraph"],
      writable: true,
    });
  });

  it("resolves aliased named imports and property access", () => {
    const { root } = fixture();
    fs.writeFileSync(path.join(root, "src", "config", "siteData.ts"), 'export const siteData = { nav: { label: "Home" } };\n');
    const source = `---\nimport { siteData as site } from "@config/siteData";\n---\n<span>{site.nav.label}</span>\n`;
    fs.writeFileSync(path.join(root, "src", "components", "Nav.astro"), source);
    expect(inspectComposerProjectData(root, {
      relativeFile: "src/components/Nav.astro",
      source,
      expression: "site.nav.label",
    }).binding).toMatchObject({
      ownership: "project",
      sourceFile: "src/config/siteData.ts",
      rootExport: "siteData",
      valuePath: ["nav", "label"],
      value: "Home",
    });
  });

  it("resolves nested destructuring aliases", () => {
    const { root } = fixture();
    const source = `---\nimport portfolioData from "@config/portfolioData.json";\nconst { profile: { bio: paragraphs } } = portfolioData;\n---\n{paragraphs.map((paragraph) => <p>{paragraph}</p>)}\n`;
    fs.writeFileSync(path.join(root, "src", "components", "Nested.astro"), source);
    expect(inspectComposerProjectData(root, {
      relativeFile: "src/components/Nested.astro",
      source,
      expression: "paragraphs.map((paragraph) => (",
    }).binding).toMatchObject({ ownership: "project", valuePath: ["profile", "bio"], itemCount: 2 });
  });

  it("infers the whole exported object and wraps scalar arrays as repeaters", async () => {
    const { root, source } = fixture();
    const assessment = await assessProjectDataAdoption(root, {
      relativeFile: "src/components/Hero.astro",
      source,
      expression: "bio.map((para) => (",
    });
    expect(assessment.collectionName).toBe("portfolio-data");
    expect(assessment.fields.map((item) => item.field.key)).toEqual(["profile", "stats", "enabled"]);
    const profile = assessment.fields[0]!.field;
    const bio = profile.fields?.find((field) => field.key === "bio");
    expect(bio).toMatchObject({ type: "repeater", fields: [{ key: "value", type: "string" }] });
    expect((assessment.frontmatter.profile as Record<string, unknown>).bio).toEqual([
      { value: "First paragraph" },
      { value: "Second paragraph" },
    ]);
    expect(assessment.consumers.map((item) => [item.valuePath.join("."), item.status])).toEqual(
      expect.arrayContaining([
        ["profile.heading", "safe"],
        ["profile.bio", "safe"],
      ]),
    );
  });

  it("cuts over selected consumers with fallbacks and retains the source module", async () => {
    const { root, source, data } = fixture();
    const input = {
      relativeFile: "src/components/Hero.astro",
      source,
      expression: "bio.map((para) => (",
      collectionName: "portfolio-data",
      entrySlug: "portfolio-data",
    };
    const assessment = await assessProjectDataAdoption(root, input);
    const bioConsumer = assessment.consumers.find((item) => item.valuePath.join(".") === "profile.bio")!;
    const result = await applyProjectDataCutover(root, {
      ...input,
      expectedPreviewHash: assessment.previewHash,
      collectionId: "collection-id",
      consumerIds: [bioConsumer.id],
    });
    expect(result.changedFiles).toEqual(["src/components/Hero.astro"]);
    const next = fs.readFileSync(path.join(root, "src", "components", "Hero.astro"), "utf8");
    expect(next).toContain('getCollection("portfolio-data")');
    expect(next).toContain('?.["bio"]?.map((item) => item?.value) ?? /* @aria-cms-fallback */ (bio)');
    expect((await parseAstro(next, { filename: "Hero.astro" })).editable).toBe(true);
    expect(fs.readFileSync(path.join(root, "src", "config", "portfolioData.json.ts"), "utf8")).toBe(data);
  });

  it("creates a draft atomically without changing project data or consumers", async () => {
    const { root, source, data } = fixture();
    const history = fs.mkdtempSync(path.join(os.tmpdir(), "aria-project-data-history-"));
    roots.push(history);
    configureMutationCoordinator(history);
    const input = {
      relativeFile: "src/components/Hero.astro",
      source,
      expression: "bio.map((para) => (",
    };
    const assessment = await assessProjectDataAdoption(root, input);
    const result = await runProjectMutation(
      root,
      { actor: "user", surface: "cms", operation: "adopt project data", targets: [] },
      () => createProjectDataDraft(root, { ...input, expectedPreviewHash: assessment.previewHash }),
    );
    expect(result.status).toBe("draft");
    expect(readCollections(root).collections).toEqual([
      expect.objectContaining({ id: result.collectionId, name: "portfolio-data", kind: "config" }),
    ]);
    expect(getEntry(root, result.collectionId, result.entrySlug)?.entry.status).toBe("draft");
    expect(fs.readFileSync(path.join(root, "src", "config", "portfolioData.json.ts"), "utf8")).toBe(data);
    expect(fs.readFileSync(path.join(root, "src", "components", "Hero.astro"), "utf8")).toBe(source);
  });

  it("patches only the selected literal and rejects a stale source hash", () => {
    const { root, source } = fixture();
    const binding = inspectComposerProjectData(root, {
      relativeFile: "src/components/Hero.astro",
      source,
      expression: "bio.map((para) => (",
    }).binding;
    const input = {
      relativeFile: "src/components/Hero.astro",
      source,
      expression: "bio.map((para) => (",
      expectedSourceHash: binding.sourceHash!,
      valuePath: ["profile", "bio", "1"],
      value: "Updated paragraph",
    };
    expect(editComposerProjectData(root, input).ok).toBe(true);
    const next = fs.readFileSync(path.join(root, "src/config/portfolioData.json.ts"), "utf8");
    expect(next).toContain('["First paragraph", "Updated paragraph"]');
    expect(() => editComposerProjectData(root, input)).toThrow("PROJECT_DATA_CONFLICT");
  });

  it("keeps runtime expressions read-only", () => {
    const { root, source } = fixture();
    expect(inspectComposerProjectData(root, {
      relativeFile: "src/components/Hero.astro",
      source,
      expression: "getItems().map((item) => (",
    }).binding).toMatchObject({ ownership: "computed", writable: false });
  });
});
