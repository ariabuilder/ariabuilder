import { describe, expect, it } from "vitest";
import type { AriaCollectionDef } from "../types";
import {
  createCmsBindingFieldOptionGroups,
  createCmsBindingFieldOptions,
} from "./cmsFieldOptions";

function collection(input: Partial<AriaCollectionDef> & Pick<AriaCollectionDef, "id" | "name" | "label">): AriaCollectionDef {
  return {
    kind: "content",
    urlPattern: null,
    listPageFile: null,
    templatePageFile: null,
    ...input,
  };
}

describe("CMS binding field options", () => {
  const authors = collection({
    id: "authors-id",
    name: "authors",
    label: "Authors",
    schema: { version: 1, fields: [
      { key: "name", label: "Name", type: "string" },
      { key: "company", label: "Company", type: "reference", targetCollection: "companies-id" },
      { key: "profile", label: "Profile", type: "object", fields: [
        { key: "role", label: "Role", type: "string" },
      ] },
    ] },
  });
  const companies = collection({ id: "companies-id", name: "companies", label: "Companies", schema: { version: 1, fields: [{ key: "name", label: "Name", type: "string" }] } });
  const posts = collection({
    id: "posts-id",
    name: "posts",
    label: "Posts",
    schema: { version: 1, fields: [
      { key: "author", label: "Author", type: "reference", targetCollection: authors.id },
      { key: "tags", label: "Tags", type: "relation", targetCollection: "tags-id" },
      { key: "cards", label: "Cards", type: "repeater", fields: [{ key: "heading", label: "Heading", type: "string" }] },
      { key: "cover", label: "Cover", type: "image" },
    ] },
  });
  const tags = collection({ id: "tags-id", name: "tags", label: "Tags", schema: { version: 1, fields: [{ key: "label", label: "Label", type: "string" }] } });

  it("creates nested object, repeater, reference, and relation paths", () => {
    const options = createCmsBindingFieldOptions(posts, [posts, authors, tags, companies]);
    expect(options.map((option) => option.path)).toEqual(expect.arrayContaining([
      "cards.0.heading",
      "cover.src",
      "cover.alt",
      "author.name",
      "author.profile.role",
      "tags.0.label",
    ]));
    expect(options.find((option) => option.path === "author.name")?.relation).toMatchObject({
      sourceField: "author",
      targetCollection: "authors",
      targetField: "name",
      kind: "reference",
    });
    expect(options.find((option) => option.path === "tags.0.label")?.relation).toMatchObject({
      sourceField: "tags",
      targetCollection: "tags",
      targetField: "label",
      kind: "relation",
      index: 0,
    });
  });

  it("describes compatibility and semantic suggestions on the shared option contract", () => {
    const options = createCmsBindingFieldOptions(posts, [posts, authors, tags, companies]);
    expect(options.find((option) => option.path === "cover.src")).toMatchObject({
      compatibility: expect.arrayContaining(["image", "link"]),
      suggestions: expect.arrayContaining(["image"]),
    });
    expect(options.find((option) => option.path === "cover.alt")).toMatchObject({
      compatibility: expect.arrayContaining(["text", "alt"]),
      suggestions: expect.arrayContaining(["alt"]),
    });
  });

  it("stops after one related entry", () => {
    const options = createCmsBindingFieldOptions(posts, [posts, authors, tags, companies]);
    expect(options.some((option) => option.path === "author.company.name")).toBe(false);
  });

  it("ranks semantic matches without hiding the current binding", () => {
    const options = createCmsBindingFieldOptions(posts, [posts, authors, tags, companies]);
    const groups = createCmsBindingFieldOptionGroups(options, "text", "Heading", "tags.0.label");
    expect(groups[0]?.label).toBe("Recommended");
    expect(groups.flatMap((group) => group.options).some((option) => option.path === "tags.0.label")).toBe(true);
  });
});
