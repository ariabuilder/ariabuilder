// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectDataCatalogResult } from "../../../../shared/composer";
import type { AstroDocumentModel } from "../../../../shared/composer/types";
import { provideComposerBeacon } from "../selection/useComposerBeacon";
import { provideComposerDocument, type ComposerDocumentSession } from "../useComposerDocumentSession";
import ComposerDataSection from "./ComposerDataSection.vue";

const mocks = vi.hoisted(() => ({
  listProjectData: vi.fn(),
  inspectProjectData: vi.fn(),
  editProjectData: vi.fn(),
}));

vi.mock("@/lib/composer", () => ({
  listComposerProjectData: mocks.listProjectData,
  inspectComposerProjectData: mocks.inspectProjectData,
  editComposerProjectDataCatalogValue: mocks.editProjectData,
  revealComposerProjectData: vi.fn(),
  assessComposerProjectDataAdoption: vi.fn(),
  createComposerProjectDataDraft: vi.fn(),
  applyComposerProjectDataCutover: vi.fn(),
}));

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

  it("uses a grouped searchable picker and managed binding actions", () => {
    expect(source).toContain("listComposerProjectData")
    expect(source).toContain("<CommandInput")
    expect(source).toContain('v-for="group in groups"')
    expect(source).toContain("bindProjectDataTextAtPath")
    expect(source).toContain("unbindProjectDataTextAtPath")
    expect(source).toContain("m.composer_data_bind_field()")
    expect(source).toContain("m.composer_data_clear_binding()")
  })

  it("keeps the picker keyboard-operable with named live feedback", () => {
    expect(source).toContain('role="combobox"')
    expect(source).toContain(':aria-expanded="pickerOpen"')
    expect(source).toContain('role="status" aria-live="polite"')
    expect(source).toContain('role="alert" aria-live="assertive"')
  })
})

const mounted: Array<() => void> = [];
HTMLElement.prototype.scrollIntoView = vi.fn();

function catalog(): ProjectDataCatalogResult {
  return {
    groups: [{
      id: "current-item",
      label: "Current item",
      roots: [],
      fields: [{
        id: "title",
        group: "current-item",
        label: "Title",
        pathLabel: "Current item · Title",
        expression: "project.title",
        shape: "string",
        derivation: "literal",
        valuePath: ["title"],
        value: "Third",
        compatible: true,
        bindable: true,
        writable: true,
        sourceFile: "src/pages/index.astro",
        sourceHash: "hash",
        sourceRange: { from: 1, to: 2 },
      }, {
        id: "runtime",
        group: "current-item",
        label: "Runtime",
        pathLabel: "Current item · Runtime",
        expression: "project.runtime",
        shape: "unknown",
        derivation: "unresolved",
        valuePath: ["runtime"],
        compatible: false,
        bindable: false,
        writable: false,
        reason: "This value is computed at runtime.",
        sourceFile: "src/pages/index.astro",
      }],
    }, { id: "page", label: "This page", roots: [], fields: [] }, { id: "project", label: "Project files", roots: [], fields: [] }],
    sources: [],
    selectedFieldId: "title",
    expression: "project.title",
    managed: false,
    targetPath: "0.0",
    target: { kind: "text" },
    scannedAt: new Date(0).toISOString(),
  };
}

function mountSection() {
  const host = document.createElement("div");
  document.body.append(host);
  const model = ref<AstroDocumentModel | null>({
    imports: [],
    extraFrontmatter: 'const project = { title: "Third" };',
    nodes: [{
      id: "heading",
      kind: "element",
      name: "h3",
      props: { class: { type: "string", value: "title" } },
      children: [{ id: "title", kind: "expr", value: "{project.title}" }],
    }],
    propSchema: [],
    slots: [],
    extendsTag: null,
  });
  const app = createApp(defineComponent({
    setup() {
      const beacon = provideComposerBeacon();
      beacon.illuminate("0");
      provideComposerDocument({
        model,
        exactSource: ref('---\nconst project = { title: "Third" };\n---\n<h3 class="title">{project.title}</h3>'),
        editable: ref(true),
        mutationPending: ref(false),
        designActive: ref(true),
        saveError: ref(null),
        projectPath: ref("/project"),
        editFile: ref("src/pages/index.astro"),
        availableLayouts: ref([]),
        pages: ref([]),
        documentKind: ref("page"),
        instanceChain: ref([]),
        commitInspectorMutation: vi.fn(),
        flushSave: vi.fn().mockResolvedValue(undefined),
        reloadDocument: vi.fn().mockResolvedValue(undefined),
      } as unknown as ComposerDocumentSession);
      return () => h(ComposerDataSection);
    },
  }));
  app.mount(host);
  mounted.push(() => { app.unmount(); host.remove(); });
  return host;
}

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  document.body.querySelectorAll("[data-reka-popper-content-wrapper]").forEach((node) => node.remove());
  vi.clearAllMocks();
});

describe("ComposerDataSection behavior", () => {
  it("analyzes exact source separately from the current selection source and exposes target choice", async () => {
    mocks.listProjectData.mockResolvedValue(catalog());
    mocks.inspectProjectData.mockResolvedValue({ binding: null });
    const host = mountSection();
    await vi.waitFor(() => expect(host.textContent).toContain("Third"));
    const input = mocks.listProjectData.mock.calls[0]?.[1];
    expect(input.source).toContain('<h3 class="title">');
    expect(input.selectionSource).toContain("project.title");
    expect(input.selectionSource).not.toBe(input.source);
    expect(host.textContent).toContain("Bind to");
    expect(host.textContent).toContain("Text content");
    const targetTrigger = host.querySelector<HTMLElement>('[data-slot="select-trigger"]')!;
    targetTrigger.focus();
    targetTrigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(document.body.textContent).toContain("Property · Class"));
    const classTarget = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((item) => item.textContent?.includes("Property · Class"));
    expect(classTarget).toBeDefined();
    classTarget?.dispatchEvent(new Event("pointerup", { bubbles: true }));
    await vi.waitFor(() => expect(mocks.listProjectData.mock.calls.some((call) =>
      call[1]?.target?.kind === "prop" && call[1]?.target?.propName === "class",
    )).toBe(true));
  });

  it("keeps unresolved fields selectable and announces filtered results", async () => {
    mocks.listProjectData.mockResolvedValue(catalog());
    mocks.inspectProjectData.mockResolvedValue({ binding: null });
    const host = mountSection();
    await vi.waitFor(() => expect(host.textContent).toContain("Third"));
    const picker = host.querySelector<HTMLButtonElement>('[role="combobox"][aria-labelledby="composer-project-data-field-label"]')!;
    picker.click();
    await nextTick();
    const search = document.body.querySelector<HTMLInputElement>('[data-slot="command-input"]')!;
    search.value = "Runtime";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    expect(document.body.textContent).toContain("1 project fields");
    const runtime = [...document.body.querySelectorAll<HTMLElement>('[data-slot="command-item"]')]
      .find((item) => item.textContent?.includes("Runtime"));
    expect(runtime?.getAttribute("data-disabled")).toBeNull();
    expect(document.body.textContent).toContain("Read only");
    runtime?.click();
    await nextTick();
    expect(host.textContent).toContain("This value is computed at runtime.");
  });

  it("supports keyboard selection and restores focus when the picker closes", async () => {
    mocks.listProjectData.mockResolvedValue(catalog());
    mocks.inspectProjectData.mockResolvedValue({ binding: null });
    const host = mountSection();
    await vi.waitFor(() => expect(host.textContent).toContain("Third"));
    const picker = host.querySelector<HTMLButtonElement>('[role="combobox"][aria-labelledby="composer-project-data-field-label"]')!;
    picker.focus();
    picker.click();
    await nextTick();
    const search = document.body.querySelector<HTMLInputElement>('[data-slot="command-input"]')!;
    search.value = "Runtime";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await nextTick();
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(host.textContent).toContain("This value is computed at runtime."));
    expect(document.activeElement).toBe(picker);
  });

  it("rejects an invalid numeric draft before IPC mutation", async () => {
    const result = catalog();
    const field = result.groups[0]!.fields[0]!;
    field.shape = "number";
    field.value = 12;
    mocks.listProjectData.mockResolvedValue(result);
    mocks.inspectProjectData.mockResolvedValue({ binding: null });
    const host = mountSection();
    await vi.waitFor(() => expect(host.querySelector<HTMLInputElement>('#composer-project-data-value[type="number"]')).not.toBeNull());
    const input = host.querySelector<HTMLInputElement>("#composer-project-data-value")!;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    const save = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Save value"))!;
    save.click();
    await nextTick();
    expect(host.textContent).toContain("Enter a valid finite number.");
    expect(mocks.editProjectData).not.toHaveBeenCalled();
  });
});
