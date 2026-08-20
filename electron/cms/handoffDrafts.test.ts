import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHandoffDraft, readHandoffDrafts } from "./handoffDrafts";

describe("external CMS handoff drafts", () => {
  it("stores an explicit local-unapplied patch without provider credentials", () => {
    const root = mkdtempSync(path.join(tmpdir(), "aria-handoff-"));
    const draft = createHandoffDraft(root, {
      provider: "sanity",
      collection: "articles",
      recordId: "article-1",
      sourceVersion: "rev-7",
      sourceContentHash: "content-123",
      targetLocale: "fr-CA",
      proposedFieldPatch: { title: "Bonjour", summary: "Résumé" },
    });
    expect(draft.state).toBe("local-unapplied");
    expect(readHandoffDrafts(root)).toEqual([draft]);
  });

  it("rejects secret-shaped fields at any depth", () => {
    const root = mkdtempSync(path.join(tmpdir(), "aria-handoff-"));
    expect(() => createHandoffDraft(root, {
      provider: "payload",
      collection: "posts",
      recordId: "1",
      sourceContentHash: "hash",
      targetLocale: "fr",
      proposedFieldPatch: { metadata: { apiToken: "do-not-store" } },
    })).toThrow(/cannot contain credentials/i);
  });
});
