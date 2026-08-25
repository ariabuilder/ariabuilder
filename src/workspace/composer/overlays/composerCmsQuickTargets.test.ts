import { describe, expect, it } from "vitest";
import { parseAstro } from "../../../../shared/composer/parseAstro";
import { composerCmsQuickTargets } from "./composerCmsQuickTargets";

async function model(source: string) {
  const parsed = await parseAstro(source);
  if (!parsed.editable) throw new Error(parsed.reason);
  return parsed.model;
}

describe("Composer CMS quick targets", () => {
  it("groups image source and alt targets", async () => {
    const doc = await model(`<img src="/cover.jpg" alt="Cover" />`);
    expect(composerCmsQuickTargets(doc, "0", "image").map((target) => target.propName)).toEqual(["src", "alt"]);
  });

  it("groups link destination and editable label", async () => {
    const doc = await model(`<a href="/docs">Documentation</a>`);
    expect(composerCmsQuickTargets(doc, "0", "link").map((target) => [target.bindingKind, target.propName])).toEqual([
      ["prop", "href"],
      ["text", undefined],
    ]);
  });

  it("maps semantic descendants for a collection loop", async () => {
    const doc = await model(`<article><h2>Title</h2><p>Summary</p><img src="/cover.jpg" alt="Cover" /><a href="/read">Read</a></article>`);
    const targets = composerCmsQuickTargets(doc, "0", "loop");
    expect(targets.map((target) => target.targetKind)).toEqual(["text", "text", "image", "alt", "link", "text"]);
  });
});
