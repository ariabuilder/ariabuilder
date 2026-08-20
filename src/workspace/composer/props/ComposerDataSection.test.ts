import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(import.meta.dirname, "ComposerDataSection.vue"), "utf8");

describe("ComposerDataSection interaction contract", () => {
  it("keeps draft creation and consumer cutover as separate explicit actions", () => {
    expect(source).toContain("createComposerProjectDataDraft")
    expect(source).toContain("applyComposerProjectDataCutover")
    expect(source).toContain("m.composer_data_create_draft()")
    expect(source).toContain("m.composer_data_apply_cutover()")
  })

  it("labels controls and announces save, adoption, and error states", () => {
    expect(source).toContain('for="composer-project-data-value"')
    expect(source).toContain('id="composer-project-data-value"')
    expect(source).toContain('role="status" aria-live="polite"')
    expect(source).toContain('role="alert"')
    expect(source).toContain(':aria-label="`Cut over ${consumer.file}`"')
  })

  it("states that creating a draft does not alter existing source bindings", () => {
    expect(source).toContain("m.composer_data_adopt_description()")
    expect(source).toContain("m.composer_data_source_unchanged()")
    expect(source).toContain("m.composer_data_draft_created()")
  })
})
